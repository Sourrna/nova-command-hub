CREATE TABLE IF NOT EXISTS workspaces (
  owner_id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  document TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  target TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  execution_key TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked', 'executing', 'succeeded', 'failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  result TEXT,
  error_code TEXT,
  UNIQUE (owner_id, idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS approval_requests_owner_status_created
  ON approval_requests(owner_id, status, created_at DESC);
