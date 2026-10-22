import { describe, expect, it, vi } from "vitest";
import {
  notionGet,
  notionSearch,
  notionFetchPage,
  notionListChildren,
  NOTION_VERSION,
} from "@/lib/nova/notion.server";

const withKey = () => {
  const orig = { ...process.env };
  process.env["NOTION_API_KEY"] = "test-key";
  return () => {
    Object.assign(process.env, orig);
    delete process.env["NOTION_API_KEY"];
  };
};

const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const status = (s: number) =>
  vi.fn(async () => new Response("secret-leak", { status: s })) as unknown as typeof fetch;

const network = () =>
  vi.fn(async () => {
    throw new TypeError("boom");
  }) as unknown as typeof fetch;

describe("Notion connector (notion.server)", () => {
  it("returns missing when NOTION_API_KEY is not set", async () => {
    const restore = withKey();
    delete process.env["NOTION_API_KEY"];
    try {
      const f = ok({});
      const r = await notionGet("search", { method: "GET" }, f);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("missing");
        expect(r.error).toContain("not linked");
      }
      expect(f).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("sends the integration token as a bearer token", async () => {
    const restore = withKey();
    try {
      const f = ok({ results: [] });
      const r = await notionSearch("Nova", f);
      expect(r.ok).toBe(true);
      const calls = (
        f as unknown as {
          mock: {
            calls: [string, { headers: Record<string, string> }][];
          };
        }
      ).mock.calls;
      const call = calls[0];
      expect(call?.[1]?.headers?.["Authorization"]).toBe("Bearer test-key");
      expect(call?.[1]?.headers?.["Notion-Version"]).toBe(NOTION_VERSION);
    } finally {
      restore();
    }
  });

  it("returns auth on 401", async () => {
    const restore = withKey();
    try {
      const r = await notionGet("search", { method: "GET" }, status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally {
      restore();
    }
  });

  it("returns auth on 403", async () => {
    const restore = withKey();
    try {
      const r = await notionGet("search", { method: "GET" }, status(403));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally {
      restore();
    }
  });

  it("returns rate on 429", async () => {
    const restore = withKey();
    try {
      const r = await notionGet("search", { method: "GET" }, status(429));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate");
    } finally {
      restore();
    }
  });

  it("returns data on 200", async () => {
    const restore = withKey();
    try {
      const r = await notionSearch("Nova", ok({ results: [{ id: "p1" }] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.results).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("handles network failure", async () => {
    const restore = withKey();
    try {
      const r = await notionGet("search", { method: "GET" }, network());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally {
      restore();
    }
  });

  it("never leaks credential values in errors", async () => {
    const restore = withKey();
    try {
      const r = await notionGet("search", { method: "GET" }, status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        // The error may mention "token" as a generic word, but must never
        // include the actual key value or the env var name.
        expect(r.error).not.toContain("test-key");
        expect(r.error).not.toContain("NOTION_API_KEY");
      }
    } finally {
      restore();
    }
  });

  it("fetchPage and listChildren use the correct paths", async () => {
    const restore = withKey();
    try {
      const calls1: string[] = [];
      const f1 = vi.fn(async (url: string) => {
        calls1.push(url);
        return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
      }) as unknown as typeof fetch;
      await notionFetchPage("abc", f1);
      expect(calls1[0]).toContain("pages/abc");

      const calls2: string[] = [];
      const f2 = vi.fn(async (url: string) => {
        calls2.push(url);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }) as unknown as typeof fetch;
      await notionListChildren("abc", f2);
      expect(calls2[0]).toContain("blocks/abc/children");
    } finally {
      restore();
    }
  });
});
