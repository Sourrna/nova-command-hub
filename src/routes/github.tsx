import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, GitCommit, CircleDot, RefreshCw } from "lucide-react";
import { PageHeader, Panel, Empty } from "@/components/nova/ui";
import { ConnectorDetail } from "@/components/nova/ConnectorViews";
import { getRepoSnapshot } from "@/lib/nova/github.functions";
import { githubWriteInputSchema, requestGitHubApproval, type GitHubWriteInput } from "@/lib/nova/github-write.functions";
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

export function GithubPage() {
  const requestApproval = useServerFn(requestGitHubApproval);
  const q = useQuery({
    queryKey: ["gh-snapshot"],
    queryFn: () => getRepoSnapshot(),
    staleTime: 60_000,
  });
  const s = q.data;
  const [operation, setOperation] = useState<GitHubWriteInput["op"]>("issues.create");
  const [owner, setOwner] = useState("Sourrna");
  const [repo, setRepo] = useState("nova-brand-ai");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [issueState, setIssueState] = useState<"open" | "closed">("open");
  const [head, setHead] = useState("");
  const [base, setBase] = useState("main");
  const [branchName, setBranchName] = useState("");
  const [sha, setSha] = useState("");
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef<{ payload: string; id: string } | null>(null);

  async function submitGitHubRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mutation = {
      op: operation,
      owner,
      repo,
      ...(operation === "issues.create" ? { title, body } : {}),
      ...(operation === "issues.update" ? { number: issueNumber, title: title || undefined, body: body || undefined, state: issueState } : {}),
      ...(operation === "prs.create" ? { title, head, base, body } : {}),
      ...(operation === "branches.create" ? { ref: branchName, sha } : {}),
    };
    const parsed = githubWriteInputSchema.safeParse(mutation);
    if (!parsed.success) {
      setRequestMessage(parsed.error.issues[0]?.message ?? "GitHub operation is invalid.");
      return;
    }
    const payloadJson = JSON.stringify(parsed.data);
    if (requestKey.current?.payload !== payloadJson) {
      requestKey.current = { payload: payloadJson, id: crypto.randomUUID() };
    }
    setSubmitting(true);
    setRequestMessage(null);
    try {
      const result = await requestApproval({
        data: { idempotencyKey: requestKey.current.id, mutation: parsed.data },
      });
      if (result.ok) {
        requestKey.current = null;
        setRequestMessage(`Durable approval ${result.approval.id} is ${result.approval.status}. Review it in Activity before execution.`);
      } else {
        setRequestMessage(result.error);
      }
    } catch (error) {
      setRequestMessage(error instanceof Error ? error.message : "Could not create the durable approval request.");
    } finally {
      setSubmitting(false);
    }
  }

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

        <Panel title="Request an approved GitHub operation">
          <p className="mb-3 text-xs text-muted-foreground">
            This creates a durable pending request only. Nothing is sent to GitHub until you approve it and explicitly execute it from Activity.
          </p>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitGitHubRequest}>
            <label className="space-y-1 text-xs">Operation
              <select className="field w-full" value={operation} onChange={(event) => setOperation(event.target.value as GitHubWriteInput["op"])}>
                <option value="issues.create">Create issue</option>
                <option value="issues.update">Update issue</option>
                <option value="branches.create">Create branch</option>
                <option value="prs.create">Create pull request</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">Owner<input className="field w-full" value={owner} onChange={(event) => setOwner(event.target.value)} required /></label>
              <label className="space-y-1 text-xs">Repository<input className="field w-full" value={repo} onChange={(event) => setRepo(event.target.value)} required /></label>
            </div>
            {operation === "issues.update" && (
              <label className="space-y-1 text-xs">Issue number<input className="field w-full" inputMode="numeric" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} required /></label>
            )}
            {operation === "branches.create" ? (
              <>
                <label className="space-y-1 text-xs">New branch<input className="field w-full" value={branchName} onChange={(event) => setBranchName(event.target.value)} required /></label>
                <label className="space-y-1 text-xs">Source commit SHA<input className="field w-full font-mono" value={sha} onChange={(event) => setSha(event.target.value)} required /></label>
              </>
            ) : operation === "prs.create" ? (
              <>
                <label className="space-y-1 text-xs">Head branch<input className="field w-full" value={head} onChange={(event) => setHead(event.target.value)} required /></label>
                <label className="space-y-1 text-xs">Base branch<input className="field w-full" value={base} onChange={(event) => setBase(event.target.value)} required /></label>
              </>
            ) : null}
            {operation !== "branches.create" && (
              <label className="space-y-1 text-xs sm:col-span-2">Title<input className="field w-full" value={title} onChange={(event) => setTitle(event.target.value)} required={operation !== "issues.update"} /></label>
            )}
            {operation === "issues.update" && (
              <label className="space-y-1 text-xs">Issue state
                <select className="field w-full" value={issueState} onChange={(event) => setIssueState(event.target.value as "open" | "closed")}>
                  <option value="open">Open</option><option value="closed">Closed</option>
                </select>
              </label>
            )}
            {(operation === "issues.create" || operation === "issues.update" || operation === "prs.create") && (
              <label className="space-y-1 text-xs sm:col-span-2">Body<textarea className="field w-full" rows={3} value={body} onChange={(event) => setBody(event.target.value)} /></label>
            )}
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? "Requesting…" : "Request approval"}
              </button>
              {requestMessage && <span role="status" className="text-xs text-muted-foreground">{requestMessage}</span>}
            </div>
          </form>
        </Panel>

        <ConnectorDetail id="github" />
      </div>
    </>
  );
}
