import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, Play, RotateCcw, ShieldCheck, FileText } from "lucide-react";
import { PageHeader, Panel, Empty } from "@/components/nova/ui";
import { GoalInput, PhasePill, Stepper, StateBlock, LoadingLine } from "@/components/nova/Cycle";
import { meta } from "@/lib/nova/meta";
import { buildPlan, executePlan, type ExecutionResult, type PlannedStep } from "@/lib/nova/orchestrator";
import { interpretGoal } from "@/lib/nova/command.server";
import { generateAi } from "@/lib/nova/ai.functions";
import { getRepoSnapshot } from "@/lib/nova/github.functions";
import { notionSearch } from "@/lib/nova/notion.server";
import { grantNotionApproval } from "@/lib/nova/notion.functions";
import { linkedinOrganizations } from "@/lib/nova/linkedin.server";
import { useHealth } from "@/lib/nova/health";
import { fmtTime } from "@/components/nova/ui";
import { cn } from "@/lib/utils";
import { actions } from "@/lib/nova/store";

export const Route = createFileRoute("/command")({
  head: () => meta("Command", "Goal intake, plan, and execution with approvals."),
  component: CommandPage,
});

type Mode = "idle" | "planning" | "running" | "done";

function CommandPage() {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [plan, setPlan] = useState<ReturnType<typeof buildPlan> | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const health = useHealth();
  const openai = health.get("openai").status;
  const xai = health.get("xai").status;
  const aiReady = openai === "connected" || xai === "connected";

  const doInterpret = useServerFn(interpretGoal);
  const doGen = useServerFn(generateAi);
  const doGrantNotion = useServerFn(grantNotionApproval);

  async function planGoal() {
    if (!goal.trim()) return;
    setMode("planning");
    setNote(null);
    setAiNote(null);
    setResult(null);
    const p = buildPlan(goal.trim());
    setPlan(p);

    if (aiReady) {
      try {
        const res = await doInterpret({ data: { goal: goal.trim() } });
        if (res.ok) {
          setAiNote(`AI interpretation: ${res.value.objective} (confidence ${(res.value.confidence * 100).toFixed(0)}%, intent ${res.value.intent}). Schema validated.`);
        } else {
          setAiNote(`AI interpretation unavailable: ${res.error}`);
        }
      } catch (e) {
        setAiNote(`AI interpretation error: ${e instanceof Error ? e.message : "unknown"}`);
      }
    } else {
      setAiNote("AI interpretation not used: no connected OpenAI/xAI credentials detected. Using deterministic planner.");
    }
    setMode("idle");
  }

  async function runPlan() {
    if (!plan) return;
    setMode("running");
    setNote(null);
    const handlers: Record<string, (step: PlannedStep) => Promise<{ summary: string; artifact?: unknown }>> = {};
    for (const s of plan.steps) {
      if (s.kind === "generate" && s.connector === "openai") {
        handlers[s.id] = async () => {
          if (!aiReady) throw new Error("No connected AI provider (OpenAI/xAI). Add server secrets and re-check status.");
          const res = await doGen({ data: { provider: openai === "connected" ? "openai" : "xai", prompt: goal.trim() } });
          if (!res.ok) throw new Error(res.error);
          return { summary: `Generated draft via ${res.value.model}`, artifact: { text: res.value.text, source: "ai" } };
        };
      }
      if (s.kind === "read" && s.connector === "github") {
        handlers[s.id] = async () => {
          const res = await getRepoSnapshot();
          if (!res.ok) throw new Error(res.error ?? "GitHub read failed");
          return { summary: `${res.repo}: ${res.info?.stars ?? 0} ★ · ${res.info?.openIssues ?? 0} open · ${res.commits.length} recent commits`, artifact: { source: "github", ...res } };
        };
      }
      if (s.kind === "read" && s.connector === "notion") {
        handlers[s.id] = async () => {
          const res = await notionSearch(goal.trim(), fetch);
          if (!res.ok) throw new Error(res.error ?? "Notion read failed");
          const count = Array.isArray((res.data as any)?.results) ? (res.data as any).results.length : 0;
          return { summary: `Notion search: ${count} result(s)`, artifact: { source: "notion", data: res.data } };
        };
      }
      if (s.kind === "read" && s.connector === "linkedin") {
        handlers[s.id] = async () => {
          const res = await linkedinOrganizations(fetch);
          if (!res.ok) throw new Error(res.error ?? "LinkedIn read failed");
          const count = Array.isArray((res.data as any)?.elements) ? (res.data as any).elements.length : 0;
          return { summary: `LinkedIn: ${count} organization(s) accessible`, artifact: { source: "linkedin", data: res.data } };
        };
      }
      if (s.kind === "write" && s.connector === "notion") {
        handlers[s.id] = async () => {
          const approvalId = `na_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const contentId = `nc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const title = goal.trim().slice(0, 200);
          const body = "";
          const res = await doGrantNotion({ data: { approvalId, contentId, title, body } });
          if ((res as any)?.ok === false) throw new Error((res as any).error ?? "Failed to grant Notion approval");
          try {
            actions.requestApproval(`Publish "${title}"`, "Notion", "notion", contentId);
            // Update the approval with our specific id for Activity UI
            const state = (await import("@/lib/nova/store")).readState();
            const found = state.approvals.find((a) => a.ref === contentId && a.state === "pending");
            if (found && found.id !== approvalId) {
              // Replace id by updating state
              const next = state.approvals.map((a) => a.ref === contentId && a.state === "pending" ? { ...a, id: approvalId } : a);
              // We need to use update; but easier to just rely on found id? No - Activity uses approval.id
              // Try to replace via update
              const { update } = await import("@/lib/nova/store");
              update((s2: any) => ({ approvals: s2.approvals.map((a: any) => a.ref === contentId && a.state === "pending" ? { ...a, id: approvalId, action: `Publish "${title}"`, target: "Notion" } : a) }));
            }
          } catch {}
          return { summary: "Notion write approval granted (pending execution via Activity approvals)", artifact: { source: "notion", approvalId, contentId, gated: true } };
        };
      }
    }
    try {
      const r = await executePlan(plan, handlers);
      setResult(r);
      setNote(r.state === "awaiting_approval" ? "Gated steps completed. Public/publishing actions remain behind existing server-side approval gates — no automatic publish." : r.state === "failed" ? "Execution failed. See step results below." : "Execution complete.");
      setMode("done");
    } catch (e) {
      setNote(`Execution error: ${e instanceof Error ? e.message : "unknown"}`);
      setMode("done");
    }
  }

  function reset() {
    setGoal("");
    setPlan(null);
    setResult(null);
    setNote(null);
    setAiNote(null);
    setMode("idle");
  }

  const steps = plan ? plan.steps.map((s, i) => {
    const r = result?.steps.find((x) => x.stepId === s.id);
    const state = r?.state ?? (mode === "planning" ? "active" as const : "pending" as const);
    return { label: s.title, state };
  }) : [];

  return (
    <>
      <PageHeader kicker="Command" title="Goal Workspace">
        <PhasePill phase={mode === "planning" ? "planning" : mode === "running" ? "executing" : result?.state === "awaiting_approval" ? "review" : result?.state === "failed" ? "error" : result?.state === "complete" ? "done" : "idle"} />
        {(plan || goal) && <button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} />Reset</button>}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Goal intake" className="lg:col-span-2">
          <GoalInput value={goal} onChange={setGoal} onSubmit={planGoal} disabled={mode === "planning" || mode === "running"} />
          {aiNote && <p className="mt-2 text-xs text-muted-foreground">{aiNote}</p>}
          {note && <p className="mt-2 text-xs text-silver">{note}</p>}
        </Panel>
        <Panel title="Approval posture">
          <div className="flex items-center gap-2 text-sm"><ShieldCheck size={16} className="text-ok" /><span>Server-side, payload-bound, single-use</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Public publishing and sensitive external writes remain behind the existing approval gates. No automatic publish occurs here.</p>
        </Panel>

        {plan && (
          <>
            <Panel title="Plan" className="lg:col-span-2" action={<span className="label-hud">{plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}</span>}>
              <Stepper steps={steps} />
              <ul className="mt-3 divide-y divide-border">
                {plan.steps.map((s) => {
                  const r = result?.steps.find((x) => x.stepId === s.id);
                  if (!r) {
                    return (
                      <li key={s.id} className="flex items-start gap-3 py-2 text-sm">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-border" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span>{s.title}</span>
                            <span className="label-hud">{s.connector}{s.gated ? " · gated" : ""}</span>
                          </div>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={s.id} className="flex items-start gap-3 py-2 text-sm">
                      <span className={cn("mt-1 h-1.5 w-1.5 rounded-full", r.state === "done" ? "bg-ok" : r.state === "failed" ? "bg-destructive" : r.state === "skipped" ? "bg-idle" : r.state === "running" ? "bg-accent pulse-dot" : "bg-border")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn(r.state === "skipped" && "text-muted-foreground")}>{s.title}</span>
                          <span className="label-hud">{s.connector}{s.gated ? " · gated" : ""}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.summary}
                          {r.error ? ` — ${r.error}` : ""}
                          {r.completedAt ? ` · ${fmtTime(r.completedAt)}` : ""}
                          {r.artifact && (r.artifact as any)?.source ? <span> · source: {(r.artifact as any).source}</span> : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel title="Execute">
              {mode === "planning" && <LoadingLine label="Validating plan" />}
              {mode === "running" && <LoadingLine label="Executing steps" />}
              {mode === "idle" && !result && <StateBlock title="Ready" hint="Plan generated. Execute supported non-destructive steps through existing services." action={<button className="btn btn-primary" onClick={runPlan}><Play size={14} />Execute</button>} />}
              {result && <StateBlock title={result.state === "awaiting_approval" ? "Awaiting approval" : result.state === "failed" ? "Failed" : "Complete"} hint="See step results for details. Gated actions require explicit approval." action={<button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} />New goal</button>} />}
            </Panel>
          </>
        )}

        {!plan && (
          <Panel title="Getting started" className="lg:col-span-3">
            <Empty title="Enter a goal" hint="Example: Draft a LinkedIn post about shipping the command workspace. Or review open GitHub issues." />
          </Panel>
        )}
      </div>
    </>
  );
}
