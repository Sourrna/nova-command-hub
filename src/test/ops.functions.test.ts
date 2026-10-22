import { describe, expect, it } from "vitest";
import { buildOpsDashboard, type OpsDashboard } from "@/lib/nova/ops.functions";

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = <C extends "missing" | "auth" | "rate" | "error">(code: C, error: string) => ({
  ok: false as const,
  code,
  error,
});

const ghRepo = (over: Partial<{ stargazers_count: number; open_issues_count: number; default_branch: string; pushed_at: string }> = {}) =>
  ({ stargazers_count: 12, open_issues_count: 3, default_branch: "main", pushed_at: "2026-10-17T00:00:00Z", ...over });

const dashboard = (gh: ReturnType<typeof ok<GhRepo>> | ReturnType<typeof fail>, no: ReturnType<typeof ok<{ results: unknown[] }>> | ReturnType<typeof fail>, li: ReturnType<typeof ok<{ elements: unknown[] }>> | ReturnType<typeof fail>, oai: ReturnType<typeof ok<null>> | ReturnType<typeof fail>, xai: ReturnType<typeof ok<null>> | ReturnType<typeof fail>): OpsDashboard =>
  buildOpsDashboard(gh as never, no as never, li as never, oai as never, xai as never);

type GhRepo = { stargazers_count: number; open_issues_count: number; default_branch: string; pushed_at: string };

describe("buildOpsDashboard", () => {
  it("aggregates live data from every adapter", () => {
    const d = dashboard(
      ok(ghRepo()),
      ok({ results: [{ id: "a" }, { id: "b" }] }),
      ok({ elements: [{ id: "1" }] }),
      ok(null),
      ok(null),
    );
    expect(d.github.ok).toBe(true);
    expect(d.github.stars).toBe(12);
    expect(d.github.openIssues).toBe(3);
    expect(d.notion.ok).toBe(true);
    expect(d.notion.results).toBe(2);
    expect(d.linkedin.ok).toBe(true);
    expect(d.linkedin.organizations).toBe(1);
    expect(d.ai.openai).toBe(true);
    expect(d.ai.xai).toBe(true);
  });

  it("reports failures without crashing the whole dashboard", () => {
    const d = dashboard(
      fail("auth", "GitHub rejected the credentials."),
      fail("auth", "Notion rejected the integration token."),
      fail("rate", "LinkedIn rate limited the request; try again later."),
      ok(null),
      fail("auth", "Provider rejected the API key (unauthorised)."),
    );
    expect(d.github.ok).toBe(false);
    expect(d.notion.ok).toBe(false);
    expect(d.linkedin.ok).toBe(false);
    expect(d.ai.openai).toBe(true);
    expect(d.ai.xai).toBe(false);
  });

  it("never leaks credentials in error payloads", () => {
    // Real adapter error strings are fixed messages; the token is never
    // interpolated into them. Verify the dashboard copies those verbatim
    // without ever carrying a token value through.
    const d = dashboard(
      fail("auth", "GitHub rejected the credentials."),
      fail("auth", "Notion rejected the integration token."),
      fail("rate", "LinkedIn rate limited the request; try again later."),
      fail("auth", "Provider rejected the API key (unauthorised)."),
      fail("auth", "Provider rejected the API key (unauthorised)."),
    );
    const json = JSON.stringify(d);
    expect(json).not.toContain("Bearer");
    expect(json).not.toContain("sk-");
    expect(json).not.toContain("secret");
  });

  it("includes a generated timestamp", () => {
    const before = Date.now();
    const d = dashboard(ok(ghRepo()), ok({ results: [] }), ok({ elements: [] }), ok(null), ok(null));
    const after = Date.now();
    expect(d.generatedAt).toBeGreaterThanOrEqual(before);
    expect(d.generatedAt).toBeLessThanOrEqual(after);
  });
});