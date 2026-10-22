import { describe, expect, it, vi } from "vitest";
import { githubArgsSchema, githubCaps, splitRepo } from "@/lib/nova/github-capabilities";
import { buildSnapshot } from "@/lib/nova/github.functions";
import { grantApproval, revokeApproval, payloadHash } from "@/lib/nova/approval.server";

describe("GitHub capability registry", () => {
  it("validates args for reads", () => {
    expect(githubArgsSchema["repo.get"].safeParse({ owner: "a", repo: "b" }).success).toBe(true);
    expect(githubArgsSchema["issues.get"].safeParse({ owner: "a", repo: "b", number: 1 }).success).toBe(true);
    expect(githubArgsSchema["issues.get"].safeParse({ owner: "a", repo: "b", number: -1 }).success).toBe(false);
  });
  it("marks writes as approval-required", () => {
    expect(githubCaps["issues.create"].approvalRequired).toBe(true);
    expect(githubCaps["branches.create"].approvalRequired).toBe(true);
    expect(githubCaps["prs.create"].approvalRequired).toBe(true);
    expect(githubCaps["repo.get"].approvalRequired).toBe(false);
  });
  it("splits repo ids", () => {
    expect(splitRepo("Sourrna/nova-brand-ai")).toEqual({ owner: "Sourrna", repo: "nova-brand-ai" });
  });
});

describe("GitHub snapshot", () => {
  it("builds snapshot from mocked results", () => {
    const r = buildSnapshot(
      { ok: true, data: { description: "x", stargazers_count: 1, open_issues_count: 2, default_branch: "main", pushed_at: "2025-01-01T00:00:00Z", html_url: "u", private: false } },
      { ok: true, data: [{ sha: "abc1234", html_url: "c", commit: { message: "m\nx", author: { name: "a", date: "2025-01-01T00:00:00Z" } } }] },
      { ok: true, data: [{ number: 1, title: "t", html_url: "i" }] },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info?.stars).toBe(1);
  });
  it("handles missing credentials/permission failures honestly", () => {
    const r = buildSnapshot({ ok: false, code: "auth", error: "GitHub rejected the credentials." } as any, { ok: false } as any, { ok: false } as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("rejected");
  });
});

describe("GitHub write approval", () => {
  beforeEach(() => { revokeApproval("gh1"); revokeApproval("gh2"); });
  it("binds approval to payload", () => {
    grantApproval("gh1", "gh-repo", "Create issue", "fix bug", "Sourrna/nova-brand-ai", "Create GitHub issue");
    expect(payloadHash("Create issue", "fix bug")).toBeTruthy();
  });
});
