import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDurableContext } from "./durable-context.server";
import { loadWorkspace as loadWorkspaceRecord, saveWorkspace as saveWorkspaceRecord, StorageConflictError } from "./durable-storage.server";

const taskSchema = z.object({
  id: z.string(), title: z.string(), status: z.enum(["todo", "doing", "done"]),
  priority: z.enum(["low", "med", "high"]), created: z.number(),
}).strict();
const contentSchema = z.object({
  id: z.string(), title: z.string(), channel: z.string(),
  stage: z.enum(["idea", "strategy", "draft", "review", "approved", "published", "measured"]),
  notes: z.string(), demo: z.boolean().optional(), updated: z.number(), linkedinAuthor: z.string().optional(),
}).strict();
const projectSchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(["active", "paused", "done"]),
  progress: z.number(), demo: z.boolean().optional(),
}).strict();
const memorySchema = z.object({ id: z.string(), text: z.string(), tag: z.string(), created: z.number() }).strict();
const logSchema = z.object({
  id: z.string(), at: z.number(), kind: z.enum(["info", "approval", "blocked", "local"]), message: z.string(),
}).strict();
const approvalSchema = z.object({
  id: z.string(), at: z.number(), action: z.string(), target: z.string(), connector: z.string(),
  state: z.enum(["pending", "approved", "rejected", "invalidated", "executed", "failed"]),
  ref: z.string().optional(), operation: z.enum(["write", "publish"]).optional(),
  payloadHash: z.string().optional(), expiresAt: z.number().optional(), pageId: z.string().optional(),
}).strict();
const stepSchema = z.object({
  stepId: z.string(), state: z.enum(["pending", "running", "done", "failed", "skipped"]),
  startedAt: z.number().optional(), completedAt: z.number().optional(), summary: z.string(),
  artifact: z.unknown().optional(), error: z.string().optional(),
}).strict();
const executionSchema = z.object({
  plan: z.object({
    goal: z.string(),
    steps: z.array(z.object({
      id: z.string(), kind: z.enum(["generate", "read", "write", "publish", "approve"]),
      title: z.string(), connector: z.string(), gated: z.boolean(), dependsOn: z.array(z.string()),
    }).strict()),
    createdAt: z.number(),
  }).strict(),
  steps: z.array(stepSchema),
  state: z.enum(["planning", "executing", "awaiting_approval", "complete", "failed"]),
  completedAt: z.number(),
}).strict();

export const WorkspaceDocumentSchema = z.object({
  lang: z.enum(["en", "fa"]),
  disabled: z.array(z.string()).max(100),
  tasks: z.array(taskSchema).max(10_000),
  content: z.array(contentSchema).max(10_000),
  projects: z.array(projectSchema).max(10_000),
  memory: z.array(memorySchema).max(10_000),
  log: z.array(logSchema).max(10_000),
  approvals: z.array(approvalSchema).max(10_000),
  executions: z.array(z.object({
    id: z.string(), goal: z.string(), savedAt: z.number(), result: executionSchema,
  }).strict()).max(30),
}).strict();

export type WorkspaceDocument = z.infer<typeof WorkspaceDocumentSchema>;

export const getDurableWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  const context = await getDurableContext();
  if (!context.ok) return context;
  const record = await loadWorkspaceRecord(context.db, context.user.id);
  if (!record) return { ok: true as const, exists: false as const, revision: 0 };
  return { ok: true as const, exists: true as const, revision: record.revision, documentJson: record.document };
});

export const saveDurableWorkspace = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({
    expectedRevision: z.number().int().nonnegative(),
    documentJson: z.string().max(2_000_000),
  }).parse(input))
  .handler(async ({ data }) => {
    const context = await getDurableContext();
    if (!context.ok) return context;
    let document: unknown;
    try {
      document = JSON.parse(data.documentJson);
    } catch {
      return { ok: false as const, code: "invalid_document" as const, error: "Workspace data is not valid JSON." };
    }
    const parsed = WorkspaceDocumentSchema.safeParse(document);
    if (!parsed.success) {
      return { ok: false as const, code: "invalid_document" as const, error: "Workspace data failed validation." };
    }
    const serialized = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(serialized).byteLength > 2_000_000) {
      return { ok: false as const, code: "document_too_large" as const, error: "Workspace exceeds the 2 MB storage limit." };
    }
    try {
      const revision = await saveWorkspaceRecord(
        context.db,
        context.user.id,
        serialized,
        data.expectedRevision,
        Date.now(),
      );
      return { ok: true as const, revision };
    } catch (error) {
      if (error instanceof StorageConflictError) {
        return { ok: false as const, code: "conflict" as const, error: error.message };
      }
      throw error;
    }
  });
