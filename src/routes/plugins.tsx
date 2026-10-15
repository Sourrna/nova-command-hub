import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CONNECTORS, type ConnectorStatus } from "@/lib/nova/connectors";
import { useHealth } from "@/lib/nova/health";
import { ConnectorCard } from "@/components/nova/ConnectorViews";
import { PageHeader, Empty } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/plugins")({
  head: () => meta("Plugin Hub", "Registry of connectors with truthful status and capabilities."),
  component: Hub,
});

function Hub() {
  const health = useHealth();
  const [q, setQ] = useState("");
  const [st, setSt] = useState<"all" | ConnectorStatus>("all");
  const shown = CONNECTORS.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) && (st === "all" || health.get(c.id).status === st));
  return (
    <>
      <PageHeader kicker="Connector registry" title="Plugin Hub">
        <input className="field w-44" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search connectors" />
        <select className="field w-36" value={st} onChange={(e) => setSt(e.target.value as typeof st)} aria-label="Filter status">
          <option value="all">All states</option><option value="connected">Connected</option><option value="limited">Limited</option><option value="needs_setup">Needs setup</option><option value="disconnected">Disconnected</option>
        </select>
      </PageHeader>
      {shown.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((c) => <ConnectorCard key={c.id} c={c} />)}</div>
        : <Empty title="No connectors match" />}
      <p className="mt-6 text-xs text-muted-foreground">"Limited" means a credential exists but has not been verified by a live provider call. Nothing is reported as Connected until verified.</p>
    </>
  );
}
