import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Building2, FileText, BarChart3, Send } from "lucide-react";
import { actions } from "@/lib/nova/store";
import { PageHeader, Panel, Empty, StatusChip } from "@/components/nova/ui";
import { ConnectorDetail } from "@/components/nova/ConnectorViews";
import { getLinkedinSnapshot, buildLinkedinSnapshot } from "@/lib/nova/linkedin.functions";
import { healthQuery } from "@/lib/nova/health";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/linkedin")({
  head: () => meta("LinkedIn", "LinkedIn publishing connector status and setup."),
  component: LinkedinPage,
});

const linkedinQuery = {
  queryKey: ["linkedin-snapshot"],
  queryFn: () => getLinkedinSnapshot(),
  staleTime: 60_000,
  retry: false,
};

function LinkedinPage() {
  const snap = useQuery(linkedinQuery);
  const h = useQuery(healthQuery);
  const linkedinHealth = h.data?.find((c) => c.id === "linkedin");
  const [author, setAuthor] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const authors = snap.data?.ok ? snap.data.authors : [];

  useEffect(() => {
    if (!authors.includes(author)) setAuthor(authors[0] ?? "");
  }, [authors, author]);

  function draftPost(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !authors.includes(author)) return;
    actions.addContent(title.trim(), "LinkedIn", body.trim(), "draft", author);
    setTitle(""); setBody("");
  }

  return (
    <>
      <PageHeader kicker="Social" title="LinkedIn" />

      <div className="space-y-4">
        <Panel title="New post">
          <p className="text-sm text-muted-foreground">Draft a post into the Content Studio. It moves through idea → strategy → draft → review → approved, then appears in the Activity Log for an explicit approval before anything is published.</p>
          <form onSubmit={draftPost} className="mt-3 space-y-3">
            <select className="field w-full" value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="LinkedIn author" disabled={!authors.length}>
              <option value="">{authors.length ? "Select an available LinkedIn author" : "No LinkedIn author available"}</option>
              {authors.map((urn) => <option key={urn} value={urn}>{urn}</option>)}
            </select>
            <input className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" aria-label="Post title" />
            <textarea className="field min-h-24 w-full" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Post commentary (max 700 chars)" aria-label="Post commentary" maxLength={700} />
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || !authors.includes(author)}><Send size={14} /> Draft post</button>
          </form>
        </Panel>

        <Panel title="LinkedIn workspace">
          {snap.isLoading ? (
            <p className="text-sm text-muted-foreground">Reading live LinkedIn data…</p>
          ) : snap.isError || !snap.data ? (
            <Empty title="LinkedIn not reachable" hint="The server function did not return a usable response." />
          ) : !snap.data.ok ? (
            <Empty
              title={snap.data.code === "missing" ? "LinkedIn integration not linked" : snap.data.code === "auth" ? "LinkedIn rejected the token" : snap.data.code === "rate" ? "LinkedIn rate limited the request" : "LinkedIn unreachable"}
              {...(snap.data.error ? { hint: snap.data.error } : {})}
            >
              <button className="btn btn-ghost" onClick={() => snap.refetch()}>
                <RefreshCw size={14} /> Re-check
              </button>
            </Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <StatusChip status={linkedinHealth?.status ?? "connected"} />
                <span className="text-muted-foreground">
                  {linkedinHealth?.reason ?? "Live read access verified"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border p-2">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground"><Building2 size={12} /></div>
                  <div className="font-mono text-lg">{snap.data.organizations}</div>
                  <div className="text-[10px] text-muted-foreground">orgs</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground"><FileText size={12} /></div>
                  <div className="font-mono text-lg">{snap.data.posts}</div>
                  <div className="text-[10px] text-muted-foreground">posts</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="flex items-center justify-center gap-1 text-muted-foreground"><BarChart3 size={12} /></div>
                  <div className="font-mono text-lg">{snap.data.engagement}</div>
                  <div className="text-[10px] text-muted-foreground">engagement</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Publishing requires explicit approval and is disabled until a shared durable approval store is configured.</p>
            </div>
          )}
        </Panel>

        <ConnectorDetail id="linkedin" />
      </div>
    </>
  );
}

export { buildLinkedinSnapshot };