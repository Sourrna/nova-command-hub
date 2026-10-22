// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  exportWorkspace,
  importWorkspace,
  actions,
  readState,
} from "@/lib/nova/store";

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
    const raw = exportWorkspace();
    expect(() => JSON.parse(raw)).not.toThrow();
    const snap = JSON.parse(raw);
    expect(snap.version).toBe(1);
    expect(snap.exportedAt).toBeGreaterThan(0);
    expect(Array.isArray(snap.tasks)).toBe(true);
    expect(Array.isArray(snap.content)).toBe(true);
    expect(Array.isArray(snap.projects)).toBe(true);
    expect(Array.isArray(snap.memory)).toBe(true);
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
    const raw = exportWorkspace();

    actions.reset();
    const r = importWorkspace(raw);
    expect(r.ok).toBe(true);
    const s = readState();
    expect(s.tasks.some((t) => t.title === "Original")).toBe(true);
    expect(s.content.some((c) => c.title === "Original post")).toBe(true);
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