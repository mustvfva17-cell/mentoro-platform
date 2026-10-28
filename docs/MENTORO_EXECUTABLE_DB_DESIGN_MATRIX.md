# MENTORO — Executable Database Design Matrix

**Status:** Superseded legacy design proposal; not approved as migration SQL.  
**Implementation status:** Documentation only. No migration, policy, RPC, test, or deployment has been created or run.  
**Scope of this pass:** Historical proposal for identity, role grants, invitation enrollment, activation codes, and trainee assignments; do not use the enrollment/assignment constraints as the current model.

> **Architecture supersession notice — 2026-10-28:** The canonical booking/logbook model is now `docs/MENTORO_TARGET_DATA_MODEL_V2.md`, adopted with `docs/decisions/ADR-03-INDEPENDENT-TRAINING-ENROLLMENTS.md`. Any content in this legacy document that requires one active assignment/logbook per trainee, a trainee-wide mentor relationship, one pending enrollment per email, or activation-code-based training enrollment is superseded and must not be used to implement migrations or protected workflows. Shared security, audit, privacy, role-integrity, correction-history, and immutable-template-version principles remain relevant only where consistent with the new model. No SQL or database changes are authorized by this notice.


This matrix translates accepted decisions into a reviewable implementation checklist. It does not override the Architecture Decision Register, Data Model, Physical Schema/RLS Contract, or Activation API Contract. If a requirement is unresolved, it is explicitly marked open rather than guessed.

## 1. Common enforcement rules

- UUID primary keys; timestamps use `TIMESTAMPTZ`; server-owned timestamps and actor fields are not trusted from browser input.
- Sensitive state changes and required audit events commit or roll back together.
- Use explicit foreign keys and indexes; a UI check is never the final defense for uniqueness or authorization.
- The Vercel API derives the actor from verified Supabase Auth session state. Client-supplied actor IDs, role labels, email-verification claims, or ownership assertions are not authoritative.
- RLS, SQL grants, and trusted API checks must be designed together. `SECURITY INVOKER` is the default. Any `SECURITY DEFINER` exception needs explicit review.
- Never log activation codes, password/token material, service-role secrets, or patient-identifying information.
- All SQL below is a design checklist, not executable or applied migration content.

## 2. Table-by-table matrix

### 2.1 `profiles`

**Purpose:** application profile keyed to the corresponding Supabase Auth user.

| Area | Proposed contract | Gate |
|---|---|---|
| Identity | `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT` | Review FK/delete behavior against account closure and retention policy |
| Fields | `full_name TEXT`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL` | Decide requiredness/length constraints and timestamp update mechanism |
| Provisioning | Trusted Vercel API creates profile after Auth registration; idempotent retry/reconciliation required | Must not report complete enrollment if profile provisioning failed |
| Write access | User may update only explicitly permitted profile fields; cannot change ID, roles, or admin fields | Exact column grants or trusted update operation remains to define |
| RLS | User may read permitted own profile; no cross-user access | Exact policy and grants not yet written |
| Tests | Cross-user read denied; ID cannot be spoofed; partial Auth/profile failure can recover without duplicates | Required before implementation gate |

### 2.2 `user_roles`

**Purpose:** server-managed role grants: `SUPER_ADMIN`, `TRAINEE`, `MENTOR`.

| Area | Proposed contract | Gate |
|---|---|---|
| Identity | UUID primary key; `user_id` references `profiles(id)`; role constrained to the three accepted values | Final FK actions and exact type/check syntax remain open |
| Active-grant uniqueness | At most one active grant per `(user_id, role)`; candidate partial unique index where `revoked_at IS NULL` | Migration review |
| Platform Super Admin | One active Super Admin platform-wide; prevent concurrent second grant and prevent ordinary revocation of the last active Super Admin | Locking/constraint strategy not finalized |
| Actor fields | Grant/revoke actor and timestamps are trusted server values; role writes are never client-direct | Exact audit actor/FK behavior remains open |
| Bootstrap/recovery | Initial grant is a separate restricted operation; emergency recovery follows L-22/L-29/L-41 | Production runbook must name operators, evidence, custody, approvals/exceptions, and review deadline |
| RLS/grants | No ordinary user role-table writes or self-granting; role reads only as required by trusted authorization design | Exact policy/function boundary remains open |
| Atomicity | Role grant/revoke + required audit event in one transaction | Required test: audit failure rolls back role change |

#### Platform-wide Super Admin concurrency guard

**Recommended design proposal:** keep `user_roles` as the role-grant history and enforce at most one active platform-wide Super Admin with a partial unique index on a constant expression:

```sql
CREATE UNIQUE INDEX one_active_super_admin_platform
ON public.user_roles ((role))
WHERE role = 'SUPER_ADMIN' AND revoked_at IS NULL;
```

This is a candidate predicate, not approved migration SQL. The constant-expression uniqueness rule prevents two active Super Admin rows even if two grant requests race. It does not, by itself, prevent revocation of the last active Super Admin.

All Super Admin grant, revoke, and recovery operations must therefore use one trusted transaction boundary that acquires the same transaction-scoped serialization lock before checking or changing the active Super Admin set. A revoke must fail if it would leave zero active Super Admins, except through the separately documented L-41 emergency recovery procedure. The exact lock primitive/key, lock ordering, recovery exception, and audit event contract must be reviewed and tested together. Never implement a check-then-write sequence without serialization.
### 2.3 `pending_enrollments`

**Purpose:** one pending invitation/enrollment per normalized email across all templates.

| Area | Proposed contract | Gate |
|---|---|---|
| Identity/scope | UUID primary key; `normalized_email TEXT NOT NULL`; `logbook_template_id UUID NOT NULL`; status constrained to `PENDING/ACTIVATED/REVOKED/EXPIRED/CANCELLED` | Final FKs/checks and normalization rule remain open |
| Lifecycle metadata | Created/updated timestamps, creator, activating profile/time, cancellation time | Define consistency checks for each status |
| Uniqueness | At most one `PENDING` row per normalized email; candidate partial unique index on `normalized_email WHERE status='PENDING'` | Migration review |
| Same-scope request | Reuse eligible pending enrollment for same normalized email + selected template/scope | Must be concurrency-safe |
| Different-scope request | Atomically cancel old pending enrollment, revoke old unused code(s), create replacement enrollment/code, and audit | Must serialize by normalized email; no mutation of old scope |
| Activated enrollment | Never reuse/cancel an activated enrollment to create a duplicate assignment | Enforce via transaction logic and assignment uniqueness |
| RLS/write path | Admin-only trusted invitation workflow; no client-direct writes | Exact grants/RLS/RPC execution boundary remains open |

### 2.4 `activation_codes`

**Purpose:** single-use, hash-only activation credentials with 24-hour validity.

| Area | Proposed contract | Gate |
|---|---|---|
| Identity | UUID primary key; FK to pending enrollment; unique `code_hash`; expiry and lifecycle timestamps | Final FK actions and check constraints remain open |
| Secret handling | Store only secure hash; plaintext returned once to authorized Super Admin after commit; never persist or log plaintext | Hash algorithm/entropy and rate limits still need security review |
| Expiry | `expires_at` is 24 hours after trusted issuance; always check expiry at redemption | Do not rely on a time-dependent index predicate |
| Uniqueness | At most one code with `used_at IS NULL AND revoked_at IS NULL` per enrollment; candidate partial unique index on enrollment ID | Before replacement, explicitly revoke expired-but-unused codes |
| Replacement | Revoke previous unused code before inserting replacement in same transaction | Any failure rolls back both changes |
| Redemption | Code, enrollment, email verification/match, template eligibility, profile readiness, assignment uniqueness, and audit checked atomically | See Activation API Contract; exact RPC remains open |
| Access | No trainee/mentor access to hashes; no browser direct write | Explicit grants and RLS review required |

### 2.5 `trainee_assignments`

**Purpose:** current and historical links between a trainee and a specific template version.

| Area | Proposed contract | Gate |
|---|---|---|
| Identity/scope | UUID primary key; profile FK; template FK; status `ACTIVE/SUSPENDED/COMPLETED`; `created_from_pending_enrollment_id` nullable FK | Exact FK and delete behavior remain open |
| Active uniqueness | At most one `ACTIVE` assignment per profile; candidate partial unique index on `profile_id WHERE status='ACTIVE'` | Required database final defense |
| Source-enrollment uniqueness | At most one assignment per non-null source enrollment; candidate partial unique index on `created_from_pending_enrollment_id WHERE ... IS NOT NULL` | Required to prevent duplicate assignment on retries |
| Template eligibility | New assignment requires template `PUBLISHED` and `is_assignable=TRUE` | Check in trusted transaction; database lifecycle constraints reviewed separately |
| History | Historical assignments retain original template identity; no automatic rewrite or migration of historical entries | Accepted policy |
| Transition | Suspend prior ACTIVE + activate destination + transition record + audit atomically | Transition RPC detailed design is deferred; must be completed before that feature is implemented |
| RLS/write path | Trainee reads own assignments; sensitive creation/status changes via trusted workflow | Exact policy/grants remain open |

## 3. Candidate uniqueness predicates for migration review

These snippets state intended predicates only; they are not approved or applied SQL.

```sql
CREATE UNIQUE INDEX one_pending_enrollment_per_normalized_email
ON public.pending_enrollments (normalized_email)
WHERE status = 'PENDING';

CREATE UNIQUE INDEX one_usable_activation_code_per_enrollment
ON public.activation_codes (pending_enrollment_id)
WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX one_assignment_per_source_enrollment
ON public.trainee_assignments (created_from_pending_enrollment_id)
WHERE created_from_pending_enrollment_id IS NOT NULL;

CREATE UNIQUE INDEX one_active_assignment_per_profile
ON public.trainee_assignments (profile_id)
WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX one_active_role_per_user_role
ON public.user_roles (user_id, role)
WHERE revoked_at IS NULL;
```

The one-platform-wide-Super-Admin invariant needs its own concurrency-safe design; the per-user role index above does not enforce it.

## 3.1 Trusted Vercel-to-PostgreSQL privilege boundary

**Recommended direction for review:** do not assume that `SECURITY INVOKER` alone makes an RPC least-privileged. Its effective access is that of the database role executing it; a Supabase service-role credential is privileged and bypasses RLS.

Before implementation, choose and document the actual backend connection model:
- Preferred if supported and operationally viable: a dedicated server-only PostgreSQL role for the Vercel API, with no `BYPASSRLS`, minimal table privileges, and explicit execute grants for reviewed RPCs; keep the Supabase service-role key out of the ordinary application data path.
- If the deployment instead uses the Supabase service-role client for a protected operation, treat the API's server-side authorization checks as mandatory because RLS is not the effective boundary for that role; limit this client to server-only code and tightly scope the callable operations. Do not claim that invoker rights restore RLS protection for a bypass-RLS role.

In either case, verify the real Supabase/Vercel connection and pooling options, grants, RLS behavior, transaction support, and actor propagation in an isolated test project before choosing final RPC signatures. A privileged function must not infer the actor from an untrusted argument. Every protected operation must bind the supplied profile ID to the verified session-derived actor in the trusted API boundary, and record that actor in the audit event.
## 4. Activation transaction contract

The trusted backend verifies session state and email verification, derives the profile UUID, and computes the code hash. The database transaction must then:

1. Lock/serialize the code and enrollment in a documented stable order.
2. Confirm the profile exists; if profile provisioning is incomplete, fail retryably without consuming the code.
3. Validate the code's use/revocation/expiry state, enrollment status, normalized verified-email match, and template lifecycle/eligibility.
4. If the code was already consumed, return the prior result only to the same recorded activating profile when the source-linked assignment exists; otherwise fail safely.
5. Serialize the trainee active-assignment invariant and rely on unique constraints as final defense.
6. Consume the code, activate the enrollment, record activating profile/time, create one source-linked assignment, and insert required audit events in the same transaction.
7. Commit before reporting success. Any required write/audit failure rolls back the full operation.

Exact RPC signature, lock primitive/order, isolation level, grants, and RLS behavior must be reviewed against the actual Supabase connection/role used by the Vercel API. Do not assume a service-role connection and `SECURITY INVOKER` provide the same privilege boundary as a user-session connection.

## 5. Minimum test gate for this slice

- Concurrent invitations for same normalized email never leave two pending enrollments.
- Same-scope invitation reuses enrollment without creating duplicate pending rows.
- Different-scope replacement leaves one pending enrollment and revokes the old unused code.
- Expired unused code is revoked before replacement and cannot be redeemed.
- Concurrent redemption of one code yields at most one first-time activation.
- Retry after committed activation returns the same result only to the same authenticated profile.
- A different profile cannot reuse a consumed code or learn its owner.
- One source enrollment cannot create two assignments.
- A trainee cannot obtain two ACTIVE assignments, including under concurrent requests.
- Unverified/mismatched email, missing profile, ineligible template, or existing conflicting active assignment does not consume a valid code.
- Required audit failure rolls back all protected state changes.
- Role spoofing/self-granting is denied; second active Super Admin and revocation of the last active Super Admin are prevented.
- RLS and explicit grants prevent unauthorized reads/writes to profiles, roles, code hashes, enrollments, and assignments.
- Logs and responses do not expose plaintext code, code hash, session token, or service-role secret.

Tests must run against an actual isolated local/test PostgreSQL or Supabase environment. No tests are claimed as run.

## 6. Decisions intentionally not frozen here

- Exact email normalization algorithm and secure code generation/hash construction.
- Concrete backend DB credential/session propagation and RPC execute grants.
- Exact FK delete actions, status/metadata check constraints, timestamp trigger strategy, and RLS policy SQL.
- Exact lock primitive/isolation strategy and Super Admin last-admin concurrency guard.
- Activation HTTP route/status mapping, rate-limit thresholds, alerting, and delivery beyond one-time admin display.
- Production retention periods and account deletion/anonymization/export implementation.

These are explicit review items, not implicit approvals. No migration should be created until the applicable items are resolved and tested.
