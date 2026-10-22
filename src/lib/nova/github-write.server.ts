// Server-only GitHub write adapter. Callers must enforce authorization and
// explicit approval before invoking it. This module never reads client keys.

const GATEWAY = "https://connector-gateway.lovable.dev/github";
const DIRECT = "https://api.github.com";

export type GitHubWriteResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; code: "missing" | "auth" | "permission" | "rate" | "error"; error: string };

function failure(status: number, rateRemaining?: string | null): GitHubWriteResult<never> {
  if (status === 401) return { ok: false, code: "auth", error: "GitHub rejected the credentials." };
  if (status === 403) {
    return rateRemaining === "0"
      ? { ok: false, code: "rate", error: "GitHub rate limited the request; try again later." }
      : { ok: false, code: "permission", error: "GitHub refused the request; check repository access and token permissions." };
  }
  if (status === 429) return { ok: false, code: "rate", error: "GitHub rate limited the request; try again later." };
  return { ok: false, code: "error", error: `GitHub request failed (${status}).` };
}

export async function githubWriteRequest<T>(
  method: "POST" | "PATCH",
  path: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubWriteResult<T>> {
  const githubKey = process.env["GITHUB_API_KEY"];
  if (!githubKey) return { ok: false, code: "missing", error: "GitHub write credentials are not configured." };

  const lovableKey = process.env["LOVABLE_API_KEY"];
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(lovableKey
      ? { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": githubKey }
      : { Authorization: `Bearer ${githubKey}` }),
  };

  try {
    const response = await fetchImpl(`${lovableKey ? GATEWAY : DIRECT}/${path}`, {
      method,
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return failure(response.status, response.headers.get("X-RateLimit-Remaining"));
    }
    return { ok: true, data: await response.json() as T, status: response.status };
  } catch {
    return { ok: false, code: "error", error: "GitHub unreachable or timed out." };
  }
}
