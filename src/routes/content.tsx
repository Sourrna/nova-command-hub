import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Send, Trash2 } from "lucide-react";
import { actions, STAGES, useNova, type ContentItem } from "@/lib/nova/store";
import { PageHeader, Panel, Empty, DemoTag } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/content")({
  head: () => meta("Content Studio", "Move content from idea to strategy, draft, review, approval, publishing and measurement."),
  component: Studio,
});

function Studio() {
  const items = useNova((s) => s.content);
  const approvals = useNova((s) => s.approvals);
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("LinkedIn");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const shown = items.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) && (filter === "all" || c.channel === filter));

  const move = (c: ContentItem, dir: 1 | -1) => {
    const next = STAGES[STAGES.indexOf(c.stage) + dir];
    if (!next) return;
    // Approved → published is an external write: route through the approval gate.
    if (next === "published") {
      if (approvals.some((a) => a.ref === c.id && a.state === "pending")) return;
      actions.requestApproval(`Publish "${c.title}"`, c.channel, c.channel.toLowerCase(), c.id);
      return;
    }
    actions.setContent(c.id, { stage: next });
  };

  return (
    <>
      <PageHeader kicker="Pipeline" title="Content Studio" />
      <Panel>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { actions.addContent(title.trim(), channel); setTitle(""); } }}>
          <input className="field flex-1 min-w-48" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New idea" aria-label="New idea" />
          <select className="field w-32" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel"><option>LinkedIn</option><option>Notion</option><option>GitHub</option></select>
          <button className="btn btn-primary">Add idea</button>
          <input className="field w-44" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search content" />
          <select className="field w-32" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter channel"><option value="all">All channels</option><option>LinkedIn</option><option>Notion</option><option>GitHub</option></select>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Moving an item from Approved to Published creates an approval request. No post is sent until a real adapter is connected.</p>
      </Panel>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((st) => {
          const list = shown.filter((c) => c.stage === st);
          return (
            <Panel key={st} title={`${st} · ${list.length}`} className="w-64 shrink-0">
              {list.length ? (
                <ul className="space-y-2">
                  {list.map((c) => {
                    const waiting = approvals.some((a) => a.ref === c.id && a.state === "pending");
                    return (
                      <li key={c.id} className="rounded-md border bg-background/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm">{c.title}</p>
                          <button className="text-muted-foreground hover:text-destructive" onClick={() => actions.delContent(c.id)} aria-label="Delete"><Trash2 size={13} /></button>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1"><span className="label-hud">{c.channel}</span>{c.demo && <DemoTag />}{waiting && <span className="chip text-warn">awaiting approval</span>}</div>
                        <textarea className="field mt-2 h-14 text-xs" value={c.notes} placeholder="Notes / draft" aria-label="Notes"
                          onChange={(e) => actions.setContent(c.id, { notes: e.target.value })} />
                        <div className="mt-2 flex justify-between">
                          <button className="btn btn-ghost !p-1" disabled={st === "idea"} onClick={() => move(c, -1)} aria-label="Previous stage"><ChevronLeft size={14} className="rtl:rotate-180" /></button>
                          <button className="btn !py-1 text-xs" disabled={st === "measured" || waiting} onClick={() => move(c, 1)}>
                            {st === "approved" ? <><Send size={12} />Request publish</> : <>Advance<ChevronRight size={12} className="rtl:rotate-180" /></>}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <Empty title="Empty" />}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
