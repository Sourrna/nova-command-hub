import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeLinkedinPublishCore } from "@/lib/nova/linkedin.functions";
import { grantApproval, revokeApproval, payloadHash } from "@/lib/nova/approval.server";
import { type LinkedinPostInput } from "@/lib/nova/linkedin.server";

const AUTHOR = "urn:li:organization:123";
const COMMENTARY = "Hello LinkedIn";

type Over = { title?: string; commentary?: string; author?: string };

const granted = (approvalId: string, contentId: string, over: Over = {}): void => {
  grantApproval(
    approvalId,
    contentId,
    over.title ?? "",
    over.commentary ?? COMMENTARY,
    over.author ?? AUTHOR,
    `Publish to LinkedIn as ${over.author ?? AUTHOR}`,
  );
};

const call = (approvalId: string, contentId: string, over: Over = {}) => ({
  author: over.author ?? AUTHOR,
  visibility: "PUBLIC" as const,
  commentary: over.commentary ?? COMMENTARY,
  ...(over.title ? { title: over.title } : {}),
  approvalId,
  contentId,
});

describe("executeLinkedinPublishCore — approval gate", () => {
  beforeEach(() => {
    for (let i = 1; i <= 12; i++) revokeApproval(`l${i}`);
  });

  it("publishes after a human-granted approval", async () => {
    granted("l1", "c1");
    const calls: { idempotencyKey?: string }[] = [];
    const publish = vi.fn(async (input: LinkedinPostInput) => {
      if (input.idempotencyKey) calls.push({ idempotencyKey: input.idempotencyKey });
      return { ok: true as const, data: { id: "post-1", url: "https://www.linkedin.com/posts/post-1" } };
    });
    const r = await executeLinkedinPublishCore(call("l1", "c1"), publish);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.postId).toBe("post-1");
      expect(r.url).toBe("https://www.linkedin.com/posts/post-1");
      expect(r.idempotencyKey).toBe(`l1:${payloadHash("", COMMENTARY)}`);
    }
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ author: AUTHOR }), expect.anything());
    expect(calls[0]?.idempotencyKey).toBe(`l1:${payloadHash("", COMMENTARY)}`);
  });

  it("publishes only to the selected LinkedIn author bound in the approval", async () => {
    const selected = "urn:li:organization:987";
    grantApproval("l-selected", "content-selected", "", COMMENTARY, selected, `Publish to LinkedIn as ${selected}`);
    const publish = vi.fn(async (input: LinkedinPostInput) => ({ ok: true as const, data: { id: input.author } }));
    const result = await executeLinkedinPublishCore(
      { ...call("l-selected", "content-selected", { author: selected }), author: selected },
      publish,
    );
    expect(result.ok).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ author: selected }), expect.anything());
  });

  it("rejects a payload that changed after approval", async () => {
    granted("l2", "c2");
    const publish = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
    const r = await executeLinkedinPublishCore(
      call("l2", "c2", { commentary: "Edited after approval" }),
      publish,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("changed after approval");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a write for a different content item", async () => {
    granted("l3", "c3");
    const publish = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
    const r = await executeLinkedinPublishCore(call("l3", "c-other"), publish);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("does not belong");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a write to a different author than the one approved", async () => {
    granted("l4", "c4");
    const publish = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
    const r = await executeLinkedinPublishCore(
      call("l4", "c4", { author: "urn:li:person:999" }),
      publish,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("destination changed after approval");
    expect(publish).not.toHaveBeenCalled();
  });

  it("is single-use: a replayed approval cannot publish twice", async () => {
    granted("l5", "c5");
    const publish = vi.fn(async () => ({ ok: true as const, data: { id: "post-1" } }));
    await executeLinkedinPublishCore(call("l5", "c5"), publish);
    const r = await executeLinkedinPublishCore(call("l5", "c5"), publish);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("already used");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown approval id entirely", async () => {
    const publish = vi.fn(async () => ({ ok: true as const, data: { id: "x" } }));
    const r = await executeLinkedinPublishCore(call("l6", "c6"), publish);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("request approval first");
    expect(publish).not.toHaveBeenCalled();
  });

  it("propagates provider errors without claiming publication", async () => {
    granted("l7", "c7");
    const publish = vi.fn(async () => ({
      ok: false as const,
      code: "auth" as const,
      error: "LinkedIn rejected the integration token.",
    }));
    const r = await executeLinkedinPublishCore(call("l7", "c7"), publish);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("auth");
      expect(r.error).not.toContain("Bearer");
    }
  });

  it("does not leak the payload content in error messages", async () => {
    granted("l8", "c8", { commentary: "Secret post body" });
    const publish = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await executeLinkedinPublishCore(
      call("l8", "c8", { commentary: "Secret post body" }),
      publish,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("Secret post body");
  });

  it("forwards the grant's idempotency key to the adapter", async () => {
    granted("l9", "c9");
    const seen: string[] = [];
    const publish = vi.fn(async (input: LinkedinPostInput) => {
      if (input.idempotencyKey) seen.push(input.idempotencyKey);
      return { ok: true as const, data: { id: "p1" } };
    });
    await executeLinkedinPublishCore(call("l9", "c9"), publish);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(`l9:${payloadHash("", COMMENTARY)}`);
  });

  it("binds the idempotency key to the payload hash", async () => {
    granted("l10", "c10", { commentary: "Original" });
    const seen: string[] = [];
    const publish = vi.fn(async (input: LinkedinPostInput) => {
      if (input.idempotencyKey) seen.push(input.idempotencyKey);
      return { ok: true as const, data: { id: "p1" } };
    });
    await executeLinkedinPublishCore(call("l10", "c10", { commentary: "Original" }), publish);
    expect(seen[0]).toBe(`l10:${payloadHash("", "Original")}`);
    expect(seen[0]).not.toBe(`l10:${payloadHash("", "Different")}`);
  });
});
