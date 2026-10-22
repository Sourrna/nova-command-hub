import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitCommit, CircleDot, Lock, RefreshCw } from "lucide-react";
import { PageHeader, Panel, Empty, StatusChip, fmtTime } from "@/components/nova/ui";
import { ConnectorDetail } from "@/components/nova/ConnectorViews";
import { getRepoSnapshot } from "@/lib/nova/github.functions";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/github")({
  head: () => meta("GitHub", "Live read-only telemetry for the NOVA GitHub repository."),
  component: GithubPage,
});

const SETUP_HINTS: Record<string, { title: string; hint: string }> = {
  missing: {
    title: "GitHub connection not linked",
    hint: "Add the server secrets LOVABLE_API_KEY and GITHUB_API_KEY in the project's secure secrets configuration. They are stored server-side only and never appear in this browser, in Git, or in chat.",
  },
  auth: {
    title: "GitHub rejected the credentials",
    hint: "The stored API key was refused (HTTP 401). Generate a new key with read-only scope at the provider, update the server secret, then press Re-check.",
  },
  rate: {
    title: "GitHub rate limit or permission denied",
    hint: "GitHub refused the request (HTTP 403/429). Wait a few minutes before retrying, and confirm the token has repo/read scope for Sourrna/nova-brand-ai.",
  },
  error: {
    title: "GitHub unreachable",
    hint: "The request failed or timed out. Check network access to api.github.com and the Lovable connector gateway, then press Re-check.",
  },
};

function GithubPage() {
  const q = useQuery({
    queryKey: ["gh-snapshot"],
    queryFn: () => getRepoSnapshot(),
    staleTime: 60_000,
  });
  const s = q.data;

  return (
    <>
      <PageHeader kicker="Code" title="GitHub" />

      <div className="space-y-4">
        <Panel title={`Live repository — ${s?.repo ?? "Sourrna/nova-brand-ai"}`}>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading live data…</p>
          ) : q.isError || !s ? (
            <Empty
              title="Could not load repository"
              hint="The server function did not return a usable snapshot."
            />
          ) : !s.ok ? (
            <Empty
              title={SETUP_HINTS[s.code ?? "error"]?.title ?? "Could not load repository"}
              hint={SETUP_HINTS[s.code ?? "error"]?.hint ?? s.error ?? "Could not load repository."}
            >
              <button className="btn btn-ghost" onClick={() => q.refetch()}>
                <RefreshCw size={14} /> Re-check
              </button>
            </Empty>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="chip">{s.info!.private ? "Private" : "Public"}</span>
                <span className="chip">Branch: {s.info!.branch}</span>
                <span className="chip">Open issues/PRs: {s.info!.openIssues}</span>
                <span className="chip">
                  Last push: {new Date(s.info!.pushedAt).toLocaleString()}
                </span>
                <a className="btn btn-ghost" href={s.info!.url} target="_blank" rel="noreferrer">
                  Open on GitHub <ExternalLink size={13} />
                </a>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="label-hud mb-2">Recent commits</p>
                  {s.commits.length ? (
                    <ul className="space-y-1 text-sm">
                      {s.commits.map((c) => (
                        <li key={c.sha} className="flex gap-2">
                          <GitCommit size={14} className="mt-0.5 shrink-0" />
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            <code className="me-2 font-mono text-xs">{c.sha}</code>
                            {c.message}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No commits returned.</p>
                  )}
                </div>
                <div>
                  <p className="label-hud mb-2">Open issues & PRs</p>
                  {s.issues.length ? (
                    <ul className="space-y-1 text-sm">
                      {s.issues.map((i) => (
                        <li key={i.number} className="flex gap-2">
                          <CircleDot size={14} className="mt-0.5 shrink-0" />
                          <a
                            href={i.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            #{i.number} {i.isPr ? "[PR] " : ""}
                            {i.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No open issues.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Panel>

        <ConnectorDetail id="github" />
      </div>
    </>
  );
}
