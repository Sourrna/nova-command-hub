import { describe, expect, it, vi } from "vitest";
import { githubArgsSchema, githubCaps, splitRepo } from "@/lib/nova/github-capabilities";
import { buildSnapshot } from "@/lib/nova/github.functions";
import { grantApproval, revokeApproval, payloadHash } from "@/lib/nova/approval.server";
import { GITHUB_CONTROL_CAPABILITIES } from "@/routes/github-control";
import { normalizeGitHubCommandReadData, resolveGitHubCommandRead, summarizeGitHubCommandRead } from "@/lib/nova/github-command";

describe("GitHub capability registry", () => {
  it("labels write adapters ready but blocked pending durable approvals", () => {
    const writes = GITHUB_CONTROL_CAPABILITIES.filter((capability) => capability.access === "write");
    expect(writes.map((capability) => capability.operation)).toEqual(["issues.create", "issues.update", "branches.create", "prs.create"]);
    expect(writes.every((capability) => capability.implemented && capability.writeBlocked)).toBe(true);
    expect(GITHUB_CONTROL_CAPABILITIES.filter((capability) => capability.access === "read").every((capability) => capability.implemented && !capability.writeBlocked)).toBe(true);
  });

  describe("GitHub command read routing", () => {
    it.each([
      ["Review open issues on GitHub", "issues.list"],
      ["Inspect GitHub issue #42", "issues.get"],
      ["List pull requests for Sourrna/nova-brand-ai", "prs.list"],
      ["Inspect PR #17 in Sourrna/nova-brand-ai", "prs.get"],
      ["List branches", "branches.list"],
      ["Show recent commits", "commits.list"],
      ["Show repository information", "repo.get"],
    ] as const)("resolves %s to %s", (goal, op) => {
      expect(resolveGitHubCommandRead(goal).op).toBe(op);
    });

    it("extracts a specific issue number and repository", () => {
      expect(resolveGitHubCommandRead("Inspect issue #42 in octo/project")).toEqual({
        op: "issues.get",
        owner: "octo",
        repo: "project",
        number: 42,
      });
    });

    it("extracts the repository rather than the github.com hostname from a URL", () => {
      expect(resolveGitHubCommandRead("Review issues in https://github.com/octo/project")).toMatchObject({
        op: "issues.list",
        owner: "octo",
        repo: "project",
      });
    });

    it("summarizes actual provider issue data", () => {
      expect(summarizeGitHubCommandRead("issues.get", { number: 42, title: "Fix command issue", state: "open" }))
        .toBe("Issue #42: Fix command issue (open).");
    });

    it("shows actual issue titles and filters pull requests returned by GitHub's issues endpoint", () => {
      const results = normalizeGitHubCommandReadData("issues.list", [
        { number: 42, title: "Fix command issue" },
        { number: 17, title: "A pull request", pull_request: { url: "https://api.github.com/pulls/17" } },
      ]);
      expect(results).toEqual([{ number: 42, title: "Fix command issue" }]);
      expect(summarizeGitHubCommandRead("issues.list", results))
        .toBe("GitHub returned 1 open issue(s): #42 Fix command issue.");
    });
  });

  it("validates args for reads", () => {
    expect(githubArgsSchema["repo.get"].safeParse({ owner: "a", repo: "b" }).success).toBe(true);
    expect(githubArgsSchema["issues.get"].safeParse({ owner: "a", repo: "b", number: 1 }).success).toBe(true);
    expect(githubArgsSchema["issues.get"].safeParse({ owner: "a", repo: "b", number: -1 }).success).toBe(false);
    expect(githubArgsSchema["repo.get"].safeParse({ owner: "../users", repo: "project" }).success).toBe(false);
    expect(githubArgsSchema["repo.get"].safeParse({ owner: "octo", repo: "project?per_page=1" }).success).toBe(false);
  });
  it("validates issue update payloads and rejects empty updates", () => {
    expect(githubArgsSchema["issues.update"].safeParse({ owner: "a", repo: "b", number: 4, state: "closed" }).success).toBe(true);
    expect(githubArgsSchema["issues.update"].safeParse({ owner: "a", repo: "b", number: 4 }).success).toBe(false);
    expect(githubArgsSchema["issues.update"].safeParse({ owner: "a", repo: "b", number: 4, state: "merged" }).success).toBe(false);
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
