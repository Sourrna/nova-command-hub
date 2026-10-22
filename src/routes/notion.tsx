import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, RefreshCw, Database } from "lucide-react";
import { PageHeader, Panel, Empty, StatusChip } from "@/components/nova/ui";
import { ConnectorDetail } from "@/components/nova/ConnectorViews";
import { notionSearch } from "@/lib/nova/notion.server";
import { healthQuery } from "@/lib/nova/health";
import { meta } from "@/lib/nova/meta";

const SEARCHABLE = [
  { label: "Engineering Ledger", q: "Engineering Ledger" },
  { label: "Migration Ledger", q: "Migration Ledger" },
  { label: "Architecture", q: "Architecture" },
];

export const Route = createFileRoute("/notion")({
  head: () => meta("Notion", "Notion workspace connector status and setup."),
  component: NotionPage,
});

function NotionPage() {
  const q = useQuery({
    queryKey: ["notion-search"],
    queryFn: () => notionSearch("Nova"),
    staleTime: 60_000,
    retry: false,
  });
  const h = useQuery(healthQuery);
  const notionHealth = h.data?.find((c) => c.id === "notion");
  const data = q.data;

  return (
    <>
      <PageHeader kicker="Workspace" title="Notion" />

      <div className="space-y-4">
        <Panel title="Notion workspace">
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Reading live Notion data…</p>
          ) : q.isError || !data ? (
            <Empty title="Notion not reachable" hint="The server function did not return a usable response." />
          ) : !data.ok ? (
            <Empty
              title={data.code === "missing" ? "Notion integration not linked" : data.code === "auth" ? "Notion rejected the token" : data.code === "rate" ? "Notion rate limited the request" : "Notion unreachable"}
              hint={data.error}
            >
              <button className="btn btn-ghost" onClick={() => q.refetch()}>
                <RefreshCw size={14} /> Re-check
              </button>
            </Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <StatusChip status={notionHealth?.status ?? "connected"} />
                <span className="text-muted-foreground">
                  {notionHealth?.reason ?? "Live read access verified"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {data.data.results.length} record(s) returned for query "Nova". Read-only — writes require explicit approval and are not implemented.
              </p>
              {data.data.results.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {(data.data.results as { id: string; object: string; url?: string; title?: string }[]).map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      {r.object === "database" ? <Database size={14} /> : <FileText size={14} />}
                      <span className="truncate">{r.title ?? r.id}</span>
                      <span className="label-hud text-xs">{r.object}</span>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" className="ml-auto btn btn-ghost text-xs">
                          Open <ExternalLink size={12} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No records matched "Nova".</p>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                {SEARCHABLE.map((s) => (
                  <div key={s.label} className="rounded-md border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText size={14} /> {s.label}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Query: "{s.q}"</p>
                    <a
                      className="btn btn-ghost mt-2 text-xs"
                      href={`https://www.notion.com/search?query=${encodeURIComponent(s.q)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Notion <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <ConnectorDetail id="notion" />
      </div>
    </>
  );
}