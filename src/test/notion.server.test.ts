import { describe, expect, it } from "vitest";
import { notionCreatePage, NOTION_VERSION } from "@/lib/nova/notion.server";

const withKey = () => {
  const orig = { ...process.env };
  process.env["NOTION_API_KEY"] = "test-key";
  return () => { Object.assign(process.env, orig); delete process.env["NOTION_API_KEY"]; };
};

const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const status = (s: number) =>
  (async () => new Response("secret-leak", { status: s })) as unknown as typeof fetch;

describe("notionCreatePage (write adapter)", () => {
  it("returns missing when NOTION_API_KEY is not set", async () => {
    const restore = withKey();
    delete process.env["NOTION_API_KEY"];
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, ok({ id: "x" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("missing");
    } finally { restore(); }
  });

  it("POSTs to /pages with the title and body", async () => {
    const restore = withKey();
    try {
      const calls: { url: string; init: RequestInit }[] = [];
      const f = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "page-123" }), { status: 200 });
      }) as unknown as typeof fetch;
      const r = await notionCreatePage({ title: "Hello", body: "World" }, f);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.id).toBe("page-123");
      const call = calls[0];
      expect(call?.url).toContain("/pages");
      expect((call?.init as { method?: string } | undefined)?.method).toBe("POST");
      const headers = (call?.init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      expect(headers["Authorization"]).toBe("Bearer test-key");
      expect(headers["Notion-Version"]).toBe(NOTION_VERSION);
      const body = JSON.parse((call?.init as { body?: string } | undefined)?.body ?? "{}");
      expect(body.children[0].paragraph.rich_text[0].text.content).toBe("World");
    } finally { restore(); }
  });

  it("returns auth on 401", async () => {
    const restore = withKey();
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally { restore(); }
  });

  it("returns auth on 403", async () => {
    const restore = withKey();
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, status(403));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally { restore(); }
  });

  it("returns error on 500", async () => {
    const restore = withKey();
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, status(500));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally { restore(); }
  });

  it("returns error on network failure", async () => {
    const restore = withKey();
    try {
      const f = (async () => { throw new TypeError("boom"); }) as unknown as typeof fetch;
      const r = await notionCreatePage({ title: "T", body: "B" }, f);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("error");
        expect(r.error).toContain("unreachable");
      }
    } finally { restore(); }
  });

  it("does not leak the token in error payloads", async () => {
    const restore = withKey();
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, status(401));
      expect(JSON.stringify(r)).not.toContain("test-key");
    } finally { restore(); }
  });

  it("includes a database parent when databaseId is provided", async () => {
    const restore = withKey();
    try {
      const calls: { init: RequestInit }[] = [];
      const f = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ init });
        return new Response(JSON.stringify({ id: "p" }), { status: 200 });
      }) as unknown as typeof fetch;
      await notionCreatePage({ title: "T", body: "B", databaseId: "db-1" }, f);
      const body = JSON.parse((calls[0]?.init as { body?: string } | undefined)?.body ?? "{}");
      expect(body.parent.database).toBe("db-1");
    } finally { restore(); }
  });
});