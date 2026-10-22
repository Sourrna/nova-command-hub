import { describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "@/lib/nova/github.functions";

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (code: "missing" | "auth" | "permission" | "rate" | "error", error: string) => ({
  ok: false as const,
  code,
  error,
});

const repo = () => ({
  id: 1,
  full_name: "Sourrna/nova-brand-ai",
  description: "d",
  stargazers_count: 3,
  open_issues_count: 1,
  default_branch: "main",
  pushed_at: "2026-10-17T00:00:00Z",
  html_url: "https://github.com/Sourrna/nova-brand-ai",
  private: true,
});
const commit = () => ({
  sha: "abcdef1234567890",
  html_url: "https://github.com/x/c/abcdef1",
  commit: { message: "fix: bug", author: { name: "Sourena", date: "2026-10-17T00:00:00Z" } },
});
const issue = () => ({ number: 7, title: "Add tests", html_url: "https://github.com/x/i/7" });

describe("GitHub snapshot (github.functions)", () => {
  it("propagates the failure code when repo metadata fails", () => {
    const r = buildSnapshot(fail("missing", "GitHub connection not linked."), ok([]), ok([]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("missing");
      expect(r.error).toContain("not linked");
      expect(r.commits).toEqual([]);
      expect(r.issues).toEqual([]);
    }
  });

  it("propagates auth failure code", () => {
    const r = buildSnapshot(fail("auth", "GitHub rejected the credentials."), ok([]), ok([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("auth");
  });

  it("propagates rate-limit code", () => {
    const r = buildSnapshot(fail("rate", "rate"), ok([]), ok([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("rate");
  });

  it("returns a full snapshot on success", () => {
    const r = buildSnapshot(ok(repo()), ok([commit()]), ok([issue()]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.repo).toBe("Sourrna/nova-brand-ai");
      expect(r.info?.branch).toBe("main");
      expect(r.info?.stars).toBe(3);
      expect(r.commits[0]?.sha).toBe("abcdef1");
      expect(r.commits[0]?.message).toBe("fix: bug");
      expect(r.issues[0]?.number).toBe(7);
      expect(r.issues[0]?.isPr).toBe(false);
    }
  });

  it("returns partial data when only the repo call succeeds", () => {
    const r = buildSnapshot(ok(repo()), fail("rate", "rate"), fail("rate", "rate"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.commits).toEqual([]);
      expect(r.issues).toEqual([]);
    }
  });

  it("truncates long commit SHAs to 7 chars", () => {
    const r = buildSnapshot(ok(repo()), ok([commit()]), ok([]));
    if (r.ok) expect(r.commits[0]?.sha.length).toBe(7);
  });

  it("strips multi-line commit messages to the first line", () => {
    const r = buildSnapshot(
      ok(repo()),
      ok([
        {
          ...commit(),
          commit: { message: "feat: x\n\nbody line", author: commit().commit.author },
        },
      ]),
      ok([]),
    );
    if (r.ok) expect(r.commits[0]?.message).toBe("feat: x");
  });

  it("never exposes credential values in errors", () => {
    const r = buildSnapshot(fail("auth", "GitHub rejected the credentials."), ok([]), ok([]));
    if (!r.ok) {
      expect(r.error).not.toContain("secret");
      expect(r.error).not.toContain("token");
      expect(r.error).not.toContain("key");
    }
  });
});
