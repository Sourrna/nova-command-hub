// Server-only GitHub adapter via the Lovable connector gateway. Read-only.
const GATEWAY = "https://connector-gateway.lovable.dev/github";
export const GH_REPO = "Sourrna/nova-brand-ai";

export type GhResult<T> = { ok: true; data: T } | { ok: false; code: "missing" | "auth" | "rate" | "error"; error: string };

export async function ghGet<T>(path: string, f: typeof fetch = fetch): Promise<GhResult<T>> {
  const lk = process.env.LOVABLE_API_KEY, gk = process.env.GITHUB_API_KEY;
  if (!lk || !gk) return { ok: false, code: "missing", error: "GitHub connection not linked." };
  try {
    const r = await f(`${GATEWAY}/${path}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": gk },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      console.error(`GitHub gateway [${r.status}]: ${body}`);
      if (r.status === 401) return { ok: false, code: "auth", error: "GitHub rejected the credentials." };
      if (r.status === 403 || r.status === 429) return { ok: false, code: "rate", error: `GitHub refused (${r.status}); rate limit or permission.` };
      return { ok: false, code: "error", error: `GitHub request failed (${r.status}).` };
    }
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, code: "error", error: "GitHub unreachable or timed out." };
  }
}
