import { describe, expect, it, vi } from "vitest";
import { linkedinGet, linkedinOrganizations, linkedinPosts, linkedinMetrics } from "@/lib/nova/linkedin.server";

const withKey = () => {
  const orig = { ...process.env };
  process.env["LINKEDIN_ACCESS_TOKEN"] = "test-li-key";
  return () => {
    Object.assign(process.env, orig);
    delete process.env["LINKEDIN_ACCESS_TOKEN"];
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

describe("LinkedIn connector (linkedin.server)", () => {
  it("returns missing when LINKEDIN_ACCESS_TOKEN is not set", async () => {
    const restore = withKey();
    delete process.env["LINKEDIN_ACCESS_TOKEN"];
    try {
      const f = ok({});
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, f);
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
      const f = ok({ elements: [] });
      const r = await linkedinOrganizations(f);
      expect(r.ok).toBe(true);
      const calls = (
        f as unknown as {
          mock: { calls: [string, { headers: Record<string, string> }][] };
        }
      ).mock.calls;
      const call = calls[0];
      expect(call?.[1]?.headers?.["Authorization"]).toBe("Bearer test-li-key");
      expect(call?.[1]?.headers?.["X-Restli-Protocol-Version"]).toBe("2.0.0");
    } finally {
      restore();
    }
  });

  it("returns auth on 401", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally {
      restore();
    }
  });

  it("returns auth on 403", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, status(403));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally {
      restore();
    }
  });

  it("returns rate on 429", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, status(429));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate");
    } finally {
      restore();
    }
  });

  it("returns error on 500", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, status(500));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally {
      restore();
    }
  });

  it("returns error on network failure", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, network());
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("error");
        expect(r.error).toContain("unreachable");
      }
    } finally {
      restore();
    }
  });

  it("posts and metrics use the correct paths", async () => {
    const restore = withKey();
    try {
      const calls1: string[] = [];
      const f1 = vi.fn(async (url: string) => { calls1.push(url); return new Response(JSON.stringify({ elements: [] }), { status: 200 }); }) as unknown as typeof fetch;
      await linkedinPosts("123", f1);
      expect(calls1[0]).toContain("ugcPosts");
      expect(calls1[0]).toContain("urn:li:organizationalEntity:123");

      const calls2: string[] = [];
      const f2 = vi.fn(async (url: string) => { calls2.push(url); return new Response(JSON.stringify({ elements: [] }), { status: 200 }); }) as unknown as typeof fetch;
      await linkedinMetrics("456", f2);
      expect(calls2[0]).toContain("socialActions");
      expect(calls2[0]).toContain("urn:li:organizationalEntity:456");
    } finally {
      restore();
    }
  });

  it("does not leak the token in error messages", async () => {
    const restore = withKey();
    try {
      const r = await linkedinGet("organizationalEntityAcls", { method: "GET" }, status(401));
      expect(JSON.stringify(r)).not.toContain("test-li-key");
    } finally {
      restore();
    }
  });
});