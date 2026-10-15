import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { actions, useNova } from "@/lib/nova/store";
import { PageHeader, Panel, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/memory")({
  head: () => meta("Memory", "Brand voice, facts and preferences Nova should remember."),
  component: MemoryPage,
});

function MemoryPage() {
  const mem = useNova((s) => s.memory);
  const [text, setText] = useState("");
  const [tag, setTag] = useState("voice");
  const [q, setQ] = useState("");
  const shown = mem.filter((m) => (m.text + m.tag).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader kicker="Knowledge" title="Memory" />
      <Panel>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { actions.addMemory(text.trim(), tag); setText(""); } }}>
          <input className="field flex-1 min-w-48" value={text} onChange={(e) => setText(e.target.value)} placeholder="Something to remember…" aria-label="Memory" />
          <select className="field w-32" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag"><option>voice</option><option>audience</option><option>fact</option><option>goal</option></select>
          <button className="btn btn-primary">Save</button>
          <input className="field w-44" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search memory" />
        </form>
      </Panel>
      <div className="mt-4 space-y-2">
        {shown.length ? shown.map((m) => (
          <Panel key={m.id}>
            <div className="flex items-start gap-3">
              <span className="chip text-idle">{m.tag}</span>
              <p className="flex-1 text-sm">{m.text}</p>
              <span className="font-mono text-xs text-muted-foreground">{fmtTime(m.created)}</span>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => actions.delMemory(m.id)} aria-label="Delete"><Trash2 size={14} /></button>
            </div>
          </Panel>
        )) : <Empty title="No memories" hint="Save voice rules, audience notes and facts." />}
      </div>
    </>
  );
}
