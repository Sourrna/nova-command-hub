import { describe, expect, it, vi } from "vitest";
import { generateInput, generateText, testProvider } from "@/lib/nova/ai.server";

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const status = (s: number) => vi.fn(async () => new Response("secret-leak", { status: s })) as unknown as typeof fetch;

describe("AI adapters", () => {
  it("returns text on success", async () => {
    const r = await generateText({ provider: "openai", prompt: "hi" }, "k", ok({ choices: [{ message: { content: "hello" } }] }));
    expect(r).toEqual({ ok: true, value: { text: "hello", model: "gpt-4o-mini" } });
  });
  it("reports missing key without calling provider", async () => {
    const f = ok({});
    const r = await testProvider("xai", undefined, f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_key");
    expect(f).not.toHaveBeenCalled();
  });
  it("sanitizes provider errors", async () => {
    const r = await generateText({ provider: "xai", prompt: "hi" }, "k", status(401));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("auth"); expect(r.error).not.toContain("secret"); }
    const rl = await testProvider("openai", "k", status(429));
    if (!rl.ok) expect(rl.code).toBe("rate_limit");
  });
  it("handles network failure", async () => {
    const f = vi.fn(async () => { throw new TypeError("boom"); }) as unknown as typeof fetch;
    const r = await testProvider("openai", "k", f);
    if (!r.ok) expect(r.code).toBe("network"); else throw new Error("expected failure");
  });
  it("validates input", () => {
    expect(generateInput.safeParse({ provider: "openai", prompt: "  " }).success).toBe(false);
    expect(generateInput.safeParse({ provider: "bad", prompt: "x" }).success).toBe(false);
    expect(generateInput.safeParse({ provider: "openai", model: "grok-3", prompt: "x" }).success).toBe(false);
    expect(generateInput.safeParse({ provider: "xai", model: "grok-3", prompt: "x" }).success).toBe(true);
  });
});
