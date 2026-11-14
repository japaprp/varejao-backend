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

The Render service is a public Render Web Service. Render's current security guidance explicitly says inbound traffic passes through Cloudflare and Render load balancers, the socket address is a proxy address, and applications should read `X-Forwarded-For` for the client IP. It recommends application-level rate limiting and a distributed store such as Render Key Value when running multiple instances. Therefore, the previous claim that simply using the first `X-Forwarded-For` value proves a spoofing vulnerability was too strong and is withdrawn. We did not enable Express `trust proxy` or assume a hop count.

The PR branch now validates the first `X-Forwarded-For` value as an IP address and falls back to a validated socket address if the header is malformed. The in-memory bucket map is capped at 10,000 identities per limiter, expired buckets are pruned, and new identities fail closed with HTTP 503 when capacity remains full. Regression tests cover forwarded IP parsing, malformed headers, rate-limit enforcement, bounded capacity, and expiry.

Remaining limitation: counters are still process-local and reset on restart/free-instance spin-down. The active service currently has one instance, but this is not durable or distributed protection. Before production approval, move counters to a dedicated Varejão-owned shared store or a transactional database-backed limiter and test concurrency/expiry. Do not reuse the Redis resource belonging to Guerra Infinita.

## Live Render persistence risk — confirmed by configuration and code (2026-11-14)

The active Render service `varejao-backend-1` is on the Free plan, has one instance, and deploys from `main`. Render's current Free-plan documentation states that Free web services have an ephemeral filesystem, do not support persistent disks or SSH/shell access, and lose local file changes when the instance spins down, restarts, or redeploys. Free instances can spin down after 15 minutes without inbound traffic.

The deployed commit is `91248f7fa864cd3ff378ec366e1ccd96401346ab`. In that commit, `backend/src/data/repository.js` resolves `database.json` relative to the source file and uses synchronous `readFileSync` / `writeFileSync`. Therefore the live application writes its mutable JSON database inside the service filesystem, not to a managed datastore. The workspace contains no Varejão Postgres or Varejão-owned Key Value resource. The only listed Postgres belongs to another project and is suspended/expired; the only Key Value resource belongs to Guerra Infinita and must not be reused.

This is a **critical persistence/data-loss risk**. The repository's deployed `database.json` snapshot contains 7 user records and 12 top-level collections, but this is only the committed seed snapshot; it is not a live runtime export and does not reveal current live account/order state. Render app logs only showed process startup; no database contents were read. Because the service is Free and has no persistent disk, the current mutable runtime file cannot be considered durable. Do not restart, redeploy, change the plan, alter auto-deploy, or run cleanup until the current live data has been captured through an authorized safe export or the system owner confirms the data is disposable/reconstructable.

The active service exposes no SSH/shell path on the Free plan, and no approved application-level export endpoint was found in this audit. A provider-side snapshot is therefore **BLOCKED**. Safe next step: arrange a temporary, access-controlled, read-only export mechanism on an isolated branch and run it only after its authorization, privacy controls, and no-mutation properties are reviewed. Do not deploy that export mechanism to the active service without explicit deployment approval. If no reliable live export can be obtained, preserve the service untouched and treat the current live data as at-risk/unrecoverable rather than assuming the Git snapshot is equivalent.

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

## PostgreSQL destination discovery (2026-11-14)

Read-only inventory of the connected Supabase account found no project identified as Varejão. The available projects belong to other workstreams and were not inspected or reused. Render inventory likewise contains no Varejão Postgres instance. The expired EventosRP Postgres and Guerra Infinita Key Value resources are explicitly out of scope.

No new database or branch was created. No pricing/cost confirmation, credentials, schema change, or database connection was initiated. A dedicated Varejão-owned PostgreSQL target remains a prerequisite for import rehearsal and adapter testing. Select the provider/organization and review any quoted cost before provisioning.

## Deployed seed snapshot schema preflight (2026-11-14)

A new read-only, privacy-safe `backend/scripts/audit_migration_source.js` validates collection shapes, primary identifiers, normalized email uniqueness, role values, bcrypt hash format, product price/stock values, order item references/quantities, and coupon-code uniqueness. It prints only aggregate counts and validation failures, never record values or PII.

The deployed commit's tracked seed file has 12 top-level collections: 38 products, 7 users, 2 coupons, 1 cash/expense record, and empty order/stock-movement/customer-loyalty arrays; the remaining configuration collections are objects. The 7 users comprise 1 customer, 1 admin, and 5 operational roles; all 7 have bcrypt-formatted hashes. Product and user records use string IDs, while coupons have no `id` field and are keyed by `codigo`. The first preflight test incorrectly assumed coupon IDs; CI exposed that schema mismatch, and the checker was corrected to validate normalized coupon codes instead.

These results describe only the deployed Git snapshot, not the mutable Render runtime file. The script is a source preflight, not a live backup or import rehearsal.

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
