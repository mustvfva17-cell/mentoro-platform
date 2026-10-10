# MENTORO — Deployment Connection & Privilege Verification

**Status:** Verification checklist only; actual deployment settings have not been inspected.
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
