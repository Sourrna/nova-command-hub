import { describe, expect, it } from "vitest";
import { validateHermesRequest, isAllowedHermesMethod } from "@/lib/nova/hermes-bridge";

describe("Hermes bridge - allowlist and validation", () => {
  it("allows only read-only methods", () => {
    expect(isAllowedHermesMethod("system.status")).toBe(true);
    expect(isAllowedHermesMethod("chat.send")).toBe(false);
    expect(isAllowedHermesMethod("tool.execute")).toBe(false);
  });
  it("rejects malformed and disallowed requests", () => {
    expect(validateHermesRequest({}).ok).toBe(false);
    expect(validateHermesRequest({ jsonrpc: "1.0", id: 1, method: "system.status" }).ok).toBe(false);
    expect(validateHermesRequest({ jsonrpc: "2.0", id: 1, method: "chat.send" }).ok).toBe(false);
  });
});
