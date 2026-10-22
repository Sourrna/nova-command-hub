// Task planner + executor for the command workspace.
//
// This is deliberately small and deterministic. It does NOT call external
// services itself — it delegates to the existing connector server functions
// and only orchestrates sequencing, state, and evidence. Every step records
// a timestamp and a result; failures are surfaced, never swallowed.
//
// Nothing here fabricates success. If a credential is missing or a connector
// is unavailable, the step is marked failed with an explicit reason.

export type TaskKind = "generate" | "read" | "write" | "publish" | "approve";

export interface PlannedStep {
  id: string;
  kind: TaskKind;
  title: string;
  connector: string;
  gated: boolean;
  dependsOn: string[];
}

export interface StepResult {
  stepId: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  summary: string;
  artifact?: unknown;
  error?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PlannedStep[];
  createdAt: number;
}

export interface ExecutionResult {
  plan: ExecutionPlan;
  steps: StepResult[];
  state: "planning" | "executing" | "awaiting_approval" | "complete" | "failed";
  completedAt: number;
}

const SUPPORTED_STEPS: Record<string, TaskKind[]> = {
  openai: ["generate"],
  xai: ["generate"],
  github: ["read"],
  notion: ["read", "write"],
  linkedin: ["read", "publish"],
};

/** Convert schema-validated model output into only operations with real handlers. */
export function planFromInterpretation(
  goal: string,
  interpretation: {
    objective: string;
    steps: { title: string; kind: TaskKind; connector: string; gated: boolean }[];
  },
): ExecutionPlan | null {
  const candidates: PlannedStep[] = [];
  for (const [index, candidate] of interpretation.steps.entries()) {
    if (!SUPPORTED_STEPS[candidate.connector]?.includes(candidate.kind)) return null;
    const gated = candidate.kind === "write" || candidate.kind === "publish";
    if (candidate.gated !== gated) return null;
    candidates.push({
      id: `interpreted-${index + 1}`,
      kind: candidate.kind,
      title: candidate.title,
      connector: candidate.connector,
      gated,
      dependsOn: [],
    });
  }
  const steps = [...candidates.filter((step) => !step.gated), ...candidates.filter((step) => step.gated)];
  const generation = steps.find((step) => step.kind === "generate");
  if (generation) {
    for (const step of steps) {
      if (step.gated) step.dependsOn.push(generation.id);
    }
  }
  return { goal: interpretation.objective || goal, steps, createdAt: Date.now() };
}

/** Build a plan from a natural-language goal. Deterministic: no network, no
 * LLM. The mapping is keyword-driven so it is testable and auditable. */
export function buildPlan(goal: string): ExecutionPlan {
  const g = goal.toLowerCase();
  const steps: PlannedStep[] = [];
  const has = (kw: string) => g.includes(kw);

  if (has("draft") || has("write") || has("content") || has("post") || has("publish")) {
    steps.push({ id: "s1-generate", kind: "generate", title: "Draft content from goal", connector: "openai", gated: false, dependsOn: [] });
  }
  if (has("github") || has("repo") || has("issue") || has("pr")) {
    steps.push({ id: "s2-github", kind: "read", title: "Read GitHub context", connector: "github", gated: false, dependsOn: [] });
  }
  if (has("notion") || has("calendar") || has("notes") || has("database")) {
    steps.push({ id: "s3-notion", kind: "read", title: "Read Notion context", connector: "notion", gated: false, dependsOn: [] });
  }
  if (has("linkedin") && (has("publish") || has("post"))) {
    steps.push({ id: "s4-linkedin", kind: "publish", title: "Publish to LinkedIn", connector: "linkedin", gated: true, dependsOn: [] });
  }
  if (has("notion") && (has("save") || has("create") || has("write"))) {
    steps.push({ id: "s5-notion-write", kind: "write", title: "Save to Notion", connector: "notion", gated: true, dependsOn: [] });
  }

  if (steps.length === 0) {
    steps.push({ id: "s0-analyze", kind: "generate", title: "Analyze goal and propose next action", connector: "openai", gated: false, dependsOn: [] });
  }

  // Chain: generation precedes any gated write/publish step.
  const gen = steps.find((s) => s.kind === "generate");
  if (gen) {
    for (const s of steps) {
      if ((s.kind === "write" || s.kind === "publish") && !s.dependsOn.includes(gen.id)) {
        s.dependsOn.push(gen.id);
      }
    }
  }

  return { goal, steps, createdAt: Date.now() };
}

/** Execute a plan against injected step handlers. Handlers return a summary
 * and optional artifact; throws and return-code failures become step errors. */
export async function executePlan(
  plan: ExecutionPlan,
  handlers: Record<string, (step: PlannedStep) => Promise<{ summary: string; artifact?: unknown }>>,
): Promise<ExecutionResult> {
  const results = new Map<string, StepResult>();
  const completed = (stepId: string, patch: Partial<StepResult>) => {
    const cur = results.get(stepId) ?? { stepId, state: "pending", summary: "" };
    results.set(stepId, { ...cur, ...patch });
  };

  for (const step of plan.steps) {
    const depsDone = step.dependsOn.every((d) => results.get(d)?.state === "done");
    if (!depsDone) {
      completed(step.id, { state: "skipped", summary: "Skipped: dependency did not complete." });
      continue;
    }
    const handler = handlers[step.id];
    if (!handler) {
      if (step.gated) {
        completed(step.id, { state: "pending", summary: "Awaiting approval." });
        continue;
      }
      completed(step.id, { state: "failed", summary: "No handler registered for this step.", error: "missing_handler" });
      continue;
    }
    completed(step.id, { state: "running", startedAt: Date.now(), summary: "Running…" });
    try {
      const out = await handler(step);
      completed(step.id, { state: "done", completedAt: Date.now(), summary: out.summary, artifact: out.artifact });
    } catch (e) {
      completed(step.id, { state: "failed", completedAt: Date.now(), summary: "Failed.", error: e instanceof Error ? e.message : "Unknown error" });
    }
  }

  const list = plan.steps.map((s) => results.get(s.id)!);
  const anyFailed = list.some((r) => r.state === "failed");
  const gatedSteps = plan.steps.filter((s) => s.gated);
  const gatedPending = gatedSteps.some((g) => {
    const res = list.find((r) => r.stepId === g.id);
    return res?.state === "pending" || res?.state === "running";
  });
  const gatedComplete = gatedSteps.length > 0 && gatedSteps.every((g) => {
    const res = list.find((r) => r.stepId === g.id);
    return res?.state === "done" && res.completedAt != null;
  });
  const allDone = list.every((r) => r.state === "done" || r.state === "skipped");

  let state: ExecutionResult["state"] = "complete";
  if (anyFailed) state = "failed";
  else if (gatedPending || (gatedComplete && !allDone)) state = "awaiting_approval";
  else if (allDone && gatedSteps.length > 0) state = "awaiting_approval";
  else if (list.some((r) => r.state === "running")) state = "executing";

  return { plan, steps: list, state, completedAt: Date.now() };
}

/** Execute a plan from a natural-language goal by setting up step handlers. */
export async function runPlan(
  plan: ExecutionPlan,
  getRepoSnapshot: () => Promise<unknown>,
  notionSearch: (q: string) => Promise<unknown>,
  linkedinOrganizations: () => Promise<unknown>,
  getHermesStatus: () => Promise<{ state: string; status: unknown }>,
  getLocalAgentStatus: () => Promise<{ state: string; status: unknown }>,
): Promise<ExecutionResult> {
  const handlers: Record<string, (step: PlannedStep) => Promise<{ summary: string; artifact?: unknown }>> = {};
  for (const s of plan.steps) {
    if (s.kind === "generate" && s.connector === "openai") {
      handlers[s.id] = async () => {
        throw new Error("AI generation requires additional integration - handlers to be implemented in command.tsx");
      };
    }
    if (s.kind === "read" && s.connector === "github") {
      handlers[s.id] = async () => {
        const res = await getRepoSnapshot();
        if (!res || typeof res !== "object" || !(res as any).ok) throw new Error("GitHub snapshot failed");
        return { summary: `${(res as any).repo}: ${(res as any).info?.stars ?? 0} ★ · ${(res as any).info?.openIssues ?? 0} open · ${(res as any).commits?.length ?? 0} recent commits`, artifact: { source: "github", ...res } };
      };
    }
    if (s.kind === "read" && s.connector === "notion") {
      handlers[s.id] = async () => {
        const res = await notionSearch(plan.goal);
        if (!res || typeof res !== "object" || !(res as any).ok) throw new Error("Notion search failed");
        const count = Array.isArray((res as any).data?.results) ? (res as any).data.results.length : 0;
        return { summary: `Notion search: ${count} result(s)`, artifact: { source: "notion", data: (res as any).data } };
      };
    }
    if (s.kind === "read" && s.connector === "linkedin") {
      handlers[s.id] = async () => {
        const res = await linkedinOrganizations();
        if (!res || typeof res !== "object" || !(res as any).ok) throw new Error("LinkedIn organizations failed");
        const count = Array.isArray((res as any).data?.elements) ? (res as any).data.elements.length : 0;
        return { summary: `LinkedIn: ${count} organization(s) accessible`, artifact: { source: "linkedin", data: (res as any).data } };
      };
    }
    if (s.kind === "read" && s.connector === "hermes") {
      handlers[s.id] = async () => {
        const res = await getHermesStatus();
        if (!res || typeof res !== "object" || !(res as any).ok) throw new Error("Hermes status failed");
        return { summary: `Hermes: ${(res as any).status?.state}`, artifact: { source: "hermes", status: (res as any).status } };
      };
    }
    if (s.kind === "read" && s.connector === "local-agents") {
      handlers[s.id] = async () => {
        const res = await getLocalAgentStatus();
        if (!res || typeof res !== "object" || !(res as any).ok) throw new Error("Local agents status failed");
        return { summary: `Local agents: ${(res as any).status?.state}`, artifact: { source: "local-agents", status: (res as any).status } };
      };
    }
  }
  return executePlan(plan, handlers);
}