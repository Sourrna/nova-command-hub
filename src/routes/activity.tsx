import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { actions, useNova, type LogEntry } from "@/lib/nova/store";
import { useHealth } from "@/lib/nova/health";
import { DURABLE_APPROVAL_STORE_CONFIGURED } from "@/lib/nova/approval-config";
import type { ConnectorId } from "@/lib/nova/connectors";
import { executeNotionWrite, grantNotionApproval, revokeNotionApproval } from "@/lib/nova/notion.functions";
import { executeLinkedinPublish, grantLinkedinApproval, revokeLinkedinApproval } from "@/lib/nova/linkedin.functions";
import { PageHeader, Panel, Empty, fmtTime } from "@/components/nova/ui";
import { meta } from "@/lib/nova/meta";
import { approvalHandlerFor, dispatchApproval } from "@/lib/nova/approval-dispatch";
import {
  approveDurableApproval as approveDurableApprovalFn,
  listDurableApprovals,
  rejectDurableApproval as rejectDurableApprovalFn,
  revokeDurableApproval as revokeDurableApprovalFn,
  type DurableApprovalView,
} from "@/lib/nova/durable-approval.functions";
import { githubWrite } from "@/lib/nova/github-write.functions";

export const Route = createFileRoute("/activity")({
  head: () => meta("Activity Log", "Audit log of every operation and the approval gate for write actions."),
  component: Activity,
});

export function Activity() {
  const { log, approvals, content } = useNova((s) => s);
  const health = useHealth();
  const execute = useServerFn(executeNotionWrite);
  const notionGrant = useServerFn(grantNotionApproval);
  const linkedinExecute = useServerFn(executeLinkedinPublish);
  const linkedinGrant = useServerFn(grantLinkedinApproval);
  const linkedinRevoke = useServerFn(revokeLinkedinApproval);
  const revoke = useServerFn(revokeNotionApproval);
  const loadDurable = useServerFn(listDurableApprovals);
  const approveDurable = useServerFn(approveDurableApprovalFn);
  const rejectDurable = useServerFn(rejectDurableApprovalFn);
  const revokeDurable = useServerFn(revokeDurableApprovalFn);
  const executeGitHub = useServerFn(githubWrite);
  const [kind, setKind] = useState<"all" | LogEntry["kind"]>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [durableApprovals, setDurableApprovals] = useState<DurableApprovalView[]>([]);
  const [durableLoading, setDurableLoading] = useState(true);
  const [durableLoadError, setDurableLoadError] = useState<string | null>(null);
  const [durableActionError, setDurableActionError] = useState<string | null>(null);
  const [durableNotice, setDurableNotice] = useState<string | null>(null);
  const shown = log.filter((l) => (kind === "all" || l.kind === kind) && l.message.toLowerCase().includes(q.toLowerCase()));
  const pending = approvals.filter((a) => a.state === "pending");
  const ready = (c: string) => (c === "notion" || c === "linkedin") && health.get(c as ConnectorId).status === "connected";

  const refreshDurable = useCallback(async () => {
    setDurableLoading(true);
    try {
      const response = await loadDurable();
      if (!response.ok) {
        setDurableLoadError(response.error);
      } else {
        setDurableApprovals(response.approvals);
        setDurableLoadError(null);
      }
    } catch (error) {
      setDurableLoadError(error instanceof Error ? error.message : "Could not load durable approvals.");
    } finally {
      setDurableLoading(false);
    }
  }, [loadDurable]);

  useEffect(() => { void refreshDurable(); }, [refreshDurable]);

  async function transitionDurable(id: string, action: "approve" | "reject" | "revoke") {
    const key = `durable:${id}`;
    setBusy((current) => ({ ...current, [key]: true }));
    setDurableActionError(null);
    setDurableNotice(null);
    try {
      const response = action === "approve"
        ? await approveDurable({ data: { approvalId: id } })
        : action === "reject"
          ? await rejectDurable({ data: { approvalId: id } })
          : await revokeDurable({ data: { approvalId: id } });
      let actionError: string | null = null;
      if (!response.ok) {
        actionError = response.error;
      } else {
        setDurableNotice(action === "approve"
          ? "Approval recorded. No provider write was executed."
          : action === "reject" ? "Approval rejected." : "Approval revoked.");
      }
      await refreshDurable();
      if (actionError) setDurableActionError(actionError);
    } catch (error) {
      setDurableActionError(error instanceof Error ? error.message : "Could not update durable approval.");
    } finally {
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }

  async function executeDurableGitHub(id: string) {
    const key = `durable:${id}`;
    setBusy((current) => ({ ...current, [key]: true }));
    setDurableActionError(null);
    setDurableNotice(null);
    try {
      const response = await executeGitHub({ data: { approvalId: id } });
      let actionError: string | null = null;
      if (!response.ok) {
        actionError = response.error;
      } else {
        const number = response.data.number ? ` #${response.data.number}` : "";
        setDurableNotice(`GitHub confirmed ${response.data.ref ? `branch ${response.data.ref}` : `the operation${number}`}.`);
      }
      await refreshDurable();
      if (actionError) setDurableActionError(actionError);
    } catch (error) {
      setDurableActionError(error instanceof Error ? error.message : "GitHub execution failed.");
    } finally {
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }

  async function approve(a: { id: string; connector: string; operation?: "write" | "publish" | undefined; ref?: string | undefined; action?: string }) {
    if (!approvalHandlerFor(a.connector, a.operation)) {
      const msg = `Unsupported approval operation: ${a.connector}/${a.operation ?? "unspecified"}. No external action was run.`;
      actions.markApprovalFailed(a.id, msg);
      setErrors((e) => ({ ...e, [a.id]: msg }));
      return;
    }
    if (!ready(a.connector)) {
      const msg = `Cannot approve ${a.connector}/${a.operation ?? "unspecified"}: connector is not connected.`;
      actions.markApprovalFailed(a.id, msg);
      setErrors((e) => ({ ...e, [a.id]: msg }));
      return;
    }
    const item = a.ref ? content.find((c) => c.id === a.ref) : undefined;
    if (!item && a.ref) return;
    const title = item?.title ?? (a.action?.replace(/^Publish\s+"?/, "").replace(/"$/, "") || "Untitled");
    const body = item?.notes ?? "";
    const contentId = item?.id ?? a.ref ?? a.id;
    setBusy((b) => ({ ...b, [a.id]: true }));
    setErrors((e) => ({ ...e, [a.id]: "" }));
    try {
      await dispatchApproval(a.connector, a.operation, {
        "linkedin-publish": async () => {
          const author = item?.linkedinAuthor;
          if (!author) throw new Error("Select a LinkedIn author from the LinkedIn connector before approval. No post was sent.");
          const grant = await linkedinGrant({
            data: {
              approvalId: a.id, contentId,
              author, visibility: "PUBLIC",
              commentary: item?.notes || item?.title || title,
              title: item?.title ?? title,
            },
          });
          if (!grant.ok) throw new Error(grant.error);
          const r = await linkedinExecute({
            data: {
              author, visibility: "PUBLIC",
              commentary: item?.notes || item?.title || title,
              title: item?.title ?? title,
              approvalId: a.id, contentId, grant: false,
            },
          });
        if (r.ok) {
          actions.markExecuted(a.id, (r as any).postId);
          if (item) actions.setContent(item.id, { stage: "published" });
        } else {
          actions.markApprovalFailed(a.id, (r as any).error ?? "Publish failed.");
          setErrors((e) => ({ ...e, [a.id]: (r as any).error ?? "Publish failed." }));
        }
        },
        "notion-write": async () => {
          const grant = await notionGrant({ data: { approvalId: a.id, contentId, title, body } });
          if (!grant.ok) throw new Error(grant.error);
          const r = await execute({ data: { title, body, approvalId: a.id, contentId, grant: false } });
        if (r.ok) {
          actions.markExecuted(a.id, r.pageId);
          if (item) actions.setContent(item.id, { stage: "published" });
        } else {
          actions.markApprovalFailed(a.id, r.error);
          setErrors((e) => ({ ...e, [a.id]: r.error }));
        }
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Write failed.";
      actions.markApprovalFailed(a.id, msg);
      setErrors((previous) => ({ ...previous, [a.id]: msg }));
    } finally {
      setBusy((b) => ({ ...b, [a.id]: false }));
    }
  }

  async function reject(a: { id: string; connector: string }) {
    try {
      if (a.connector === "notion") await revoke({ data: { approvalId: a.id } });
      else if (a.connector === "linkedin") await linkedinRevoke({ data: { approvalId: a.id } });
    } catch (e) {
      setErrors((previous) => ({ ...previous, [a.id]: e instanceof Error ? e.message : "Could not revoke approval." }));
    }
    actions.resolveApproval(a.id, false, false);
  }

  return (
    <>
      <PageHeader kicker="Audit & approvals" title="Activity Log" />
      <Panel title={`Durable approvals · ${durableApprovals.filter((approval) => approval.status === "pending").length} pending`} className="panel-glow">
        {durableLoading ? (
          <p className="text-sm text-muted-foreground">Loading owner-scoped approvals…</p>
        ) : durableLoadError ? (
          <Empty title="Durable approvals unavailable" hint={durableLoadError}>
            <button className="btn btn-ghost" onClick={() => void refreshDurable()}>Retry</button>
          </Empty>
        ) : (
          <>
            {durableActionError && <p role="alert" className="mb-3 text-xs text-destructive">{durableActionError}</p>}
            {durableApprovals.length ? <ul className="space-y-2">
              {durableApprovals.map((approval) => {
              const key = `durable:${approval.id}`;
              return (
                <li key={approval.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
                  <span className="flex-1">{approval.action} <span className="label-hud">→ {approval.target}</span></span>
                  <span className="label-hud">{approval.provider} · {approval.operation}</span>
                  <span className={`chip ${approval.status === "succeeded" ? "text-ok" : approval.status === "failed" ? "text-destructive" : approval.status === "pending" ? "text-warn" : "text-muted-foreground"}`}>{approval.status}</span>
                  {approval.status === "pending" && (
                    <>
                      <button className="btn btn-primary" disabled={busy[key]} onClick={() => void transitionDurable(approval.id, "approve")}>
                        <Check size={14} />Approve
                      </button>
                      <button className="btn" disabled={busy[key]} onClick={() => void transitionDurable(approval.id, "reject")}>
                        <X size={14} />Reject
                      </button>
                    </>
                  )}
                  {approval.status === "approved" && approval.provider === "github" && (
                    <>
                      <button className="btn btn-primary" disabled={busy[key]} onClick={() => void executeDurableGitHub(approval.id)}>
                        {busy[key] ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Execute GitHub write
                      </button>
                      <button className="btn" disabled={busy[key]} onClick={() => void transitionDurable(approval.id, "revoke")}>Revoke</button>
                    </>
                  )}
                  {approval.result?.url && <a className="btn btn-ghost" href={approval.result.url} target="_blank" rel="noreferrer">Open result</a>}
                  {approval.errorCode && <span className="text-xs text-destructive">Provider error: {approval.errorCode}</span>}
                  {approval.status === "pending" && <span className="text-xs text-muted-foreground">Expires {fmtTime(approval.expiresAt)}</span>}
                </li>
              );
              })}
            </ul> : <Empty title="No durable approval requests" hint="Validated GitHub mutation requests appear here after they are stored for your authenticated account." />}
          </>
        )}
        {durableNotice && <p role="status" className="mt-3 text-xs text-muted-foreground">{durableNotice}</p>}
      </Panel>
      <Panel title={`Approval gate · ${pending.length} pending`} className="panel-glow">
        {approvals.length ? (
          <ul className="space-y-2">
            {approvals.slice(0, 12).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{fmtTime(a.at)}</span>
                <span className="flex-1">{a.action} <span className="label-hud">→ {a.target}</span></span>
                {a.state === "pending" ? (
                  <>
                    {DURABLE_APPROVAL_STORE_CONFIGURED ? (
                      <button className="btn btn-primary" disabled={busy[a.id] || (!!approvalHandlerFor(a.connector, a.operation) && !ready(a.connector))} onClick={() => approve(a)}>
                        {busy[a.id] ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{busy[a.id] ? "Writing…" : "Approve"}
                      </button>
                    ) : (
                      <span className="chip text-warn" title="Configure the shared durable approval store to enable writes">Write unavailable</span>
                    )}
                    <button className="btn" onClick={() => reject(a)} disabled={busy[a.id]}><X size={14} />Reject</button>
                  </>
                ) : (
                  <>
                    <span className={`chip ${a.state === "executed" ? "text-ok" : a.state === "failed" ? "text-destructive" : a.state === "invalidated" ? "text-warn" : "text-muted-foreground"}`}>{a.state}</span>
                    {a.state === "executed" && a.pageId && (
                      <span className="label-hud">page {a.pageId.slice(0, 8)}…</span>
                    )}
                  </>
                )}
                {errors[a.id] && <span role="alert" className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle size={12} />{errors[a.id]}</span>}
              </li>
            ))}
          </ul>
        ) : <Empty title="No approval requests" hint="Publish and write actions will appear here before anything runs." />}
        <p className="mt-3 text-xs text-muted-foreground">These browser-local requests never authorize external writes. GitHub approvals use the authenticated durable flow above when it is configured; Notion and LinkedIn writes remain disabled until their provider handlers use that flow.</p>
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