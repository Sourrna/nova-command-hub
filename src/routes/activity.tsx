import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { actions, useNova, type LogEntry } from "@/lib/nova/store";
import { useHealth } from "@/lib/nova/health";
import type { ConnectorId } from "@/lib/nova/connectors";
import { PageHeader, Panel, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/activity")({
  head: () => meta("Activity Log", "Audit log of every operation and the approval gate for write actions."),
  component: Activity,
});

function Activity() {
  const { log, approvals } = useNova((s) => s);
  const health = useHealth();
  const [kind, setKind] = useState<"all" | LogEntry["kind"]>("all");
  const [q, setQ] = useState("");
  const shown = log.filter((l) => (kind === "all" || l.kind === kind) && l.message.toLowerCase().includes(q.toLowerCase()));
  const pending = approvals.filter((a) => a.state === "pending");
  const ready = (c: string) => health.get(c as ConnectorId).status === "connected";

  return (
    <>
      <PageHeader kicker="Audit & approvals" title="Activity Log" />
      <Panel title={`Approval gate · ${pending.length} pending`} className="panel-glow">
        {approvals.length ? (
          <ul className="space-y-2">
            {approvals.slice(0, 12).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{fmtTime(a.at)}</span>
                <span className="flex-1">{a.action} <span className="label-hud">→ {a.target}</span></span>
                {a.state === "pending" ? (
                  <>
                    <button className="btn btn-primary" onClick={() => actions.resolveApproval(a.id, true, ready(a.connector))}><Check size={14} />Approve</button>
                    <button className="btn" onClick={() => actions.resolveApproval(a.id, false, false)}><X size={14} />Reject</button>
                  </>
                ) : (
                  <>
                    <span className={`chip ${a.state === "approved" ? "text-ok" : "text-destructive"}`}>{a.state}</span>
                    {a.state === "approved" && a.ref && (
                      <button className="btn btn-ghost text-xs" onClick={() => { actions.setContent(a.ref!, { stage: "published" }); }}>
                        Mark published manually
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty title="No approval requests" hint="Publish and write actions will appear here before anything runs." />}
        <p className="mt-3 text-xs text-muted-foreground">Approving does not fake success: without a verified connector and adapter, the action is logged as blocked.</p>
      </Panel>
      <Panel title="Audit log" className="mt-4" action={
        <div className="flex gap-2">
          <input className="field !w-40 !py-1 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search log" />
          <select className="field !w-28 !py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Filter kind">
            <option value="all">All</option><option value="local">Local</option><option value="approval">Approval</option><option value="blocked">Blocked</option><option value="info">Info</option>
          </select>
        </div>
      }>
        {shown.length ? (
          <ul className="divide-y divide-border">
            {shown.map((l) => (
              <li key={l.id} className="flex gap-3 py-1.5 text-sm">
                <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{fmtTime(l.at)}</span>
                <span className={`label-hud w-16 shrink-0 ${l.kind === "blocked" ? "!text-warn" : ""}`}>{l.kind}</span>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
        ) : <Empty title="No entries" />}
      </Panel>
    </>
  );
}
