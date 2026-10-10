# MENTORO — Role Management & Database Security Contract

**Status:** Design proposal only; not approved as executable SQL.
**Implementation status:** No grants, RLS policies, RPCs, migrations, credentials, or tests were created or changed.

## 1. Scope and invariants

This contract applies accepted decisions for one platform-wide Super Admin, server-side authorization, atomic audit writes, and L-41 emergency recovery.

- A user cannot grant themselves a role or choose the trusted actor identity.
- Role changes are restricted to trusted, authorized workflows.
- At most one active platform-wide `SUPER_ADMIN` may exist.
- Ordinary operations must not revoke the last active Super Admin.
- Every role grant/revocation and required audit event commits or rolls back together.
- Service-role credentials, if used, remain server-side and out of source control, browser bundles, logs, and audit metadata.

## 2. Role grant/revocation contract

### Grant
1. Verify the Supabase Auth session at the trusted Vercel API.
2. Derive actor identity from the verified session; do not trust actor IDs or role labels from the request.
3. Authorize the actor against trusted role state.
4. Validate the target profile and allowed role.
5. For `SUPER_ADMIN`, acquire the shared serialization lock before checking the active-admin set.
6. Insert the role grant and required audit event in one transaction.
7. Roll back the grant if any required write or audit insert fails.

### Revoke
1. Verify and authorize the actor server-side.
2. Acquire the same serialization lock for Super Admin changes.
3. Reject an ordinary revocation that would leave no active Super Admin.
4. Preserve history by setting revocation fields instead of deleting the role row.
5. Record the required audit event in the same transaction.

### Concurrency
A candidate constant-expression partial unique index can prevent two active platform-wide Super Admin rows during concurrent grants. This is only a candidate predicate, not approved SQL. It does not prevent revoking the last active row. All grant/revoke/recovery workflows must use the same transaction-scoped lock and check the post-change state while holding it. Candidate lock mechanisms include a transaction-scoped advisory lock or a dedicated singleton guard row; the choice is not finalized.

## 3. Database privilege boundary

Important: a Supabase service-role connection bypasses RLS. `SECURITY INVOKER` does not restore RLS enforcement when the executing role bypasses RLS.

Before implementation, explicitly choose and verify the Vercel-to-PostgreSQL connection model:
- Preferred option to evaluate: a dedicated server-only PostgreSQL role without `BYPASSRLS`, minimal table privileges, and explicit execute grants for reviewed functions.
- If service-role access is retained, document that RLS is not the effective boundary for those operations. Server-side authentication and authorization checks remain mandatory, and service-role use must be tightly scoped.

Record the actual database role, role memberships, effective grants, RLS behavior, RPC execute grants, transaction support, connection/pooling behavior, and how the session-derived actor is bound to each operation. Do not assume `SECURITY INVOKER` alone makes an operation least-privileged.

## 4. Access goals (not executable RLS policies)

| Resource | Trainee | Mentor | Trusted administrative workflow |
|---|---|---|---|
| Profiles | Read permitted own fields; update only allowed fields | Same for own profile | Authorized support only |
| `user_roles` | No direct writes or self-grant | No direct writes or self-grant | Grant/revoke through audited operation |
| Pending enrollments | No direct writes; no unrelated invitee access | No access unless explicitly justified | Manage through trusted invitation workflow |
| Activation code hashes | No access | No access | Issuance/redemption only; hashes never exposed |
| Assignments | Read own history | Read permitted scope for assigned trainees | Create/transition through trusted workflow |
| Audit history | No mutation/deletion | No mutation/deletion | Restricted read/export and trusted append |

Final policies must avoid recursive RLS helpers. Review any helper function's owner privileges, `search_path`, grants, and recursion behavior.

## 5. Emergency recovery

Use the accepted L-41 secured procedure; do not add a public recovery endpoint or browser-controlled flag. Independently verify operator identity and authority, use two approvers when available, and apply only the documented narrow exception if delay risks permanent lockout. Keep recovery materials restricted and separately stored. Before production, the runbook must name operators, evidence, custody, contacts, approvals/exceptions, and review deadline. Record the action and independent post-recovery review without storing secrets.

## 6. Required tests

1. Trainee and mentor cannot grant/revoke roles or self-elevate.
2. Unauthenticated/unauthorized requests cannot invoke role-management operations.
3. Concurrent Super Admin grants cannot leave two active administrators.
4. Concurrent grant/revoke operations preserve the one-active-admin invariant.
5. Ordinary revocation of the last active Super Admin is rejected.
6. Audit-write failure rolls back the role change.
7. Client-supplied actor ID cannot affect authorization or audit attribution.
8. Effective database privileges and RLS behavior match the chosen connection model.
9. Any service-role use is server-only and is not described as RLS-enforced.
10. Lock behavior is tested through the actual connection/pool in an isolated database.
11. Recovery is limited to the runbook and independently reviewed.
12. No secrets appear in source, browser bundles, logs, or audit metadata.

## 7. Open items and approval gate

Still open: exact connection/credential model, lock primitive and key, final index/check/FK SQL, RPC signatures and grants, any justified `SECURITY DEFINER` exception, audit event taxonomy/retention, recovery runbook values, and test results.

Before role-management SQL or migrations: verify the actual deployment connection, finalize the shared lock and privilege model, review constraints/RLS/grants/RPC contracts against accepted decisions L-16, L-22, L-29, L-34, and L-41, and run concurrency/authorization/rollback tests in an isolated environment.

No implementation or tests are claimed by this document.