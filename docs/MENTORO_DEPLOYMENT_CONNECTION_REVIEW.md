# MENTORO — Deployment Connection & Privilege Verification

**Status:** Connection-mode review documented; database privileges and runtime behavior remain unverified.
**Purpose:** Close the pre-migration decision about how the Vercel Node.js API reaches Supabase/PostgreSQL and which database privileges are effective.

## 1. Evidence checked in the repository

On 2026-10-11, the connected GitHub repository's `main` branch was inspected for:
- `ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md`;
- `package.json`, `vercel.json`, `api/index.js`, and `supabase/config.toml`.

The architecture/status documents describe the intended stack (Vercel Node.js API, Supabase Auth/PostgreSQL, RLS, explicit grants, and narrow atomic RPC/transaction boundaries). The four implementation/configuration paths above were not found on `main`. Repository search also found no Supabase client setup, environment-variable references, or database connection code.

**This is not proof that the live Vercel project or Supabase project lacks configuration.** GitHub repository contents do not expose deployment environment settings, dashboard role grants, database connection pooling, or secret values. Those were not inspected. No secret values should be copied into this document or chat.

## 2. Required evidence before choosing the privilege model

Record the following from the actual deployed project and isolated test database. Capture names and configuration shape only; never record credential values.

| Check | Evidence to capture | Why it matters |
|---|---|---|
| Runtime path | Which Vercel Node.js API entrypoints make protected database calls | Confirms the actual trusted boundary |
| Client/library | Package and import used for Supabase Auth, data access, or direct PostgreSQL access | Distinguishes PostgREST/service-role calls from a PostgreSQL driver |
| Environment variable names | Names only, e.g. URL/key/connection-string variable identifiers; redact all values | Identifies which credentials each runtime path consumes |
| Effective database identity | Actual `current_user`, role memberships, and whether the role has `BYPASSRLS` or is a table owner | Determines whether RLS is effective for that connection |
| Grants and policies | Effective table/schema/function privileges plus enabled/forced RLS and applicable policies | Confirms least privilege rather than relying on intended policy text |
| RPC execution | Function owner, `SECURITY INVOKER`/`SECURITY DEFINER`, `search_path`, and `EXECUTE` grants | Establishes the actual function boundary |
| Transaction/pooling model | Whether multi-step writes share one transaction and connection; pooler mode and transaction-scoped lock support | Determines whether atomicity and locks work as designed |
| Actor binding | How verified Supabase session identity is bound to each database operation/function | Prevents caller-supplied identity from becoming trusted |
| Deployment parity | Whether preview, production, and isolated test environments use materially different roles or poolers | Prevents tests from validating the wrong privilege model |

## 3. Decision rule

Evaluate in this order:

1. **Preferred candidate:** a dedicated server-only PostgreSQL role with no `BYPASSRLS`, minimal required grants, and narrowly scoped execution grants for reviewed functions. Verify that the selected connection mechanism supports the required transaction and locking semantics.
2. **Alternative:** retain a Supabase service-role client only if its bypass behavior is explicitly accepted and documented. Treat server-side authentication, object-level authorization, and input validation as mandatory; do not claim RLS protects operations executed with a bypass role.
3. Do not infer effective privileges from the variable name, client-library name, `SECURITY INVOKER`, or the fact that RLS is enabled in the dashboard. Verify the actual role and behavior.
4. Do not create migrations, final grants, production RPCs, or role-management writes until this evidence is reviewed and the selected model is documented.

## 4. Safe verification procedure

- Use Vercel project settings and the Supabase dashboard/SQL editor through authorized access; do not paste or export secret values.
- Use an isolated non-production database for behavior tests.
- Verify the connection identity with read-only role/grant inspection and a controlled RLS test using representative non-sensitive test rows.
- Test transaction rollback on deliberate failure and test the chosen transaction-scoped lock with concurrent sessions through the same pool/connection mode intended for deployment.
- Confirm audit failure rolls back the protected state change.
- Record the environment, date, role identity, sanitized evidence, results, and reviewer. Redact URLs if they embed credentials and never store tokens/passwords in GitHub docs.

## 5. Current gate status

- [x] Intended architecture documented.
- [x] Repository checked for implementation/configuration entrypoints and client references.
- [ ] Actual Vercel project settings reviewed.
- [ ] Actual Supabase/PostgreSQL role, grants, RLS behavior, and function grants verified.
- [ ] Pooling, transaction, and lock behavior verified in an isolated environment.
- [ ] Privilege/connection model selected and approved.
- [ ] Security and concurrency tests passed.

**Current conclusion:** The real deployment connection and privilege model remain **unverified**. This checklist does not choose between the candidate models and does not authorize implementation. No credentials were accessed or changed; no migrations, application code, database policies, or tests were run.


## 6. Connection-mode review (2026-10-11)

### Dashboard evidence supplied by the project owner

The Supabase Connect screen shows **Shared Transaction Pooler** selected, with URI format and these non-secret parameters:
- Host: `aws-0-eu-west-1.pooler.supabase.com`
- Port: `6543`
- Database: `postgres`
- Username shape: `postgres.<project-ref>`

No password or full connection URI was recorded. The dashboard screen does not establish the effective privileges of a custom role or prove that any database behavior has been tested.

### Findings from current Supabase documentation

- Supabase recommends the shared transaction pooler for serverless/edge workloads with short-lived connections. Port 6543 is the expected shared transaction-pooler port.
- A custom role using the shared pooler must use the username form `<role>.<project-ref>`; do not assume the default `postgres.<project-ref>` identity is least-privileged.
- Transaction mode does not support prepared statements or session state that must persist across transactions. Session-level advisory locks are unsupported; any required lock must be transaction-scoped and tested through the selected driver/pooler.
- For a Node.js serverless client, configure a single application-side connection per warm instance, disable prepared statements for the selected driver, and require TLS. Driver-specific settings must be verified against the chosen library.
- A role without `BYPASSRLS` is still not automatically safe: table ownership, inherited/PUBLIC grants, function ownership, and explicit grants can widen access. Inspect effective privileges, not just the role definition.
- A direct PostgreSQL connection does not automatically carry the caller's Supabase Auth JWT into database policies. If policies depend on `auth.uid()`, the identity propagation and trust boundary must be deliberately designed and tested; do not assume browser-session RLS applies to raw SQL connections.

### Provisional decision

**Use the shared Transaction Pooler as the leading runtime connection candidate for Vercel, but do not enable it in production yet.** The runtime must not connect as the broad `postgres` admin role. First evaluate a dedicated login role with no `BYPASSRLS`, no membership in privileged Supabase roles, and only explicitly granted access to the intended application schema/functions.

This candidate is acceptable only after the design chooses and tests how verified user identity reaches authorization checks. Sensitive multi-row workflows must remain atomic; prefer narrow, reviewed database functions/transactions and explicitly test transaction-scoped locking, rollback, and audit-write failure. If this role-and-RLS model proves impractical, compare it against a Supabase Data API + server-only secret-key/RPC model and document the explicit RLS-bypass tradeoff before choosing.

### Still not verified / not performed

- No custom database role has been created and no grants, RLS policies, functions, or database settings have been changed.
- No connection attempt, SQL inspection, transaction, concurrency test, or RLS test has been run. Dashboard evidence alone cannot verify effective role privileges.
- No credentials or environment variables have been added to Vercel or GitHub.
- No migration or application database code is authorized by this review.

### References

- Supabase, Connect to your database: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase, Connection pooling and limits: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits
- Supabase, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, Postgres roles: https://supabase.com/docs/guides/database/postgres/roles

**Updated conclusion:** The pooler mode is appropriate for a Vercel serverless candidate, but the production privilege model remains unapproved until the dedicated role, identity propagation, grants/RLS, and transaction/lock behavior are tested in an isolated database.


## 7. Read-only role inventory results supplied by owner (2026-10-11)

The owner ran the read-only `pg_roles` query in the Supabase SQL Editor on the production project and uploaded the CSV. This records role attributes only; it does not prove effective object privileges or runtime behavior.

Observed roles relevant to the connection decision:
- `postgres`: `rolcanlogin=true`, `rolsuper=false`, `rolcreatedb=true`, `rolcreaterole=true`, `rolbypassrls=true`.
- `service_role`: `rolcanlogin=false`, `rolsuper=false`, `rolbypassrls=true`.
- `authenticated` and `anon`: `rolcanlogin=false`, `rolsuper=false`, `rolbypassrls=false`.
- `supabase_admin`: `rolsuper=true`, `rolbypassrls=true`.
- The observed `authenticator` role can log in but does not itself have `BYPASSRLS`; its membership/inheritance and PostgREST role-switching behavior are separate from a raw PostgreSQL app login.

Interpretation:
1. Do not use `postgres` as the Vercel runtime login: it has role-creation/database-creation privileges and bypasses RLS.
2. Do not treat `service_role` as RLS-protected: it has `BYPASSRLS` even though it is not a superuser.
3. `anon` and `authenticated` are API role identities, not automatically suitable direct-Postgres login accounts; both report `rolcanlogin=false`.
4. This role inventory does not establish whether a new custom role is permitted/appropriate, what grants it would inherit, whether it can safely use the selected pooler, or how verified Auth identity will be bound to SQL authorization.
5. No roles or grants were created or modified. The result is evidence for rejecting the default administrative runtime identity, not approval of a replacement.

### Updated verification status

- [x] Supabase Connect screenshot reviewed; shared Transaction Pooler is the candidate mode.
- [x] Read-only role attributes reviewed from owner-provided CSV.
- [ ] Effective object/schema/function grants and all relevant role memberships verified for a proposed runtime identity.
- [ ] Auth identity propagation and RLS model chosen and tested.
- [ ] Driver/pooler transaction and concurrency behavior tested in an isolated database.
- [ ] Runtime privilege model approved.

**Conclusion:** The production role inventory confirms that the default `postgres` and `service_role` identities bypass RLS. Continue design and isolated testing only; do not create a production runtime role or change production grants based on this inventory alone.
