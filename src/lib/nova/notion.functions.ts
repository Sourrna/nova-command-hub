// Server-only Notion write executor. Runs ONLY after an explicit approval is
// granted for that specific content item. The caller (activity.tsx) decides
// whether the connector is connected before invoking this.
//
// This is the single write path. It does three things before touching Notion:
//   1. Verify a server-side grant exists for approvalId and that it belongs
//      to contentId. Client state alone never authorizes a write.
//   2. Verify the payload hash matches the grant. If the title or body changed
//      after approval, execution is rejected and a new approval is required.
//   3. Atomically mark the grant consumed so a replayed submission cannot
//      create a duplicate Notion page.
//
// Only after all three pass does it call notionCreatePage, passing the
// grant's idempotency key so Notion itself dedupes any retry.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { notionCreatePage } from "./notion.server";
import { APPROVAL_STORE_BLOCKED_MESSAGE, DURABLE_APPROVAL_STORE_CONFIGURED } from "./approval-config";
import { consumeApproval, grantApproval, revokeApproval } from "./approval.server";
import { notionSearch, type NotionResult } from "./notion.server";

export interface NotionSearchRecord {
  id: string;
  object: string;
  url?: string;
  title?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function richText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((item) => {
      const record = asRecord(item);
      if (!record) return "";
      if (typeof record["plain_text"] === "string") return record["plain_text"];
      const textRecord = asRecord(record["text"]);
      return typeof textRecord?.["content"] === "string" ? textRecord["content"] : "";
    })
    .join("");
  return text || undefined;
}

export function normalizeNotionSearchRecord(value: unknown): NotionSearchRecord | null {
  const record = asRecord(value);
  if (!record || typeof record["id"] !== "string" || typeof record["object"] !== "string") return null;

  const directTitle = richText(record["title"]);
  const properties = asRecord(record["properties"]);
  const propertyTitle = properties
    ? Object.values(properties)
      .map(asRecord)
      .map((property) => property && (richText(property["title"]) ?? richText(property["rich_text"])))
      .find((title): title is string => Boolean(title))
    : undefined;
  const title = directTitle ?? propertyTitle;

  return {
    id: record["id"],
    object: record["object"],
    ...(typeof record["url"] === "string" ? { url: record["url"] } : {}),
    ...(title ? { title } : {}),
  };
}

export const searchNotion = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ query: z.string().trim().max(200).default("Nova") }).parse(d))
  .handler(async ({ data }): Promise<NotionResult<{ results: NotionSearchRecord[] }>> => {
    const result = await notionSearch(data.query);
    if (!result.ok) return result;
    return {
      ok: true,
      data: { results: result.data.results.map(normalizeNotionSearchRecord).filter((record): record is NotionSearchRecord => record !== null) },
    };
  });

export const NotionPageInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title too long"),
  body: z.string().max(8000, "Body too long"),
  databaseId: z.string().trim().max(100).optional(),
  approvalId: z.string().trim().min(1, "Approval id is required"),
  contentId: z.string().trim().min(1, "Content id is required"),
  /** MUST be false. A client-supplied true would let an untrusted caller
   * self-grant a write. Grants are created by the human's Approve click via
   * grantNotionApproval, which runs server-side. */
  grant: z.literal(false),
});

export type NotionPageInput = z.infer<typeof NotionPageInputSchema>;

/** Server fn: create a server-side grant for a Notion write. Called by the
 * HUMAN's Approve click — never by the write executor and never from a
 * client-controlled flag. The grant locks the content item, the exact payload,
 * the destination (database id or "root"), and the action string. */
export const grantNotionApproval = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const s = z.object({
      approvalId: z.string().trim().min(1, "Approval id is required"),
      contentId: z.string().trim().min(1, "Content id is required"),
      title: z.string().trim().min(1, "Title is required").max(200, "Title too long"),
      body: z.string().max(8000, "Body too long"),
      databaseId: z.string().trim().max(100).optional(),
    });
    const r = s.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    if (!DURABLE_APPROVAL_STORE_CONFIGURED) return { ok: false as const, code: "approval_storage_unavailable" as const, error: APPROVAL_STORE_BLOCKED_MESSAGE };
    grantApproval(
      data.approvalId,
      data.contentId,
      data.title,
      data.body,
      data.databaseId?.trim() || "root",
      `Publish "${data.title}" to Notion`,
    );
    return { ok: true as const };
  });

export const executeNotionWrite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const r = NotionPageInputSchema.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    if (!DURABLE_APPROVAL_STORE_CONFIGURED) return { ok: false as const, code: "approval_storage_unavailable" as const, error: APPROVAL_STORE_BLOCKED_MESSAGE };
    // The grant was created by the human's click (grantNotionApproval). We do
    // NOT create one here — a client flag is not authorization. Consume the
    // existing grant atomically: payload hash, ownership, destination, action,
    // and single-use are all enforced.
    const grant = consumeApproval(
      data.approvalId,
      data.contentId,
      data.title,
      data.body,
      data.databaseId?.trim() || "root",
      `Publish "${data.title}" to Notion`,
    );

    // Execute. The idempotency key is derived from the grant, never from
    // client input, so a replayed request cannot invent a new key.
    const result = await notionCreatePage({
      title: data.title,
      body: data.body,
      databaseId: data.databaseId,
      idempotencyKey: grant.idempotencyKey,
    });

    if (!result.ok) {
      // Execution failed. The grant is already consumed (single-use), so a
      // retry cannot replay this approval. Surface the failure without
      // leaking credentials.
      return { ok: false as const, code: result.code, error: result.error };
    }

    return { ok: true as const, pageId: result.data.id, idempotencyKey: grant.idempotencyKey };
  });

/** Server fn: revoke a grant when the human rejects or the content is edited
 * after approval. Idempotent and safe to call for unknown ids. */
export const revokeNotionApproval = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => {
    const s = z.object({ approvalId: z.string().trim().min(1) });
    const r = s.safeParse(d);
    if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Invalid input");
    return r.data;
  })
  .handler(async ({ data }) => {
    revokeApproval(data.approvalId);
    return { ok: true as const };
  });