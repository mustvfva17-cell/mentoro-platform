# MENTORO Platform — Physical Schema & RLS Contract

**Status:** Consolidated design draft — pending final review and approval  
**Phase:** Architecture and Data Model  
**Implementation status:** Documentation only. No migration, RLS policy, function, test, or deployment is claimed.  
**Companion documents:** `ARCHITECTURE.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/DATA_MODEL.md`, `docs/decisions/README.md`

## 1. Purpose

This contract translates the conceptual data model into a proposed PostgreSQL/Supabase schema and security boundary for the three initial specialties: General Surgery, Neurology, and Anaesthesia & Critical Care.

Existing specialty logbook projects remain reference sources only, outside this repository, and are not runtime dependencies.

## 2. Accepted decisions this contract enforces

- One active trainee assignment maximum platform-wide.
- Assignment switch suspends the old assignment and activates the new assignment atomically.
- Historical records remain linked to original assignment and template version.
- Drafts are trainee-editable; submitted records require documented correction workflow.
- Only administration may approve/reject correction requests and authorize their application.
- Applied corrections preserve complete before/after state and all target/context/procedure associations.
- L-23: one open correction request per entry; expected-revision checking; trainee withdrawal before decision; stale requests blocked for administrative review; correction application is atomic.
- Mentor access is limited to explicitly assigned trainees; mentor scope is trainee-wide.
- Initial release uses one platform-wide Super Admin.
- Administrators choose per trainee whether to keep the current template version or transition.
- Activation codes are single-use, hash-only, revocable, replaceable, and expire after 24 hours.
- Activation requires verified email matching the normalized pending-enrollment email.
- An eligible pending enrollment for the same normalized email and selected template/scope is reused; replacement code invalidates the old unused code.
- Specialty-specific payload is JSONB validated in a trusted backend against the exact database-backed schema definition linked to the entry and selected by template version and log type; published definitions are immutable.
- All three specialties are supported in the first release.
- No patient-identifying information in log entries.
- Exposure records are not competence/certification claims.
- Authorization is enforced server-side and in database/RLS controls where applicable; client-supplied IDs/roles are not authorization.
- No Supabase service-role secret in frontend code.
- Development/test and production are separated; no destructive production reset.

## 3. Canonical lifecycle vocabulary

- Template: `DRAFT`, `PUBLISHED`, `ARCHIVED`.
- Assignment: `ACTIVE`, `SUSPENDED`, `COMPLETED`.
- Log entry: `DRAFT`, `SUBMITTED`.
- Mentor assignment: `ACTIVE`, `ENDED`, `REVOKED`.
- Pending enrollment: `PENDING`, `ACTIVATED`, `REVOKED`, `EXPIRED`, `CANCELLED`.
- Correction request: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `APPLIED`.

Template lifecycle status and assignment eligibility are separate; L-21 defines the accepted `is_assignable` rules. Archived template/reference definitions remain interpretable for history.

## 4. Proposed physical schema

All primary keys are proposed UUIDs; event timestamps use `TIMESTAMPTZ`. Exact SQL migration syntax and delete behavior require final review.

### 4.1 `profiles`
Proposed columns: `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT`, `full_name TEXT`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`.

**Accepted identity contract (design-only):**
- `profiles.id` is the same UUID as the corresponding `auth.users.id`; the client cannot choose or change it.
- The trusted Vercel Node.js backend is the selected profile-provisioning path after Supabase Auth registration; a database trigger is not the selected default.
- Provisioning must be idempotent and handle partial failure (Auth account exists but profile creation fails) through a defined retry/reconciliation path. Do not silently create duplicate profiles or report full enrollment success while required provisioning is incomplete.
- Profile updates are limited to explicitly permitted profile fields. A user cannot write identity, role, or administrative fields through a general profile update.
- Account deletion/anonymization remains governed by L-32; the FK delete behavior and retention implementation must be reviewed against that policy before migration.

### 4.2 `user_roles`
Proposed columns: `id UUID PRIMARY KEY`, `user_id UUID NOT NULL REFERENCES profiles(id)`, `role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','TRAINEE','MENTOR'))`, `created_at TIMESTAMPTZ NOT NULL`, `granted_by UUID`, `revoked_at TIMESTAMPTZ NULL`. Final FK/delete behavior and whether the bootstrap grant uses a separately documented null-free mechanism remain migration-design details.

**Accepted role-integrity contract (design-only):**
- Roles are server-managed. Client-supplied role labels and client writes to this table are never authoritative.
- Enforce at most one active grant for each `(user_id, role)` while preserving revoked rows; candidate enforcement is a partial unique index where `revoked_at IS NULL`.
- The initial release has one platform-wide Super Admin. Database-level concurrency-safe protection must prevent granting a second active Super Admin and must prevent ordinary role-management operations from revoking or disabling the last active Super Admin.
- Initial Super Admin bootstrap is a separate, documented, restricted operation—not a general exception that permits users or ordinary application flows to self-grant roles. Emergency recovery follows L-41.
- Role grants and revocations require trusted authorization and corresponding audit events in the same transaction. Audit failure rolls back the role change.
- Exact bootstrap operator/materials, grantor FK behavior, constraint/index implementation, and the last-admin locking strategy remain executable-design/runbook work.

### 4.3 `specialties`
`id`, unique `name`, unique `slug`, `description`, `is_active`, `created_at`. Seed all three required specialties.

### 4.4 `logbook_templates`
`id`, `specialty_id`, `version_label`, `status`, `is_assignable BOOLEAN NOT NULL DEFAULT FALSE`, `created_at`, `published_at`, `published_by`; unique `(specialty_id, version_label)` and `(id, specialty_id)`. Status `DRAFT/PUBLISHED/ARCHIVED`. Published curriculum meaning is immutable; changes require a new version or explicit reviewed transition.

Assignment eligibility is separate from lifecycle status:
- `DRAFT` must have `is_assignable = FALSE`.
- `PUBLISHED` is eligible for new assignments and transition destinations only when `is_assignable = TRUE`.
- `PUBLISHED` with `is_assignable = FALSE` may remain assigned to existing trainees but cannot receive new assignments or transition destinations.
- `ARCHIVED` cannot receive new assignments or transition destinations; retain historical interpretation.
- Changing eligibility does not automatically migrate existing trainees. The Super Admin decides per trainee whether to stay on the current version or transition.

Trusted transactions must check both status and `is_assignable`. Add a database check constraint preventing `DRAFT` or `ARCHIVED` rows from having `is_assignable = TRUE`. Detailed publication, archival, and rollback workflows remain open.

### 4.5 `trainee_assignments`
Proposed columns: `id UUID PRIMARY KEY`, `profile_id UUID NOT NULL`, `logbook_template_id UUID NOT NULL`, `status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','COMPLETED'))`, `enrolled_at TIMESTAMPTZ NOT NULL`, `ended_at TIMESTAMPTZ NULL`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `created_from_pending_enrollment_id UUID NULL`.

Required invariant: at most one active assignment per profile platform-wide. Candidate enforcement:

```sql
CREATE UNIQUE INDEX one_active_assignment_per_profile
ON public.trainee_assignments (profile_id)
WHERE status = 'ACTIVE';
```

Add a composite unique key on `(id, logbook_template_id)` to support entry/template consistency. The pending-enrollment FK is added after both tables exist; its uniqueness/cardinality must prevent one activation enrollment from creating multiple assignments. Trusted activation verifies the destination template is `PUBLISHED` and `is_assignable = TRUE`. Assignment creation and enrollment/code state changes commit atomically. Any later assignment switch must preserve L-03/L-21 and be atomic; detailed transition execution is deferred until needed.

### 4.6 `mentor_assignments`
`id`, `mentor_profile_id`, `trainee_profile_id`, `status`, `assigned_by`, `assigned_at`, `ended_at`, `created_at`. Status `ACTIVE/ENDED/REVOKED`. Relationship is trainee-wide, not assignment-scoped. Only the Super Admin manages these relationships in the initial release. A mentor may access permitted records for the trainee while the relationship is eligible.

### 4.7 `pending_enrollments`
Proposed columns: `id UUID PRIMARY KEY`, `normalized_email TEXT NOT NULL`, `logbook_template_id UUID NOT NULL`, `status TEXT NOT NULL`, `created_by UUID`, `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`, `activated_by_profile_id UUID NULL`, `activated_at TIMESTAMPTZ NULL`, `cancelled_at TIMESTAMPTZ NULL`. Status is restricted to `PENDING/ACTIVATED/REVOKED/EXPIRED/CANCELLED`; exact FK actions and check constraints are migration-design work.

**Core enrollment contract (design-only):**
- Trusted backend normalizes the invitation email consistently and activation requires the authenticated Supabase email to be verified and match that normalized value.
- At most one row with status `PENDING` may exist per normalized email across all templates/specialties. A partial unique index on `normalized_email` for `status = 'PENDING'` is the candidate database enforcement.
- For the same normalized email and same selected template/scope, reuse the eligible pending enrollment rather than creating a duplicate.
- For a different selected template/scope, serialize the request by normalized email, cancel the prior pending enrollment, revoke its still-unused activation code(s), create the replacement enrollment/code, and write audit events in one transaction. Do not mutate the previous enrollment's scope.
- An activated enrollment is never reused or cancelled to create a duplicate assignment. Failed replacement must roll back all changes.
- Exact email normalization rules, per-email lock mechanism, FK behavior, and the final status/check/index design remain migration-review items.`id`, `normalized_email`, `logbook_template_id`, `status`, `created_by`, `created_at`, `updated_at`, `activated_by_profile_id`, `activated_at`, `cancelled_at`. Status `PENDING/ACTIVATED/REVOKED/EXPIRED/CANCELLED`.

Trusted logic normalizes email and requires exact normalized match to the authenticated, verified email. Under L-31, enforce at most one `PENDING` enrollment per normalized email across all templates/specialties. Reuse an eligible pending enrollment for the same email and template/scope. For a different scope, atomically cancel the existing pending enrollment, revoke/invalidate its unused activation codes, create the replacement enrollment and code as applicable, and write the audit event; do not mutate the prior enrollment's scope. Never cancel/reuse an activated enrollment through this workflow. Concurrent create/reuse/replacement attempts must be serialized safely. Exact database constraint/index design remains migration work.

### 4.8 `activation_codes`
Proposed columns: `id UUID PRIMARY KEY`, `pending_enrollment_id UUID NOT NULL`, `code_hash TEXT NOT NULL UNIQUE`, `created_by UUID`, `created_at TIMESTAMPTZ NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `used_at TIMESTAMPTZ NULL`, `used_by UUID NULL`, `revoked_at TIMESTAMPTZ NULL`, `replaced_by_code_id UUID NULL`.

**Core activation-code contract (design-only):**
- Store only a secure one-way hash; the plaintext code must not be persisted in database rows, audit metadata, logs, or repository files.
- Code issuance sets `expires_at` to 24 hours after issue using trusted server logic. Validation also checks that the code is not expired, used, or revoked.
- At most one unconsumed, unrevoked code may exist per pending enrollment. A candidate partial unique index covers `pending_enrollment_id` where `used_at IS NULL AND revoked_at IS NULL`. Before replacement/issuance, any expired unused code must be revoked so it does not block the invariant; expiry is still checked at use time.
- Replacing a code revokes the prior unused code before creating its replacement. The previous code must immediately become unusable.
- Activation must verify code, verified-email match, enrollment state, template eligibility, and absence of an existing active assignment; then consume the code, activate the enrollment, create the assignment, and write required audit events atomically.
- Failed validation must not consume a valid code or leave partial enrollment/assignment state. Concurrent attempts to redeem the same code must result in at most one successful activation.
- Exact hashing algorithm/entropy, API rate limits, response/error contracts, lock strategy, and FK actions remain detailed implementation design; never return secrets in errors or logs.`id`, `pending_enrollment_id`, `code_hash UNIQUE`, `created_by`, `created_at`, `expires_at NOT NULL`, `used_at`, `used_by`, `revoked_at`, `replaced_by_code_id`. Store only a secure hash. Trusted logic sets expiry to exactly 24 hours after issuance. Replacement invalidates the previous unused code and creates a new 24-hour validity period. Validation, consumption, enrollment activation, assignment creation, and audit write are atomic; failed verification does not consume a valid code.

### 4.9 `template_transitions`
`id`, `profile_id`, `from_assignment_id`, `to_assignment_id`, `from_template_id`, `to_template_id`, `initiated_by`, `transitioned_at`, `reason`, `mapping_summary JSONB`, `status`. Per L-38, this table records only transitions that actually completed successfully; the successful transition row, assignment changes, and associated audit event commit atomically. Failed/rejected attempts are recorded in `audit_logs` only, not as successful transition rows. Historical entries are not reassigned.

### 4.10 `roadmap_targets`
`id`, `logbook_template_id`, `target_key`, `track`, `domain`, `module`, `target_name`, `priority`, `expected_frequency`, `minimum_depth`, `is_active`, `created_at`. Unique `(logbook_template_id, target_key)` and `(id, logbook_template_id)`. Stable target keys, controlled vocabularies, and cross-version mapping remain open.

### 4.11 `contexts` and `procedures`
Each has `id`, `logbook_template_id`, `category`, `name`, `is_active`, `created_at`, plus version-scoped uniqueness and composite key `(id, logbook_template_id)`. Version-specific catalogs are the current proposal.

### 4.12 `log_entry_schema_registry` (accepted concept; physical details open)
Database-backed registry of versioned schema definitions. Candidate fields: `id`, `logbook_template_id`, `log_type`, `schema_version`, `schema_definition` (exact representation to be finalized), `state`, `created_at`, `published_at`, `created_by`, and audit metadata as needed. Each `log_entries` row must reference the exact schema definition through a stable FK; validation must verify that it matches the entry's template version and log type. Published definitions are immutable; any change requires a new version. Schema creation, publication, and state changes must use trusted, restricted workflows and sensitive administrative actions must be audited. JSON Schema Draft 2020-12 is the schema format and Ajv 8 is the validation library under L-25. Exact storage representation and specific backend technology/deployment boundary remain open; L-26 establishes the central trusted validation requirement and rollback principles.

### 4.13 `log_entries`
`id`, `trainee_assignment_id`, `logbook_template_id`, `log_type`, `status`, `occurred_at`, `submitted_at`, `reflection_notes`, `payload JSONB NOT NULL DEFAULT '{}'::jsonb`, `schema_registry_id` FK to the exact immutable schema definition, `created_at`, `updated_at`, `revision_number`.

Status `DRAFT/SUBMITTED`. Shared fields use typed columns; specialty-specific fields use JSONB. Trusted backend validates payload against the exact immutable schema definition referenced by `schema_registry_id` and verifies template-version/log-type compatibility. Never resolve historical entries against the latest schema. Composite FK `(trainee_assignment_id, logbook_template_id)` references the matching assignment/template pair. `UNIQUE (id, logbook_template_id)` supports composite association FKs. Do not store patient-identifying information.

### 4.14 Association tables
`log_entry_targets`, `log_entry_contexts`, `log_entry_procedures` each include `log_entry_id`, referenced item ID, and `logbook_template_id`. Composite FKs must ensure the entry and reference item belong to the same template version. `log_entry_targets` also includes `exposure_depth` and optional notes. Final vocabulary and specialty rules must be source-reviewed.

### 4.15 `mentor_reviews`
`id`, `log_entry_id`, `mentor_profile_id`, `status`, `comments`, `reviewed_at`, `created_at`. Mentor identity comes from authenticated context. Trusted checks confirm the record's trainee has an eligible mentor relationship. Reviews are append-only. Status vocabulary and effect on entry status remain open.

### 4.16 `log_entry_correction_requests`
`id`, `log_entry_id`, `requested_by`, `requested_at`, `reason NOT NULL`, `proposed_changes JSONB NOT NULL`, `expected_revision_number NOT NULL` (or an equivalent immutable revision reference), `status`, `reviewed_by`, `reviewed_at`, `review_decision_reason`, `withdrawn_at`, `applied_revision_id`. Requester identity and timestamps are system-derived. `review_decision_reason` is mandatory for `REJECTED` decisions and is included in the audit trail. Status `PENDING/APPROVED/REJECTED/CANCELLED/APPLIED`. `proposed_changes` contains one complete correction operation, including all affected scalar fields and target/context/procedure associations.

L-23/L-30 rules: submitting the request does not modify the entry; only the Super Admin may decide approval/rejection and authorize application; the trainee may withdraw only a still-`PENDING` request before decision, which sets `CANCELLED`, is audited, and does not change the entry. Submitted request content and proposed values are immutable; lifecycle metadata may change only through the authorized workflow. If the trainee needs to change a proposal, they must withdraw the pending request and submit a new request. Attachments are excluded from the initial release. The administrator must approve the proposal as-is or reject it; administrator editing of proposed values is prohibited. A rejection requires a non-empty `review_decision_reason`. Only one open request per entry is allowed. Define the exact open-state predicate and enforce it concurrency-safely at database level in the migration. The request captures the expected current revision. If that revision is stale at application time, block application and refer the request for administrative review; do not automatically rebase. Approval and application are distinct. A successful apply transaction verifies the expected revision and atomically updates entry fields and associations, appends the full before/after revision, updates request state to `APPLIED`, and writes the audit event. Failure rolls back all changes.

### 4.17 `log_entry_revisions`
`id`, `log_entry_id`, `revision_number`, `corrected_by`, `corrected_at`, `reason NOT NULL`, `before_snapshot JSONB NOT NULL`, `after_snapshot JSONB NOT NULL`, `correction_request_id`, `created_at`. Unique `(log_entry_id, revision_number)`. Snapshots include every scalar field and all target/context/procedure associations. Compare expected revision to current revision; reject stale changes. Entry, associations, revision, request status, and audit event update atomically. Ordinary clients cannot update/delete revisions.

### 4.18 `audit_logs`
`id`, `actor_profile_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, `metadata JSONB`, `request_id`. Trusted workflows write audit events, including failed/rejected assignment-transition attempts. Where applicable, events capture trusted actor identity, timestamp, operation type, target assignment, outcome, and failure/rejection reason, minimizing sensitive data. No plaintext activation codes, secrets, or patient-identifying data in metadata. Taxonomy, retention, export, and audit-write failure handling remain open.

## 5. Integrity constraints and indexes

Required:
- Partial unique index for one active assignment per profile.
- Composite foreign keys to enforce entry/assignment/template compatibility.
- Composite foreign keys for entry-target/context/procedure template compatibility.
- Unique code hash and mandatory code expiry.
- Unique `(log_entry_id, revision_number)`.
- Active role grant uniqueness per `(user_id, role)`; candidate partial unique index predicate is `revoked_at IS NULL`.
- Enforce at most one active `SUPER_ADMIN` grant platform-wide and prevent ordinary operations from removing the last active Super Admin. This must be concurrency-safe, not an application-only pre-check.
- Profile provisioning uses the trusted Vercel backend, must be idempotent, and must define reconciliation/retry for Auth/profile partial failure.
- Role grant/revoke changes and required audit events commit atomically; audit-write failure rolls back the role change.
- Mentor assignment uniqueness/lifecycle constraints after final review.
- Enrollment reuse serialized with transaction/lock and appropriate uniqueness constraint where compatible with the open cross-template policy.
- Correction requests: enforce at most one `PENDING` decision request per entry and prohibit a new `PENDING` request while an `APPROVED` request awaits application. A partial unique index covering both `PENDING` and `APPROVED` states is a candidate enforcement mechanism; finalize the exact index/predicate with the schema and state-transition design. `REJECTED`, `CANCELLED`, and `APPLIED` do not block a new request.
- Required audit events for a sensitive write must be inserted in the same transaction as that write; audit insertion failure rolls back the complete transaction.
- RPC functions use `SECURITY INVOKER` by default. Any `SECURITY DEFINER` exception requires documented necessity and explicit review of ownership, safe `search_path`, grants, and RLS interaction.
- Only sensitive/multi-step writes are mandated through trusted API/RPC workflows. Any allowed simple direct write must have an explicit reviewed GRANTS/RLS/constraint contract; unclassified direct writes are not implicitly allowed.
- All multi-row operations use trusted atomic transactions.
- Foreign keys/indexes are reviewed for query performance; PostgreSQL does not automatically index every referencing FK.

Suggested query indexes: assignments by profile/date; entries by assignment/date; association rows by referenced item; revisions by entry/revision; correction requests by entry/status; pending enrollments by normalized email/status; activation codes by enrollment/expiry; mentor assignments by mentor/trainee/status.

## Current implementation scope and deferred contracts

**Prioritize now:** `pending_enrollments`, `activation_codes`, and `trainee_assignments`, because they are required for the first trainee activation path and enforce single-use invitations, one active assignment, and atomic enrollment.

**Defer for now (policy remains in force):** detailed executable column/index/RLS/RPC contracts for `mentor_assignments` and `template_transitions`. Their already accepted authorization, history, and atomicity rules are not cancelled; only their detailed implementation design is deferred until mentor onboarding or assignment switching is in the immediate build scope. Do not implement those workflows through an ad-hoc path in the meantime.

## 6. Trusted transactional workflows

### Activation — MVP critical path
Authenticate through Supabase Auth; require verified email; normalize and match the enrollment email; serialize access to the normalized email, enrollment, and code; verify that the enrollment is `PENDING`, the code is unexpired/unused/unrevoked, the template is `PUBLISHED` and assignable, and the user has no active assignment. Then atomically consume the code, activate the enrollment, create the assignment, and write required audit events. Unique constraints remain the final defense against concurrent duplicate activation or active assignments. Audit failure rolls back the whole operation. Failed checks must not consume a valid code or create partial state.

### Enrollment creation/replacement — MVP critical path
Under a concurrency-safe per-normalized-email serialization mechanism, inspect the current pending enrollment. Reuse it when the selected scope/template matches. If scope differs, cancel it and revoke its unused codes, create the replacement enrollment and code, and write required audit events in one transaction. Do not cancel an activated enrollment. If any step fails, roll back the complete replacement.

### Assignment/template transition
Authorized Super Admin selects keep-current or transition. If transition: validate destination template, create/activate destination assignment, suspend prior active assignment, write transition and audit records in one transaction. Roll back all on failure.

### Draft and submission
Trainee can create/edit draft under own eligible active assignment. Validate common fields, JSONB schema/version, references, and privacy rules. Submission sets `SUBMITTED` and `submitted_at`. Trainee cannot directly update a submitted entry.

### Mentor review
Authenticate mentor, check active trainee-wide mentor relationship, verify record belongs to assigned trainee, then append a review event. Mentor cannot approve correction requests.

### Correction (L-04, L-07, L-17, L-23, L-30; executable enforcement design)
The trainee submits a complete proposed correction with mandatory reason and expected current revision; submission does not mutate the entry. `PENDING` is the only state awaiting an administrative decision. Enforce at most one `PENDING` request per entry. If a request is `APPROVED` but not yet applied, it blocks creation of another request even though it is no longer awaiting a decision. A new request is permitted only after the prior request is `REJECTED`, `CANCELLED`, or `APPLIED`. A partial unique index spanning `PENDING` and `APPROVED` is a candidate way to enforce the no-overlap invariant; finalize its exact predicate and state-transition enforcement in the migration design. Trainee withdrawal is allowed only before decision and is audited. Only administration can approve/reject and authorize application. Approval alone does not apply the change. At apply time, compare expected revision with current revision; if stale, block application and refer to administration for review without automatic rebasing. Otherwise snapshot complete before/after state, including associations, update current row and associations, append revision, update request status to `APPLIED`, and write the required audit event in the same transaction. Any failure, including audit-write failure, rolls back all changes. This is the accepted contract; no index, RPC, or migration has been implemented yet.

## 7. RLS and grants contract

Enable RLS on all private tables exposed through Supabase APIs and define SQL grants alongside policies. This section describes intended access, not implemented policies.

### Trainee
- Read permitted own profile/assignment history and reference data for assigned versions.
- Create/read own records under eligible active assignment.
- Edit drafts and submit.
- Read allowed own review/correction information.
- No other-trainee access, role writes, activation hash access, direct submitted-entry edits, or revision/audit mutation.

### Mentor
- Read permitted records only for trainees with an eligible active mentor relationship; scope is trainee-wide.
- Create review events within that scope.
- No unrelated trainee browsing, role/mentor-assignment management, direct entry edits, correction approval, or revision/audit mutation.

### Super Admin
- One platform-wide Super Admin in initial release.
- Trusted audited workflows manage pending enrollments/codes, assignments/transitions, mentor relationships, template publication/archival, and correction approval/application.
- No frontend-controlled role elevation.
- Recovery approach is Supabase Auth plus a secured emergency procedure (L-22). Exact verification, authorized operator(s), recovery-material handling, and post-recovery review remain open.

### Security implementation requirements
- Derive actor identity from authenticated Supabase context.
- Never trust client-provided role, actor, owner, or assignment identifiers.
- `SECURITY INVOKER` is the default for RPC functions. Any `SECURITY DEFINER` exception must be justified and reviewed for owner privileges, fixed safe `search_path`, narrow explicit execute grants, and RLS interaction.
- Avoid recursive RLS helper policies.
- Service-role secret remains server-side and is never exposed to browser code.
- Ordinary clients cannot update/delete revision and audit history.
- Activation hashes are not readable by trainees or mentors.
- For a sensitive write requiring an audit event, write the event in the same transaction. Audit failure must roll back the protected state change; do not report success without the required event.
- Direct writes are limited to explicitly approved simple operations with documented GRANTS, RLS, and database constraints. Sensitive or multi-step operations must use the trusted API and reviewed atomic database boundary.

## 8. Privacy and historical integrity

- No patient-identifying information in logs or audit metadata.
- Minimize free-text fields and display privacy guidance.
- Archive/deactivate referenced items instead of deleting historical evidence.
- Preserve assignment/template identity in history.
- Exposure does not establish competence or certification.
- Account deletion, retention, and historical integrity principles are accepted by L-32; numeric retention periods, legal exceptions, detailed export/backup handling, and final technical mechanisms remain open.

## 8.1 Super Admin recovery (L-22)

Recovery uses Supabase Auth plus a secured emergency procedure. It must not create a parallel identity system or rely on a frontend-only flag. The procedure must be authenticated, narrowly scoped, and auditable. Before production, specify verification, authorized operator(s), handling/storage of emergency recovery material, approval requirements, audit events, and post-recovery review. Any temporary elevation must be removed or reviewed after recovery. This operational procedure does not imply a new database table.

## 9. Required tests before production

1. One active assignment maximum, including concurrent attempts.
2. Atomic transition and rollback.
3. Mismatched assignment/template rejected.
4. Cross-template associations rejected.
5. Trainee cannot read another trainee's records.
6. Mentor cannot read an unassigned trainee and can read permitted records for assigned trainee across assignments.
7. Mentor cannot approve corrections.
8. Users cannot self-grant roles or spoof owner/actor IDs.
9. Activation requires verified normalized email match.
10. Expired/revoked/used/replaced code rejected.
11. Failed activation does not consume valid code.
12. Concurrent activation cannot use one code twice.
13. Pending enrollment reuse avoids duplicates under concurrent requests.
14. Replacement invalidates prior unused code and resets 24-hour expiry.
15. Log creation and associations are atomic.
16. Trainee can edit draft but cannot directly edit submitted record.
17. Only Super Admin can approve/reject/apply correction in initial release.
18. Correction snapshot includes all scalar fields and associations.
19. Stale concurrent corrections are rejected.
20. Entry, associations, revision, request status, and audit event update atomically.
21. Ordinary clients cannot mutate/delete revision/audit history.
22. Published/archived template history remains interpretable.
23. Each entry references an exact database-backed schema definition; backend validation is version-specific and deterministic.
24. Published schema definitions cannot be silently modified; historical entries retain their original schema reference.
24. Privacy constraints and user-facing guidance are verified.

Tests must run against an actual local/test PostgreSQL or Supabase environment. Writing tests is not evidence that they passed.

## 10. Open decisions — not approved

2. Super Admin emergency recovery operational policy — resolved by L-22, L-29, and L-41. Environment-specific operator names, verification evidence, recovery-material custody, emergency contacts, and review deadline must be populated in the production runbook before launch.
3. Correction request initiation details — resolved by L-30; remaining schema/migration and concurrency details remain open.
4. Exact schema storage representation, cross-version migration procedures, historical-entry editing policy, and detailed operational publication/rollback runbook.
5. Pending-enrollment uniqueness across templates — resolved by L-31 at policy level; exact concurrency-safe database enforcement remains migration-design work.
6. Account deletion, anonymization, retention, export, and legal policies — resolved at principles level by L-32; numeric retention periods, legal exceptions, export/backup handling, and technical mechanisms remain open.
7. Stable target keys and cross-version mapping.
8. Audit taxonomy, retention, and export — resolved at principles level by L-34; exact event catalogue, numeric retention periods, export format/permissions, backup handling, and operational safeguards remain open.
9. Stable target identity and cross-version mapping — resolved by L-35: stable target identifiers and explicit version mappings; key format, approval authority, multi-target representation, reporting calculations, and conflict handling remain open.
10. Historical dashboards for inactive targets and archived assignments — resolved by L-36: current progress is scoped to the active assignment, with a separate historical archive preserving original assignment/template links. Detailed filters, historical metrics, visual comparisons, and unavailable-data handling remain open.
11. Mentor review workflow and statuses — resolved by L-37: independent review lifecycle (`NOT_REVIEWED`, `IN_REVIEW`, `FEEDBACK_PROVIDED`, `REVIEWED`) that does not change entry status or constitute formal approval. Review granularity, reopening, trainee responses, feedback resolution, and repeated-cycle history remain open.
9. Historical display of inactive targets and archived assignments.
10. Mentor-review statuses and effect on entry status.
11. Failed-transition audit storage.
12. Source-approved fields and validation rules per specialty/log type.
13. Detailed operational checklist and runbook for publication, archival, rollback, and template eligibility (core policy is accepted in L-21 and L-28).
14. Expired activation-code row retention/deletion.

## 11. Approval gates

Before migrations: confirm consistency across the decisions register, data model, and this contract; finalize SQL types, constraints, composite FKs, indexes, grants, RLS, and trusted transaction functions; specify the concrete trusted backend/validation boundary; finalize concurrency-safe correction-request and enrollment/activation enforcement; prepare reviewed, version-controlled migrations and seeds; and execute tests against a real local/test database. Review rollback and deployment before production.

## Final design review — implementation blockers vs. deferred work (reviewed through L-41)

This review does not supersede accepted decisions. It separates work that must be resolved before the relevant implementation gate from work that can safely wait until the corresponding feature is in scope.

### Blockers before migrations or production writes

1. **Executable database/security design:** define exact SQL types, primary/foreign/composite keys, uniqueness and check constraints, indexes, grants, RLS policies, and trusted transaction functions. Validate that client-controlled identifiers/roles cannot bypass authorization. This is a required implementation-design gate, not a new policy decision.
2. **Trusted write and validation boundary:** ADR-01 selects Vercel Node.js API, Supabase Auth, PostgreSQL RLS/grants, Ajv 8 with JSON Schema Draft 2020-12, and atomic RPC/transaction workflows. The concrete API routing, session propagation, RPC contracts, privilege grants, and executable policies still require review before migrations. Sensitive writes use the trusted path; direct simple writes require explicit approval and a complete GRANTS/RLS/constraint contract.
3. **Correction-request concurrency:** the policy contract is now defined: one `PENDING` request per entry, and no new request while an `APPROVED` request awaits application; `REJECTED`, `CANCELLED`, and `APPLIED` do not block a new request. The exact partial-index predicate/state-transition enforcement, transaction locking, and stale-revision protection remain migration-design blockers.
4. **Enrollment/activation concurrency:** translate L-08/L-10/L-31 into database constraints and trusted atomic workflows so codes cannot be reused and a normalized email cannot acquire conflicting pending enrollments under concurrent requests.
5. **Source-approved specialty schemas before enabling each specialty/log type:** choose authoritative sources, review required/optional fields and constraints, record traceability, and approve final schemas under L-39. Shared platform scaffolding may proceed in parallel, but a specialty/log type must not be treated as ready for use without its approved schema.
6. **Pre-release verification:** implement and execute the security, integrity, concurrency, validation, history, and privacy tests in the Physical Schema/RLS Contract against a real local/test PostgreSQL or Supabase environment. Test definitions alone are not evidence of passing tests.

### Deferred until the corresponding feature or production gate

- Cross-version migration tooling and historical-entry editing beyond preserving immutable historical references; do not implement migration or reinterpretation implicitly.
- Detailed historical-dashboard filters, comparison visuals, and nonessential metrics; the active-assignment scope and historical archive behavior from L-36 remain mandatory.
- Additional mentor-feedback cycles, trainee responses, and reopening rules beyond the accepted L-37 statuses and permissions.
- Exact audit export format, event catalogue refinements, numeric retention periods, and backup-specific handling; required privacy, auditability, and applicable legal review must still be completed before production where relevant.
- Expired activation-code row retention/deletion policy (OD-14): decide and document before production, while preserving the existing single-use, expiry, revocation, and no-secret-logging controls during development.
- Environment-specific Super Admin recovery operator names, verification evidence, material custody details, emergency contacts, and independent-review deadline: populate the runbook before production as required by L-41.
- Operational publication/rollback runbooks and technical recovery/retry/audit-write-failure procedures: complete before enabling the relevant production operations.

### Exit rule

Do not open new policy decisions unless implementation reveals a genuine conflict with an accepted decision or a material security/data-integrity gap. Record non-blocking work as deferred tasks. This review does not itself authorize migrations or claim that any code, database change, or test has been executed.


**Current status: consolidated design draft through L-41. Final policy-level review is complete; migrations remain gated on executable database/security design, concurrency enforcement, and validation-boundary decisions. No migrations are authorized by this status.**


### L-24 schema registry security and historical integrity

- Store schema definitions in the database-backed `log_entry_schema_registry`.
- Every log entry references one stable schema definition compatible with its template version and log type.
- All payload validation runs in trusted backend code; frontend checks are supplementary only.
- Published definitions are immutable; updates require a new schema version.
- New definitions never automatically reinterpret or migrate historical entries. The exact original schema reference is preserved.
- Restrict schema creation, publication, and state changes to trusted workflows; audit sensitive administrative actions.
- Schema format, validation library, cross-version migration, historical-entry editing policy, and detailed publication/rollback remain open and are not approved by L-24.


### L-25 — Schema format and validation contract

- Define specialty-specific payload schemas using JSON Schema Draft 2020-12.
- Validate payloads in a trusted backend using Ajv 8; pin the dependency version and verify runtime compatibility.
- Validate schema definitions before publication and validate payloads server-side before accepting create, update, or submit operations.
- Reject non-conforming payloads by default. Client-side validation is supplementary and never a bypass.
- Authorization, relational integrity, template-transition rules, and database-dependent constraints remain separate controls.
- This decision does not modify published schemas or reinterpret historical records. Historical-entry editing remains open.
- Exact schema storage representation, validation execution boundary, and publication/rollback procedures remain open for detailed design.


## L-26 — Trusted validation and schema publication/rollback (accepted)

### Validation boundary
- All application write paths that create, modify, or submit specialty-specific payloads must pass through a centrally defined trusted backend validation path using Ajv 8 and JSON Schema Draft 2020-12.
- Validate against the exact schema definition selected for the entry's template version and log type. Reject invalid payloads before accepting the corresponding write.
- Frontend validation is supplementary. Alternate write paths must not bypass validation or authorization. RLS and database-dependent integrity constraints remain separate controls.
- The specific backend technology and deployment boundary remain for implementation design review.

### Publication and rollback
- Validate schema definitions before publication. Reject failed validation/publication atomically and preserve previously committed schema state and eligibility configuration.
- Published schema definitions are immutable; changes require a new version. Restrict publication and eligibility changes to trusted workflows and audit sensitive administrative actions.
- An affected published version may be disabled for new assignments or other applicable new uses through an authorized, auditable workflow.
- A prior published version may be selected for new use only after verifying compatibility and eligibility for the relevant template version and log type.
- Rollback must not modify/delete published definitions, rewrite historical schema references, reinterpret historical entries, or automatically migrate existing assignments. Assignment transitions remain subject to accepted transition decisions.
- Exact schema-registry storage representation, cross-version migration, historical-entry editing, and the full operational publication/rollback runbook remain open. L-26 does not authorize migrations or backend implementation by itself.


## L-27 — JSONB storage for schema registry definitions (accepted)

- Add `schema_definition JSONB NOT NULL` to the database-backed `log_entry_schema_registry` as the schema-definition storage representation.
- Original JSON text formatting and key order need not be preserved; a separate original-text copy is not required solely for formatting.
- Validate schema definitions against JSON Schema Draft 2020-12 before publication through the validation process established by L-25/L-26. JSONB does not itself validate the schema.
- Every log entry references the exact registry record applicable to its template version and log type. Published definitions are immutable; changes require a new schema version and registry record.
- Preserve historical schema references; new schema versions do not automatically reinterpret or migrate historical entries.
- Restrict schema creation, publication, and state transitions to trusted workflows and audit sensitive administrative actions. JSONB does not replace authorization, relational integrity, RLS, or payload validation.
- Cross-version migration, historical-entry editing, and the detailed operational publication/rollback runbook remain open. L-27 does not authorize migrations or backend implementation by itself.


## L-28 — Template lifecycle operations (accepted)

- Keep `DRAFT`, `PUBLISHED`, and `ARCHIVED` as template lifecycle states; control assignment eligibility separately through `is_assignable` as defined in L-21.
- Publication requires successful schema validation, completion of applicable publication checks, and documented administrative approval through a restricted trusted workflow. Failure must not leave partially published or partially updated eligibility state.
- Published template-version content is immutable in place; content changes require a new version. Audit sensitive lifecycle actions with actor, timestamp, action, and reason.
- Eligibility and lifecycle changes must not automatically migrate, suspend, replace, or move existing trainee assignments. Transitions remain separate authorized operations under L-03/L-21.
- Rollback disables new use of an affected version and may restore eligibility for a previously published version only after verifying validity, eligibility, and compatibility for the intended use. Rollback must not rewrite versions or history, reinterpret entries, or automatically migrate assignments.
- Archival is terminal for that record. An archived version cannot be reopened or assigned; its data and historical references remain preserved. Reuse of its content requires a new version and applicable publication checks.
- Enforce lifecycle rules through trusted backend/database controls, not frontend filtering alone. Detailed operational runbooks must implement these rules.
- Cross-version migration and historical-entry editing remain open. L-28 does not authorize migrations or backend implementation by itself.


## L-29 — Super Admin emergency recovery procedure (accepted)

- Restrict emergency recovery to pre-authorized operators acting under a documented procedure. Verify requester identity and authority independently of frontend state or user-editable role claims. Supabase Auth remains the authentication mechanism; no parallel identity system or authentication bypass is permitted.
- Require approval by two independently authorized persons whenever operationally available. If the second approver is unavailable and delay risks permanent administrative lockout, permit only a narrowly scoped, documented exception recording the justification, operator, approval limitation, actions, and why normal approval was unavailable.
- The exception does not waive identity verification, authentication, least privilege, or auditing, and requires independent post-recovery review.
- Store recovery materials securely and separately from the application and source repository, with restricted documented access. Grant minimum necessary privileges; revoke or review temporary privileges, credentials, and emergency access promptly after recovery.
- Audit the request, verification outcome, operator, approver or exception rationale, timestamps, actions, and resulting privilege changes. An independent authorized reviewer who did not execute recovery must review and document the outcome, irregularities, and corrective actions.
- Before production, an operational runbook must specify operators, verification evidence, recovery-material handling, emergency contacts, approval/exception steps, and review deadline.
- L-29 does not authorize migrations or backend implementation by itself.


## L-30 — Correction-request details (accepted)

- The request stores the trainee's mandatory reason, complete proposed replacement state including affected associations, and expected current revision. Requester identity and timestamps are derived by trusted logic.
- No request attachments are supported in the initial release.
- Submitted request content and proposed values are immutable; lifecycle metadata may change only through the authorized workflow. The trainee may withdraw only a still-`PENDING` request before an administrative decision; withdrawal sets `CANCELLED`, is audited, and leaves the entry unchanged. A changed proposal requires withdrawal and a new request. L-23's one-open-request-per-entry rule remains in force.
- The Super Admin approves or rejects the proposal as submitted and may not edit its proposed values. A rejection requires a non-empty `review_decision_reason` recorded in the audit trail. The entry is modified only by the approved atomic application workflow.
- The exact open-state predicate and concurrency-safe database enforcement remain migration-design work. L-30 is design-only and does not authorize implementation or migrations.


## L-31 — Pending-enrollment uniqueness (accepted)

- At most one `PENDING` enrollment may exist for a normalized email across all specialties/template versions.
- Reuse a pending enrollment when email and template/scope match. For a different scope, a trusted atomic workflow cancels the old pending enrollment, revokes/invalidates unused activation codes, creates the replacement enrollment/code as applicable, and writes the audit event. Never mutate the old enrollment's template/scope or cancel/reuse an activated enrollment through this workflow.
- Concurrent create/reuse/replacement attempts must be serialized. Exact database constraints/indexes and transaction implementation remain migration-design work. L-31 is design-only and does not authorize implementation or migrations.


## L-32 — Account deletion, retention, and historical integrity (accepted)

- Separate identity from historical training records where supported by the design and applicable obligations; account closure/deletion does not automatically delete historical records.
- Disable access through trusted server-side processes where required. Access disabling alone does not complete a data-deletion request.
- Define documented, data-category-specific retention, deletion, anonymization, export, backup, and applicable legal-rights procedures. Avoid unnecessary retention and do not presume indefinite retention.
- Do not silently delete or alter historical records, revision history, or audit records. Any permitted deletion/anonymization must be restricted, trusted, documented, and must not silently change historical meaning or reassign records.
- Numeric retention periods, legal exceptions, detailed export/backup handling, final technical mechanisms, and database changes remain open. L-32 is principles-only and does not authorize implementation or migrations.


## L-34 — Audit model, retention, and export (accepted)

- Use a unified audit model for sensitive security, administrative, and training-record events. Capture trusted actor identity, event type, affected entity/type, timestamp, outcome, required reason, and relevant revision/decision reference where applicable.
- Ordinary users cannot alter or delete audit records through normal application operations. Writes use restricted trusted paths; client-supplied actor identity or role is not authoritative.
- Classify events into authentication/security, enrollment/activation, assignment/transition, correction/revision, template/schema lifecycle, administrative emergency recovery, and audit export. The exact event catalogue remains open.
- Define separate documented retention and export policies. Retention is category-specific and purpose/legal-obligation aware, not indefinite by default. Export is limited to authorized roles and purposes, includes privacy safeguards and file-handling rules, and records export requests/outcomes.
- Exact event types, schema, numeric retention periods, export formats/permissions, backup handling, and operational safeguards remain open. L-34 is principles-only and does not authorize migrations or implementation.


## L-35 — Stable target identity and cross-version mapping (accepted)

- Each training target has a stable identifier independent of its name or description. Version-specific target definitions remain independently preserved as historical content.
- Cross-version target relationships must be explicit and must not be inferred from name/description similarity. Supported types: `SAME_TARGET`, `REPLACED_BY`, `SPLIT_INTO`, `MERGED_INTO`, and `NO_EQUIVALENT`.
- Historical trainee records remain attached to the original template version. Mapping does not itself migrate records or assignments. Historical coverage is not automatically transferred or aggregated into targets in a newer version; reporting may use explicit approved mappings only when the applicable rules permit it.
- Mappings must be traceable and reviewable. Define an authorized approval authority before using mappings in cross-version reporting.
- Exact key format, approval authority, multi-target representation, reporting calculations, and incomplete/conflicting mapping handling remain open. L-35 is design-only; no migrations or implementation are authorized.


## L-36 — Historical dashboards for inactive targets and archived assignments (accepted)

- The current dashboard is scoped to the active assignment and its linked template version. Historical assignment progress does not automatically contribute to current metrics.
- A separate historical archive provides authorized access to inactive/archived assignments, preserving each record's original assignment, template version, and historical target definition subject to retention policy.
- Archiving does not delete or automatically transfer historical records. Historical and current progress remain distinct.
- Cross-version comparison requires explicit approved mappings under L-35; such mappings do not automatically make historical achievements satisfy current requirements.
- Current and historical views follow existing authorization rules and confer no additional mentor access. Data availability follows L-32 retention/data-management policy.
- Filters, historical metric calculations, retired/replaced/split target display, visual comparison, and unavailable-data handling remain open. L-36 is design-only; no migrations or implementation are authorized.


## L-37 — Mentor review workflow and statuses (accepted)

- Mentor review is a separate lifecycle from log-entry status and formal approval. Review-state changes do not automatically change entry status and do not constitute formal approval.
- Review states are `NOT_REVIEWED`, `IN_REVIEW`, `FEEDBACK_PROVIDED`, and `REVIEWED` (the current review cycle is complete with no outstanding feedback within that cycle).
- Mentors may provide educational feedback within assigned-trainee permissions but cannot directly edit submitted entries or apply corrections. Formal approval and correction authority remain governed by L-17, L-23, and L-30. Feedback is not formal rejection and does not imply trainee agreement.
- Record review-state changes and feedback in a traceable manner with trusted actor identity and timestamp. Client-supplied identity/role is not authoritative. Existing mentor scope restrictions apply.
- Entry-versus-revision review granularity, reopening, trainee responses, feedback-resolution states, and repeated-cycle history remain open. L-37 is design-only; no migrations or implementation are authorized.


## L-38 — Failed assignment transitions and audit logging (accepted)

- `template_transitions` records only transitions that actually completed successfully. Failed/rejected attempts are recorded in `audit_logs` only and must not be represented as successful transition rows.
- The assignment-state change, successful transition row, and associated audit event must commit atomically. Recording a failed attempt does not change assignment state.
- Audit events should capture, where applicable, trusted actor identity, timestamp, operation type, target assignment, outcome, and failure/rejection reason, with data minimization and no secrets or unnecessary sensitive details.
- Existing authorization and transition rules, including L-03 and L-21, remain applicable; client-supplied identity or role claims are not authoritative.
- Audit retention/export follows L-34; broader data-management and retention principles follow L-32.
- Audit-write failure handling, detailed failure taxonomy and retention, repeated/suspicious attempt handling, and exact technical atomicity/consistency mechanisms remain open. L-38 is design-only; no migrations or implementation are authorized.


## L-39 — Source-first specialty requirements and validation (accepted)

- Requirements for each MVP specialty and log type must be based on identified, approved sources, including source/version details where applicable. Unsupported assumptions are not approved medical requirements.
- Maintain traceability from each requirement to a supporting source or a documented platform design decision, distinguishing approved requirements from design decisions and items awaiting verification.
- Document required/optional fields, data types, allowed values, validation constraints, and source/rationale before approving a log type's requirements. Technical schema validity alone does not establish medical correctness or completeness.
- Medical content must be reviewed and approved through the trusted workflow before being treated as final. L-24 through L-28 remain applicable.
- Unverified requirements remain open; no field list or final schema is approved merely by L-39. Source selection, detailed field review, approval responsibilities, and final schemas remain open.
- L-39 is design-only and authorizes no migrations, database changes, backend changes, or UI implementation.


## L-40 — Template lifecycle operational safeguards (accepted)

- L-21 and L-28 remain authoritative for lifecycle states and eligibility. L-40 adds operational safeguards for publication, eligibility changes, archival, and rollback.
- Publication requires schema validation, applicable checks, documented restricted administrative approval, and alignment with L-39; failure must not commit a partially published or partially eligible state.
- Eligibility changes use trusted enforcement of template state and eligibility rules, with audit records; frontend filtering alone is insufficient. Existing assignments are not automatically migrated, suspended, or replaced.
- Archival blocks new assignment/transition destinations while preserving historical links and meaning. Archived versions are not reopened; future use requires a new version.
- Rollback disables new use of an affected version. A previous published version may regain eligibility only after validity and compatibility checks. No in-place published-content edits, historical rewrites/reinterpretation, schema-reference changes, or automatic trainee migration are allowed.
- Failed lifecycle operations must not be represented as successful or leave partially committed publication/eligibility state. Sensitive changes use trusted, auditable workflows; client-supplied identity/role is not authoritative.
- Detailed runbooks, technical recovery/retry mechanisms, audit-write failure handling, operational responsibilities, and exact consistency mechanisms remain open. L-40 is design/operational policy only; no migrations or implementation are authorized.


## L-41 — Super Admin emergency recovery runbook (accepted)

- Only pre-authorized operators may perform recovery. Verify requester identity and authority independently of frontend state and user-editable role claims; Supabase Auth remains the authentication mechanism, with no parallel identity system or authentication bypass.
- Require two independent authorized approvers whenever operationally available. If a second approver is unavailable and delay creates material risk of permanent administrative lockout, a narrowly scoped documented exception may be used. Record its rationale, operator, approval limitation, why the normal process was unavailable, and actions performed. Never waive identity verification, authentication, least privilege, or audit.
- Keep recovery materials secure, access-restricted, and separate from the app and source repository; document access/use. Grant minimum necessary privileges and revoke or promptly review temporary privileges, credentials, and emergency access mechanisms.
- Trusted audit records capture the request, verification, operator, approver(s) or exception, timestamps, actions, and resulting privileges, excluding secrets and unnecessary sensitive data. An authorized reviewer independent of the operator documents the review, conclusion, irregularities, and corrective actions.
- Before production, the operational runbook must define operators, acceptable verification evidence, recovery-material custody, emergency contacts, approval/exception steps, and independent-review deadline. Actual environment-specific values remain to be populated. L-41 resolves OD-02 and OD-15 at policy level.
- L-41 is design/operational policy only. No migrations, database changes, backend implementation, or UI implementation are authorized.


## ADR-01 — Trusted backend and atomic write boundary (accepted)

### Required contract
- Vercel-hosted Node.js API is the trusted boundary for protected application writes and server-side schema validation.
- Authenticate through Supabase Auth; derive actor identity from verified session/token state. Client-supplied user IDs, roles, ownership, and permission claims are not authoritative.
- Enforce object-level authorization in the backend and keep PostgreSQL RLS enabled for protected data. Specify explicit grants and constraints; backend checks do not replace RLS.
- Validate specialty payloads in trusted backend code with Ajv 8 and JSON Schema Draft 2020-12 against the exact schema selected by template version and log type. Frontend validation is supplementary.
- Use reviewed PostgreSQL transactions/RPC functions for multi-row operations requiring atomicity. State changes and required audit/revision/transition records must commit together or roll back together. Failed operations must not leave partial state or be reported as successful.
- No alternate write path may bypass authorization, validation, lifecycle rules, or required audit behavior. Enforce concurrency-sensitive invariants in database/transaction design.
- Never expose service-role credentials or privileged secrets to browser code, client bundles, public assets, logs, or repository files. Privileged server-side use, if any, must be explicitly justified and least-privilege; it cannot substitute for authorization.
- Any SECURITY DEFINER function needs explicit review of search_path, execute grants, ownership/privileges, and RLS interaction.

### Design work still required before migrations
- Concrete API routing/session propagation and trusted backend deployment details.
- Exact SQL types, keys, foreign/composite keys, uniqueness/check constraints, indexes, grants, and RLS policies.
- RPC/function signatures, transaction boundaries, locking/isolation, audit-write failure behavior, and failure/error contracts.
- Review of the full design against accepted decisions and the implementation-blocker checklist.

ADR-01 is design-only. No migrations, database changes, backend/frontend code, secrets, deployment, or tests are created or claimed by this update.
