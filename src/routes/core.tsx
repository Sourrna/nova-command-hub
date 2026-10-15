import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { actions, useNova, type Task } from "@/lib/nova/store";
import { PageHeader, Panel, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/core")({
  head: () => meta("Nova Core", "Tasks, plan and execution history for your brand operations."),
  component: Core,
});

const COLS: { id: Task["status"]; label: string }[] = [{ id: "todo", label: "Plan" }, { id: "doing", label: "Executing" }, { id: "done", label: "Done" }];

function Core() {
  const tasks = useNova((s) => s.tasks);
  const history = useNova((s) => s.log.filter((l) => l.message.startsWith("Task")).slice(0, 15));
  const [title, setTitle] = useState("");
  const [prio, setPrio] = useState<Task["priority"]>("med");
  const [q, setQ] = useState("");
  const shown = tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader kicker="Planner & execution" title="Nova Core" />
      <Panel>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { actions.addTask(title.trim(), prio); setTitle(""); } }}>
          <input className="field flex-1 min-w-48" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" aria-label="New task" />
          <select className="field w-28" value={prio} onChange={(e) => setPrio(e.target.value as Task["priority"])} aria-label="Priority">
            <option value="low">Low</option><option value="med">Medium</option><option value="high">High</option>
          </select>
          <button className="btn btn-primary">Add</button>
          <input className="field w-48" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
        </form>
      </Panel>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {COLS.map((col) => {
          const list = shown.filter((t) => t.status === col.id);
          return (
            <Panel key={col.id} title={`${col.label} · ${list.length}`}>
              {list.length ? (
                <ul className="space-y-2">
                  {list.map((t) => (
                    <li key={t.id} className="rounded-md border bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => actions.delTask(t.id)} aria-label="Delete task"><Trash2 size={14} /></button>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="label-hud">{t.priority}</span>
                        <select className="field ms-auto !w-auto !py-0.5 text-xs" value={t.status} onChange={(e) => actions.setTask(t.id, { status: e.target.value as Task["status"] })} aria-label="Status">
                          {COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <Empty title="Nothing here" />}
            </Panel>
          );
        })}
      </div>
      <Panel title="Execution history" className="mt-4">
        {history.length ? <ul className="space-y-1 text-sm">{history.map((h) => <li key={h.id}><span className="me-3 font-mono text-xs text-muted-foreground">{fmtTime(h.at)}</span>{h.message}</li>)}</ul>
          : <Empty title="No history yet" />}
      </Panel>
    </>
  );
}
