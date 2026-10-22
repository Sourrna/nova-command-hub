// Server-only GitHub adapter. Read-only. Two transports, tried in order:
//  1. Lovable connector gateway (https://connector-gateway.lovable.dev/github)
//     — used when LOVABLE_API_KEY is present; authenticates via Lovable + the
//       connection's own GITHUB_API_KEY.
//  2. Direct GitHub REST API — used when only GITHUB_API_KEY is set, so the
//     connector also works outside Lovable (local dev, other hosts).
// Keys are read from process.env by callers and never returned, logged, or
// echoed in errors.

const GATEWAY = "https://connector-gateway.lovable.dev/github";
const DIRECT = "https://api.github.com";
export const GH_REPO = "Sourrna/nova-brand-ai";

export type GhResult<T> = { ok: true; data: T } | { ok: false; code: "missing" | "auth" | "rate" | "error"; error: string };

function classify(status: number): GhResult<never> {
  if (status === 401) return { ok: false, code: "auth", error: "GitHub rejected the credentials." };
  if (status === 403 || status === 429) return { ok: false, code: "rate", error: `GitHub refused (${status}); rate limit or permission.` };
  return { ok: false, code: "error", error: `GitHub request failed (${status}).` };
}

async function request<T>(url: string, headers: Record<string, string>, f: typeof fetch): Promise<GhResult<T>> {
  try {
    const r = await f(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      console.error(`GitHub [${r.status}]: ${body}`);
      return classify(r.status);
    }
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, code: "error", error: "GitHub unreachable or timed out." };
  }
}

export async function ghGet<T>(path: string, f: typeof fetch = fetch): Promise<GhResult<T>> {
  const lk = process.env["LOVABLE_API_KEY"];
  const gk = process.env["GITHUB_API_KEY"];

  if (!gk && !lk) {
    // No credentials at all. Public repositories can still be read without
    // authentication (lower rate limit, but functional). If the repo is
    // private this call will 401 and the caller reports "auth".
    return request<T>(`${DIRECT}/${path}`, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }, f);
  }

  if (!gk) {
    // Lovable key present but no GitHub token — the Lovable gateway needs both,
    // so fall back to unauthenticated direct access for public repos.
    return request<T>(`${DIRECT}/${path}`, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }, f);
  }

  // Prefer the Lovable connector gateway when both keys are present, so the
  // deployed Lovable environment keeps using its own connection configuration.
  if (lk) {
    return request<T>(`${GATEWAY}/${path}`, {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${lk}`,
      "X-Connection-Api-Key": gk,
    }, f);
  }

  // Fallback: direct GitHub REST API with the token. Works locally and on any
  // host that has GITHUB_API_KEY configured. The token is sent as a bearer
  // token and never stored in the browser, in Git, or in chat.
  return request<T>(`${DIRECT}/${path}`, {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${gk}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }, f);
}