import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDurableContext } from "./durable-context.server";
import {
  createApprovalRequest as persistApprovalRequest,
  listApprovalRequests,
  transitionApproval,
  type DurableApprovalStatus,
} from "./durable-storage.server";

export const APPROVAL_LIFETIME_MS = 5 * 60 * 1000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export async function approvalPayloadHash(input: {
  provider: string;
  operation: string;
  target: string;
  payload: unknown;
}): Promise<string> {
  const canonical = JSON.stringify(canonicalize(input));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const approvalRequestInput = z.object({
  provider: z.enum(["github", "notion", "linkedin"]),
  operation: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(300),
  action: z.string().trim().min(1).max(300),
  idempotencyKey: z.string().uuid(),
  payload: z.unknown(),
});

export const requestDurableApproval = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => approvalRequestInput.parse(value))
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    const payload = data.payload ?? null;
    const payloadJson = JSON.stringify(canonicalize(payload));
    if (new TextEncoder().encode(payloadJson).byteLength > 256_000) {
      return { ok: false as const, code: "payload_too_large" as const, error: "Approval payload exceeds the 256 KB limit." };
    }
    const hash = await approvalPayloadHash({ ...data, payload });
    const now = Date.now();
    const approval = await persistApprovalRequest(context.db, {
      id: crypto.randomUUID(),
      ownerId: context.user.id,
      provider: data.provider,
      operation: data.operation,
      target: data.target,
      payloadJson,
      payloadHash: hash,
      idempotencyKey: data.idempotencyKey,
      action: data.action,
      now,
      expiresAt: now + APPROVAL_LIFETIME_MS,
    });
    return {
      ok: true as const,
      approval: {
        id: approval.id,
        status: approval.status,
        expiresAt: approval.expiresAt,
        payloadHash: approval.payloadHash,
      },
    };
  });

const approvalIdInput = z.object({ approvalId: z.string().uuid() });

export interface DurableApprovalView {
  id: string;
  provider: string;
  operation: string;
  target: string;
  action: string;
  status: DurableApprovalStatus;
  createdAt: number;
  expiresAt: number;
  errorCode?: string | null;
  result?: { id?: number; number?: number; url?: string; ref?: string } | null | undefined;
}

function parseApprovalResult(value: string | null | undefined): DurableApprovalView["result"] {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as Record<string, unknown>;
    return {
      ...(typeof result["id"] === "number" ? { id: result["id"] } : {}),
      ...(typeof result["number"] === "number" ? { number: result["number"] } : {}),
      ...(typeof result["html_url"] === "string" && result["html_url"].startsWith("https://github.com/")
        ? { url: result["html_url"] } : {}),
      ...(typeof result["ref"] === "string" ? { ref: result["ref"] } : {}),
    };
  } catch {
    return null;
  }
}

export const listDurableApprovals = createServerFn({ method: "GET" }).handler(async () => {
  const context = await getDurableContext();
  if (!context.ok) return context;
  const approvals = await listApprovalRequests(context.db, context.user.id, Date.now());
  return {
    ok: true as const,
    approvals: approvals.map((approval): DurableApprovalView => ({
      id: approval.id,
      provider: approval.provider,
      operation: approval.operation,
      target: approval.target,
      action: approval.action,
      status: approval.status,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      ...(approval.errorCode !== undefined ? { errorCode: approval.errorCode } : {}),
      ...(approval.result !== undefined ? { result: parseApprovalResult(approval.result) } : {}),
    })),
  };
});

export const approveDurableApproval = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => approvalIdInput.parse(value))
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    const approved = await transitionApproval(
      context.db, context.user.id, data.approvalId, "pending", "approved", Date.now(),
    );
    return approved
      ? { ok: true as const, status: "approved" as const }
      : { ok: false as const, code: "not_pending" as const, error: "Approval is missing, expired, or no longer pending." };
  });

export const rejectDurableApproval = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => approvalIdInput.parse(value))
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    const rejected = await transitionApproval(
      context.db, context.user.id, data.approvalId, "pending", "rejected", Date.now(),
    );
    return rejected
      ? { ok: true as const, status: "rejected" as const }
      : { ok: false as const, code: "not_pending" as const, error: "Approval is missing, expired, or no longer pending." };
  });

export const revokeDurableApproval = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => approvalIdInput.parse(value))
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    const revoked = await transitionApproval(
      context.db, context.user.id, data.approvalId, "approved", "revoked", Date.now(),
    );
    return revoked
      ? { ok: true as const, status: "revoked" as const }
      : { ok: false as const, code: "not_revocable" as const, error: "Approval is missing, expired, executing, or already resolved." };
  });
