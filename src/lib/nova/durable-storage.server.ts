import type { D1Database } from "./cloudflare-runtime.server";

export type DurableApprovalStatus =
  | "pending" | "approved" | "rejected" | "expired" | "revoked"
  | "executing" | "succeeded" | "failed";

export interface DurableApproval {
  id: string;
  ownerId: string;
  provider: string;
  operation: string;
  target: string;
  payloadJson: string;
  payloadHash: string;
  idempotencyKey: string;
  executionKey: string;
  action: string;
  status: DurableApprovalStatus;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  result?: string | null;
  errorCode?: string | null;
}

export interface WorkspaceRecord {
  revision: number;
  document: string;
  updatedAt: number;
}

export interface ApprovalRequestInput {
  id: string;
  ownerId: string;
  provider: string;
  operation: string;
  target: string;
  payloadJson: string;
  payloadHash: string;
  idempotencyKey: string;
  action: string;
  expiresAt: number;
  now: number;
}

export class StorageConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConflictError";
  }
}

export async function loadWorkspace(db: D1Database, ownerId: string): Promise<WorkspaceRecord | null> {
  const row = await db.prepare(
    "SELECT revision, document, updated_at AS updatedAt FROM workspaces WHERE owner_id = ?1",
  ).bind(ownerId).first<WorkspaceRecord>();
  return row;
}

export async function saveWorkspace(
  db: D1Database,
  ownerId: string,
  document: string,
  expectedRevision: number,
  now: number,
): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO workspaces(owner_id, revision, document, updated_at)
    SELECT ?1, 1, ?2, ?3
    WHERE ?4 = 0 OR EXISTS (SELECT 1 FROM workspaces WHERE owner_id = ?1)
    ON CONFLICT(owner_id) DO UPDATE SET
      document = excluded.document,
      revision = workspaces.revision + 1,
      updated_at = excluded.updated_at
    WHERE workspaces.revision = ?4
    RETURNING revision
  `).bind(ownerId, document, now, expectedRevision).first<{ revision: number }>();
  if (!row) throw new StorageConflictError("Workspace changed in another session. Reload before saving again.");
  return row.revision;
}

export async function createApprovalRequest(db: D1Database, input: ApprovalRequestInput): Promise<DurableApproval> {
  const inserted = await db.prepare(`
    INSERT INTO approval_requests(
      id, owner_id, provider, operation, target, payload_json, payload_hash, idempotency_key, execution_key,
      action, status, created_at, expires_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?12, ?11)
    ON CONFLICT(owner_id, idempotency_key) DO NOTHING
    RETURNING id, owner_id AS ownerId, provider, operation, target, payload_json AS payloadJson, payload_hash AS payloadHash,
      idempotency_key AS idempotencyKey, execution_key AS executionKey, action, status, created_at AS createdAt,
      expires_at AS expiresAt, updated_at AS updatedAt, result, error_code AS errorCode
  `).bind(
    input.id, input.ownerId, input.provider, input.operation, input.target,
    input.payloadJson, input.payloadHash, input.idempotencyKey, input.id, input.action, input.now, input.expiresAt,
  ).first<DurableApproval>();
  if (inserted) return inserted;

  const existing = await db.prepare(`
    SELECT id, owner_id AS ownerId, provider, operation, target, payload_json AS payloadJson, payload_hash AS payloadHash,
      idempotency_key AS idempotencyKey, execution_key AS executionKey, action, status, created_at AS createdAt,
      expires_at AS expiresAt, updated_at AS updatedAt, result, error_code AS errorCode
    FROM approval_requests WHERE owner_id = ?1 AND idempotency_key = ?2
  `).bind(input.ownerId, input.idempotencyKey).first<DurableApproval>();
  if (!existing) throw new Error("Approval request could not be persisted.");
  const exactRequest = existing.provider === input.provider &&
    existing.operation === input.operation &&
    existing.target === input.target &&
    existing.payloadJson === input.payloadJson &&
    existing.payloadHash === input.payloadHash &&
    existing.action === input.action;
  if (!exactRequest) throw new StorageConflictError("Idempotency key is already bound to another operation.");
  return existing;
}

export async function getApprovalById(
  db: D1Database,
  ownerId: string,
  approvalId: string,
): Promise<DurableApproval | null> {
  return db.prepare(`
    SELECT id, owner_id AS ownerId, provider, operation, target, payload_json AS payloadJson,
      payload_hash AS payloadHash, idempotency_key AS idempotencyKey, execution_key AS executionKey,
      action, status, created_at AS createdAt, expires_at AS expiresAt, updated_at AS updatedAt,
      result, error_code AS errorCode
    FROM approval_requests WHERE id = ?1 AND owner_id = ?2
  `).bind(approvalId, ownerId).first<DurableApproval>();
}

export async function listApprovalRequests(
  db: D1Database,
  ownerId: string,
  now: number,
  limit = 50,
): Promise<DurableApproval[]> {
  await db.prepare(`
    UPDATE approval_requests SET status = 'expired', updated_at = ?2
    WHERE owner_id = ?1 AND status IN ('pending', 'approved') AND expires_at <= ?2
  `).bind(ownerId, now).run();
  const result = await db.prepare(`
    SELECT id, owner_id AS ownerId, provider, operation, target, payload_json AS payloadJson,
      payload_hash AS payloadHash, idempotency_key AS idempotencyKey, execution_key AS executionKey,
      action, status, created_at AS createdAt, expires_at AS expiresAt, updated_at AS updatedAt,
      result, error_code AS errorCode
    FROM approval_requests WHERE owner_id = ?1
    ORDER BY created_at DESC LIMIT ?2
  `).bind(ownerId, limit).all<DurableApproval>();
  return result.results;
}

export async function transitionApproval(
  db: D1Database,
  ownerId: string,
  approvalId: string,
  from: "pending" | "approved",
  to: "approved" | "rejected" | "revoked",
  now: number,
): Promise<boolean> {
  await db.prepare(`
    UPDATE approval_requests SET status = 'expired', updated_at = ?4
    WHERE id = ?1 AND owner_id = ?2 AND status = ?3 AND expires_at <= ?4
  `).bind(approvalId, ownerId, from, now).run();
  const row = await db.prepare(`
    UPDATE approval_requests SET status = ?4, updated_at = ?5
    WHERE id = ?1 AND owner_id = ?2 AND status = ?3 AND expires_at > ?5
    RETURNING id
  `).bind(approvalId, ownerId, from, to, now).first<{ id: string }>();
  return !!row;
}

export async function consumeApproval(
  db: D1Database,
  input: {
    ownerId: string;
    approvalId: string;
    provider: string;
    operation: string;
    target: string;
    payloadHash: string;
    now: number;
  },
): Promise<DurableApproval | null> {
  await db.prepare(`
    UPDATE approval_requests SET status = 'expired', updated_at = ?3
    WHERE id = ?1 AND owner_id = ?2 AND status = 'approved' AND expires_at <= ?3
  `).bind(input.approvalId, input.ownerId, input.now).run();
  return db.prepare(`
    UPDATE approval_requests SET status = 'executing', updated_at = ?8
    WHERE id = ?1 AND owner_id = ?2 AND status = 'approved' AND expires_at > ?8
      AND provider = ?3 AND operation = ?4 AND target = ?5 AND payload_hash = ?6
      AND execution_key = ?7
    RETURNING id, owner_id AS ownerId, provider, operation, target, payload_json AS payloadJson,
      payload_hash AS payloadHash,
      idempotency_key AS idempotencyKey, execution_key AS executionKey, action, status, created_at AS createdAt,
      expires_at AS expiresAt, updated_at AS updatedAt, result, error_code AS errorCode
  `).bind(
    input.approvalId, input.ownerId, input.provider, input.operation,
    input.target, input.payloadHash, input.approvalId, input.now,
  ).first<DurableApproval>();
}

export async function finishApproval(
  db: D1Database,
  input: { ownerId: string; approvalId: string; status: "succeeded" | "failed"; result?: string; errorCode?: string; now: number },
): Promise<boolean> {
  const row = await db.prepare(`
    UPDATE approval_requests SET status = ?3, result = ?4, error_code = ?5, updated_at = ?6
    WHERE id = ?1 AND owner_id = ?2 AND status = 'executing'
    RETURNING id
  `).bind(input.approvalId, input.ownerId, input.status, input.result ?? null, input.errorCode ?? null, input.now)
    .first<{ id: string }>();
  return !!row;
}
