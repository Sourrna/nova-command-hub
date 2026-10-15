import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FilePlus, ListPlus, FolderPlus } from "lucide-react";
import { useState } from "react";
import { actions, STAGES, useNova } from "@/lib/nova/store";
import { CONNECTORS } from "@/lib/nova/connectors";
import { useHealth } from "@/lib/nova/health";
import { PageHeader, Panel, Stat, StatusChip, DemoTag, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/")({
  head: () => meta("Command Center", "Operational overview of your personal-brand pipeline, connectors and next actions."),
  component: CommandCenter,
});

function CommandCenter() {
  const s = useNova((x) => x);
  const health = useHealth();
  const [quick, setQuick] = useState("");
  const statuses = CONNECTORS.map((c) => health.get(c.id).status);
  const open = s.tasks.filter((t) => t.status !== "done");
  const pending = s.approvals.filter((a) => a.state === "pending");

  return (
    <>
      <PageHeader kicker="Systems overview" title="Command Center">
        <Link to="/content" className="btn btn-primary"><FilePlus size={14} />New content</Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Connectors live" value={`${statuses.filter((x) => x === "connected").length}/${CONNECTORS.length}`} sub={`${statuses.filter((x) => x === "needs_setup").length} need setup · ${statuses.filter((x) => x === "limited").length} limited`} />
        <Stat label="Open tasks" value={open.length} sub={`${open.filter((t) => t.priority === "high").length} high priority`} />
        <Stat label="In pipeline" value={s.content.filter((c) => c.stage !== "measured").length} sub={`${s.content.filter((c) => c.stage === "review").length} awaiting review`} />
        <Stat label="Pending approvals" value={pending.length} sub="Write/publish actions gated" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Quick actions" className="lg:col-span-1">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { actions.addTask(quick.trim()); setQuick(""); } }}>
            <input className="field" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Capture a task…" aria-label="Quick task" />
            <button className="btn btn-primary" aria-label="Add task"><ListPlus size={14} /></button>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/content" className="btn"><FilePlus size={14} />Idea</Link>
            <Link to="/projects" className="btn"><FolderPlus size={14} />Project</Link>
            <Link to="/plugins" className="btn">Connectors</Link>
            <Link to="/memory" className="btn">Memory</Link>
          </div>
        </Panel>

        <Panel title="Content pipeline" className="lg:col-span-2" action={<Link to="/content" className="label-hud hover:text-silver">Open studio →</Link>}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {STAGES.map((st) => {
              const n = s.content.filter((c) => c.stage === st).length;
              return (
                <div key={st} className="rounded-md border p-2 text-center">
                  <p className="font-mono text-xl text-silver">{n}</p>
                  <p className="label-hud mt-1 !text-[0.6rem]">{st}</p>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Next actions">
          {open.length ? (
            <ul className="space-y-2">
              {open.slice(0, 5).map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`Complete ${t.title}`} onChange={() => actions.setTask(t.id, { status: "done" })} />
                  <span className="flex-1">{t.title}</span>
                  <span className="label-hud">{t.priority}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="All clear" hint="No open tasks." />}
        </Panel>

        <Panel title="Active projects" action={<Link to="/projects" className="label-hud hover:text-silver">All →</Link>}>
          {s.projects.filter((p) => p.status === "active").length ? (
            <ul className="space-y-3">
              {s.projects.filter((p) => p.status === "active").map((p) => (
                <li key={p.id}>
                  <div className="flex items-center justify-between text-sm"><span>{p.name} {p.demo && <DemoTag />}</span><span className="font-mono text-xs">{p.progress}%</span></div>
                  <div className="mt-1 h-1 rounded bg-muted"><div className="h-1 rounded bg-accent" style={{ width: `${p.progress}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <Empty title="No active projects" />}
        </Panel>

        <Panel title="Connector health" action={<Link to="/plugins" className="label-hud hover:text-silver">Hub →</Link>}>
          <ul className="space-y-2">
            {CONNECTORS.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm"><span>{c.name}</span><StatusChip status={health.get(c.id).status} /></li>
            ))}
          </ul>
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-3" action={<Link to="/activity" className="label-hud hover:text-silver">Audit log <ArrowRight size={10} className="inline" /></Link>}>
          <ul className="divide-y divide-border">
            {s.log.slice(0, 6).map((l) => (
              <li key={l.id} className="flex gap-3 py-1.5 text-sm"><span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">{fmtTime(l.at)}</span><span className="label-hud w-16 shrink-0">{l.kind}</span><span>{l.message}</span></li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
