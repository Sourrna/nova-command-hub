import { describe, expect, it } from "vitest";
import { validateLocalInvoke, LOCAL_CAPS } from "@/lib/nova/local-agents";

describe("local agents - capability discovery", () => {
  it("records verified capabilities", () => {
    expect(LOCAL_CAPS.hermes.serve).toBe(true);
    expect(LOCAL_CAPS.kilo.run).toBe(true);
    expect(LOCAL_CAPS.kilo.serve).toBe(false);
  });
  it("validates bounded inputs", () => {
    expect(validateLocalInvoke({ agent: "hermes", prompt: "hi" }).ok).toBe(true);
    expect(validateLocalInvoke({ agent: "bad", prompt: "hi" }).ok).toBe(false);
    expect(validateLocalInvoke({ agent: "kilo", prompt: "" }).ok).toBe(false);
  });
});
