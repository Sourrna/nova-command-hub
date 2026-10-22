import { describe, expect, it } from "vitest";
import { buildPlan, executePlan } from "@/lib/nova/orchestrator";

describe("buildPlan", () => {
  it("plans a LinkedIn publish goal with a generate step first", () => {
    const p = buildPlan("Publish this week's LinkedIn post");
    const kinds = p.steps.map((s) => s.kind);
    expect(kinds).toContain("generate");
    expect(kinds).toContain("publish");
    const gen = p.steps.find((s) => s.kind === "generate")!;
    const pub = p.steps.find((s) => s.kind === "publish")!;
    expect(pub.dependsOn).toContain(gen.id);
    expect(pub.gated).toBe(true);
  });

  it("plans a Notion save as a gated write chained after generation", () => {
    const p = buildPlan("Save the draft to Notion");
    const write = p.steps.find((s) => s.kind === "write");
    expect(write).toBeTruthy();
    expect(write!.gated).toBe(true);
    expect(write!.dependsOn).toContain(p.steps.find((s) => s.kind === "generate")!.id);
  });

  it("adds a GitHub read step when the goal mentions repo or issues", () => {
    const p = buildPlan("Review open issues on GitHub");
    expect(p.steps.some((s) => s.connector === "github" && s.kind === "read")).toBe(true);
  });

  it("falls back to an analysis step for an unrelated goal", () => {
    const p = buildPlan("hello world");
    expect(p.steps.length).toBe(1);
    expect(p.steps[0]!.kind).toBe("generate");
  });
});

describe("executePlan", () => {
  it("runs steps in order and records timestamps", async () => {
    const plan = buildPlan("Publish this week's LinkedIn post");
    const seen: string[] = [];
    const handlers = Object.fromEntries(plan.steps.map((s) => [s.id, async () => {
      seen.push(s.id);
      return { summary: `Completed ${s.id}`, artifact: { id: s.id } };
    }]));
    const r = await executePlan(plan, handlers as never);
    expect(r.state).toBe("awaiting_approval");
    expect(r.steps.every((s) => s.state === "done" || s.state === "skipped")).toBe(true);
    expect(r.steps.filter((s) => s.state === "done").every((s) => s.completedAt && s.completedAt >= (s.startedAt ?? 0))).toBe(true);
  });

  it("marks dependent steps skipped when a dependency fails", async () => {
    const plan = buildPlan("Publish this week's LinkedIn post");
    const gen = plan.steps.find((s) => s.kind === "generate")!;
    const handlers = {
      [gen.id]: async () => { throw new Error("no key"); },
    } as never;
    const r = await executePlan(plan, handlers);
    expect(r.state).toBe("failed");
    const pub = plan.steps.find((s) => s.kind === "publish")!;
    const pubRes = r.steps.find((s) => s.stepId === pub.id)!;
    expect(pubRes.state).toBe("skipped");
    expect(pubRes.summary).toContain("Skipped");
  });

  it("records an explicit error when no handler is registered", async () => {
    const plan = buildPlan("hello world");
    const r = await executePlan(plan, {});
    expect(r.state).toBe("failed");
    expect(r.steps[0]!.state).toBe("failed");
    expect(r.steps[0]!.error).toBe("missing_handler");
  });
});