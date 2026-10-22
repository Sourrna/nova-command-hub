import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Play, RotateCcw, ShieldCheck, FileText, ExternalLink } from "lucide-react";
import { PageHeader, Panel, Empty } from "@/components/nova/ui";
import { GoalInput, PhasePill, Stepper, StateBlock, LoadingLine } from "@/components/nova/Cycle";
import { meta } from "@/lib/nova/meta";
import { buildPlan, executePlan, planFromInterpretation, type ExecutionResult, type PlannedStep } from "@/lib/nova/orchestrator";
import { interpretGoal } from "@/lib/nova/command.server";
import { generateAi } from "@/lib/nova/ai.functions";
import { githubRead } from "@/lib/nova/github-control.server";
import { normalizeGitHubCommandReadData, resolveGitHubCommandRead, summarizeGitHubCommandRead } from "@/lib/nova/github-command";
import { searchNotion } from "@/lib/nova/notion.functions";
import { getLinkedinSnapshot } from "@/lib/nova/linkedin.functions";
import { useHealth } from "@/lib/nova/health";
import { cn } from "@/lib/utils";
import { actions, useNova } from "@/lib/nova/store";

export const Route = createFileRoute("/command")({
  head: () => meta("Command", "Goal intake, plan, and execution with approvals."),
  component: CommandPage,
});

type Mode = "idle" | "planning" | "running" | "done";

export function CommandPage() {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [plan, setPlan] = useState<ReturnType<typeof buildPlan> | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [draftChannel, setDraftChannel] = useState("LinkedIn");
  const [draftAuthor, setDraftAuthor] = useState("");
  const latestExecution = useNova((s) => s.executions[0] ?? null);
  const restored = useRef(false);
  const health = useHealth();
  const openai = health.get("openai").status;
  const xai = health.get("xai").status;
  const aiReady = openai === "connected" || xai === "connected";

  const doInterpret = useServerFn(interpretGoal);
  const doGen = useServerFn(generateAi);
  const doGithubRead = useServerFn(githubRead);
  const doNotionSearch = useServerFn(searchNotion);
  const doLinkedinSnapshot = useServerFn(getLinkedinSnapshot);
  const linkedinReady = health.get("linkedin").status === "connected";
  const linkedinAuthorsQuery = useQuery({
    queryKey: ["command-linkedin-authors"],
    queryFn: () => doLinkedinSnapshot(),
    enabled: draftChannel === "LinkedIn" && linkedinReady,
    staleTime: 60_000,
    retry: false,
  });
  const linkedinAuthors = linkedinAuthorsQuery.data?.ok ? linkedinAuthorsQuery.data.authors : [];
  useEffect(() => {
    if (!restored.current && latestExecution) {
      restored.current = true;
      setGoal(latestExecution.goal);
      setPlan(latestExecution.result.plan);
      setResult(latestExecution.result);
      setMode("done");
      setNote("Restored the most recent command execution from this browser workspace.");
    }
  }, [latestExecution]);
  useEffect(() => {
    if (draftChannel === "LinkedIn" && !linkedinAuthors.includes(draftAuthor)) {
      setDraftAuthor(linkedinAuthors[0] ?? "");
    }
  }, [draftChannel, draftAuthor, linkedinAuthors]);

  async function planGoal() {
    if (!goal.trim()) return;
    setMode("planning");
    setNote(null);
    setAiNote(null);
    setResult(null);
    restored.current = true;
    const fallback = buildPlan(goal.trim());
    if (openai !== "connected" && xai === "connected") {
      for (const step of fallback.steps) {
        if (step.kind === "generate") step.connector = "xai";
      }
    }
    let p = fallback;

    if (aiReady) {
      try {
        const provider = openai === "connected" ? "openai" : "xai";
        const res = await doInterpret({ data: { goal: goal.trim(), provider } });
        if (res.ok) {
          const interpreted = planFromInterpretation(goal.trim(), res.value);
          if (interpreted) {
            p = interpreted;
            setAiNote(`Using validated AI plan: ${res.value.objective} (${(res.value.confidence * 100).toFixed(0)}% confidence).`);
          } else {
            setAiNote("AI plan requested an unsupported or unsafe operation. Using the deterministic plan instead.");
          }
        } else {
          setAiNote(`AI interpretation unavailable: ${res.error} Using the deterministic plan instead.`);
        }
      } catch (e) {
        setAiNote(`AI interpretation error: ${e instanceof Error ? e.message : "unknown"}. Using the deterministic plan instead.`);
      }
    } else {
      setAiNote("AI interpretation not used: no connected OpenAI/xAI credentials detected. Using deterministic planner.");
    }
    setPlan(p);
    setMode("idle");
  }

  async function runPlan() {
    if (!plan) return;
    setMode("running");
    setNote(null);
    const handlers: Record<string, (step: PlannedStep) => Promise<{ summary: string; artifact?: unknown }>> = {};
    for (const s of plan.steps) {
      if (s.kind === "generate" && (s.connector === "openai" || s.connector === "xai")) {
        handlers[s.id] = async () => {
          const provider = s.connector as "openai" | "xai";
          if (health.get(provider).status !== "connected") throw new Error(`No connected ${provider} provider. Add its server secret and re-check status.`);
          const res = await doGen({ data: { provider, prompt: plan.goal } });
          if (!res.ok) throw new Error(res.error);
          return { summary: `Generated draft via ${res.value.model}`, artifact: { text: res.value.text, source: "ai" } };
        };
      }
      if (s.kind === "read" && s.connector === "github") {
        handlers[s.id] = async () => {
          const request = resolveGitHubCommandRead(plan.goal);
          const res = await doGithubRead({ data: request });
          if (!res.ok) throw new Error(res.error ?? "GitHub read failed");
          const data = normalizeGitHubCommandReadData(request.op, res.data);
          return {
            summary: summarizeGitHubCommandRead(request.op, data),
            artifact: { source: "github", operation: request.op, data },
          };
        };
      }
      if (s.kind === "read" && s.connector === "notion") {
        handlers[s.id] = async () => {
          const res = await doNotionSearch({ data: { query: plan.goal } });
          if (!res.ok) throw new Error(res.error ?? "Notion read failed");
          const count = res.data.results.length;
          return { summary: `Notion search: ${count} result(s)`, artifact: { source: "notion", data: res.data } };
        };
      }
      if (s.kind === "read" && s.connector === "linkedin") {
        handlers[s.id] = async () => {
          const res = await doLinkedinSnapshot();
          if (!res.ok) throw new Error(res.error ?? "LinkedIn read failed");
          return { summary: `LinkedIn: ${res.organizations} organization(s) accessible`, artifact: { source: "linkedin", data: res } };
        };
      }
    }
    try {
      const r = await executePlan(plan, handlers);
      setResult(r);
      actions.saveExecution(goal.trim(), r);
      for (const step of r.steps) {
        const planned = plan.steps.find((candidate) => candidate.id === step.stepId);
        if (step.state !== "pending" || !planned?.gated) continue;
        const operation = planned.kind === "write" ? "write" : planned.kind === "publish" ? "publish" : undefined;
        if (!operation) continue;
        if (planned.connector === "github") {
          actions.requestApproval(planned.title, plan.goal.match(/(?<![\w.-])([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)(?![\w.-])/)?.[0] ?? "GitHub repository", "github", undefined, operation);
        } else if (planned.connector === "notion" || planned.connector === "linkedin") {
          const generated = r.steps.find((item) => item.state === "done" && typeof item.artifact === "object" && item.artifact !== null && "text" in item.artifact);
          const text = generated && typeof generated.artifact === "object" && generated.artifact !== null && "text" in generated.artifact && typeof generated.artifact.text === "string" ? generated.artifact.text : plan.goal;
          const title = text.split("\n").find((line) => line.trim())?.slice(0, 200) || plan.goal.slice(0, 200);
          const channel = planned.connector === "linkedin" ? "LinkedIn" : "Notion";
          const connector = planned.connector === "linkedin" ? "linkedin" : "notion";
          const contentId = actions.addContent(title, channel, text, "draft");
          actions.requestApproval(`Save "${title}" to ${channel}`, channel, connector, contentId, operation);
        }
      }
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
    restored.current = true;
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
          <div className="flex items-center gap-2 text-sm"><ShieldCheck size={16} className="text-warn" /><span>External writes fail-closed</span></div>
          <p className="mt-2 text-xs text-muted-foreground">GitHub, Notion, and LinkedIn mutations require authenticated, payload-bound durable approval. No external write is enabled in this deployment.</p>
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
                          <span className={r.state === "failed" ? "text-destructive" : r.state === "pending" ? "text-warn" : ""}>{r.summary}</span>
                          {r.error && <p role="alert" className="mt-1 text-destructive">{r.error}</p>}
                        </div>
                        {r.artifact !== undefined && r.artifact !== null && <OperationArtifact artifact={r.artifact} />}
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
              {result && <StateBlock title={result.state === "awaiting_approval" ? "Awaiting approval" : result.state === "failed" ? "Failed" : "Complete"} hint={result.state === "awaiting_approval" ? "No external action ran. Review the local request in Activity; provider writes remain disabled until secure shared approval storage is configured." : "See the operation output above."} action={<button className="btn btn-ghost" onClick={reset}><RotateCcw size={14} />New goal</button>} />}
            </Panel>
            {result?.steps.some((step) => step.state === "done" && getArtifactText(step.artifact)) && (
              <Panel title="Continue generated draft" className="lg:col-span-3">
                {result.steps.filter((step) => step.state === "done" && getArtifactText(step.artifact)).map((step) => {
                  const text = getArtifactText(step.artifact)!;
                  const title = text.split("\n").find((line) => line.trim())?.slice(0, 120) || plan.goal.slice(0, 120);
                  return <div key={step.stepId} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex-1">{title}</span>
                    <select className="field w-32" aria-label="Draft channel" value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)}>
                      <option>LinkedIn</option><option>Notion</option>
                    </select>
                    {draftChannel === "LinkedIn" && <select className="field max-w-64" aria-label="LinkedIn author" value={draftAuthor} onChange={(e) => setDraftAuthor(e.target.value)} disabled={!linkedinReady || !linkedinAuthors.length}>
                      <option value="">{linkedinAuthors.length ? "Select LinkedIn author (optional)" : "No LinkedIn author available (optional)"}</option>
                      {linkedinAuthors.map((author) => <option key={author} value={author}>{author}</option>)}
                    </select>}
                    <button className="btn btn-primary" onClick={() => actions.addContent(title, draftChannel, text, "draft", draftChannel === "LinkedIn" ? draftAuthor || undefined : undefined)}>Save to Content Studio</button>
                    <Link to="/content" className="btn">Open Studio <ExternalLink size={12} /></Link>
                  </div>;
                })}
              </Panel>
            )}
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

function getArtifactText(artifact: unknown): string | null {
  if (typeof artifact !== "object" || artifact === null || !("text" in artifact)) return null;
  return typeof artifact.text === "string" ? artifact.text : null;
}

function OperationArtifact({ artifact }: { artifact: unknown }) {
  const text = getArtifactText(artifact);
  if (text !== null) return <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-background/50 p-3 text-sm">{text}</pre>;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">View operation data</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-background/50 p-3">{JSON.stringify(artifact, null, 2)}</pre>
    </details>
  );
}
