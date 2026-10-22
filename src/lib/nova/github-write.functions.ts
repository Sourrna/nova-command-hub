import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { APPROVAL_STORE_BLOCKED_MESSAGE, DURABLE_APPROVAL_STORE_CONFIGURED } from "./approval-config";
import { githubCaps } from "./github-capabilities";
import type { GitHubWriteResult } from "./github-write.server";

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
  | { ok: false; code: "approval_storage_unavailable" | "approval_flow_unavailable"; error: string }
  | GitHubWriteResult<{ id?: number; number?: number; html_url?: string; ref?: string }>;

export function githubWriteBlockReason(): GitHubWriteResponse {
  if (!DURABLE_APPROVAL_STORE_CONFIGURED) {
    return { ok: false, code: "approval_storage_unavailable", error: APPROVAL_STORE_BLOCKED_MESSAGE };
  }
  return {
    ok: false,
    code: "approval_flow_unavailable",
    error: "GitHub writes remain blocked until authenticated owner-bound approval grant, consume, and idempotency checks are wired.",
  };
}

/** Mutation endpoint intentionally remains fail-closed. The deployment has no
 * authenticated owner identity or durable approval lifecycle; adapter calls
 * cannot be safely authorized until those prerequisites are provisioned. */
export const githubWrite = createServerFn({ method: "POST" })
  .inputValidator((value: unknown) => {
    const result = githubWriteInputSchema.safeParse(value);
    if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Invalid GitHub write request");
    return buildGitHubWriteRequest(result.data);
  })
  .handler(async (): Promise<GitHubWriteResponse> => githubWriteBlockReason());
