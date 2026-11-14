-- Varejao PostgreSQL migration foundation.
-- This file only defines the target schema. It does not connect to a database,
-- import data, create credentials, or change any hosted environment.

BEGIN;

CREATE TABLE IF NOT EXISTS varejao_schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transitional compatibility store. One row preserves the current JSON
-- document shape while writes are serialized with row-level transactions.
-- It is a bridge, not the final normalized data model.
CREATE TABLE IF NOT EXISTS varejao_app_state (
  singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE IF NOT EXISTS varejao_migration_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  imported_revision BIGINT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result TEXT NOT NULL CHECK (result IN ('validated', 'imported', 'rolled_back')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS varejao_migration_audit_source_idx
  ON varejao_migration_audit (source_sha256);

COMMIT;

-- Safe import pattern (implement in a dedicated, reviewed migration runner):
-- 1. Parse and validate the complete JSON source before opening a transaction.
-- 2. BEGIN; acquire pg_advisory_xact_lock(<stable application lock key>).
-- 3. INSERT the singleton row only if absent; never overwrite a non-empty row
--    without an explicit, reviewed cutover decision.
-- 4. Verify row count, collection counts, canonical JSON digest and user
--    identity/hash invariants inside the transaction.
-- 5. Record the source SHA-256 and imported revision in the audit table.
-- 6. COMMIT only when every invariant passes; otherwise ROLLBACK.
-- 7. Keep the source file and a tested backup immutable until rollback window ends.
