import type { NovaCloudflareEnv } from "./cloudflare-runtime.server";

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

interface AccessClaims {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
}

interface AccessJwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeSegment<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function configuredIssuer(env: NovaCloudflareEnv): { issuer: string; audience: string } {
  const domain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const audience = env.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) {
    throw new AuthenticationError("Cloudflare Access identity is not configured.");
  }
  return { issuer: `https://${domain}`, audience };
}

export async function authenticateCloudflareAccess(
  request: Request,
  env: NovaCloudflareEnv,
  fetchImpl: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AuthenticatedUser> {
  const { issuer, audience } = configuredIssuer(env);
  const token = request.headers.get("CF-Access-JWT-Assertion");
  if (!token) throw new AuthenticationError("A verified Cloudflare Access identity is required.");
  const segments = token.split(".");
  if (segments.length !== 3) throw new AuthenticationError("Cloudflare Access token is invalid.");

  let header: { alg?: unknown; kid?: unknown };
  let claims: AccessClaims;
  try {
    header = decodeSegment(segments[0]!);
    claims = decodeSegment(segments[1]!);
  } catch {
    throw new AuthenticationError("Cloudflare Access token is invalid.");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw new AuthenticationError("Cloudflare Access token uses an unsupported signing key.");
  }
  if (claims.iss !== issuer || typeof claims.sub !== "string" || !claims.sub) {
    throw new AuthenticationError("Cloudflare Access token identity is invalid.");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) throw new AuthenticationError("Cloudflare Access token is for another application.");
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) throw new AuthenticationError("Cloudflare Access token has expired.");
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds) throw new AuthenticationError("Cloudflare Access token is not yet valid.");

  let keys: AccessJwk[];
  try {
    const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("JWKS request failed");
    const body = await response.json() as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error("JWKS response invalid");
    keys = body.keys as AccessJwk[];
  } catch {
    throw new AuthenticationError("Cloudflare Access signing keys could not be verified.");
  }

  const key = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA" && candidate.alg === "RS256" && candidate.use !== "enc");
  if (!key) throw new AuthenticationError("Cloudflare Access signing key was not found.");
  try {
    const cryptoKey = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const data = Uint8Array.from(new TextEncoder().encode(`${segments[0]}.${segments[1]}`));
    const signature = Uint8Array.from(decodeBase64Url(segments[2]!));
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      signature.buffer,
      data.buffer,
    );
    if (!valid) throw new Error("signature mismatch");
  } catch {
    throw new AuthenticationError("Cloudflare Access token signature is invalid.");
  }
  return { id: claims.sub, ...(typeof claims.email === "string" ? { email: claims.email } : {}) };
}
