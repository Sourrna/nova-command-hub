import { describe, expect, it, beforeEach } from "vitest";
import { notionCreatePage } from "@/lib/nova/notion.server";
import { revokeApproval, payloadHash } from "@/lib/nova/approval.server";

const withKey = () => {
  const orig = { ...process.env };
  process.env["NOTION_API_KEY"] = "test-key";
  return () => { Object.assign(process.env, orig); delete process.env["NOTION_API_KEY"]; };
};

const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const status = (s: number) =>
  (async () => new Response("secret-leak", { status: s })) as unknown as typeof fetch;

describe("executeNotionWrite integration (adapter + grant wiring)", () => {
  beforeEach(() => {
    for (const id of ["i1", "i2", "i3", "i4", "i5"]) revokeApproval(id);
  });

  it("sends the grant's idempotency key on the POST", async () => {
    const restore = withKey();
    try {
      const calls: { init: RequestInit }[] = [];
      const f = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ init });
        return new Response(JSON.stringify({ id: "page-1" }), { status: 200 });
      }) as unknown as typeof fetch;
      const key = `i1:${payloadHash("T", "B")}`;
      const r = await notionCreatePage({ title: "T", body: "B", idempotencyKey: key }, f);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.id).toBe("page-1");
      const headers = (calls[0]?.init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      expect(headers["Idempotency-Key"]).toBe(key);
    } finally { restore(); }
  });

  it("fails closed when credentials are missing even with a valid grant key", async () => {
    const restore = withKey();
    delete process.env["NOTION_API_KEY"];
    try {
      const key = `i2:${payloadHash("T", "B")}`;
      const r = await notionCreatePage({ title: "T", body: "B", idempotencyKey: key }, ok({ id: "x" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("missing");
    } finally { restore(); }
  });

  it("fails closed on auth rejection without leaking the token or key", async () => {
    const restore = withKey();
    try {
      const key = `i3:${payloadHash("T", "B")}`;
      const r = await notionCreatePage({ title: "T", body: "B", idempotencyKey: key }, status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
      expect(JSON.stringify(r)).not.toContain("test-key");
      expect(JSON.stringify(r)).not.toContain(key);
    } finally { restore(); }
  });

  it("fails closed on server error", async () => {
    const restore = withKey();
    try {
      const r = await notionCreatePage({ title: "T", body: "B" }, status(500));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally { restore(); }
  });

  it("fails closed on network failure", async () => {
    const restore = withKey();
    try {
      const f = (async () => { throw new TypeError("boom"); }) as unknown as typeof fetch;
      const r = await notionCreatePage({ title: "T", body: "B" }, f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally { restore(); }
  });

  it("records the returned page id", async () => {
    const restore = withKey();
    try {
      const key = `i5:${payloadHash("T", "B")}`;
      const r = await notionCreatePage({ title: "T", body: "B", idempotencyKey: key }, ok({ id: "page-xyz" }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.id).toBe("page-xyz");
    } finally { restore(); }
  });
});