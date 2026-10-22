import { afterEach, describe, expect, it, vi } from "vitest";
import { githubWriteRequest } from "@/lib/nova/github-write.server";
import { buildGitHubWriteRequest, githubWriteBlockReason, githubWriteInputSchema } from "@/lib/nova/github-write.functions";
import { githubArgsSchema } from "@/lib/nova/github-capabilities";

const originalGithubKey = process.env["GITHUB_API_KEY"];
const originalLovableKey = process.env["LOVABLE_API_KEY"];

afterEach(() => {
  if (originalGithubKey === undefined) delete process.env["GITHUB_API_KEY"];
  else process.env["GITHUB_API_KEY"] = originalGithubKey;
  if (originalLovableKey === undefined) delete process.env["LOVABLE_API_KEY"];
  else process.env["LOVABLE_API_KEY"] = originalLovableKey;
});

describe("GitHub write adapter", () => {
  it("does not make unauthenticated mutation requests", async () => {
    delete process.env["GITHUB_API_KEY"];
    const fetchMock = vi.fn();
    const result = await githubWriteRequest("POST", "repos/octo/project/issues", { title: "Example" }, fetchMock as typeof fetch);

    expect(result).toEqual({ ok: false, code: "missing", error: "GitHub write credentials are not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a validated issue-create payload and returns the actual provider id and URL", async () => {
    process.env["GITHUB_API_KEY"] = "test-only-token";
    delete process.env["LOVABLE_API_KEY"];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 123,
      number: 42,
      html_url: "https://github.com/octo/project/issues/42",
    }), { status: 201 })) as unknown as typeof fetch;

    const result = await githubWriteRequest<{ id: number; number: number; html_url: string }>(
      "POST",
      "repos/octo/project/issues",
      { title: "Example", body: "Details" },
      fetchMock,
    );

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: { id: 123, number: 42, html_url: "https://github.com/octo/project/issues/42" },
    });
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/octo/project/issues");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Example", body: "Details" });
  });

  it.each([
    [401, "auth"],
    [429, "rate"],
    [500, "error"],
  ] as const)("classifies provider status %s without exposing response content", async (status, code) => {
    process.env["GITHUB_API_KEY"] = "test-only-token";
    const fetchMock = vi.fn(async () => new Response("private provider diagnostics", { status })) as unknown as typeof fetch;
    const result = await githubWriteRequest("PATCH", "repos/octo/project/issues/42", { state: "closed" }, fetchMock);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.error).not.toContain("private provider diagnostics");
      expect(result.error).not.toContain("test-only-token");
    }
  });

  it("distinguishes a GitHub 403 permission failure from an exhausted rate limit", async () => {
    process.env["GITHUB_API_KEY"] = "test-only-token";
    const forbiddenFetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const limitedFetch = vi.fn(async () => new Response("", { status: 403, headers: { "X-RateLimit-Remaining": "0" } })) as unknown as typeof fetch;

    expect(await githubWriteRequest("POST", "repos/octo/project/issues", { title: "Example" }, forbiddenFetch))
      .toMatchObject({ ok: false, code: "permission" });
    expect(await githubWriteRequest("POST", "repos/octo/project/issues", { title: "Example" }, limitedFetch))
      .toMatchObject({ ok: false, code: "rate" });
  });

  it("keeps the public mutation function fail-closed until owner-bound durable approvals exist", () => {
    const result = githubWriteBlockReason();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("approval_storage_unavailable");
  });

  it("validates issue, branch, and pull-request write payloads before dispatch", () => {
    expect(githubWriteInputSchema.safeParse({
      op: "issues.create",
      owner: "octo",
      repo: "project",
      title: "New issue",
    }).success).toBe(true);
    expect(githubWriteInputSchema.safeParse({
      op: "branches.create",
      owner: "octo",
      repo: "project",
      ref: "feature/approved-work",
      sha: "a".repeat(40),
    }).success).toBe(true);
    expect(githubWriteInputSchema.safeParse({
      op: "branches.create",
      owner: "octo",
      repo: "project",
      ref: "../main",
      sha: "a".repeat(40),
    }).success).toBe(false);
    expect(githubWriteInputSchema.safeParse({
      op: "prs.create",
      owner: "octo",
      repo: "project",
      title: "PR",
      head: "feature",
      base: "main",
    }).success).toBe(true);
    expect(githubArgsSchema["issues.update"].safeParse({
      owner: "octo",
      repo: "project",
      number: 7,
      state: "closed",
    }).success).toBe(true);
    expect(githubWriteInputSchema.safeParse({
      op: "issues.update",
      owner: "octo",
      repo: "project",
      number: 42,
    }).success).toBe(false);
    expect(githubWriteInputSchema.safeParse({
      op: "prs.create",
      owner: "octo",
      repo: "project",
      title: "PR",
      head: "feature?state=closed",
      base: "main",
    }).success).toBe(false);
  });

  it("maps validated mutations to the correct provider method, endpoint, and payload", () => {
    expect(buildGitHubWriteRequest({
      op: "issues.create",
      owner: "octo",
      repo: "project",
      title: "Issue",
      body: "Details",
    })).toEqual({
      method: "POST",
      path: "repos/octo/project/issues",
      payload: { title: "Issue", body: "Details" },
    });
    expect(buildGitHubWriteRequest({
      op: "issues.update",
      owner: "octo",
      repo: "project",
      number: 42,
      state: "closed",
    })).toEqual({
      method: "PATCH",
      path: "repos/octo/project/issues/42",
      payload: { state: "closed" },
    });
    expect(buildGitHubWriteRequest({
      op: "branches.create",
      owner: "octo",
      repo: "project",
      ref: "feature/release",
      sha: "a".repeat(40),
    })).toEqual({
      method: "POST",
      path: "repos/octo/project/git/refs",
      payload: { ref: "refs/heads/feature/release", sha: "a".repeat(40) },
    });
    expect(buildGitHubWriteRequest({
      op: "prs.create",
      owner: "octo",
      repo: "project",
      title: "PR",
      head: "feature",
      base: "main",
    })).toEqual({
      method: "POST",
      path: "repos/octo/project/pulls",
      payload: { title: "PR", head: "feature", base: "main" },
    });
  });
});
