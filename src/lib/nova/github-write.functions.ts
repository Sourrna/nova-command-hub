import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { APPROVAL_STORE_BLOCKED_MESSAGE, DURABLE_APPROVAL_STORE_CONFIGURED } from "./approval-config";
import { githubCaps } from "./github-capabilities";
import { githubWriteRequest, type GitHubWriteResult } from "./github-write.server";
import { getDurableContext } from "./durable-context.server";
import { approvalPayloadHash, APPROVAL_LIFETIME_MS } from "./durable-approval.functions";
import {
  createApprovalRequest,
  consumeApproval,
  finishApproval,
  getApprovalById,
  StorageConflictError,
} from "./durable-storage.server";

const owner = z.string().trim().min(1).max(39).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const repo = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).refine((value) => value !== "." && value !== "..");
const branch = z.string().trim().min(1).max(100).regex(/^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\s~^:?*\[]))[\w./-]+(?<!\/|\.lock)$/);

export const githubWriteInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("issues.create"),
    owner,
    repo,
    title: z.string().trim().min(1).max(256),
    body: z.string().trim().max(65536).optional(),
  }),
  z.object({
    op: z.literal("issues.update"),
    owner,
    repo,
    number: z.coerce.number().int().positive(),
    title: z.string().trim().min(1).max(256).optional(),
    body: z.string().trim().max(65536).nullable().optional(),
    state: z.enum(["open", "closed"]).optional(),
  }),
  z.object({
    op: z.literal("branches.create"),
    owner,
    repo,
    ref: branch,
    sha: z.string().trim().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
  }),
  z.object({
    op: z.literal("prs.create"),
    owner,
    repo,
    title: z.string().trim().min(1).max(256),
    head: branch,
    base: branch,
    body: z.string().trim().max(65536).optional(),
  }),
]).superRefine((value, context) => {
  if (value.op === "issues.update" && value.title === undefined && value.body === undefined && value.state === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one issue field is required" });
  }
});

export type GitHubWriteInput = z.infer<typeof githubWriteInputSchema>;
export interface GitHubWriteRequest {
  method: "POST" | "PATCH";
  path: string;
  payload: Record<string, unknown>;
}

export function buildGitHubWriteRequest(input: GitHubWriteInput): GitHubWriteRequest {
  const path = githubCaps[input.op].path(input);
  if (input.op === "issues.create" || input.op === "prs.create") {
    const { op: _op, owner: _owner, repo: _repo, ...payload } = input;
    return { method: "POST", path, payload };
  }
  if (input.op === "issues.update") {
    const { op: _op, owner: _owner, repo: _repo, number: _number, ...payload } = input;
    return { method: "PATCH", path, payload };
  }
  return { method: "POST", path, payload: { ref: `refs/heads/${input.ref}`, sha: input.sha } };
}

export type GitHubWriteResponse =
  | { ok: false; code: "approval_storage_unavailable" | "approval_flow_unavailable" | "authentication_required" | "database_unavailable" | "approval_invalid" | "execution_recording_failed"; error: string; providerConfirmed?: boolean }
  | GitHubWriteResult<{ id?: number; number?: number; html_url?: string; ref?: string }>;

export function githubWriteBlockReason(): GitHubWriteResponse {
  if (!DURABLE_APPROVAL_STORE_CONFIGURED) {
    return { ok: false, code: "approval_storage_unavailable", error: APPROVAL_STORE_BLOCKED_MESSAGE };
  }
  return {
    ok: false,
    code: "approval_flow_unavailable",
    error: "GitHub writes require a verified owner, D1 approval, and server-side credentials.",
  };
}

const githubApprovalInput = z.object({
  idempotencyKey: z.string().uuid(),
  mutation: githubWriteInputSchema,
}).strict();

export const requestGitHubApproval = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => {
    const result = githubApprovalInput.safeParse(value);
    if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid GitHub write request");
    return { ...result.data, request: buildGitHubWriteRequest(result.data.mutation) };
  })
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    const operation = data.mutation.op;
    const target = data.request.path;
    const payload = { method: data.request.method, path: data.request.path, payload: data.request.payload };
    const payloadJson = JSON.stringify({ mutation: data.mutation, request: payload });
    const payloadHash = await approvalPayloadHash({ provider: "github", operation, target, payload });
    const now = Date.now();
    try {
      const approval = await createApprovalRequest(context.db, {
        id: crypto.randomUUID(),
        ownerId: context.user.id,
        provider: "github",
        operation,
        target,
        payloadJson,
        payloadHash,
        idempotencyKey: data.idempotencyKey,
        action: `${operation} ${target}`,
        now,
        expiresAt: now + APPROVAL_LIFETIME_MS,
      });
      return {
        ok: true as const,
        approval: { id: approval.id, status: approval.status, expiresAt: approval.expiresAt },
      };
    } catch (error) {
      if (error instanceof StorageConflictError) {
        return { ok: false as const, code: "idempotency_conflict" as const, error: error.message };
      }
      throw error;
    }
  });

export const githubWrite = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => z.object({ approvalId: z.string().uuid() }).strict().parse(value))
  .handler(async ({ data }): Promise<GitHubWriteResponse> => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    if (!process.env["GITHUB_API_KEY"]) {
      return { ok: false, code: "missing", error: "GitHub write credentials are not configured." };
    }

    const approval = await getApprovalById(context.db, context.user.id, data.approvalId);
    if (!approval || approval.provider !== "github" || approval.status !== "approved") {
      return { ok: false, code: "approval_invalid", error: "No matching approved GitHub operation is available." };
    }
    let stored: { mutation?: unknown; request?: unknown };
    try {
      stored = JSON.parse(approval.payloadJson) as typeof stored;
    } catch {
      return { ok: false, code: "approval_invalid", error: "Stored approval payload is invalid." };
    }
    const parsedMutation = githubWriteInputSchema.safeParse(stored.mutation);
    if (!parsedMutation.success) {
      return { ok: false, code: "approval_invalid", error: "Stored GitHub operation failed validation." };
    }
    const request = buildGitHubWriteRequest(parsedMutation.data);
    const target = request.path;
    const payload = { method: request.method, path: request.path, payload: request.payload };
    const payloadHash = await approvalPayloadHash({
      provider: "github",
      operation: parsedMutation.data.op,
      target,
      payload,
    });
    if (
      approval.operation !== parsedMutation.data.op ||
      approval.target !== target ||
      approval.payloadHash !== payloadHash
    ) {
      return { ok: false, code: "approval_invalid", error: "Stored operation does not match the approved payload." };
    }

    const consumed = await consumeApproval(context.db, {
      ownerId: context.user.id,
      approvalId: approval.id,
      provider: "github",
      operation: approval.operation,
      target: approval.target,
      payloadHash,
      now: Date.now(),
    });
    if (!consumed) {
      return { ok: false, code: "approval_invalid", error: "Approval expired or has already been consumed." };
    }

    const result = await githubWriteRequest<{ id?: number; number?: number; html_url?: string; ref?: string }>(
      request.method,
      request.path,
      request.payload,
    );
    let finished = false;
    const resultSummary = result.ok ? {
      ...(typeof result.data.id === "number" ? { id: result.data.id } : {}),
      ...(typeof result.data.number === "number" ? { number: result.data.number } : {}),
      ...(typeof result.data.html_url === "string" ? { html_url: result.data.html_url } : {}),
      ...(typeof result.data.ref === "string" ? { ref: result.data.ref } : {}),
    } : undefined;
    try {
      const finishInput: Parameters<typeof finishApproval>[1] = {
        ownerId: context.user.id,
        approvalId: approval.id,
        status: result.ok ? "succeeded" : "failed",
        now: Date.now(),
        ...(result.ok
          ? { result: JSON.stringify(resultSummary) }
          : { errorCode: result.code }),
      };
      finished = await finishApproval(context.db, finishInput);
    } catch {
      finished = false;
    }
    if (!finished) {
      const providerFailureCode = result.ok ? undefined : result.code;
      return {
        ok: false,
        code: "execution_recording_failed",
        error: result.ok
          ? "GitHub confirmed the operation, but its final status could not be saved. Do not retry this approval."
          : `GitHub operation failed (${providerFailureCode}), and its final status could not be saved.`,
        ...(result.ok ? { providerConfirmed: true } : {}),
      };
    }
    return result;
  });
