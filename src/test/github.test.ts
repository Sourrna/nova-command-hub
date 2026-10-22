import { describe, expect, it, vi } from "vitest";
import { ghGet, GH_REPO } from "@/lib/nova/github.server";

// Credentials must be present or ghGet returns "missing" before calling fetch.
const withCreds = () => {
  const orig = { ...process.env };
  process.env["LOVABLE_API_KEY"] = "test-lovable-key";
  process.env["GITHUB_API_KEY"] = "test-github-key";
  return () => {
    Object.assign(process.env, orig);
    delete process.env["LOVABLE_API_KEY"];
    delete process.env["GITHUB_API_KEY"];
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

describe("GitHub connector (github.server)", () => {
  it("returns missing when no credentials are configured and the repo is private", async () => {
    const restore = withCreds();
    delete process.env["LOVABLE_API_KEY"];
    delete process.env["GITHUB_API_KEY"];
    try {
      // No token: the adapter falls back to unauthenticated direct access.
      // A private repo responds 401, which the adapter reports as "auth".
      const f = status(401);
      const r = await ghGet("repos/Sourrna/nova-brand-ai", f);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("auth");
        expect(r.error).toContain("rejected the credentials");
      }
      expect(f).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reads a public repository without any credentials", async () => {
    const restore = withCreds();
    delete process.env["LOVABLE_API_KEY"];
    delete process.env["GITHUB_API_KEY"];
    try {
      const f = ok({ id: 1, full_name: GH_REPO });
      const r = await ghGet(`repos/${GH_REPO}`, f);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.data as { id: number }).id).toBe(1);
      const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call?.[0]).toContain("api.github.com/repos/Sourrna/nova-brand-ai");
    } finally {
      restore();
    }
  });

  it("returns auth on 401", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet("repos/Sourrna/nova-brand-ai", status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally {
      restore();
    }
  });

  it("returns permission on 403 without rate-limit headers", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet("repos/Sourrna/nova-brand-ai", status(403));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("permission");
    } finally {
      restore();
    }
  });

  it("returns rate on 429", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet("repos/Sourrna/nova-brand-ai", status(429));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate");
    } finally {
      restore();
    }
  });

  it("returns error on 500", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet("repos/Sourrna/nova-brand-ai", status(500));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally {
      restore();
    }
  });

  it("returns data on 200", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet(`repos/${GH_REPO}`, ok({ id: 1, full_name: GH_REPO }));
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.data as { id: number }).id).toBe(1);
    } finally {
      restore();
    }
  });

  it("handles network failure", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet(`repos/${GH_REPO}`, network());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("error");
    } finally {
      restore();
    }
  });

  it("never leaks credential values in errors", async () => {
    const restore = withCreds();
    try {
      const r = await ghGet("repos/Sourrna/nova-brand-ai", status(401));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toContain("secret");
        expect(r.error).not.toContain("token");
        expect(r.error).not.toContain("key");
      }
    } finally {
      restore();
    }
  });

  it("uses the direct GitHub API when only GITHUB_API_KEY is set", async () => {
    const restore = withCreds();
    delete process.env["LOVABLE_API_KEY"];
    try {
      const f = ok({ id: 1, full_name: GH_REPO });
      const r = await ghGet(`repos/${GH_REPO}`, f);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.data as { id: number }).id).toBe(1);
      const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call?.[0]).toContain("api.github.com/repos/Sourrna/nova-brand-ai");
      const headers = (call?.[1] as { headers: Record<string, string> } | undefined)?.headers;
      expect(headers?.["Authorization"]).toBe("Bearer test-github-key");
      expect(headers?.["X-GitHub-Api-Version"]).toBe("2022-11-28");
    } finally {
      restore();
    }
  });

  it("uses the Lovable gateway when both keys are set", async () => {
    const restore = withCreds();
    try {
      const f = ok({ id: 1, full_name: GH_REPO });
      const r = await ghGet(`repos/${GH_REPO}`, f);
      expect(r.ok).toBe(true);
      const call = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(call?.[0]).toContain(
        "connector-gateway.lovable.dev/github/repos/Sourrna/nova-brand-ai",
      );
      const headers = (call?.[1] as { headers: Record<string, string> } | undefined)?.headers;
      expect(headers?.["Authorization"]).toBe("Bearer test-lovable-key");
      expect(headers?.["X-Connection-Api-Key"]).toBe("test-github-key");
    } finally {
      restore();
    }
  });
});
