# Backend security environment setup

Configure these values in the hosting provider's encrypted environment-variable settings. Never commit them or paste them into issues, pull requests, or chat.

## Required

- `TOKEN_SECRET`: unique, cryptographically random value with at least 32 characters. Generate one with `openssl rand -hex 32`. Rotating it invalidates all existing signed sessions.
- `ADMIN_PASSWORD`: unique administrator password. Required when `NODE_ENV=production`. Set it through the host's secret manager; do not use a sample/default value.

## Operational demo accounts

- `DISABLE_DEMO_OPERATIONAL_USERS` defaults to enabled (demo users are not seeded).
- Only set `DISABLE_DEMO_OPERATIONAL_USERS=false` when demo operational accounts are intentionally required.
- If demo seeding is enabled, `DEMO_OPERATIONAL_PASSWORD` must be set to a unique strong value.
- Disabling seeding does not delete demo accounts that may already exist in a persistent JSON database. Before production rollout, inspect the existing user records through an authorized maintenance procedure and disable/remove any known demo accounts there. Do not assume this code change removes existing accounts.

## Startup behavior

The backend refuses to start when `TOKEN_SECRET` is missing or shorter than 32 characters. In production it also refuses to start without `ADMIN_PASSWORD`, and refuses demo-account seeding without `DEMO_OPERATIONAL_PASSWORD`.

## Rollout checklist

1. Configure the required values as encrypted environment variables in the host.
2. Confirm `NODE_ENV=production`.
3. Audit existing administrator and operational accounts in the persistent database; rotate any credentials that may have been created with former defaults.
4. Verify startup and authentication in a non-production environment first.
5. Rotate `TOKEN_SECRET` only with a planned session invalidation window.
6. Do not deploy until the database migration and concurrency limitations documented in the PR have been addressed.
