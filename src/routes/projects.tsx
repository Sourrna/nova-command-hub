import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { actions, useNova, type Project } from "@/lib/nova/store";
import { PageHeader, Panel, Empty, DemoTag } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/projects")({
  head: () => meta("Projects", "Track brand projects, status and progress."),
  component: Projects,
});

function Projects() {
  const projects = useNova((s) => s.projects);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<"all" | Project["status"]>("all");
  const shown = projects.filter((p) => filter === "all" || p.status === filter);
  return (
    <>
      <PageHeader kicker="Portfolio of work" title="Projects" />
      <Panel>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { actions.addProject(name.trim()); setName(""); } }}>
          <input className="field flex-1 min-w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name" />
          <button className="btn btn-primary">Create</button>
          <select className="field w-32" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter status">
            <option value="all">All</option><option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option>
          </select>
        </form>
      </Panel>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.length ? shown.map((p) => (
          <Panel key={p.id}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-silver">{p.name} {p.demo && <DemoTag />}</p>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => actions.delProject(p.id)} aria-label="Delete project"><Trash2 size={14} /></button>
            </div>
            <label className="label-hud mt-4 block">Progress {p.progress}%</label>
            <input type="range" min={0} max={100} value={p.progress} className="w-full accent-[var(--accent)]" onChange={(e) => actions.setProject(p.id, { progress: +e.target.value })} aria-label="Progress" />
            <select className="field mt-3" value={p.status} onChange={(e) => actions.setProject(p.id, { status: e.target.value as Project["status"] })} aria-label="Status">
              <option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option>
            </select>
          </Panel>
        )) : <div className="sm:col-span-3"><Empty title="No projects" hint="Create one above." /></div>}
      </div>
    </>
  );
}
