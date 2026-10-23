import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { authenticateCloudflareAccess, AuthenticationError } from "@/lib/nova/cloudflare-access.server";
import { getRequestEnvironment, registerRequestEnvironment } from "@/lib/nova/cloudflare-runtime.server";

const issuer = "https://nova-team.cloudflareaccess.com";
const audience = "access-app-audience";
let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function token(claims: Record<string, unknown>, mutateSignature = false): Promise<string> {
  const head = encode({ alg: "RS256", kid: "test-key" });
  const body = encode(claims);
  const bytes = new TextEncoder().encode(`${head}.${body}`);
  const signature = new Uint8Array(await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, bytes));
  if (mutateSignature) signature[0] = signature[0]! ^ 0xff;
  const encodedSignature = btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${head}.${body}.${encodedSignature}`;
}

function makeRequest(jwt?: string): Request {
  return new Request("https://nova.example.test/api", {
    headers: jwt ? { "CF-Access-JWT-Assertion": jwt } : {},
  });
}

const env = {
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "nova-team.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: audience,
};

beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  const keys = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]);
  privateKey = keys.privateKey;
  publicJwk = {
    ...await webcrypto.subtle.exportKey("jwk", keys.publicKey),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
});

describe("Cloudflare Access identity verification", () => {
  it("accepts only a signed token for the configured issuer, audience, and subject", async () => {
    const jwt = await token({ iss: issuer, sub: "access-user-42", aud: [audience], exp: 2000, nbf: 900, email: "user@example.test" });
    const fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] })) as typeof fetch;
    await expect(authenticateCloudflareAccess(makeRequest(jwt), env, fetchMock, 1000))
      .resolves.toEqual({ id: "access-user-42", email: "user@example.test" });
  });

  it.each([
    [{ iss: issuer, sub: "user", aud: [audience], exp: 900 }, "expired"],
    [{ iss: issuer, sub: "user", aud: ["another-app"], exp: 2000 }, "another application"],
    [{ iss: "https://attacker.example", sub: "user", aud: [audience], exp: 2000 }, "identity is invalid"],
    [{ iss: issuer, sub: "user", aud: [audience], exp: 2000, nbf: 1001 }, "not yet valid"],
  ])("rejects invalid claims (%s)", async (claims, expected) => {
    const jwt = await token(claims);
    const fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] })) as typeof fetch;
    await expect(authenticateCloudflareAccess(makeRequest(jwt), env, fetchMock, 1000))
      .rejects.toThrow(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing identity, invalid signatures, and unavailable signing keys", async () => {
    const fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] })) as typeof fetch;
    await expect(authenticateCloudflareAccess(makeRequest(), env, fetchMock, 1000))
      .rejects.toBeInstanceOf(AuthenticationError);
    const invalid = await token({ iss: issuer, sub: "user", aud: [audience], exp: 2000 }, true);
    await expect(authenticateCloudflareAccess(makeRequest(invalid), env, fetchMock, 1000))
      .rejects.toThrow("signature is invalid");
    const unavailable = vi.fn(async () => new Response("", { status: 503 })) as typeof fetch;
    const valid = await token({ iss: issuer, sub: "user", aud: [audience], exp: 2000 });
    await expect(authenticateCloudflareAccess(makeRequest(valid), env, unavailable, 1000))
      .rejects.toThrow("signing keys could not be verified");
  });

  it("fails closed when the Access application is not configured", async () => {
    await expect(authenticateCloudflareAccess(makeRequest("x.y.z"), {}, fetch, 1000))
      .rejects.toThrow("not configured");
  });

  it("scopes Worker bindings to the request and unregisters them after completion", () => {
    const request = makeRequest();
    const bindings = { CLOUDFLARE_ACCESS_AUD: audience };
    const unregister = registerRequestEnvironment(request, bindings);
    expect(getRequestEnvironment(request)).toBe(bindings);
    unregister();
    expect(getRequestEnvironment(request)).toEqual({});
  });
});
