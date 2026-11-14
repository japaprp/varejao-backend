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

A further route audit found that the unauthenticated legacy `POST /finalizar` endpoint exposed `checkoutCart()`, which could deduct stock and create a finalized order without a trusted payment confirmation. The current repository frontend does not call this endpoint: online checkout uses the Mercado Pago preference/webhook flow, and physical checkout uses authenticated operational routes. The controller now disables the legacy endpoint with HTTP 410 and an explanatory response. Regression smoke tests submit both physical and online cart IDs to the endpoint and verify that order count and stock remain unchanged. CI run #42 initially failed because the older regression assertion still expected HTTP 403 from the intermediate physical-only guard; after the endpoint was consistently disabled with HTTP 410 for both channels, the test expectation was corrected and run #43 passed.

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

## Rate limiter — bounded local implementation; distributed persistence remains blocked

The Render service is a public Render Web Service. Render's current security guidance explicitly says inbound traffic passes through Cloudflare and Render load balancers, the socket address is a proxy address, and applications should read `X-Forwarded-For` for the client IP. It recommends application-level rate limiting and a distributed store such as Render Key Value when running multiple instances. Therefore, the previous claim that simply using the first `X-Forwarded-For` value proves a spoofing vulnerability was too strong and is withdrawn. We did not enable Express `trust proxy` or assume a hop count.

The PR branch now validates the first `X-Forwarded-For` value as an IP address and falls back to a validated socket address if the header is malformed. The in-memory bucket map is capped at 10,000 identities per limiter, expired buckets are pruned, and new identities fail closed with HTTP 503 when capacity remains full. Regression tests cover forwarded IP parsing, malformed headers, rate-limit enforcement, bounded capacity, and expiry.

Remaining limitation: counters are still process-local and reset on restart/free-instance spin-down. The active service currently has one instance, but this is not durable or distributed protection. Before production approval, move counters to a dedicated Varejão-owned shared store or a transactional database-backed limiter and test concurrency/expiry. Do not reuse the Redis resource belonging to Guerra Infinita.

## Live Render persistence risk — confirmed by configuration and code (2026-11-14)

The active Render service `varejao-backend-1` is on the Free plan, has one instance, and deploys from `main`. Render's current Free-plan documentation states that Free web services have an ephemeral filesystem, do not support persistent disks or SSH/shell access, and lose local file changes when the instance spins down, restarts, or redeploys. Free instances can spin down after 15 minutes without inbound traffic.

The deployed commit is `91248f7fa864cd3ff378ec366e1ccd96401346ab`. In that commit, `backend/src/data/repository.js` resolves `database.json` relative to the source file and uses synchronous `readFileSync` / `writeFileSync`. Therefore the live application writes its mutable JSON database inside the service filesystem, not to a managed datastore. The same deployed source configures `backend/src/middlewares/uploadMiddleware.js` to write uploaded images into `path.join(process.cwd(), 'uploads')`, served by Express from `/uploads`; those files are also local filesystem state and are equally ephemeral. A durable migration must move both structured data to a dedicated Varejão PostgreSQL database and uploaded media to a Varejão-owned object-storage bucket/CDN, with a verified copy/checksum process. Do not assume a persistent disk is available on the current Free service. The workspace contains no Varejão Postgres or Varejão-owned Key Value resource. The only listed Postgres belongs to another project and is suspended/expired; the only Key Value resource belongs to Guerra Infinita and must not be reused.

This is a **critical persistence/data-loss risk**. The repository's deployed `database.json` snapshot contains 7 user records and 12 top-level collections, but this is only the committed seed snapshot; it is not a live runtime export and does not reveal current live account/order state. Render app logs only showed process startup; no database contents were read. Because the service is Free and has no persistent disk, the current mutable runtime file cannot be considered durable. Do not restart, redeploy, change the plan, alter auto-deploy, or run cleanup until the current live data has been captured through an authorized safe export or the system owner confirms the data is disposable/reconstructable.

The active service exposes no SSH/shell path on the Free plan, and no full-database export endpoint was found. The API has selected CSV exports for individual operational views, but these do not constitute a complete backup of users, products, orders, carts, loyalty, coupons, configuration, and audit-relevant state. A provider-side snapshot is therefore **BLOCKED**. A read-only Dropbox search for Varejão/backend/database backup/export artifacts returned no matches; this does not rule out backups under unrelated names or another storage account, but no matching Dropbox backup is currently identified. Safe next step: arrange a temporary, access-controlled, read-only export mechanism on an isolated branch and run it only after its authorization, privacy controls, and no-mutation properties are reviewed. Do not deploy that export mechanism to the active service without explicit deployment approval. If no reliable live export can be obtained, preserve the service untouched and treat the current live data as at-risk/unrecoverable rather than assuming the Git snapshot is equivalent.

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

## Checkout/cart contract audit and compatibility-first ownership design (2026-11-14)

### Existing frontend contract — confirmed from repository source

The repository contains the storefront frontend; this is not an external-client-only integration. The current browser contract is:
- `app-core.js` stores `cart_id` in localStorage. It accepts a `?cart=` URL parameter and overwrites the stored ID. New IDs use `crypto.randomUUID()`, with a weaker `Date.now()+Math.random()` fallback.
- `index.html` captures the cart ID synchronously at page load, appends it to `Pagamento.html?api=...&cart=...`, and sends it as `X-Cart-Id` on `POST /carrinho`.
- `Pagamento.html` resolves the same ID, sends `X-Cart-Id` to `GET /checkout`, cart rehydration, `POST /pagamento/preferencia`, and `POST /pagamento/maquininha/iniciar`; it puts the cart ID in the EventSource URL as `?cartId=...`.
- The frontend keeps a second local cart (`cart_items`) and attempts to rehydrate the backend cart if the backend returns an empty cart. This is an existing recovery path and must be preserved during rollout.
- `Pagamento.html` decides whether to show the physical/maquininha UI by regex-matching the caller-controlled cart ID (`caixa|pdv|balcao|fisic|sessao|session|mesa|comanda`). The backend independently derives channel from the same string. A client-controlled identifier is therefore also controlling business channel.
- `admin.html` displays cart IDs in its active-cart table. No separate physical-cart creation or authenticated cart-session issuance flow was found in the inspected frontend.
- `Carrinho.html` is only a redirect page. No other storefront page in the repository defines an alternative cart-token contract.

### Existing backend behavior — confirmed

- `GET/POST /carrinho`, `GET /checkout`, `GET /stream/checkout`, and `POST /pagamento/preferencia` are public.
- `getCartId(req)` trusts `X-Cart-Id`, query `cartId`, or body `cartId`, in that order.
- Missing IDs become the shared `default` key in `cartService.resolveCartId()`.
- Cart contents are stored in `database.json` under `carrinhos[cartId]`; there is no session owner, capability hash, expiration, or revocation record.
- Checkout SSE subscriptions are keyed only by cart ID. `notifyCheckout()` publishes the checkout preview, including item details and totals, to every subscriber with that ID.
- `POST /pagamento/preferencia` creates and persists a pending order and clears the cart before calling Mercado Pago. A provider error/timeout can therefore leave an empty cart and a pending order without a usable preference. There is no application idempotency key.
- The pending order stores caller-provided CPF/name. On payment approval, `finalizePaidOrder()` calls `applyLoyalty(order.cpf, order.nomeCliente, order.total)`; an unverified CPF can therefore receive loyalty attribution.
- The physical/maquininha routes require an authenticated operator. However, the current `Pagamento.html` requests for both `POST /pagamento/maquininha/iniciar` and `POST /pagamento/maquininha/confirmar` do not send an Authorization header. The page's public physical-mode detection and backend role gate are inconsistent; the current browser flow appears unable to complete those protected requests. This needs a dedicated UI/authentication contract test before changing the route.
- The maquininha start endpoint also receives a caller-selected cart ID; physical channel must not be inferred from a public identifier.
- CORS is configured with exact allowed origins and the `cors` package defaults. The new contract should explicitly document/allow `X-Cart-Token` and `Idempotency-Key` and include OPTIONS preflight tests.

### Security and compatibility conclusions

1. `cart_id` is currently both a locator and a bearer credential. It is exposed in the URL, page text, browser history, and SSE query string. It must become a non-secret locator; authorization must use a separate capability never placed in a URL.
2. The shared `default` cart must be removed. Requests without an explicit valid cart session must return 401/400 and must never read or create a shared cart.
3. The business channel must be server-owned session metadata, not a regex over a client-controlled ID. Public self-service session issuance creates `online` sessions only. Physical sessions/orders must be created through authenticated operator workflows with explicit role, store, and channel scope.
4. A cart capability must be generated with a cryptographically secure 256-bit random value. Store only its SHA-256 hash, bind it to a random public cart ID, channel, optional authenticated owner, created/last-used/expiry timestamps, and revocation state. Compare hashes safely; do not log or display the raw capability.
5. Guest checkout can remain available, but a typed CPF/name is not proof of identity. Preserve the UI fields as unverified purchase details if legally/operationally needed; do not associate them with customer history or award loyalty until verified. For logged-in customers, derive identity from the current authenticated account. For guests, add an explicit verification flow before loyalty attribution.
6. The browser's local `cart_items` fallback and rehydration behavior must remain functional. Session rotation should rebind the existing cart only when the client proves possession of the old high-entropy cart capability; do not silently claim arbitrary legacy IDs. For clients that lost their old capability, start a fresh cart and let the existing local-cart rehydration restore only the items still present in that browser.
7. The EventSource API cannot set a custom Authorization header. Replace the permanent cart ID subscription with a short-lived, cart-bound stream ticket minted by an authenticated POST, or retain polling with `X-Cart-Token`. Never put the permanent cart capability in a query string.
8. Checkout creation needs an application idempotency key bound to cart session + request fingerprint. Persist the pending order/idempotency state transactionally; retries must return the same order/preference result or a safe retry state, not create duplicate orders. Do not clear the cart irreversibly before the provider operation has a recoverable state.
9. Expired/revoked sessions must stop reserving stock. Expiration cleanup must be transactional and must not delete carts linked to pending/paid orders.

### Compatibility-first implementation and rollout (not yet implemented)

**Phase 0 — contract tests and baseline**
- Add frontend contract tests for cart ID persistence, `?cart=` behavior, local-cart fallback/rehydration, online checkout, physical/maquininha authorization, SSE/polling, and Mercado Pago return navigation.
- Add backend regressions proving that arbitrary IDs, missing IDs, `default`, cross-session reads, and unauthorized SSE subscriptions are denied once enforcement is enabled.
- Add tests for guest CPF not receiving loyalty credit without verification, idempotent preference retries, provider failure recovery, and physical channel authorization.
- Record current request/response shapes as compatibility fixtures before changing them.

**Phase 1 — additive v2 session capability**
- Add `POST /carrinho/sessao` returning `cartId` (public locator) and `cartToken` (256-bit secret) for an online session. Store only token hash and session metadata.
- Add `X-Cart-Token` to cart read/write, checkout preview, payment preference, and cart stream authorization. Keep response JSON fields and storefront UX unchanged.
- Update `app-core.js` with an async session bootstrap; update `index.html` and `Pagamento.html` to await it before cart requests, persist the token separately, and keep `cart_id` as a locator only. Keep `cart_items` rehydration.
- Replace SSE with token-authorized polling initially, or add a short-lived stream ticket. Do not expose the permanent token in URLs.
- Keep legacy clients behind an explicit temporary compatibility mode, instrument only aggregate legacy-request counts, and set a documented removal date. The mode must be fail-closed when enforcement is enabled.

**Phase 2 — authenticated physical flow**
- Remove client-ID regex channel detection. Physical sales use the existing authenticated operational order/settlement routes, or a separately issued physical session bound to an operator and store.
- Repair the maquininha UI contract: send the current operator bearer token for protected start/confirm actions, and test that kitchen/customer roles cannot initiate or confirm settlement.
- Never allow a public online session to become physical by changing its locator.

**Phase 3 — enforce and retire legacy**
- After frontend deployment and adoption evidence, explicitly enable strict session enforcement; legacy requests without a valid capability return 401/403. This requires a separate deployment/configuration authorization and is not part of this PR.
- Remove `default` fallback and raw cart-ID authorization. Revoke/expire legacy cart sessions safely.
- Preserve old order `cartId` values as historical references; do not rewrite historical orders merely to rotate active cart sessions.

### Release gates

- No frontend/backend contract change without browser-level and API integration coverage.
- No raw capability in URL, DOM text, logs, analytics, or admin tables.
- Cross-session isolation tests: A cannot read, mutate, stream, or checkout B's cart.
- Missing/expired/revoked capability tests return denial without creating a cart.
- Physical channel and operator identity are server-derived.
- CPF/loyalty attribution requires verified identity.
- Preference retry/provider-timeout tests prove no duplicate order and no unrecoverable cart loss.
- Compatibility rollout has a measured legacy window and an explicit strict-enforcement switch.
- Current implementation status: **AUDIT PASS / DESIGN DOCUMENTED / CODE NOT RUN / ENFORCEMENT NOT ENABLED**. No production changes.

## Operational settlement role separation (2026-11-14)

Route review found that `POST /operacao/pedidos/:id/fechar` used the broad operational-role set, including kitchen/production and counter-service roles. This allowed a kitchen-role token to attempt payment settlement. The route now uses a narrower payment-authorized set: admin, operator, manager, and cashier roles. Production-stage updates and order creation retain the broader operational-role set. A smoke regression creates a signed kitchen-role token and verifies settlement is rejected with HTTP 403. CI is pending.

## Public cart/session ownership and checkout identity — release blocker (2026-11-14)

Static route/service review found an unresolved trust boundary:
- `POST/GET /carrinho`, `GET /checkout`, and `GET /stream/checkout` are public and identify a cart using caller-controlled `x-cart-id`, query `cartId`, or body `cartId`.
- When no cart ID is supplied, `resolveCartId()` falls back to the shared key `default`.
- Public `POST /pagamento/preferencia` uses the supplied cart ID to create a pending order and clears that cart. Checkout CPF and customer name are also accepted from the request body.
- There is no server-side cart owner/session binding or proof that a supplied CPF belongs to the caller. An absent/default cart ID can therefore cause cross-session cart access; predictable/reused cart IDs can expose cart/checkout state or interfere with another checkout. Client-supplied CPF also cannot be treated as verified identity.

Status: **BLOCKED — not changed in this backend-only PR**. The repository contains no frontend client, so the current cart-ID generation/storage contract cannot be verified. Blindly requiring a new token format could break the external storefront. Before release, inspect the actual frontend and migrate to an opaque high-entropy server-issued cart capability (or authenticated owner binding), remove the shared `default` fallback, bind checkout to that capability, add expiration and idempotency, and verify customer identity before associating CPF/loyalty data. Do not treat a caller-supplied cart ID or CPF as authorization.

## Concurrent writes and transactional integrity — release blocker

The current JSON repository still performs synchronous whole-file read/modify/write without cross-process locking, atomic compare-and-swap, or database transactions. Single-process smoke tests cannot prove correctness under multiple instances or concurrent requests. A process-local lock would not protect separate instances and is not an adequate production fix. This remains **BLOCKED** until a verified backup is preserved, an isolated Varejão-owned database is selected, and transactional persistence plus concurrency/rollback tests are implemented. No live data or infrastructure has been changed.

## Operator attribution and current-account authorization (2026-11-14)

Operational records previously accepted an operator label from the request body, and production/settlement actions did not consistently persist the authenticated actor. The API now derives the operator identity from the authenticated session:
- Operational order creation stores operator ID, role, and name from `req.user`; a client-supplied operator label is ignored.
- Production-stage changes append a bounded (latest 100 events) `productionHistory` with stage, timestamp, and authenticated actor.
- Operational settlement stores `settledBy` and `settledAt`.
- Machine payment confirmation already stores the confirming actor and transaction reference.

A separate authentication review found that `getUserByToken()` trusted the user/role snapshot embedded in a signed token until expiry. It now resolves the user ID against the current database record on every authenticated request and returns the current sanitized account. This invalidates access for deleted accounts and prevents stale role claims from retaining privileges after a role change. Smoke regressions cover stale admin-to-kitchen role refresh, deleted-user token rejection, spoofed operator labels, production actor history, and settlement attribution.

Validation: GitHub Actions run #76 passed on commit `caf43773374f60e76d522d20f6c801703a766be0`. Logs confirm migration preflight `errors: []`, rate-limiter tests, upload-policy tests, and full smoke QA. Runs #72–#75 revealed test-fixture gaps caused by the new current-account lookup (synthetic test identities were not persisted in the smoke database); the fixtures now create the corresponding temporary database users before signing tokens.

The current-account lookup still uses the JSON repository. It does not solve the already documented multi-instance/concurrent-write limitations; transactional persistence and durable storage remain blocked on backup and migration readiness.

## Authorization audit follow-up (2026-11-14)

Two additional authorization issues were found and corrected:
- Customer order history: a customer account with no associated CPF could previously supply another CPF in `GET /pedidos?cpf=...`. Customer accounts without an associated CPF are now denied; customer history lookup always targets the CPF bound to the authenticated token. Regression test verifies HTTP 403 for a validly signed CPF-less customer token.
- Operational settlement: the settlement route previously accepted the broad operational role set, including kitchen/production users. It now permits only admin, operator, manager, and cashier roles. Production queue/status and order creation retain the broader operational role set. Regression test verifies a signed kitchen-role token receives HTTP 403.

QA evidence:
- Runs #59–#66 exposed defects in the new test fixtures, not failures in the application corrections: the CPF test used a checksum-invalid sample, and subsequent test tokens were signed with the parent process's unset secret rather than the isolated smoke server secret. The fixtures were corrected to use a valid synthetic CPF and tokens signed with the smoke server's configured secret.
- GitHub Actions run #67 passed on commit `0d786594f2610b8d3a6d8403c6f68a357a76db4e`. Logs confirm migration preflight `errors: []`, rate-limiter tests, upload-policy tests, and full smoke QA (`auth, payments, catalog, stock, production, orders, and recovery`).

## Customer order-history authorization hardening (2026-11-14)

Independent route review found that an authenticated customer account without a CPF could call `GET /pedidos?cpf=<other-customer>` because the controller fell back from the account CPF to the caller-supplied query CPF. Registration permits accounts without a CPF, so this was a real cross-customer history disclosure path. The controller now denies order-history access to non-privileged accounts without an associated CPF and never uses a caller-supplied CPF as the target for customer accounts. A smoke regression registers a CPF-less customer and verifies an arbitrary CPF query returns HTTP 403. CI for this correction is pending.

## Upload endpoint hardening (2026-11-14)

The admin-only image upload path previously trusted the client-supplied MIME type and retained the sanitized original filename/extension. The branch now:
- accepts only JPEG, PNG, WebP, and GIF MIME types (SVG and active document types are rejected);
- buffers uploads with the existing 5 MB limit and validates the file signature before writing;
- generates a random UUID filename with an extension derived from the detected signature, not the supplied filename;
- rejects content whose signature does not match an allowed raster image.

The upload policy test covers supported formats, SVG/HTML/JavaScript rejection, valid image signatures, and non-image content. GitHub Actions run #53 passed the upload policy tests, rate-limiter tests, migration-source preflight, and smoke QA.

Remaining limitation: accepted images are still written under the service-local `uploads/` directory. On the active Render Free service this directory is ephemeral, so durable media storage must move to a Varejão-owned object-storage bucket/CDN before production use.

## PostgreSQL destination discovery (2026-11-14)

Read-only inventory of the connected Supabase account found no project identified as Varejão. The available projects belong to other workstreams and were not inspected or reused. Render inventory likewise contains no Varejão Postgres instance. The expired EventosRP Postgres and Guerra Infinita Key Value resources are explicitly out of scope.

No new database or branch was created. No pricing/cost confirmation, credentials, schema change, or database connection was initiated. A dedicated Varejão-owned PostgreSQL target remains a prerequisite for import rehearsal and adapter testing. Select the provider/organization and review any quoted cost before provisioning.

## Additional owner-reported backup source — USB drive (2026-11-14)

The owner reports that a USB flash drive contains a Varejão project/data folder, but the drive is currently unavailable and has intermittently produced errors. Its contents, exact path, timestamp, integrity, and whether it contains the live `database.json` or only project files are **unverified**. Do not treat it as a valid backup yet.

When the drive is available, use a preservation-first, read-only acquisition:
1. Do not format, repair, initialize, or write to the original drive; do not run filesystem repair tools before imaging/copying.
2. Inspect the drive's health/read errors and identify the exact Varejão folder and files. If it is unstable, stop repeated reads and create a sector-level image with an appropriate recovery tool before file-level extraction.
3. Copy the candidate folder to a separate healthy storage device; keep the original unchanged.
4. Compute SHA-256 hashes and byte sizes for the copied files, compare source/copy where safely readable, and record timestamps.
5. Inspect JSON structure and aggregate counts without printing personal data, passwords, tokens, or hashes. Never overwrite the GitHub snapshot or live service with the USB copy.
6. Compare the USB copy, Git snapshot, and any safely obtainable live export; identify which is newest and whether it is complete before calling any one of them a migration source.

Current source-of-truth assessment: GitHub is a known versioned seed snapshot; Render's mutable live state is inaccessible and at risk; USB is a promising but unverified recovery candidate. No valid complete operational backup has yet been verified.

## Deployed seed snapshot schema preflight (2026-11-14)

A new read-only, privacy-safe `backend/scripts/audit_migration_source.js` validates collection shapes, primary identifiers, normalized email uniqueness, role values, bcrypt hash format, product price/stock values, order item references/quantities, and coupon-code uniqueness. It prints only aggregate counts and validation failures, never record values or PII.

The deployed commit's tracked seed file has 12 top-level collections: 38 products, 7 users, 2 coupons, 1 cash/expense record, and empty order/stock-movement/customer-loyalty arrays; the remaining configuration collections are objects. The 7 users comprise 1 customer, 1 admin, and 5 operational roles; all 7 have bcrypt-formatted hashes. Product and user records use string IDs, while coupons have no `id` field and are keyed by `codigo`. The first preflight test incorrectly assumed coupon IDs; CI exposed that schema mismatch, and the checker was corrected to validate normalized coupon codes instead.

These results describe only the deployed Git snapshot, not the mutable Render runtime file. The script is a source preflight, not a live backup or import rehearsal.

## Identifier collision hardening and stock idempotency (2026-11-14)

Static review found order and user identifiers generated from `Date.now()`, which can collide when multiple records are created within the same millisecond. Order, payment-entry, and user record IDs now use Node's `crypto.randomUUID()`. Smoke tests create two users and two operational orders synchronously and assert distinct identifiers.

Operational settlement regression tests also verify that a valid close deducts the sold quantity exactly once and that repeating the same close does not deduct stock again or alter the recorded payment total.

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

- Render proxy/client-IP handling review: PASS (followed current Render guidance; no speculative Express trust-proxy hop count).
- Bounded local rate limiter and deterministic tests: PASS.
- Distributed/durable rate-limit store: BLOCKED (no Varejão-owned store; do not reuse another project's Redis).
- Legacy unauthenticated `POST /finalizar` route closure and no-mutation regression tests: PASS.
- Operational payment reconciliation, stock-preservation, stock-once/idempotency tests: PASS.
- Collision-resistant order/payment/user IDs and regression tests: PASS.
- Image upload MIME allowlist, magic-byte validation, UUID naming, and tests: PASS.
- Static repository persistence audit and deployed snapshot schema preflight: PASS.
- Tracked JSON snapshot account summary: PASS (7 records; 5 operational identities; no duplicate normalized emails; bcrypt hashes present).
- Render live filesystem persistence risk: CONFIRMED CRITICAL (Free plan, local JSON and uploads directories are ephemeral).
- Live runtime backup/export: BLOCKED (no SSH/shell on Free plan; no full-database export endpoint; current mutable runtime file not accessible through approved read-only channel).
- Live production account audit: BLOCKED until a trustworthy runtime export is obtained.
- PostgreSQL destination: NOT RUN (no Varejão-specific Render or Supabase project found; no resource created).
- Import rehearsal/checksum reconciliation: NOT RUN (requires a preserved source snapshot and dedicated isolated PostgreSQL).
- Transactional runtime adapter: NOT RUN (must follow verified source backup and isolated import rehearsal).
- Durable media storage: NOT RUN (requires a Varejão-owned object-storage target).
- Production migration/cutover: NOT AUTHORIZED; not performed.
