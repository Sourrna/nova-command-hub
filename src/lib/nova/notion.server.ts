// Read-only transport. Credentials are supplied by a request-time server boundary.
export const NOTION_VERSION = "2025-09-03";
export type NotionCode = "missing" | "auth" | "permission" | "rate" | "network" | "error";
export type NotionResult = { ok: true; results: NotionItem[]; nextCursor: string | null } | { ok: false; code: NotionCode; error: string; status?: number };
export interface NotionItem { id: string; title: string; kind: "page" | "data_source"; url: string | null; editedAt: string | null }
export interface NotionCredentials { token?: string | undefined; gatewayKey?: string | undefined; mode: "direct" | "gateway" }

export function notionCredentials(bindings: Record<string, unknown>): NotionCredentials {
  const text = (key: string) => typeof bindings[key] === "string" ? bindings[key] as string : undefined;
  return { token: text("NOTION_API_KEY"), gatewayKey: text("LOVABLE_API_KEY"), mode: text("NOTION_API_MODE") === "direct" || !text("LOVABLE_API_KEY") ? "direct" : "gateway" };
}

function safeText(value: unknown, secrets: string[]): string {
  let text = typeof value === "string" ? value : "";
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text.slice(0, 500);
}

export async function searchNotion(credentials: NotionCredentials, input: { query?: string; cursor?: string } = {}, fetcher: typeof fetch = fetch): Promise<NotionResult> {
  const { token, gatewayKey, mode } = credentials;
  if (!token || (mode === "gateway" && !gatewayKey)) return { ok: false, code: "missing", error: "Notion credentials are missing from this request’s server environment." };
  const secrets = [token, gatewayKey].filter((s): s is string => Boolean(s));
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Notion-Version": NOTION_VERSION };
    if (mode === "gateway" && gatewayKey) {
      headers["Authorization"] = `Bearer ${gatewayKey}`;
      headers["X-Connection-Api-Key"] = token;
    } else headers["Authorization"] = `Bearer ${token}`;
    const response = await fetcher(`${mode === "gateway" ? "https://connector-gateway.lovable.dev/notion" : "https://api.notion.com"}/v1/search`, {
      method: "POST", headers, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ page_size: 50, sort: { direction: "descending", timestamp: "last_edited_time" }, ...(input.query ? { query: input.query } : {}), ...(input.cursor ? { start_cursor: input.cursor } : {}) }),
    });
    // Never log or return provider bodies: they can contain credentials or private content.
    if (!response.ok) {
      const status = response.status;
      if (status === 401) return { ok: false, code: "auth", status, error: "Notion rejected the credentials. Check the connection or integration token." };
      if (status === 403) return { ok: false, code: "permission", status, error: "Notion denied access. Share the relevant pages with the integration and check its read permissions." };
      if (status === 429) return { ok: false, code: "rate", status, error: "Notion’s request limit was reached. Wait before retrying." };
      return { ok: false, code: "error", status, error: `Notion request failed (${status}).` };
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.results)) return { ok: false, code: "error", error: "Notion returned an unexpected response." };
    const results: NotionItem[] = [];
    for (const item of payload.results) {
      if (!item || (item.object !== "page" && item.object !== "data_source") || typeof item.id !== "string") continue;
      const property = Object.values(item.properties ?? {}).find((p: any) => p?.type === "title") as { title?: { plain_text?: string }[] } | undefined;
      const title = item.object === "data_source" ? item.title : property?.title;
      const url = safeText(item.url, secrets);
      results.push({ id: safeText(item.id, secrets), kind: item.object, title: safeText(Array.isArray(title) ? title.map((part: any) => part.plain_text ?? "").join("") : "", secrets) || "Untitled", url: /^https:\/\/(www\.)?notion\.(so|site)\//.test(url) ? url : null, editedAt: typeof item.last_edited_time === "string" && Number.isFinite(Date.parse(item.last_edited_time)) ? new Date(item.last_edited_time).toISOString() : null });
    }
    const cursor = typeof payload.next_cursor === "string" && payload.has_more ? payload.next_cursor : null;
    return { ok: true, results, nextCursor: cursor && !secrets.some((s) => cursor.includes(s)) ? cursor : null };
  } catch (error) {
    return { ok: false, code: error instanceof SyntaxError ? "error" : "network", error: error instanceof SyntaxError ? "Notion returned an unreadable response." : "Notion could not be reached or the request timed out." };
  }
}