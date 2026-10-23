import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@/lib/nova/cloudflare-runtime.server";
import {
  createApprovalRequest,
  finishApproval,
  getApprovalById,
  listApprovalRequests,
  loadWorkspace,
  saveWorkspace,
  StorageConflictError,
  transitionApproval,
  consumeApproval,
} from "@/lib/nova/durable-storage.server";
import { approvalPayloadHash } from "@/lib/nova/durable-approval.functions";

interface Row {
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
  status: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  result?: string | null;
  errorCode?: string | null;
}

class MemoryD1 implements D1Database {
  workspaces = new Map<string, { revision: number; document: string; updatedAt: number }>();
  approvals = new Map<string, Row>();

  prepare(query: string): D1PreparedStatement {
    let values: unknown[] = [];
    const db = this;
    return {
      bind(...bound: unknown[]) {
        values = bound;
        return this;
      },
      async first<T>() {
        return db.first<T>(query, values);
      },
      async all<T>() {
        return db.all<T>(query, values);
      },
      async run<T>() {
        return db.run<T>(query, values);
      },
    };
  }

  private async first<T>(query: string, values: unknown[]): Promise<T | null> {
    if (query.includes("INSERT INTO workspaces")) {
      const [owner, document, updatedAt, expected] = values as [string, string, number, number];
      const current = this.workspaces.get(owner);
      if ((!current && expected !== 0) || (current && current.revision !== expected)) return null;
      const revision = (current?.revision ?? 0) + 1;
      const row = { revision, document, updatedAt };
      this.workspaces.set(owner, row);
      return { revision } as T;
    }
    if (query.includes("INSERT INTO approval_requests")) {
      const [id, ownerId, provider, operation, target, payloadJson, payloadHash, idempotencyKey,
        executionKey, action, now, expiresAt] = values as [string, string, string, string, string, string, string, string, string, string, number, number];
      const duplicate = [...this.approvals.values()].find((row) => row.ownerId === ownerId && row.idempotencyKey === idempotencyKey);
      if (duplicate) return null;
      const row: Row = {
        id, ownerId, provider, operation, target, payloadJson, payloadHash, idempotencyKey,
        executionKey, action, status: "pending", createdAt: now, expiresAt, updatedAt: now,
      };
      this.approvals.set(id, row);
      return row as T;
    }
    if (query.includes("WHERE owner_id = ?1 AND idempotency_key = ?2")) {
      const [ownerId, key] = values as [string, string];
      return ([...this.approvals.values()].find((row) => row.ownerId === ownerId && row.idempotencyKey === key) ?? null) as T | null;
    }
    if (query.includes("FROM approval_requests WHERE id = ?1 AND owner_id = ?2")) {
      const [id, ownerId] = values as [string, string];
      const row = this.approvals.get(id);
      return (row?.ownerId === ownerId ? row : null) as T | null;
    }
    if (query.includes("UPDATE approval_requests SET status = ?4")) {
      const [id, ownerId, from, to, now] = values as [string, string, string, string, number];
      const row = this.approvals.get(id);
      if (!row || row.ownerId !== ownerId || row.status !== from || row.expiresAt <= now) return null;
      row.status = to;
      row.updatedAt = now;
      return { id } as T;
    }
    if (query.includes("SET status = 'executing'")) {
      const [id, ownerId, provider, operation, target, hash, executionKey, now] =
        values as [string, string, string, string, string, string, string, number];
      const row = this.approvals.get(id);
      if (
        !row || row.ownerId !== ownerId || row.status !== "approved" || row.expiresAt <= now ||
        row.provider !== provider || row.operation !== operation || row.target !== target ||
        row.payloadHash !== hash || row.executionKey !== executionKey
      ) return null;
      row.status = "executing";
      row.updatedAt = now;
      return row as T;
    }
    if (query.includes("SET status = ?3, result = ?4")) {
      const [id, ownerId, status, result, errorCode, now] = values as [string, string, string, string | null, string | null, number];
      const row = this.approvals.get(id);
      if (!row || row.ownerId !== ownerId || row.status !== "executing") return null;
      Object.assign(row, { status, result, errorCode, updatedAt: now });
      return { id } as T;
    }
    if (query.includes("SELECT revision, document")) {
      const [ownerId] = values as [string];
      return (this.workspaces.get(ownerId) ?? null) as T | null;
    }
    return null;
  }

  private async all<T>(query: string, values: unknown[]): Promise<{ results: T[] }> {
    if (!query.includes("FROM approval_requests WHERE owner_id = ?1")) return { results: [] };
    const [ownerId, limit] = values as [string, number];
    const rows = [...this.approvals.values()]
      .filter((row) => row.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return { results: rows as T[] };
  }

  private async run<T>(query: string, values: unknown[]): Promise<{ success: boolean; results?: T[]; meta?: { changes?: number } }> {
    if (query.includes("SET status = 'expired'")) {
      if (query.includes("status IN ('pending', 'approved')")) {
        const ownerId = String(values[0]);
        const now = Number(values[1]);
        for (const approval of this.approvals.values()) {
          if (approval.ownerId === ownerId && ["pending", "approved"].includes(approval.status) && approval.expiresAt <= now) {
            approval.status = "expired";
            approval.updatedAt = now;
          }
        }
      } else {
        const row = this.approvals.get(String(values[0]));
        const approvalOwner = String(values[1]);
        const from = values.length === 4 ? String(values[2]) : "approved";
        const now = Number(values[values.length - 1]);
        if (row?.ownerId === approvalOwner && row.status === from && row.expiresAt <= now) {
          row.status = "expired";
          row.updatedAt = now;
        }
      }
    }
    return { success: true };
  }
}

async function createPending(db: MemoryD1, overrides: Partial<Parameters<typeof createApprovalRequest>[1]> = {}) {
  const payload = { title: "approved title", body: "approved body" };
  const request = {
    id: "approval-1",
    ownerId: "user-1",
    provider: "github",
    operation: "issues.create",
    target: "repos/octo/project/issues",
    payloadJson: JSON.stringify(payload),
    payloadHash: await approvalPayloadHash({
      provider: "github", operation: "issues.create", target: "repos/octo/project/issues", payload,
    }),
    idempotencyKey: "idempotency-1",
    action: "Create issue",
    now: 100,
    expiresAt: 500,
    ...overrides,
  };
  return { row: await createApprovalRequest(db, request), request, payload };
}

describe("durable D1 workspace and approvals", () => {
  it("isolates workspace reads by owner and rejects stale revisions", async () => {
    const db = new MemoryD1();
    expect(await saveWorkspace(db, "owner-a", '{"tasks":[]}', 0, 10)).toBe(1);
    expect(await loadWorkspace(db, "owner-b")).toBeNull();
    expect(await loadWorkspace(db, "owner-a")).toMatchObject({ revision: 1, document: '{"tasks":[]}' });
    await expect(saveWorkspace(db, "owner-a", '{"tasks":[1]}', 0, 11)).rejects.toBeInstanceOf(StorageConflictError);
    expect(await saveWorkspace(db, "owner-a", '{"tasks":[1]}', 1, 12)).toBe(2);
  });

  it("binds owner-scoped idempotency keys to the exact operation and payload", async () => {
    const db = new MemoryD1();
    const { row, request } = await createPending(db);
    const repeated = await createApprovalRequest(db, { ...request, id: "unused" });
    expect(repeated.id).toBe(row.id);
    await expect(createApprovalRequest(db, {
      ...request, id: "new", payloadHash: "tampered",
    })).rejects.toBeInstanceOf(StorageConflictError);
    const otherOwner = await createApprovalRequest(db, { ...request, id: "approval-2", ownerId: "user-2" });
    expect(otherOwner.id).toBe("approval-2");
  });

  it("prevents cross-owner reads, payload tampering, and expired approval consumption", async () => {
    const db = new MemoryD1();
    const { row, request } = await createPending(db);
    expect(await getApprovalById(db, "user-2", row.id)).toBeNull();
    expect(await transitionApproval(db, "user-1", row.id, "pending", "approved", 200)).toBe(true);
    expect(await consumeApproval(db, {
      ownerId: "user-1", approvalId: row.id, provider: request.provider, operation: request.operation,
      target: request.target, payloadHash: "different-payload", now: 300,
    })).toBeNull();
    const consumed = await consumeApproval(db, {
      ownerId: "user-1", approvalId: row.id, provider: request.provider, operation: request.operation,
      target: request.target, payloadHash: request.payloadHash, now: 500,
    });
    expect(consumed).toBeNull();
    expect(db.approvals.get(row.id)?.status).toBe("expired");
  });

  it("atomically permits one execution, rejects replay, and records provider failure", async () => {
    const db = new MemoryD1();
    const { row, request } = await createPending(db);
    expect(await transitionApproval(db, "user-1", row.id, "pending", "approved", 200)).toBe(true);
    const input = {
      ownerId: "user-1", approvalId: row.id, provider: request.provider,
      operation: request.operation, target: request.target, payloadHash: request.payloadHash, now: 300,
    };
    const results = await Promise.all([consumeApproval(db, input), consumeApproval(db, input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await consumeApproval(db, input)).toBeNull();
    expect(await finishApproval(db, {
      ownerId: "user-1", approvalId: row.id, status: "failed", errorCode: "permission", now: 400,
    })).toBe(true);
    expect(db.approvals.get(row.id)).toMatchObject({ status: "failed", errorCode: "permission" });
  });

  it("expires pending requests and revokes an approved request before consumption", async () => {
    const db = new MemoryD1();
    const { row, request } = await createPending(db);
    expect(await transitionApproval(db, "user-1", row.id, "pending", "approved", 500)).toBe(false);
    expect(db.approvals.get(row.id)?.status).toBe("expired");
    const active = await createPending(db, { id: "approval-2", idempotencyKey: "idempotency-2" });
    expect(await transitionApproval(db, "user-1", active.row.id, "pending", "approved", 200)).toBe(true);
    expect(await transitionApproval(db, "user-1", active.row.id, "approved", "revoked", 250)).toBe(true);
    expect(await consumeApproval(db, {
      ownerId: "user-1", approvalId: active.row.id, provider: request.provider,
      operation: request.operation, target: request.target, payloadHash: request.payloadHash, now: 300,
    })).toBeNull();
    expect(db.approvals.get(active.row.id)?.status).toBe("revoked");
  });

  it("lists only the authenticated owner's approvals and materializes expired statuses", async () => {
    const db = new MemoryD1();
    const { row } = await createPending(db);
    await createPending(db, { id: "approval-2", ownerId: "user-2", idempotencyKey: "idempotency-2" });
    const list = await listApprovalRequests(db, "user-1", 500);
    expect(list.map((approval) => approval.id)).toEqual([row.id]);
    expect(list[0]?.status).toBe("expired");
  });

  it("hashes semantically identical object payloads consistently", async () => {
    const first = await approvalPayloadHash({ provider: "github", operation: "issue", target: "repo", payload: { a: 1, b: { x: 2, y: 3 } } });
    const second = await approvalPayloadHash({ target: "repo", payload: { b: { y: 3, x: 2 }, a: 1 }, operation: "issue", provider: "github" });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
});
