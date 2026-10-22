import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { actions, useNova, type LogEntry } from "@/lib/nova/store";
import { useHealth } from "@/lib/nova/health";
import type { ConnectorId } from "@/lib/nova/connectors";
import { executeNotionWrite, grantNotionApproval, revokeNotionApproval } from "@/lib/nova/notion.functions";
import { executeLinkedinPublish, grantLinkedinApproval } from "@/lib/nova/linkedin.functions";
import { PageHeader, Panel, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";

export const Route = createFileRoute("/activity")({
  head: () => meta("Activity Log", "Audit log of every operation and the approval gate for write actions."),
  component: Activity,
});

function Activity() {
  const { log, approvals, content } = useNova((s) => s);
  const health = useHealth();
  const execute = useServerFn(executeNotionWrite);
  const notionGrant = useServerFn(grantNotionApproval);
  const linkedinExecute = useServerFn(executeLinkedinPublish);
  const linkedinGrant = useServerFn(grantLinkedinApproval);
  const revoke = useServerFn(revokeNotionApproval);
  const [kind, setKind] = useState<"all" | LogEntry["kind"]>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const shown = log.filter((l) => (kind === "all" || l.kind === kind) && l.message.toLowerCase().includes(q.toLowerCase()));
  const pending = approvals.filter((a) => a.state === "pending");
  const ready = (c: string) => health.get(c as ConnectorId).status === "connected";

  async function approve(a: { id: string; connector: string; ref?: string | undefined; action?: string }) {
    if (!ready(a.connector)) return;
    const item = a.ref ? content.find((c) => c.id === a.ref) : undefined;
    if (!item && a.ref) return;
    const title = item?.title ?? (a.action?.replace(/^Publish\s+"?/, "").replace(/"$/, "") || "Untitled");
    const body = item?.notes ?? "";
    const contentId = item?.id ?? a.ref ?? a.id;
    setBusy((b) => ({ ...b, [a.id]: true }));
    setErrors((e) => ({ ...e, [a.id]: "" }));
    try {
      // Phase 1: the human's click creates a server-side grant that locks the
      // content item, the exact payload, the destination, and the action.
      // Nothing is sent to any provider in this phase.
      if (a.connector === "linkedin") {
        await linkedinGrant({
          data: {
            approvalId: a.id,
            contentId: item?.id ?? contentId,
            author: item?.linkedinAuthor ?? "urn:li:organization:0",
            visibility: "PUBLIC",
            commentary: item?.notes || item?.title || body || title,
            title: item?.title ?? title,
          },
        });
        const r = await linkedinExecute({
          data: {
            author: item?.linkedinAuthor ?? "urn:li:organization:0",
            visibility: "PUBLIC",
            commentary: item?.notes || item?.title || body || title,
            title: item?.title ?? title,
            approvalId: a.id,
            contentId: item?.id ?? contentId,
            grant: false,
          },
        });
        if (r.ok) {
          actions.markExecuted(a.id, (r as any).postId);
          if (item) actions.setContent(item.id, { stage: "published" });
        } else {
          actions.markApprovalFailed(a.id, (r as any).error ?? "Publish failed.");
        }
      } else {
        await notionGrant({
          data: {
            approvalId: a.id,
            contentId,
            title,
            body,
          },
        });
        const r = await execute({
          data: {
            title,
            body,
            approvalId: a.id,
            contentId,
            grant: false,
          },
        });
        if (r.ok) {
          actions.markExecuted(a.id, r.pageId);
          if (item) actions.setContent(item.id, { stage: "published" });
        } else {
          actions.markApprovalFailed(a.id, r.error);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Write failed.";
      actions.markApprovalFailed(a.id, msg);
    } finally {
      setBusy((b) => ({ ...b, [a.id]: false }));
    }
  }

  async function reject(a: { id: string }) {
    try { await revoke({ data: { approvalId: a.id } }); } catch { /* best-effort */ }
    actions.resolveApproval(a.id, false, false);
  }

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
                    <button className="btn btn-primary" disabled={busy[a.id] || !ready(a.connector)} onClick={() => approve(a)}>
                      {busy[a.id] ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{busy[a.id] ? "Writing…" : "Approve"}
                    </button>
                    <button className="btn" onClick={() => reject(a)} disabled={busy[a.id]}><X size={14} />Reject</button>
                  </>
                ) : (
                  <>
                    <span className={`chip ${a.state === "executed" ? "text-ok" : a.state === "failed" ? "text-destructive" : a.state === "invalidated" ? "text-warn" : "text-muted-foreground"}`}>{a.state}</span>
                    {a.state === "executed" && a.pageId && (
                      <span className="label-hud">page {a.pageId.slice(0, 8)}…</span>
                    )}
                    {errors[a.id] && (
                      <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle size={12} />{errors[a.id]}</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty title="No approval requests" hint="Publish and write actions will appear here before anything runs." />}
        <p className="mt-3 text-xs text-muted-foreground">Approving a Notion publish calls the real write adapter through the server function. The server verifies the approval belongs to this content item, locks the payload, and consumes the grant on first execution — a replayed approval cannot create a duplicate page. Without a verified connector the button is disabled and nothing is sent.</p>
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