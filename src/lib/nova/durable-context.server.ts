import { getRequest } from "@tanstack/react-start/server";
import { authenticateCloudflareAccess, type AuthenticatedUser } from "./cloudflare-access.server";
import { getRequestEnvironment, type D1Database, type NovaCloudflareEnv } from "./cloudflare-runtime.server";

export type DurableContextResult =
  | { ok: true; user: AuthenticatedUser; db: D1Database; env: NovaCloudflareEnv; request: Request }
  | { ok: false; code: "authentication_required" | "database_unavailable"; error: string };

export async function getDurableContext(): Promise<DurableContextResult> {
  const request = getRequest();
  const env = getRequestEnvironment(request);
  if (!env.NOVA_DB) {
    return { ok: false, code: "database_unavailable", error: "Durable workspace storage is not configured." };
  }
  try {
    const user = await authenticateCloudflareAccess(request, env);
    return { ok: true, user, db: env.NOVA_DB, env, request };
  } catch (error) {
    return {
      ok: false,
      code: "authentication_required",
      error: error instanceof Error ? error.message : "A verified user identity is required.",
    };
  }
}
