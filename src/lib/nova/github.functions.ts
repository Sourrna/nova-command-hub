import { createServerFn } from "@tanstack/react-start";
import { ghGet, GH_REPO } from "./github.server";

export interface RepoSnapshot {
  ok: boolean; error?: string; repo: string;
  info?: { description: string | null; stars: number; openIssues: number; branch: string; pushedAt: string; url: string; private: boolean };
  commits: { sha: string; message: string; author: string; date: string; url: string }[];
  issues: { number: number; title: string; url: string; isPr: boolean }[];
}

type R = { description: string | null; stargazers_count: number; open_issues_count: number; default_branch: string; pushed_at: string; html_url: string; private: boolean };
type C = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } };
type I = { number: number; title: string; html_url: string; pull_request?: unknown };

export const getRepoSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<RepoSnapshot> => {
  const [r, c, i] = await Promise.all([
    ghGet<R>(`repos/${GH_REPO}`),
    ghGet<C[]>(`repos/${GH_REPO}/commits?per_page=8`),
    ghGet<I[]>(`repos/${GH_REPO}/issues?state=open&per_page=8`),
  ]);
  if (!r.ok) return { ok: false, error: r.error, repo: GH_REPO, commits: [], issues: [] };
  return {
    ok: true, repo: GH_REPO,
    info: { description: r.data.description, stars: r.data.stargazers_count, openIssues: r.data.open_issues_count, branch: r.data.default_branch, pushedAt: r.data.pushed_at, url: r.data.html_url, private: r.data.private },
    commits: c.ok ? c.data.map((x) => ({ sha: x.sha.slice(0, 7), message: x.commit.message.split("\n")[0] ?? "", author: x.commit.author.name, date: x.commit.author.date, url: x.html_url })) : [],
    issues: i.ok ? i.data.map((x) => ({ number: x.number, title: x.title, url: x.html_url, isPr: !!x.pull_request })) : [],
  };
});
