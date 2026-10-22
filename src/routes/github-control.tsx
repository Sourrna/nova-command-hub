import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GitBranch, GitPullRequest, AlertCircle, FileText, RefreshCw } from "lucide-react";
import { PageHeader, Panel, Empty } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";
import { githubRead } from "@/lib/nova/github-control.server";
import { GH_REPO_DEFAULT, githubCaps, splitRepo } from "@/lib/nova/github-capabilities";
import { useHealth } from "@/lib/nova/health";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/github-control")({
  head: () => meta("GitHub Control", "Real GitHub repository control center."),
  component: GitHubControlPage,
});

type Tab = "overview" | "branches" | "issues" | "pulls" | "commits";

export const GITHUB_CONTROL_CAPABILITIES = Object.values(githubCaps).map(({ op, authz, implemented }) => ({
  operation: op,
  access: authz,
  implemented,
}));

function GitHubControlPage() {
  const [repo, setRepo] = useState(GH_REPO_DEFAULT);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const read = useServerFn(githubRead);
  const health = useHealth();
  const gk = health.get("github");
  const { owner, repo: name } = splitRepo(repo);

  async function load(op: any) {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const res = await read({ data: { op, owner, repo: name } });
      if (!res.ok) setErr(res.error ?? "Request failed");
      else setData(res.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "unknown");
    }
    setLoading(false);
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: FileText },
    { id: "branches", label: "Branches", icon: GitBranch },
    { id: "issues", label: "Issues", icon: AlertCircle },
    { id: "pulls", label: "Pull Requests", icon: GitPullRequest },
    { id: "commits", label: "Commits", icon: FileText },
  ];

  return (
    <>
      <PageHeader kicker="GitHub Control" title="Repository Operations">
        <div className="flex items-center gap-2">
          <input className="field max-w-xs" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
          <span className={cn("chip", gk.status === "connected" ? "text-ok" : gk.status === "limited" ? "text-warn" : "text-idle")}>{gk.status}</span>
          <Link to="/github" className="btn btn-ghost">GitHub Overview</Link>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} className={cn("btn", tab === t.id && "btn-primary")} onClick={() => { setTab(t.id); if (t.id === "overview") load("repo.get"); if (t.id === "branches") load("branches.list"); if (t.id === "issues") load("issues.list"); if (t.id === "pulls") load("prs.list"); if (t.id === "commits") load("commits.list"); }}>
            <t.icon size={14} />{t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Panel title={tab === "overview" ? "Repository" : tab.charAt(0).toUpperCase() + tab.slice(1)} className="lg:col-span-8" action={<button className="btn btn-ghost" onClick={() => { if (tab === "overview") load("repo.get"); if (tab === "branches") load("branches.list"); if (tab === "issues") load("issues.list"); if (tab === "pulls") load("prs.list"); if (tab === "commits") load("commits.list"); }} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>}>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {err && <p className="text-sm text-destructive">{err}</p>}
          {!loading && !err && !data && <Empty title="Select a view" hint="Load branches, issues, PRs, or commits from the official GitHub API." />}
          {tab === "overview" && data && (
            <div className="space-y-2 text-sm">
              <p className="text-silver">{data.full_name}</p>
              <p className="text-muted-foreground">{data.description || "No description"}</p>
              <p className="label-hud">Stars {data.stargazers_count} · Open issues {data.open_issues_count} · Default {data.default_branch} · Private {String(data.private)}</p>
            </div>
          )}
          {tab === "branches" && Array.isArray(data) && (
            <ul className="divide-y divide-border">
              {data.map((b: any) => <li key={b.name} className="flex items-center justify-between py-2 text-sm"><span>{b.name}</span><span className="label-hud">{b.commit?.sha?.slice(0,7)}</span></li>)}
            </ul>
          )}
          {tab === "issues" && Array.isArray(data) && (
            <ul className="divide-y divide-border">
              {data.filter((i: any) => !i.pull_request).map((i: any) => <li key={i.number} className="py-2 text-sm"><div className="flex items-center justify-between"><span>#{i.number} {i.title}</span><span className="label-hud">{i.state}</span></div></li>)}
              {data.filter((i: any) => !i.pull_request).length === 0 && <Empty title="No open issues" />}
            </ul>
          )}
          {tab === "pulls" && Array.isArray(data) && (
            <ul className="divide-y divide-border">
              {data.map((p: any) => <li key={p.number} className="py-2 text-sm"><div className="flex items-center justify-between"><span>#{p.number} {p.title}</span><span className="label-hud">{p.head?.ref} → {p.base?.ref}</span></div></li>)}
              {data.length === 0 && <Empty title="No open pull requests" />}
            </ul>
          )}
          {tab === "commits" && Array.isArray(data) && (
            <ul className="divide-y divide-border">
              {data.map((c: any) => <li key={c.sha} className="py-2 text-sm"><div className="flex items-center justify-between"><span className="truncate pr-4">{c.commit?.message?.split("\n")[0]}</span><span className="label-hud">{c.sha?.slice(0,7)}</span></div></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Capability registry" className="lg:col-span-4">
          <ul className="space-y-2 text-sm">
            {GITHUB_CONTROL_CAPABILITIES.map((capability) => (
              <li key={capability.operation} className="flex items-center justify-between">
                <span>{capability.operation}</span>
                <span className={`label-hud ${capability.implemented ? "" : "text-muted-foreground"}`}>
                  {capability.implemented ? capability.access : "not implemented"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Repository reads use the GitHub API. GitHub writes are unavailable; no issue, branch, or pull request is created here.</p>
        </Panel>
      </div>
    </>
  );
}
