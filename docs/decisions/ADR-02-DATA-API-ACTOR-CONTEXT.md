# ADR-02 — Supabase Data API, Verified Actor Context, and Atomic RPC

**Status:** Proposed for isolated validation; not yet accepted as the final production connection model.
**Date:** 2026-10-11
**Related:** ADR-01, L-16, L-17, L-23, L-24–L-27, L-30–L-41.

## Context

The production role inventory supplied by the project owner confirms:
- `postgres` can log in, create databases and roles, and has `BYPASSRLS`.
- `service_role` has `BYPASSRLS`.
- `anon` and `authenticated` have `rolcanlogin = false`; they are API role identities, not direct PostgreSQL login accounts.
- The Supabase shared Transaction Pooler is available, but raw PostgreSQL access does not automatically propagate a user's Supabase Auth JWT into database policies.

Using the default `postgres` login for application runtime is rejected. A custom direct-Postgres role remains possible, but requires a separate role/grant design and an explicit identity-propagation model.

## Candidate decision

**Preferred candidate to validate first:** use `@supabase/supabase-js` / Supabase Data API from the Vercel Node.js API and preserve the verified caller's access-token context for user-scoped operations. Use narrow PostgreSQL RPC functions for multi-row atomic workflows. Do not introduce a direct PostgreSQL runtime connection or `DATABASE_URL` until a concrete requirement justifies it.

### Actor binding

1. The Vercel API verifies the incoming Supabase session/token using supported Supabase Auth verification.
2. Actor identity is derived from the verified user, never from request-body IDs, role labels, email claims, or frontend state.
3. For user-scoped database operations, the API forwards/uses that user's access-token context so Postgres receives the correct JWT claims and RLS can evaluate `auth.uid()`.
4. Privileged actions additionally check the active role in trusted database state. Client-supplied actor IDs never determine authorization.
5. Do not silently replace the caller context with a service-role-only client for ordinary user operations.

### Atomic workflows and privileged functions

- Multi-row workflows are implemented as one database function/RPC call so PostgreSQL can commit or roll back all state and required audit writes together.
- Default to `SECURITY INVOKER` where its effective grants are sufficient.
- If a workflow requires a narrowly scoped `SECURITY DEFINER` function, its SQL body must independently derive/check the authenticated actor (e.g. `auth.uid()`), verify the required active role from trusted tables, validate target scope, use a fixed safe `search_path`, fully qualify sensitive objects, and have `EXECUTE` revoked from `PUBLIC`/unneeded roles and granted only to the intended API role(s). Function ownership and RLS interaction must be reviewed.
- Do not assume a `SECURITY DEFINER` function is safe merely because execute permission is restricted. Its internal authorization checks are mandatory.
- Any server-only secret/service-role credential remains server-side. Calls made without a user access token execute with bypass-RLS semantics and must not be treated as RLS-protected. Such calls are reserved for separately reviewed system/bootstrap operations, not a general-purpose data-access shortcut.

### Why this candidate first

- Avoids raw database credentials and the administrative `postgres` login in normal Vercel runtime.
- Preserves a native Supabase Auth JWT context for user-scoped RLS.
- RPC provides a database-side transaction boundary for multi-row invariants without needing a client-side multi-statement transaction over the Data API.
- Avoids committing to a raw Postgres driver/pooler combination before its behavior and role grants have been tested.

This is a candidate, not a claim that RLS/RPC security is already implemented or verified. Supabase documents that database functions can be called over RPC, that function execute grants and function-body authorization are separate controls, and that secret/service-role access bypasses RLS when no user access token is present.

## Required isolated tests before acceptance

1. Valid, invalid, expired, and absent session handling at the Vercel API boundary.
2. A forged body `actor_id`, role label, or target ID cannot change actor attribution or bypass authorization.
3. User-token requests reach Postgres with the expected `auth.uid()` and RLS behavior.
4. Trainee/mentor cannot call Super Admin workflows or access another user's protected data.
5. The chosen RPC rejects unauthorized callers even if called directly through the Data API.
6. A deliberately failed second write rolls back all earlier writes in the same RPC.
7. Audit-write failure rolls back the protected operation.
8. Concurrent calls preserve the global one-active-Super-Admin, one-active-assignment, one-pending-enrollment-per-normalized-email, and single-use activation invariants.
9. Restricted function execute grants, safe `search_path`, ownership, and effective privileges are inspected.
10. Production and preview configuration do not accidentally share credentials or point test operations at production.

## Consequences and remaining gates

- This ADR does not approve production credentials, environment variables, SQL migrations, role grants, RLS policies, or RPC code.
- The direct PostgreSQL + dedicated role option is not permanently rejected; reopen it only if Data API/RPC cannot meet a documented requirement or a test demonstrates a material limitation.
- Before migration 0001, finalize FK/delete semantics, initial Super Admin bootstrap/recovery, exact constraints, role grants, RLS policies, function signatures/ownership/execute grants, audit taxonomy, and concurrency-safe last-admin protection.
- Tests must run in a separate test Supabase project/database. Do not create test objects or experimental roles in the current production project.
- Do not paste secret keys, passwords, complete connection URIs, JWTs, or recovery material into chat, GitHub, or audit metadata.

## References

- Supabase, Connect to your database: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase, Database functions: https://supabase.com/docs/guides/database/functions
- Supabase, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, Serverless drivers: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
