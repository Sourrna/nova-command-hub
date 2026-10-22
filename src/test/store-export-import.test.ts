// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  exportWorkspace,
  importWorkspace,
  actions,
  readState,
  useNova,
} from "@/lib/nova/store";
import { buildPlan } from "@/lib/nova/orchestrator";

// Reset the module-level store between tests so each one starts clean.
beforeEach(() => {
  actions.reset();
});

afterEach(() => {
  actions.reset();
});

describe("exportWorkspace", () => {
  it("returns a JSON string with version and all collections", () => {
    actions.addTask("Do something", "high");
    actions.addContent("Post idea", "LinkedIn");
    actions.saveExecution("Write a post", {
      plan: buildPlan("Draft a post"),
      steps: [{ stepId: "s1-generate", state: "done", summary: "Generated", artifact: { text: "Draft" } }],
      state: "complete",
      completedAt: Date.now(),
    });
    const raw = exportWorkspace();
    expect(() => JSON.parse(raw)).not.toThrow();
    const snap = JSON.parse(raw);
    expect(snap.version).toBe(1);
    expect(snap.exportedAt).toBeGreaterThan(0);
    expect(Array.isArray(snap.tasks)).toBe(true);
    expect(Array.isArray(snap.content)).toBe(true);
    expect(Array.isArray(snap.projects)).toBe(true);
    expect(Array.isArray(snap.memory)).toBe(true);
    expect(snap.executions).toHaveLength(1);
    expect(snap.tasks.some((t: { title: string }) => t.title === "Do something")).toBe(true);
    expect(snap.content.some((c: { title: string }) => c.title === "Post idea")).toBe(true);
  });

  it("strips approval grant material and any secret-looking fields", () => {
    actions.requestApproval("Publish post", "LinkedIn", "linkedin", "c-1");
    const raw = exportWorkspace();
    const snap = JSON.parse(raw);
    // Approvals are exported as audit records only — no payload hashes, no
    // grant material, no page ids that could be mistaken for secrets.
    for (const a of snap.approvals) {
      expect(a).not.toHaveProperty("payloadHash");
      expect(a).not.toHaveProperty("expiresAt");
      expect(a).not.toHaveProperty("pageId");
    }
    const text = JSON.stringify(snap);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("sk-");
    expect(text).not.toContain("payloadHash");
  });
});

describe("importWorkspace", () => {
  it("restores a snapshot produced by exportWorkspace", () => {
    actions.addTask("Original", "med");
    actions.addContent("Original post", "Notion");
    actions.saveExecution("Draft", {
      plan: buildPlan("Draft"),
      steps: [{ stepId: "s0-analyze", state: "failed", summary: "Failed", error: "Missing credential" }],
      state: "failed",
      completedAt: Date.now(),
    });

    const raw = exportWorkspace();

    actions.reset();
    const r = importWorkspace(raw);
    expect(r.ok).toBe(true);
    const s = readState();
    expect(s.tasks.some((t) => t.title === "Original")).toBe(true);
    expect(s.content.some((c) => c.title === "Original post")).toBe(true);
    expect(s.executions[0]?.goal).toBe("Draft");
  });

  it("rejects malformed JSON", () => {
    const r = importWorkspace("not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("JSON");
  });

  it("rejects a snapshot missing required arrays", () => {
    const r = importWorkspace(JSON.stringify({ version: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("missing required arrays");
  });

  it("rejects a foreign payload that is an object without arrays", () => {
    const r = importWorkspace(JSON.stringify({ hello: "world" }));
    expect(r.ok).toBe(false);
  });

  it("does not leak secrets into the snapshot during import", () => {
    const malicious = JSON.stringify({
      version: 1,
      tasks: [], content: [], projects: [], memory: [],
      approvals: [{ id: "x", action: "a", target: "t", connector: "linkedin", state: "pending", secret: "Bearer sk-123" }],
    });
    const r = importWorkspace(malicious);
    expect(r.ok).toBe(true);
    const s = readState();
    expect(JSON.stringify(s)).not.toContain("sk-123");
  });
});

describe("workspace storage synchronization", () => {
  it("updates mounted consumers when another browser tab persists workspace changes", async () => {
    const { result } = renderHook(() => useNova((state) => state.content.map((item) => item.title)));
    const nextState = {
      ...readState(),
      content: [{ id: "remote-item", title: "Saved in another tab", channel: "Notion", stage: "draft", notes: "", updated: Date.now() }],
    };
    localStorage.setItem("nova-brand-os-v1", JSON.stringify(nextState));
    window.dispatchEvent(new StorageEvent("storage", {
      key: "nova-brand-os-v1",
      newValue: JSON.stringify(nextState),
      storageArea: localStorage,
    }));

    await waitFor(() => expect(result.current).toContain("Saved in another tab"));
  });
});