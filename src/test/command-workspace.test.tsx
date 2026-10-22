import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildPlan, executePlan } from "@/lib/nova/orchestrator";
import { planFromInterpretation } from "@/lib/nova/orchestrator";
import { parseInterpretation, GoalInterpretationSchema } from "@/lib/nova/command-interpreter";
import { actions, readState } from "@/lib/nova/store";

const commandMocks = vi.hoisted(() => ({
  interpret: Symbol("interpret"),
  generate: Symbol("generate"),
  notion: Symbol("notion"),
  linkedin: Symbol("linkedin"),
  notionExecute: Symbol("notionExecute"),
  notionGrant: Symbol("notionGrant"),
  notionRevoke: Symbol("notionRevoke"),
  linkedinExecute: Symbol("linkedinExecute"),
  linkedinGrant: Symbol("linkedinGrant"),
  linkedinRevoke: Symbol("linkedinRevoke"),
  interpretCall: vi.fn(),
  generateCall: vi.fn(),
  linkedinCall: vi.fn(),
  notionExecuteCall: vi.fn(),
  notionGrantCall: vi.fn(),
  notionRevokeCall: vi.fn(),
  linkedinExecuteCall: vi.fn(),
  linkedinGrantCall: vi.fn(),
  linkedinRevokeCall: vi.fn(),
  linkedinConnected: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (route: unknown) => route,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: (fn: unknown) => fn === commandMocks.interpret
      ? commandMocks.interpretCall
      : fn === commandMocks.generate
        ? commandMocks.generateCall
        : fn === commandMocks.linkedin
          ? commandMocks.linkedinCall
          : fn === commandMocks.notionExecute
            ? commandMocks.notionExecuteCall
            : fn === commandMocks.notionGrant
              ? commandMocks.notionGrantCall
              : fn === commandMocks.notionRevoke
                ? commandMocks.notionRevokeCall
                : fn === commandMocks.linkedinExecute
                  ? commandMocks.linkedinExecuteCall
                  : fn === commandMocks.linkedinGrant
                    ? commandMocks.linkedinGrantCall
                    : fn === commandMocks.linkedinRevoke
                      ? commandMocks.linkedinRevokeCall
                      : async () => ({ ok: false, error: "not used" }),
  };
});
vi.mock("@/lib/nova/command.server", () => ({ interpretGoal: commandMocks.interpret }));
vi.mock("@/lib/nova/ai.functions", () => ({ generateAi: commandMocks.generate }));
vi.mock("@/lib/nova/notion.functions", () => ({
  searchNotion: commandMocks.notion,
  executeNotionWrite: commandMocks.notionExecute,
  grantNotionApproval: commandMocks.notionGrant,
  revokeNotionApproval: commandMocks.notionRevoke,
}));
vi.mock("@/lib/nova/linkedin.functions", () => ({
  getLinkedinSnapshot: commandMocks.linkedin,
  executeLinkedinPublish: commandMocks.linkedinExecute,
  grantLinkedinApproval: commandMocks.linkedinGrant,
  revokeLinkedinApproval: commandMocks.linkedinRevoke,
}));
vi.mock("@/lib/nova/health", () => ({
  useHealth: () => ({
    get: (id: string) => ({ status: id === "xai" || (id === "linkedin" && commandMocks.linkedinConnected) ? "connected" : "needs_setup", reason: "test", missing: [] }),
  }),
}));

import { CommandPage } from "@/routes/command";
import { Studio } from "@/routes/content";
import { Activity } from "@/routes/activity";

beforeEach(() => {
  actions.reset();
  commandMocks.interpretCall.mockReset().mockResolvedValue({
    ok: true,
    value: {
      objective: "Draft a launch announcement",
      intent: "draft",
      connectors: ["xai"],
      steps: [{ title: "Generate announcement", kind: "generate", connector: "xai", gated: false }],
      needsApproval: false,
      confidence: 0.92,
    },
  });
  commandMocks.generateCall.mockReset().mockResolvedValue({
    ok: true,
    value: { text: "Launch headline\nFull generated announcement.", model: "grok-test" },
  });
  commandMocks.linkedinCall.mockReset().mockResolvedValue({ ok: true, authors: ["urn:li:organization:321"] });
  commandMocks.notionExecuteCall.mockReset();
  commandMocks.notionGrantCall.mockReset();
  commandMocks.notionRevokeCall.mockReset();
  commandMocks.linkedinExecuteCall.mockReset();
  commandMocks.linkedinGrantCall.mockReset();
  commandMocks.linkedinRevokeCall.mockReset();
  commandMocks.linkedinConnected = false;
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CommandPage /></QueryClientProvider>);
}

function expectDraftBodyInStudio(body: string) {
  expect(screen.getAllByLabelText("Notes").map((field) => field instanceof HTMLTextAreaElement ? field.value : "")).toContain(body);
}

describe("command workspace — plan + execution", () => {
  it("uses a validated interpreted plan and rejects unsupported operations", () => {
    const candidate = {
      objective: "Research project",
      steps: [{ title: "Read context", kind: "read" as const, connector: "github", gated: false }],
    };
    expect(planFromInterpretation("original", candidate)?.steps[0]?.connector).toBe("github");
    expect(planFromInterpretation("original", {
      ...candidate,
      steps: [{ title: "Make issue", kind: "write", connector: "github", gated: true }],
    })).toBeNull();
  });

  it("renders, persists, restores, and continues a generated draft", async () => {
    commandMocks.linkedinConnected = true;
    const first = renderPage();
    fireEvent.change(screen.getByPlaceholderText(/describe a goal/i), { target: { value: "Something unrelated" } });
    fireEvent.click(screen.getByRole("button", { name: /plan execution/i }));
    await screen.findByText(/Using validated AI plan/);
    expect(screen.getAllByText("Generate announcement")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    expect(await screen.findByText(/Full generated announcement\./)).toBeInTheDocument();
    await waitFor(() => expect(readState().executions).toHaveLength(1));
    const save = screen.getByRole("button", { name: "Save to Content Studio" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(readState().content.some((item) => item.title === "Launch headline" && item.notes === "Launch headline\nFull generated announcement." && item.linkedinAuthor === "urn:li:organization:321")).toBe(true);
    expect(commandMocks.generateCall).toHaveBeenCalledWith({ data: { provider: "xai", prompt: "Draft a launch announcement" } });

    first.unmount();
    const studio = render(<Studio />);
    expect(await screen.findByDisplayValue("Launch headline")).toBeInTheDocument();
    expectDraftBodyInStudio("Launch headline\nFull generated announcement.");
    studio.unmount();

    const activity = render(<Activity />);
    expect(await screen.findByText(/Command execution complete: Something unrelated/)).toBeInTheDocument();
    activity.unmount();

    renderPage();
    expect(await screen.findByText(/Full generated announcement\./)).toBeInTheDocument();
    expect(screen.getByText(/Restored the most recent command execution/)).toBeInTheDocument();
  });

  it("saves a local LinkedIn draft without a connected account or live author lookup", async () => {
    const command = renderPage();
    fireEvent.change(screen.getByPlaceholderText(/describe a goal/i), { target: { value: "Draft a LinkedIn announcement" } });
    fireEvent.click(screen.getByRole("button", { name: /plan execution/i }));
    await screen.findByText(/Using validated AI plan/);
    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    expect(await screen.findByText(/Full generated announcement\./)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Save to Content Studio" })).toBeEnabled();
    expect(commandMocks.linkedinCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save to Content Studio" }));
    expect(readState().content.some((item) => item.title === "Launch headline" && item.notes === "Launch headline\nFull generated announcement." && !item.linkedinAuthor)).toBe(true);

    command.unmount();
    const studio = render(<Studio />);
    expect(await screen.findByDisplayValue("Launch headline")).toBeInTheDocument();
    expectDraftBodyInStudio("Launch headline\nFull generated announcement.");
    studio.unmount();
    const activity = render(<Activity />);
    expect(await screen.findByText(/Command execution complete: Draft a LinkedIn announcement/)).toBeInTheDocument();
    activity.unmount();

    renderPage();
    expect(await screen.findByText(/Full generated announcement\./)).toBeInTheDocument();
  });

  it("keeps a gated Notion step pending and creates only a local approval request", async () => {
    commandMocks.interpretCall.mockResolvedValueOnce({
      ok: true,
      value: {
        objective: "Save the campaign to Notion",
        intent: "save",
        connectors: ["notion"],
        steps: [{ title: "Create Notion page", kind: "write", connector: "notion", gated: true }],
        needsApproval: true,
        confidence: 0.9,
      },
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/describe a goal/i), { target: { value: "Save campaign" } });
    fireEvent.click(screen.getByRole("button", { name: /plan execution/i }));
    await screen.findByText(/Using validated AI plan/);
    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    expect(await screen.findByText("Awaiting approval.")).toBeInTheDocument();
    expect(readState().executions[0]?.result.state).toBe("awaiting_approval");
    expect(readState().executions[0]?.result.steps[0]?.state).toBe("pending");
    expect(readState().approvals[0]?.state).toBe("pending");
    expect(readState().approvals[0]?.operation).toBe("write");
    expect(readState().log[0]?.kind).toBe("approval");
    expect(commandMocks.notionExecuteCall).not.toHaveBeenCalled();

    const activity = render(<Activity />);
    expect(await screen.findByText(/Approval gate.*1 pending/)).toBeInTheDocument();
    expect(screen.getByText(/Command execution awaiting_approval: Save campaign/)).toBeInTheDocument();
    expect(screen.getByText("Write unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(commandMocks.notionExecuteCall).not.toHaveBeenCalled();
    activity.unmount();
  });

  it("keeps a gated LinkedIn publish step pending and creates a local approval request", async () => {
    commandMocks.interpretCall.mockResolvedValueOnce({
      ok: true,
      value: {
        objective: "Publish launch announcement to LinkedIn",
        intent: "publish",
        connectors: ["linkedin"],
        steps: [{ title: "Publish to LinkedIn", kind: "publish", connector: "linkedin", gated: true }],
        needsApproval: true,
        confidence: 0.9,
      },
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/describe a goal/i), { target: { value: "Publish announcement" } });
    fireEvent.click(screen.getByRole("button", { name: /plan execution/i }));
    await screen.findByText(/Using validated AI plan/);
    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    expect(await screen.findByText("Awaiting approval.")).toBeInTheDocument();
    expect(readState().executions[0]?.result.state).toBe("awaiting_approval");
    expect(readState().executions[0]?.result.steps[0]?.state).toBe("pending");
    expect(readState().approvals[0]?.state).toBe("pending");
    expect(readState().approvals[0]?.connector).toBe("linkedin");
    expect(readState().approvals[0]?.operation).toBe("publish");
    expect(readState().content[0]?.channel).toBe("LinkedIn");
  });

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
