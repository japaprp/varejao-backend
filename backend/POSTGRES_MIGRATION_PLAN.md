# Persistent account audit and transactional database migration

## Scope and safety boundary

This preparation is based on the Git-tracked branch source only. It does not inspect the live Render/Supabase/other host filesystem or database, does not read production credentials, and does not change production data. No provider has been selected or verified for this repository in this task. Do not treat the tracked JSON fixture as a production export.

## Findings from the current branch

- Runtime persistence is implemented by `backend/src/data/repository.js`.
- `readDb()` synchronously parses the whole `backend/src/data/database.json` document.
- `writeDb()` overwrites the whole document directly with `writeFileSync`; there is no transaction, inter-process lock, compare-and-swap revision, atomic temp-file replacement, or durable write queue.
- Authentication, catalog, and cart/order services call this shared whole-document interface. This couples unrelated domain writes and creates lost-update/corruption risk under concurrent requests or multiple instances.
- The tracked JSON file has top-level collections: produtos, informacoes, fidelidade, usuarios, clientesFidelidade, cupons, entradasEstoque, perdasEstoque, pedidos, saidas, carrinhos, operacaoConfig.
- The tracked JSON snapshot contains 7 user records: 1 customer, 1 administrator, and 5 operational-role accounts matching the legacy demo-account email set. All 7 have a stored password hash; the five matching demo records use bcrypt-formatted hashes. This confirms the accounts exist in the repository snapshot only. It does not establish that their passwords are known, that they are active in production, or that the live host uses this file.
- The tracked snapshot has no orders, stock entries, stock losses, or loyalty-customer records; this is a fixture observation, not a production-data statement.
- Do not print user identifiers, names, emails, CPF, phone numbers, password hashes, tokens, or full records in audit logs.

## Render workspace infrastructure audit (read-only, 2026-11-14)

The connected Render workspace was inspected without changing resources:

- Active backend service `varejao-backend-1` (`srv-d6gvbhjuibrs739lqbug`) points to this repository, branch `main`, root directory `backend`, Node runtime, free plan, one instance, and automatic deploy on commit. Its latest listed live deployment is commit `91248f7fa864cd3ff378ec366e1ccd96401346ab` ("Seed operational catalog codes and demo roles"), deployed 2026-04-14.
- A second backend service `varejao-backend` (`srv-d6gdahh4tr6s73dbc3l0`) points to the same repository but is suspended and configured with Go runtime despite the Node backend. Do not reactivate it.
- A separate static site `varejao-backend01` also points to this repository; it is not a database.
- No Render PostgreSQL instance for Varejao was found in the workspace inventory. The only listed PostgreSQL resource is `eventosrp-db`, belonging to a different project, suspended/expired; it must not be used for Varejao.
- The active backend service details did not expose a persistent disk mount. Because the app currently writes `src/data/database.json` locally and there is no Varejao PostgreSQL resource, persistence durability and actual live data location must be verified before any restart, redeploy, or migration. Do not assume the tracked JSON fixture is the live data.
- The service is connected to `main` with automatic deployment enabled. PR branch changes are not deployed by this service unless merged to main; no merge or deploy was performed during this audit.

Evidence scope: service metadata, workspace resource inventory, and deployment metadata only. No environment variable values, logs, database contents, or user records were read.

## Additional operational payment integrity audit (2026-11-14)

A static review found that `settleOperationalOrder()` previously marked an operational order as paid and deducted stock without requiring a non-empty payment list or reconciling the payment total against the order total. It also accepted arbitrary payment method strings and did not bound the requested discount to the subtotal. This could create a paid order with zero/underpayment and a stock deduction.

A second integrity issue was found in operational order creation: the service accepted a client-supplied unit price instead of using the trusted catalog price. The branch now ignores client price overrides, uses the catalog price, and rejects malformed items, unknown products, non-positive quantities, and invalid catalog prices.

The PR branch now:
- requires at least one payment entry;
- validates each method against the supported operational payment methods;
- rejects non-finite/non-positive payment amounts;
- validates discounts as finite and between zero and subtotal;
- requires the rounded payment sum to match the amount due within R$0.01;
- validates cash received amount and change;
- normalizes and persists validated payment entries;
- performs stock availability checks and deduction only after payment validation succeeds.

Regression smoke coverage now exercises empty payments, excessive discount, underpayment, unknown method, non-numeric amount, insufficient cash received, and inconsistent change. It verifies failed settlements leave both order status and stock unchanged before a valid PIX settlement.

## Rate-limiter client-IP trust — BLOCKED pending proxy topology confirmation

Static review also found that `rateLimitMiddleware.js` currently keys buckets from the leftmost `X-Forwarded-For` value. That value is client-controllable unless a trusted reverse proxy sanitizes/appends the chain and the Express trust-proxy configuration matches the actual topology. The app currently does not configure `trust proxy`. Using a spoofable address can let callers rotate identities and bypass per-IP limits; simply enabling `trust proxy` with an assumed hop count can also trust spoofed values or produce a shared-proxy limit.

No speculative proxy trust setting was added. Before changing this control, verify the Render ingress chain and whether direct-to-origin access is possible; then configure an explicit trusted proxy policy and use Express `req.ip`/a bounded distributed limiter. The current in-memory limiter is also per-process and not distributed, so it is not a production-grade control across multiple instances. Treat this as a release blocker until verified and corrected.

## Production account audit — BLOCKED pending authorized access

Before any migration/cutover, an authorized operator must take a provider-side, read-only snapshot and produce a privacy-preserving report with:
1. Total accounts by role and enabled/disabled status.
2. Duplicate normalized emails and duplicate external identity pairs.
3. Missing, legacy, malformed, and bcrypt password-hash counts (never export hash values).
4. Presence of the five known legacy demo-account identities (report counts/roles only).
5. Whether any account has an unexpected privileged role or invalid role value.
6. Whether the configured administrator exists and has a valid hash.
7. Session/token invalidation plan if TOKEN_SECRET is rotated.
8. Backup timestamp, checksum, retention, and a verified restore test.

Do not delete or disable any account automatically. Confirm ownership and business purpose with the system owner before remediation. If a known demo identity exists in production, suspend login through an approved, reversible procedure, rotate credentials, and preserve audit evidence; do not infer its password from a hash.

## Target recommendation: PostgreSQL

PostgreSQL is recommended for transactional persistence because order, payment, inventory, coupon, loyalty, and cash-closing operations need atomic multi-record changes, constraints, indexes, and concurrent transaction isolation. This repository currently has no `pg` driver, connection pool, schema migration framework, or verified database URL. Therefore no runtime switch is safe yet.

### Migration phases

1. **Inventory and freeze schema:** document every read/write path and all top-level JSON collections; define required fields, IDs, relationships, money precision, time zones, and lifecycle states.
2. **Provider and ownership decision:** confirm the PostgreSQL provider, region, backup/PITR capability, network access, SSL requirements, and who owns the credentials. Do not paste secrets into GitHub or chat.
3. **Backup baseline:** create an encrypted provider-side backup and an immutable JSON snapshot; record SHA-256, byte size, row/collection counts, timestamp, and retention. Perform a restore drill before importing.
4. **Compatibility import rehearsal:** validate source JSON, normalize and stage data, detect duplicates/orphans, and compare deterministic counts/digests. The included SQL creates a transitional JSONB singleton store only; it is not a production migration runner.
5. **Transactional compatibility adapter:** if using the interim singleton store, all mutations must lock the row with `SELECT ... FOR UPDATE` inside a transaction and increment revision. This preserves current document semantics but serializes all writes and is only a short-lived bridge.
6. **Normalize by domain:** move users, products, carts, orders, order items, payments, inventory movements, coupons, loyalty, expenses, and operational configuration into relational tables with foreign keys, unique constraints, indexes, and explicit money/timestamp types. Use repository methods and transaction boundaries, not whole-database read/overwrite.
7. **Dual-run validation (read-only shadow):** compare results from JSON and PostgreSQL without double-writing payments or inventory. Check counts, canonical record digests, representative business workflows, and query behavior.
8. **Controlled cutover:** freeze writes, take final backup, import delta, verify invariants, switch one environment, run smoke and reconciliation, and keep rollback path available. Never run two writable authorities.
9. **Rollback:** restore the pre-cutover backup or switch back only while JSON is guaranteed current and no divergent writes have occurred. Document reconciliation for any post-cutover transactions.
10. **Retire JSON only after:** stable observation window, successful restore, reconciled financial/stock ledgers, and explicit owner approval.

## Required invariants

- User email uniqueness after normalization; OAuth provider + subject uniqueness.
- Password hashes remain bcrypt/compatible; no plaintext passwords or hash exports.
- Orders and order items preserve totals, discounts, freight, currency, status, and timestamps.
- Payment events are idempotent by provider event/payment ID; paid orders cannot be downgraded by stale events.
- Inventory movements are append-only/auditable and stock changes are transactional.
- Coupon usage, loyalty accrual, order finalization, and cash settlement commit or roll back together where business rules require.
- Use integer minor units or PostgreSQL NUMERIC for money; never floating-point arithmetic for financial totals.
- All production migrations are versioned, repeatable where safe, observable, and have tested rollback/recovery steps.

## Files added in this preparation

- `backend/scripts/audit_json_accounts.js`: local read-only audit of the tracked JSON file; emits aggregate counts only and never prints PII or hashes.
- `backend/migrations/0001_postgres_foundation.sql`: non-destructive schema foundation for a transitional JSONB state store and migration audit ledger.
- This document.

## Current status

- Static repository persistence audit: PASS.
- Tracked JSON snapshot account summary: PASS (7 records; 5 legacy demo identity matches).
- Live production account audit: BLOCKED (no authorized host/database read access in this task).
- PostgreSQL provider/connection configuration: NOT RUN (not selected/verified).
- Import rehearsal and checksum reconciliation: NOT RUN.
- Runtime adapter replacement: NOT RUN.
- Production migration/cutover: NOT AUTHORIZED; not performed.
