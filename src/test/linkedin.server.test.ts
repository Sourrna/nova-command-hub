import { describe, expect, it, vi, beforeEach } from "vitest";
import { linkedinPublishPost, validateLinkedinPost, type LinkedinPostInput } from "@/lib/nova/linkedin.server";

const status = (s: number) =>
  (async () => new Response("secret-leak", { status: s })) as unknown as typeof fetch;
const boom = () =>
  (async () => { throw new TypeError("boom"); }) as unknown as typeof fetch;

const valid = (over: Partial<LinkedinPostInput> = {}): LinkedinPostInput => ({
  author: "urn:li:organization:123",
  visibility: "PUBLIC",
  commentary: "Hello LinkedIn",
  ...over,
});

function withKey() {
  const orig = { ...process.env };
  process.env["LINKEDIN_ACCESS_TOKEN"] = "test-token";
  return () => { Object.assign(process.env, orig); delete process.env["LINKEDIN_ACCESS_TOKEN"]; };
}

describe("validateLinkedinPost", () => {
  it("accepts a valid post", () => {
    expect(validateLinkedinPost(valid())).toEqual({ ok: true });
  });
  it("rejects a malformed author URN", () => {
    const r = validateLinkedinPost(valid({ author: "not-a-urn" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("URN");
  });
  it("rejects an unknown visibility", () => {
    const r = validateLinkedinPost(valid({ visibility: "EVERYONE" as never }));
    expect(r.ok).toBe(false);
  });
  it("rejects empty commentary", () => {
    const r = validateLinkedinPost(valid({ commentary: "   " }));
    expect(r.ok).toBe(false);
  });
  it("enforces the 700-character limit", () => {
    const r = validateLinkedinPost(valid({ commentary: "x".repeat(701) }));
    expect(r.ok).toBe(false);
  });
  it("allows commentary exactly at the limit", () => {
    expect(validateLinkedinPost(valid({ commentary: "x".repeat(700) })).ok).toBe(true);
  });
  it("counts the title toward the limit", () => {
    const r = validateLinkedinPost(valid({ title: "T".repeat(200), commentary: "x".repeat(501) }));
    expect(r.ok).toBe(false);
  });
});

describe("linkedinPublishPost", () => {
  beforeEach(() => {
    for (const id of ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"]) {
      delete process.env[`REVOKE_${id}`];
    }
  });

  it("fails closed when credentials are missing", async () => {
    const restore = withKey();
    delete process.env["LINKEDIN_ACCESS_TOKEN"];
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ id: "p1" }), { status: 200 })) as unknown as typeof fetch;
      const r = await linkedinPublishPost(valid(), f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("missing");
      expect(f).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it("fails closed on auth rejection without leaking the token", async () => {
    const restore = withKey();
    try {
      const r = await linkedinPublishPost(valid(), status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("auth");
        expect(JSON.stringify(r)).not.toContain("test-token");
      }
    } finally { restore(); }
  });

  it("fails closed on rate limiting", async () => {
    const restore = withKey();
    try {
      const r = await linkedinPublishPost(valid(), status(429));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate");
    } finally { restore(); }
  });

  it("fails closed on a server error", async () => {
    const restore = withKey();
    try {
      const r = await linkedinPublishPost(valid(), status(500));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally { restore(); }
  });

  it("fails closed on network failure", async () => {
    const restore = withKey();
    try {
      const r = await linkedinPublishPost(valid(), boom());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally { restore(); }
  });

  it("rejects malformed input before calling the provider", async () => {
    const restore = withKey();
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ id: "p1" }), { status: 200 })) as unknown as typeof fetch;
      const r = await linkedinPublishPost(valid({ author: "bad" }), f);
      expect(r.ok).toBe(false);
      expect(f).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  it("records the returned post id and url on success", async () => {
    const restore = withKey();
    try {
      const key = "l9:test";
      const calls: { init: RequestInit }[] = [];
      const f = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ init });
        return new Response(JSON.stringify({ id: "post-abc" }), { status: 200 });
      }) as unknown as typeof fetch;
      const r = await linkedinPublishPost(valid({ idempotencyKey: key }), f);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.id).toBe("post-abc");
        expect(r.data.url).toBe("https://www.linkedin.com/posts/post-abc");
      }
      const headers = (calls[0]?.init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      expect(headers["Idempotency-Key"]).toBe(key);
    } finally { restore(); }
  });

  it("does not send an idempotency key when none is provided", async () => {
    const restore = withKey();
    try {
      const calls: { init: RequestInit }[] = [];
      const f = (async (_url: string | URL, init: RequestInit = {}) => {
        calls.push({ init });
        return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
      }) as unknown as typeof fetch;
      await linkedinPublishPost(valid(), f);
      const headers = (calls[0]?.init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
      expect(headers["Idempotency-Key"]).toBeUndefined();
    } finally { restore(); }
  });
});