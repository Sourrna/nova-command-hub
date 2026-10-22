import { describe, expect, it } from "vitest";
import { buildLinkedinSnapshot } from "@/lib/nova/linkedin.functions";

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = <C extends "missing" | "auth" | "rate" | "error">(code: C, error: string) => ({
  ok: false as const,
  code,
  error,
});

const orgs = (n: number) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `org-${i}` })) });
const posts = (n: number) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `p-${i}` })) });
const metrics = (n: number) => ({ elements: Array.from({ length: n }, (_, i) => ({ id: `m-${i}` })) });

describe("buildLinkedinSnapshot", () => {
  it("aggregates organization, post, and engagement counts", () => {
    const s = buildLinkedinSnapshot(ok(orgs(2)), ok(posts(5)), ok(metrics(3)));
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.organizations).toBe(2);
      expect(s.posts).toBe(5);
      expect(s.engagement).toBe(3);
      expect(s.firstOrgId).toBe("org-0");
    }
  });

  it("returns zero counts when elements is missing", () => {
    const s = buildLinkedinSnapshot(ok({ elements: [] }), ok({ elements: [] }), ok({ elements: [] }));
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.organizations).toBe(0);
      expect(s.posts).toBe(0);
      expect(s.engagement).toBe(0);
    }
  });

  it("propagates the failure code when organizations fail", () => {
    const s = buildLinkedinSnapshot(fail("auth", "LinkedIn rejected the integration token."), ok(posts(0)), ok(metrics(0)));
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.code).toBe("auth");
      expect(s.organizations).toBe(0);
      expect(s.posts).toBe(0);
      expect(s.engagement).toBe(0);
    }
  });

  it("never leaks credentials in error payloads", () => {
    const s = buildLinkedinSnapshot(fail("auth", "LinkedIn rejected the integration token."), ok(posts(0)), ok(metrics(0)));
    expect(JSON.stringify(s)).not.toContain("Bearer");
    expect(JSON.stringify(s)).not.toContain("sk-");
    expect(JSON.stringify(s)).not.toContain("secret");
  });
});