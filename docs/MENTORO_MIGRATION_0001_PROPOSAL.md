# MENTORO — Migration 0001 Proposal (Review Only)

**Status:** Proposal; not executable migration SQL and not applied to Supabase.  
**Scope:** Foundational identity, role-history, and audit tables only.  
**Authority:** Must remain consistent with the Physical Schema/RLS Contract, Executable DB Design Matrix, Role Security Contract, ADR-01, and L-32/L-34/L-41.

## 1. Why this is a proposal, not a migration file

The accepted design intentionally leaves several migration-blocking details open: the effective Vercel-to-PostgreSQL connection role, grants and RLS policies, the initial Super Admin bootstrap operation, concurrency-safe last-admin lock strategy, and account deletion/retention semantics. Creating an executable file under `supabase/migrations/` before resolving those would falsely imply the database boundary is ready.

This document therefore specifies a reviewable first slice. It does not change the database and must not be copied into the Supabase SQL Editor and run as-is.

## 2. Proposed first-slice objects

### A. `public.profiles`

| Column | Proposed definition | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | Must equal the verified Supabase Auth user's `auth.users.id`; never client-chosen. |
| `full_name` | `TEXT NULL` | Only profile field in this slice; later field allow-list required. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Database timestamp. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Requires reviewed update behavior if the table permits updates. |

**Open before executable SQL:** FK reference `auth.users(id)` is accepted conceptually, but `ON DELETE RESTRICT` must be reconciled with L-32 account closure, deletion, and retention policy. The profile row is provisioned by the trusted Vercel backend after Auth registration; no automatic trigger is proposed. Provisioning must be idempotent and have retry/reconciliation for partial failure.

### B. `public.user_roles`

| Column | Proposed definition | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Role grant-history row. |
| `user_id` | `UUID NOT NULL REFERENCES public.profiles(id)` | FK delete action needs final review. |
| `role` | `TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','TRAINEE','MENTOR'))` | Only accepted platform roles. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Grant timestamp. |
| `granted_by` | `UUID NULL` | FK/initial bootstrap representation unresolved; do not guess in executable SQL. |
| `revoked_at` | `TIMESTAMPTZ NULL` | NULL denotes active grant. |

**Required database invariants for final migration:**
- Partial unique index on `(user_id, role)` where `revoked_at IS NULL`.
- At most one active platform-wide Super Admin; the candidate constant-expression partial unique index is documented in `docs/MENTORO_EXECUTABLE_DB_DESIGN_MATRIX.md`.
- Prevent ordinary operations from revoking the last active Super Admin. This needs a shared transaction-scoped serialization lock plus post-change count check; a unique index alone is insufficient.
- No client self-granting and no ordinary direct client writes to this table.
- Role change and required audit row must commit atomically; audit failure rolls back the change.
- Initial Super Admin bootstrap is a separate restricted operation with its own runbook; do not seed a hard-coded user or create an open bootstrap RPC.

### C. `public.audit_logs`

| Column | Proposed definition | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Immutable event identifier. |
| `actor_profile_id` | `UUID NULL` | Null may be needed for system/failed pre-profile events; final FK/delete behavior unresolved. |
| `action` | `TEXT NOT NULL` | Controlled taxonomy to be specified. |
| `entity_type` | `TEXT NOT NULL` | Target category. |
| `entity_id` | `UUID NULL` | Target ID where applicable. |
| `occurred_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Trusted database time. |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | Minimize content; never store secrets, plaintext activation codes, or patient-identifying information. |
| `request_id` | `TEXT NULL` | Correlation token only; must not contain secrets. |

**Required controls:** ordinary users cannot insert/update/delete audit rows directly. Trusted sensitive workflows insert audit events in the same transaction as the state change. Audit insertion failure must roll back that state change. Retention, export, and final event taxonomy remain open.

## 3. Index candidates for review

These are candidate definitions only, not approved SQL:

```sql
CREATE UNIQUE INDEX user_roles_one_active_role_per_user
ON public.user_roles (user_id, role)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX user_roles_one_active_super_admin
ON public.user_roles ((role))
WHERE role = 'SUPER_ADMIN' AND revoked_at IS NULL;
```

The second index uses a constant expression for the one platform-wide Super Admin rule. Validate the exact DDL and concurrent grant/revoke behavior against the selected PostgreSQL/Supabase environment before approval.

## 4. RLS and grants — deliberately not finalized here

RLS must be enabled on the private tables and explicit SQL grants must be designed alongside policies. This proposal does **not** invent executable policies while the connection identity is unverified.

Before approving policies, record:
1. Actual Vercel database client/connection path and environment variable names (never secret values).
2. Effective database role, memberships, table ownership, and `BYPASSRLS` behavior.
3. Whether a dedicated server-only PostgreSQL role without `BYPASSRLS` is operationally supported. If a service-role credential is used, explicitly document that it bypasses RLS for that path.
4. The exact trusted transaction/RPC boundary and actor binding.
5. The shared lock mechanism for global Super Admin grants/revocations, including pooling compatibility.

Do not assume `SECURITY INVOKER` restores RLS under a bypass role. Avoid any browser-side secret or direct role/audit writes.

## 5. Required review tests before implementation

- Profile provisioning is idempotent; simulated partial failure can be reconciled without duplicate profiles.
- Client cannot choose another profile ID or modify role fields.
- Role labels/IDs supplied by a client cannot grant access.
- Concurrent attempts cannot create two active grants for the same user/role or two active platform Super Admins.
- Ordinary revocation of the last Super Admin is rejected, including concurrent requests.
- Audit insertion failure rolls back the corresponding role change.
- Effective grants and RLS behavior match the selected real connection role.
- Audit rows cannot be mutated/deleted by ordinary users.
- No secret, plaintext activation code, or patient-identifying information enters audit metadata.
- Account closure/deletion behavior is compatible with L-32 before FK delete actions are finalized.

## 6. Approval gates

- [ ] Actual Vercel/Supabase connection model verified without exposing secrets.
- [ ] FK/delete behavior approved against L-32.
- [ ] Initial Super Admin bootstrap and recovery runbook specified.
- [ ] Shared last-admin serialization lock and transaction model chosen.
- [ ] Exact grants, RLS policies, and trusted RPC/function boundary reviewed.
- [ ] SQL checked and tested against an isolated database.
- [ ] Only after all above: convert this proposal into a versioned executable migration and apply to the new Supabase project.

**Current result:** Design proposal only. No migration file was created under `supabase/migrations/`; no SQL was run; no database objects, policies, grants, credentials, or tests were changed.
