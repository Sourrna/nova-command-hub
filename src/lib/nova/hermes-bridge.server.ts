import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { validateHermesRequest, type HermesStatus } from "./hermes-bridge";

const status: HermesStatus = {
  state: "service_unavailable",
  details: "Hermes serve not running on 127.0.0.1:9119 (verified by connection probe). Requires manual start with `hermes serve --port 9119 --host 127.0.0.1`. Web UI served but WebSocket JSON-RPC requires auth/session handshake not verified from public docs in this run; connection alone does not imply readiness.",
  authRequired: true,
};

export const getHermesStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: true, status };
});

export const probeHermes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const r = z.object({ method: z.string() }).safeParse(d);
    if (!r.success) throw new Error("Invalid input");
    const v = validateHermesRequest({ jsonrpc: "2.0", id: 1, method: r.data.method });
    if (!v.ok) throw new Error(v.error);
    return r.data;
  })
  .handler(async ({ data }) => {
    // Read-only allowlist enforced. No live request sent in this slice.
    // Real connection requires verified handshake/auth.
    return { ok: false, state: "protocol_unsupported", error: "WebSocket JSON-RPC endpoint requires verified auth/session handshake; no safe read-only probe executed. Start Hermes with `hermes serve --port 9119 --host 127.0.0.1` and verify protocol in docs before enabling." };
  });
