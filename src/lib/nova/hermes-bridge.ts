import { z } from "zod";

export type HermesStatusState =
  | "not_configured"
  | "service_unavailable"
  | "auth_required"
  | "auth_failed"
  | "protocol_unsupported"
  | "connected_readonly_verified"
  | "request_failed";

export interface HermesStatus {
  state: HermesStatusState;
  details: string;
  authRequired: boolean;
  verifiedMethod?: string;
}

export interface HermesProbeResult {
  ok: boolean;
  state: HermesStatusState;
  details: string;
  authRequired?: boolean;
}

const allowed = new Set(["system.status", "system.health", "system.capabilities"] as const);
type Allowed = typeof allowed extends Set<infer T> ? T : never;

export function isAllowedHermesMethod(m: string): m is Allowed {
  return allowed.has(m as Allowed);
}

const msg = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

export function validateHermesRequest(input: unknown): { ok: true; data: z.infer<typeof msg> } | { ok: false; error: string } {
  const r = msg.safeParse(input);
  if (!r.success) return { ok: false, error: "Invalid JSON-RPC request" };
  if (!isAllowedHermesMethod(r.data.method)) return { ok: false, error: "Method not in allowlist" };
  return { ok: true, data: r.data };
}
