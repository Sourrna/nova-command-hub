import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOCAL_CAPS, validateLocalInvoke } from "./local-agents";

const input = z.object({
  agent: z.enum(["kilo", "hermes"]),
  prompt: z.string().trim().min(1).max(8000),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

export const getLocalAgentStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: true, caps: LOCAL_CAPS };
});

export const invokeLocalAgent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const v = validateLocalInvoke(d);
    if (!v.ok) throw new Error(v.error);
    return v.data;
  })
  .handler(async ({ data }) => {
    // Bounded allowlist. No arbitrary shell strings accepted.
    if (data.agent === "hermes") {
      if (!LOCAL_CAPS.hermes.serve) return { ok: false, error: "Hermes serve not available." };
      // Hermes has a JSON-RPC server; direct process spawn of interactive chat is not used here.
      // We report capability without executing unbounded commands.
      return { ok: false, error: "Hermes invocation requires a JSON-RPC client against localhost:9119; no generic CLI bridge implemented in this slice." };
    }
    if (data.agent === "kilo") {
      if (!LOCAL_CAPS.kilo.run) return { ok: false, error: "Kilo run not available." };
      return { ok: false, error: "Kilo direct invocation disabled in this slice: use ACP/attach only with explicit allowlist and approval." };
    }
    return { ok: false, error: "Unknown agent" };
  });
