import { describe, expect, it, vi } from "vitest";
import { buildPlan, executePlan } from "@/lib/nova/orchestrator";
import { parseInterpretation, GoalInterpretationSchema } from "@/lib/nova/command-interpreter";

describe("command workspace — plan + execution", () => {
  it("builds a real plan from a publish goal with gated step", () => {
    const p = buildPlan("Publish this week's LinkedIn post about shipping");
    expect(p.steps.some((s) => s.kind === "generate")).toBe(true);
    expect(p.steps.some((s) => s.kind === "publish" && s.gated)).toBe(true);
  });

  it("propagates failures and skips dependent gated steps", async () => {
    const p = buildPlan("Publish this week's LinkedIn post about shipping");
    const gen = p.steps.find((s) => s.kind === "generate")!;
    const r = await executePlan(p, { [gen.id]: async () => { throw new Error("no key"); } } as never);
    expect(r.state).toBe("failed");
    expect(r.steps.find((s) => s.stepId === p.steps.find((x) => x.kind === "publish")!.id)!.state).toBe("skipped");
  });
});

describe("command interpreter — schema validation", () => {
  it("rejects malformed AI output", () => {
    expect(parseInterpretation("not json").ok).toBe(false);
    expect(parseInterpretation("{\"objective\":\"x\"}").ok).toBe(false);
  });
  it("accepts valid AI output", () => {
    const r = parseInterpretation(JSON.stringify({
      objective: "Draft a post",
      intent: "draft",
      connectors: ["openai"],
      steps: [{ title: "Draft", kind: "generate", connector: "openai", gated: false }],
      needsApproval: false,
      confidence: 0.8,
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(GoalInterpretationSchema.safeParse(r.value).success).toBe(true);
  });
});

describe("command flow — missing credentials and approvals", () => {
  it("fails execution when AI handler reports missing credentials", async () => {
    const p = buildPlan("Draft a LinkedIn post");
    const gen = p.steps.find((s) => s.kind === "generate")!;
    const r = await executePlan(p, { [gen.id]: async () => { throw new Error("Missing OPENAI_API_KEY"); } } as never);
    expect(r.state).toBe("failed");
    expect(r.steps[0]!.error).toContain("Missing");
  });
  it("keeps gated steps dependent on generation and never auto-approves", async () => {
    const p = buildPlan("Publish this week's LinkedIn post");
    const gen = p.steps.find((s) => s.kind === "generate")!;
    const pub = p.steps.find((s) => s.kind === "publish")!;
    expect(pub.dependsOn).toContain(gen.id);
    expect(pub.gated).toBe(true);
    const r = await executePlan(p, { [gen.id]: async () => ({ summary: "ok" }) });
    expect(r.steps.find((s) => s.stepId === pub.id)!.state).toBe("pending");
    expect(r.state).toBe("awaiting_approval");
  });
});
