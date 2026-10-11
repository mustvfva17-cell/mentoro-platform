# MENTORO — Runtime Database Role Verification Plan

**Status:** Review/test plan only. No database changes or connection tests have been performed.
**Purpose:** Decide whether a dedicated PostgreSQL runtime role can safely support MENTORO's Vercel API and atomic workflows.

## 1. Current evidence

The owner-provided Supabase Connect screenshot shows the Shared Transaction Pooler in URI mode:
- Host: `aws-0-eu-west-1.pooler.supabase.com`
- Port: `6543`
- Database: `postgres`
- Username format: `postgres.<project-ref>`

Do not use the shown default `postgres.<project-ref>` identity for the application's runtime. It is the administrative Postgres role, not a least-privilege application identity.

## 2. Important driver-specific correction

The pooler mode alone does not select a working driver. Current Supabase guidance says transaction mode does not support prepared statements or session state. Supabase's Postgres.js guide also documents a query-pipelining compatibility issue with the shared transaction pooler and its transaction API.

Therefore:
- Do not choose Postgres.js for the MENTORO transaction-heavy runtime without a separately verified workaround and successful tests.
- Evaluate the Node.js `pg` (node-postgres) driver or the Supabase Data API/RPC path. Pin the selected driver version and test actual transaction behavior in the target runtime.
- If evaluating a raw PostgreSQL client, require TLS, use the shared transaction pooler for serverless, keep the application-side pool small, and do not use named/prepared statements unless proven compatible.
- Keep schema migrations on a separate, explicitly administrative path; do not put admin credentials in runtime configuration.

## 3. Candidate architecture to test

**Candidate A — direct PostgreSQL from trusted Vercel API**
- Shared Transaction Pooler, port 6543.
- Dedicated login role (provisional name: `mentoro_runtime`) with no `SUPERUSER`, no `BYPASSRLS`, no privileged role memberships, and no table ownership.
- Explicit grants only to reviewed application objects and functions.
- Verify inherited and `PUBLIC` privileges, including access outside the intended application schema.
- Use short, explicit transactions for state changes, audit insertion, and transaction-scoped locks.
- Design actor binding explicitly. A raw PostgreSQL connection does not automatically carry the caller's Supabase Auth JWT; do not assume `auth.uid()` represents the signed-in user. Verify the Auth token in the trusted API and design a non-spoofable authorization boundary before relying on identity-dependent RLS.

**Candidate B — Supabase Data API + RPC**
- Use Supabase Auth to verify the session.
- Use the Data API with the user's access token where user-context RLS is required.
- Use server-only elevated credentials only for narrowly controlled administrative workflows; a secret/service-role request without a user token bypasses RLS and therefore requires explicit server-side authorization.
- Put multi-row invariants inside reviewed database functions and verify that all relevant writes and audit events are atomic.
- Do not assume that using `SECURITY INVOKER` neutralizes a caller's elevated database role.

Choose only after comparing the actor model, transaction guarantees, effective privileges, testability, and implementation complexity. No candidate is approved by this document.

## 4. Read-only SQL diagnostics

Run these only in the Supabase SQL Editor while connected as an authorized database administrator. They are read-only; they do not create roles, grant privileges, or modify application data. Review results locally and share only sanitized role names and privilege booleans, never credentials.

### 4.1 Role attributes and memberships

```sql
select
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolinherit,
  r.rolbypassrls
from pg_roles r
where r.rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator')
order by r.rolname;

select
  member_role.rolname as member_role,
  granted_role.rolname as granted_role,
  m.admin_option
from pg_auth_members m
join pg_roles member_role on member_role.oid = m.member
join pg_roles granted_role on granted_role.oid = m.roleid
where member_role.rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator')
   or granted_role.rolname in ('postgres', 'service_role')
order by 1, 2;
```

### 4.2 Default schema and PUBLIC access

```sql
select
  n.nspname as schema_name,
  has_schema_privilege('public', n.oid, 'USAGE') as public_has_usage,
  has_schema_privilege('public', n.oid, 'CREATE') as public_has_create
from pg_namespace n
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname;

select
  grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role', 'postgres')
order by table_schema, table_name, grantee, privilege_type;
```

### 4.3 RLS state for existing application tables

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  pg_get_userbyid(c.relowner) as table_owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault')
order by n.nspname, c.relname;
```

These queries are a baseline inventory, not a complete security proof. They do not validate a not-yet-created runtime role, all function privileges, runtime actor binding, transaction isolation, or concurrent lock behavior.

## 5. Required isolated-database test gates

Do not run these as production changes. Create a separate test project or isolated database before role/function creation.

1. Create the candidate role only after reviewing its exact attributes, memberships, schema access, table/function grants, default privileges, and `PUBLIC` grants.
2. Confirm runtime `current_user`, `session_user`, `rolsuper`, `rolbypassrls`, role memberships, and effective privileges through the same pooler/driver configuration intended for deployment.
3. Verify that the role cannot access unrelated schemas/tables, create objects, assume privileged roles, or execute unapproved functions.
4. Verify actor identity: missing, invalid, expired, and valid Supabase sessions; caller-supplied user IDs/roles must not be trusted. Test both allowed and denied object-level access.
5. Verify RLS behavior explicitly. If using a raw SQL connection, test the designed identity-propagation mechanism; do not treat `auth.uid()` as populated by default.
6. Verify multi-step transaction rollback: intentionally fail after the first state write and confirm all state and audit writes roll back.
7. Verify concurrent activation/scope-replacement and single-active-assignment invariants under race conditions.
8. Verify transaction-scoped locking with concurrent requests through the same transaction pooler. Do not use session-level advisory locks in transaction mode.
9. Verify audit-write failure rolls back the protected operation.
10. Verify TLS, connection caps, timeouts, prepared-statement settings, and deployment behavior in a Vercel preview/test environment.
11. Record exact driver/version, sanitized settings, role attributes, test results, and reviewer before approving a runtime connection.

## 6. Exit criteria

The connection model is ready for implementation only when:
- one candidate is explicitly selected and recorded;
- the runtime role and effective grants are verified;
- Auth actor binding and object-level authorization tests pass;
- transaction, rollback, audit-failure, and concurrency tests pass;
- the runtime driver/pooler combination is documented and tested;
- migration credentials remain separate from runtime credentials.

## References

- Supabase, Connect to your database: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase, Serverless drivers: https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers
- Supabase, Postgres.js: https://supabase.com/docs/guides/database/postgres-js
- Supabase, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, Postgres roles: https://supabase.com/docs/guides/database/postgres/roles
- Supabase, Connection pooling and limits: https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits
