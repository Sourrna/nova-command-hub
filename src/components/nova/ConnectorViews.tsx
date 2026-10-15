import { Link } from "@tanstack/react-router";
import { ExternalLink, Lock, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { CONNECTORS, getConnector, type ConnectorDef, type ConnectorId } from "@/lib/nova/connectors";
import { useHealth } from "@/lib/nova/health";
import { actions, useNova } from "@/lib/nova/store";
import { PageHeader, Panel, StatusChip, DemoTag, fmtTime } from "./ui";

const ROUTE: Record<ConnectorId, string> = { openai: "/models", xai: "/models", notion: "/notion", lovable: "/lovable", github: "/github", linkedin: "/linkedin" };

export function ConnectorCard({ c }: { c: ConnectorDef }) {
  const h = useHealth().get(c.id);
  return (
    <Link to={ROUTE[c.id]} className="panel block p-4 transition hover:panel-glow">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-silver">{c.name}</p>
          <p className="label-hud mt-0.5">{c.category}</p>
        </div>
        <StatusChip status={h.status} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{c.description}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {c.capabilities.map((cap) => (
          <span key={cap.label} className="chip text-idle">{cap.gated && <Lock size={10} />}{cap.label}</span>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{h.reason}</p>
    </Link>
  );
}

export function ConnectorDetail({ id, demo }: { id: ConnectorId; demo?: React.ReactNode }) {
  const c = getConnector(id);
  const health = useHealth();
  const h = health.get(id);
  const qc = useQueryClient();
  const disabled = useNova((s) => s.disabled.includes(id));
  const log = useNova((s) => s.log.filter((l) => l.message.toLowerCase().includes((c.name.split(" ")[0] ?? c.name).toLowerCase())).slice(0, 6));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Status" className="md:col-span-1">
          <StatusChip status={h.status} />
          <p className="mt-3 text-sm text-muted-foreground">{h.reason}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["connector-health"] })}>
              <RefreshCw size={14} className={health.isFetching ? "animate-spin" : ""} /> Re-check
            </button>
            {c.secrets.length > 0 && (
              <button className="btn btn-ghost" onClick={() => actions.toggleConnector(id)}>{disabled ? "Re-enable" : "Disconnect"}</button>
            )}
          </div>
        </Panel>
        <Panel title="Setup" className="md:col-span-2">
          <ol className="list-decimal space-y-1 ps-5 text-sm">{c.setup.map((s) => <li key={s}>{s}</li>)}</ol>
          {c.secrets.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Required server secrets: {c.secrets.map((s) => <code key={s} className="me-1 rounded bg-muted px-1 font-mono">{s}</code>)} — stored server-side only, never sent to the browser.
            </p>
          )}
          <a href={c.docs} target="_blank" rel="noreferrer" className="btn btn-ghost mt-3">Provider docs <ExternalLink size={13} /></a>
        </Panel>
      </div>
      <Panel title="Capabilities">
        <ul className="grid gap-2 sm:grid-cols-2">
          {c.capabilities.map((cap) => (
            <li key={cap.label} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>{cap.label}</span>
              <span className="label-hud">{cap.gated ? "approval required" : cap.kind}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Provider adapter calls are not yet implemented in this MVP; gated actions are logged and blocked rather than simulated.</p>
      </Panel>
      {demo && <Panel title="Preview" action={<DemoTag />}>{demo}</Panel>}
      <Panel title="Recent operations">
        {log.length ? (
          <ul className="space-y-1 text-sm">{log.map((l) => <li key={l.id} className="flex gap-3"><span className="font-mono text-xs text-muted-foreground">{fmtTime(l.at)}</span>{l.message}</li>)}</ul>
        ) : <p className="text-sm text-muted-foreground">No operations recorded for this connector yet.</p>}
      </Panel>
    </div>
  );
}

export function ConnectorPage({ id, kicker, demo }: { id: ConnectorId; kicker: string; demo?: React.ReactNode }) {
  return (<><PageHeader kicker={kicker} title={getConnector(id).name} /><ConnectorDetail id={id} demo={demo} /></>);
}

export { CONNECTORS };
