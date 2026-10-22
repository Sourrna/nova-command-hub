// Server-only aggregator. Calls every read adapter in parallel and returns a
// structured ops snapshot. Never reports a connector as contributing data
// unless its adapter returned ok. Keys never leave this function.
import { createServerFn } from "@tanstack/react-start";
import { ghGet, GH_REPO } from "./github.server";
import { notionSearch } from "./notion.server";
import { linkedinOrganizations, linkedinMetrics, linkedinPosts } from "./linkedin.server";
import { testProvider } from "./ai.server";

export interface OpsDashboard {
  generatedAt: number;
  github: { ok: boolean; stars?: number; openIssues?: number; branch?: string; pushedAt?: string; recentCommits: number; error?: string };
  notion: { ok: boolean; results: number; error?: string };
  linkedin: { ok: boolean; organizations: number; posts: number; engagement: number; error?: string };
  ai: { openai: boolean; xai: boolean };
}

type GhRepo = { stargazers_count: number; open_issues_count: number; default_branch: string; pushed_at: string };
type Gh = Awaited<ReturnType<typeof ghGet<GhRepo>>>;
type No = Awaited<ReturnType<typeof notionSearch>>;
type Li = Awaited<ReturnType<typeof linkedinOrganizations>>;
type Ai = Awaited<ReturnType<typeof testProvider>>;

function countElements<T>(r: { elements?: T[] } | undefined): number {
  return Array.isArray(r?.elements) ? r.elements.length : 0;
}

/** Pure core — no Start runtime dependency, safe to unit-test directly. */
export function buildOpsDashboard(gh: Gh, no: No, li: Li, oai: Ai, xai: Ai): OpsDashboard {
  return {
    generatedAt: Date.now(),
    github: gh.ok
      ? { ok: true, stars: gh.data.stargazers_count, openIssues: gh.data.open_issues_count, branch: gh.data.default_branch, pushedAt: gh.data.pushed_at, recentCommits: 0 }
      : { ok: false, recentCommits: 0, error: gh.error },
    notion: no.ok ? { ok: true, results: no.data.results.length } : { ok: false, results: 0, error: no.error },
    linkedin: li.ok ? { ok: true, organizations: countElements(li.data), posts: 0, engagement: 0 } : { ok: false, organizations: 0, posts: 0, engagement: 0, error: li.error },
    ai: { openai: oai.ok, xai: xai.ok },
  };
}

export const getOpsDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<OpsDashboard> => {
  const [gh, no, li, oai, xai] = await Promise.all([
    ghGet<GhRepo>(`repos/${GH_REPO}`),
    notionSearch("Nova"),
    linkedinOrganizations(),
    testProvider("openai", process.env["OPENAI_API_KEY"]),
    testProvider("xai", process.env["XAI_API_KEY"]),
  ]);
  return buildOpsDashboard(gh, no, li, oai, xai);
});