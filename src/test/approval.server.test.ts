import { describe, expect, it, beforeEach } from "vitest";
import {
  grantApproval,
  consumeApproval,
  revokeApproval,
  payloadHash,
  APPROVAL_TTL_MS,
} from "@/lib/nova/approval.server";

describe("approval.server — server-side grant ledger", () => {
  beforeEach(() => {
    // The ledger is module-level; clear it between tests by revoking every
    // known id. Tests use distinct ids so this is a safe reset.
    for (const id of ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"]) {
      revokeApproval(id);
    }
  });

  it("grants a lock on the exact payload", () => {
    const g = grantApproval("a1", "c1", "Hello", "World");
    expect(g.payloadHash).toBe(payloadHash("Hello", "World"));
    expect(g.status).toBe("granted");
    expect(g.idempotencyKey).toBe(`a1:${payloadHash("Hello", "World")}`);
    expect(g.expiresAt).toBeGreaterThan(Date.now());
    expect(g.expiresAt - Date.now()).toBeLessThanOrEqual(APPROVAL_TTL_MS + 1000);
  });

  it("rejects a payload that changed after approval", () => {
    grantApproval("a2", "c2", "Original", "body");
    expect(() => consumeApproval("a2", "c2", "Edited", "body"))
      .toThrow("Content changed after approval");
  });

  it("rejects a write for a different content item than the approval", () => {
    grantApproval("a3", "c3", "T", "B");
    expect(() => consumeApproval("a3", "c-other", "T", "B"))
      .toThrow("does not belong to this content item");
  });

  it("is single-use: a second consume throws", () => {
    grantApproval("a4", "c4", "T", "B");
    const g = consumeApproval("a4", "c4", "T", "B");
    expect(g.status).toBe("consumed");
    expect(() => consumeApproval("a4", "c4", "T", "B"))
      .toThrow("already used");
  });

  it("rejects an unknown approval id entirely", () => {
    expect(() => consumeApproval("nope", "c", "T", "B"))
      .toThrow("request approval first");
  });

  it("rejects a replayed submission with the same id after consume", () => {
    grantApproval("a5", "c5", "T", "B");
    consumeApproval("a5", "c5", "T", "B");
    // A second call with the same approval id must fail — no duplicate page.
    expect(() => consumeApproval("a5", "c5", "T", "B")).toThrow();
  });

  it("revokes a pending grant so it cannot be consumed", () => {
    grantApproval("a6", "c6", "T", "B");
    revokeApproval("a6");
    expect(() => consumeApproval("a6", "c6", "T", "B"))
      .toThrow("no longer valid");
  });

  it("does not leak the payload content in error messages", () => {
    grantApproval("a7", "c7", "Secret title", "Secret body");
    let msg = "";
    try { consumeApproval("a7", "c7", "Other", "Other"); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    expect(msg).not.toContain("Secret title");
    expect(msg).not.toContain("Secret body");
  });

  it("binds the destination and action to the grant", () => {
    const g = grantApproval("a8", "c8", "T", "B", "urn:li:organization:123", "Publish to LinkedIn");
    expect(g.destination).toBe("urn:li:organization:123");
    expect(g.action).toBe("Publish to LinkedIn");
  });

  it("rejects a consume that targets a different destination", () => {
    grantApproval("a9", "c9", "T", "B", "urn:li:organization:123", "Publish to LinkedIn");
    expect(() => consumeApproval("a9", "c9", "T", "B", "urn:li:person:999", "Publish to LinkedIn"))
      .toThrow("destination changed after approval");
  });

  it("rejects a consume that substitutes a different action", () => {
    grantApproval("b1", "c1", "T", "B", "urn:li:organization:123", "Publish to LinkedIn");
    expect(() => consumeApproval("b1", "c1", "T", "B", "urn:li:organization:123", "Publish to X"))
      .toThrow("action changed after approval");
  });

  it("still consumes when destination and action match exactly", () => {
    grantApproval("b2", "c2", "T", "B", "db-1", "Publish to Notion");
    const g = consumeApproval("b2", "c2", "T", "B", "db-1", "Publish to Notion");
    expect(g.status).toBe("consumed");
  });

  it("does not bind destination when none is supplied (backwards compatible)", () => {
    grantApproval("b3", "c3", "T", "B");
    const g = consumeApproval("b3", "c3", "T", "B");
    expect(g.status).toBe("consumed");
  });

  it("rejects reuse of an approval id for altered payload or destination", () => {
    grantApproval("b4", "c4", "T", "B", "db-1", "Publish to Notion");
    expect(() => grantApproval("b4", "c4", "Changed", "B", "db-1", "Publish to Notion")).toThrow(/different payload or destination/);
    expect(() => grantApproval("b4", "c4", "T", "B", "db-2", "Publish to Notion")).toThrow(/different payload or destination/);
  });
});