// Server-side approval grant ledger.
//
// The browser store (store.ts) is a *request* record, not an authorization.
// A pending or approved flag in localStorage does NOT permit a write. Only a
// grant recorded here, for a specific content item and payload, does.
//
// Lifecycle per grant:
//   grant   -> { status: "granted", consumed: false }   human approved, payload locked
//   execute -> { status: "granted", consumed: true }     first successful execution only
//   reject/expiry -> { status: "revoked" | "expired" }
//
// The grant locks a payload hash. execute() must present the identical payload
// or the hash check fails — editing the title/body after approval requires a
// new approval. Execution is single-use: a second call finds consumed and is
// rejected, so replayed approvals cannot create duplicate Notion pages.
//
// The current deployment has no shared KV, D1, or Durable Object binding.
// The in-memory ledger below is test/local-process support only; server
// functions must keep external writes disabled until a shared atomic store is
// configured and wired into this lifecycle.

export const DURABLE_APPROVAL_STORE_CONFIGURED = false;
export const APPROVAL_STORE_BLOCKED_MESSAGE =
  "External writes are disabled: configure and wire a shared durable approval store (D1 transaction or Durable Object) before enabling approvals.";

export const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type GrantStatus = "granted" | "consumed" | "revoked" | "expired";

export interface ApprovalGrant {
  approvalId: string;
  contentId: string;
  payload: string;
  payloadHash: string;
  idempotencyKey: string;
  grantedAt: number;
  consumedAt?: number | undefined;
  expiresAt: number;
  status: GrantStatus;
  /** Server-side binding of the external destination. For LinkedIn this is
   * the author URN (urn:li:organization:… / urn:li:person:…); for Notion it is
   * the database id or "root". A consume call must present the identical
   * destination or the grant is rejected — this stops a client from approving
   * one post and publishing to a different author. */
  destination?: string | undefined;
  /** Human-facing action string, e.g. "Publish to LinkedIn". Stored for audit
   * and bound at grant time so a consume cannot substitute a different action. */
  action?: string | undefined;
}

type LedgerEntry = ApprovalGrant;

const ledger = new Map<string, LedgerEntry>();

function sha256Sync(input: string): string {
  // Node/webcrypto Buntle subtle is async; we need a sync hash for the server
  // fn path. Use a deterministic non-cryptographic mix — it is only used for
  // equality comparison, not security. Collisions would require an attacker
  // to craft two distinct payloads with the same digest, which is infeasible
  // for real content.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "h" + (h >>> 0).toString(16).padStart(8, "0");
}

export function payloadHash(title: string, body: string): string {
  return sha256Sync(`${title}\u0000${body}`);
}

/**
 * Create a server-side grant. Called by the HUMAN's Approve click — never by
 * the write executor and never from a client-controlled flag. The grant locks:
 *   - the exact content item (contentId),
 *   - the exact payload (title + body hash),
 *   - the exact external destination (author URN for LinkedIn, database id or
 *     "root" for Notion),
 *   - the exact action string,
 *   - a server-derived idempotency key.
 * A consume call must present the identical contentId, payload, destination,
 * and action, or it is rejected. This stops a client from approving one post
 * and publishing to a different author, or from self-granting a write.
 */
export function grantApproval(
  approvalId: string,
  contentId: string,
  title: string,
  body: string,
  destination?: string,
  action?: string,
): ApprovalGrant {
  const existing = ledger.get(approvalId);
  if (existing) {
    if (existing.status === "consumed") throw new Error("This approval was already used to publish.");
    if (existing.status === "revoked") throw new Error("This approval was revoked; request a new one.");
    if (existing.status === "expired") throw new Error("This approval expired; request a new one.");
    if (
      existing.contentId !== contentId ||
      existing.payload !== JSON.stringify([title, body]) ||
      existing.destination !== destination ||
      existing.action !== action
    ) throw new Error("This approval id is already bound to a different payload or destination.");
    return existing;
  }
  const now = Date.now();
  const hash = payloadHash(title, body);
  const grant: LedgerEntry = {
    approvalId,
    contentId,
    payload: JSON.stringify([title, body]),
    payloadHash: hash,
    idempotencyKey: `${approvalId}:${hash}`,
    grantedAt: now,
    expiresAt: now + APPROVAL_TTL_MS,
    status: "granted",
    ...(destination !== undefined ? { destination } : {}),
    ...(action !== undefined ? { action } : {}),
  };
  ledger.set(approvalId, grant);
  return grant;
}

/** Atomically consume a grant. Returns the grant on success; throws on any
 * failure (missing, already consumed, revoked, expired, payload mismatch,
 * destination mismatch, action mismatch). */
export function consumeApproval(
  approvalId: string,
  contentId: string,
  title: string,
  body: string,
  destination?: string,
  action?: string,
): ApprovalGrant {
  const grant = ledger.get(approvalId);
  if (!grant) throw new Error("No valid approval for this content item; request approval first.");
  if (grant.contentId !== contentId) throw new Error("Approval does not belong to this content item.");
  if (grant.status !== "granted") throw new Error(grant.status === "consumed" ? "This approval was already used." : "This approval is no longer valid.");
  if (Date.now() >= grant.expiresAt) {
    grant.status = "expired";
    throw new Error("This approval expired; request a new one.");
  }
  const incoming = payloadHash(title, body);
  if (incoming !== grant.payloadHash || grant.payload !== JSON.stringify([title, body])) {
    throw new Error("Content changed after approval; request a new approval for the current content.");
  }
  if (grant.destination !== destination) {
    throw new Error("Publication destination changed after approval; request a new approval.");
  }
  if (grant.action !== action) {
    throw new Error("Publication action changed after approval; request a new approval.");
  }
  grant.consumedAt = Date.now();
  grant.status = "consumed";
  return grant;
}

export function revokeApproval(approvalId: string): void {
  const g = ledger.get(approvalId);
  if (g && g.status === "granted") g.status = "revoked";
}

export function approvalStatus(approvalId: string): GrantStatus | "unknown" {
  return ledger.get(approvalId)?.status ?? "unknown";
}