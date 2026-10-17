import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, StatusChip } from "@/components/nova/ui";
import { listNotion } from "@/lib/nova/notion.functions";
import { useNova } from "@/lib/nova/store";
import { meta } from "@/lib/nova/meta";

const notionQuery = queryOptions({ queryKey: ["notion-search", "", ""], queryFn: () => listNotion({ data: {} }), staleTime: 30_000, retry: false });
export const Route = createFileRoute("/notion")({
  head: () => meta("Notion Data Hub", "Live read-only search of shared Notion pages and data sources in NOVA Brand OS."),
  loader: ({ context }) => context.queryClient.ensureQueryData(notionQuery),
  pendingComponent: () => <p role="status">Loading Notion…</p>,
  component: NotionPage,
});

function NotionPage() {
  const initial = useSuspenseQuery(notionQuery);
  const search = useServerFn(listNotion);
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const disabled = useNova((s) => s.disabled.includes("notion"));
  const result = useQuery({ queryKey: ["notion-search", query, cursor], queryFn: () => search({ data: { query, cursor } }), retry: false, staleTime: 30_000, enabled: !disabled });
  const data = result.data ?? (!query && !cursor ? initial.data : undefined);
  const status = disabled ? "disconnected" : data?.ok ? "connected" : data ? data.code === "missing" ? "needs_setup" : data.code === "auth" ? "disconnected" : "limited" : "limited";
  return <>
    <PageHeader kicker="Workspace · Read only" title="Notion"><StatusChip status={status} /><Button variant="outline" disabled={result.isFetching || disabled} onClick={() => { void result.refetch(); void qc.invalidateQueries({ queryKey: ["connector-health"] }); }}><RefreshCw className={result.isFetching ? "animate-spin" : ""} />Refresh</Button></PageHeader>
    <form className="mb-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); setCursor(""); setHistory([]); }}>
      <input className="field min-w-0 flex-1" aria-label="Search Notion" placeholder="Search Notion" maxLength={200} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={disabled} />
      <Button type="submit" variant="outline" disabled={disabled || result.isFetching}><Search />Search</Button>
    </form>
    <div aria-live="polite" aria-busy={result.isFetching}>
      {disabled ? <p role="status">Notion is disconnected in this workspace.</p> : result.isFetching ? <p role="status" className="text-muted-foreground">Loading Notion…</p> : result.isError ? <p role="alert">The Notion request could not be completed. Retry with Refresh.</p> : data && !data.ok ? <p role="alert" className="text-muted-foreground">{data.error}</p> : data?.ok ? <>
        <p className="mb-3 text-sm text-muted-foreground">{data.results.length} shared pages and data sources{query ? ` matching “${query}”` : ""}</p>
        {data.results.length ? <ul className="divide-y border-y">{data.results.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0"><p className="break-words font-medium text-silver">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.kind === "page" ? "Page" : "Data source"}{item.editedAt ? ` · ${item.editedAt.slice(0, 10)}` : ""}</p></div>
          {item.url && <Button asChild variant="ghost" size="sm"><a href={item.url} target="_blank" rel="noreferrer">Open in Notion<ExternalLink /></a></Button>}
        </li>)}</ul> : <p className="py-6 text-muted-foreground">No shared results found{query ? " for this search." : ". Check which pages are shared with the integration."}</p>}
        <div className="mt-4 flex gap-2">
          {history.length > 0 && <Button variant="outline" onClick={() => { setCursor(history[history.length - 1] ?? ""); setHistory(history.slice(0, -1)); }}>Previous</Button>}
          {data.nextCursor && <Button variant="outline" onClick={() => { setHistory([...history, cursor]); setCursor(data.nextCursor ?? ""); }}>Next</Button>}
        </div>
      </> : null}
    </div>
  </>;
}
