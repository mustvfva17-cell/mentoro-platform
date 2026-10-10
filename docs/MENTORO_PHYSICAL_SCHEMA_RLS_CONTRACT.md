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
`id UUID PK REFERENCES auth.users(id) ON DELETE RESTRICT`, `full_name TEXT`, `created_at`, `updated_at`. Profile identity derives from authenticated Supabase Auth. Account deletion/anonymization policy remains open.

### 4.2 `user_roles`
`id`, `user_id FK profiles`, `role CHECK IN ('SUPER_ADMIN','TRAINEE','MENTOR')`, `created_at`, `granted_by`, `revoked_at`. Roles are server-managed. Initial release has one Super Admin with platform-wide scope. A constraint/index must prevent duplicate active grants while preserving revoked history. Recovery approach is Supabase Auth plus a secured emergency procedure (L-22); exact operational controls remain open.

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
`id`, `profile_id`, `logbook_template_id`, `status`, `enrolled_at`, `ended_at`, `created_at`, `updated_at`, `created_from_pending_enrollment_id`. Status `ACTIVE/SUSPENDED/COMPLETED`. Add partial unique index:

```sql
CREATE UNIQUE INDEX one_active_assignment_per_profile
ON public.trainee_assignments (profile_id)
WHERE status = 'ACTIVE';
```

The `created_from_pending_enrollment_id` FK can be added after both related tables exist. Transition must atomically suspend old and activate destination; rollback on any failure.

### 4.6 `mentor_assignments`
`id`, `mentor_profile_id`, `trainee_profile_id`, `status`, `assigned_by`, `assigned_at`, `ended_at`, `created_at`. Status `ACTIVE/ENDED/REVOKED`. Relationship is trainee-wide, not assignment-scoped. Only the Super Admin manages these relationships in the initial release. A mentor may access permitted records for the trainee while the relationship is eligible.

### 4.7 `pending_enrollments`
`id`, `normalized_email`, `logbook_template_id`, `status`, `created_by`, `created_at`, `updated_at`, `activated_by_profile_id`, `activated_at`, `cancelled_at`. Status `PENDING/ACTIVATED/REVOKED/EXPIRED/CANCELLED`.

Trusted logic normalizes email and requires exact normalized match to the authenticated, verified email. Under L-31, enforce at most one `PENDING` enrollment per normalized email across all templates/specialties. Reuse an eligible pending enrollment for the same email and template/scope. For a different scope, atomically cancel the existing pending enrollment, revoke/invalidate its unused activation codes, create the replacement enrollment and code as applicable, and write the audit event; do not mutate the prior enrollment's scope. Never cancel/reuse an activated enrollment through this workflow. Concurrent create/reuse/replacement attempts must be serialized safely. Exact database constraint/index design remains migration work.

### 4.8 `activation_codes`
`id`, `pending_enrollment_id`, `code_hash UNIQUE`, `created_by`, `created_at`, `expires_at NOT NULL`, `used_at`, `used_by`, `revoked_at`, `replaced_by_code_id`. Store only a secure hash. Trusted logic sets expiry to exactly 24 hours after issuance. Replacement invalidates the previous unused code and creates a new 24-hour validity period. Validation, consumption, enrollment activation, assignment creation, and audit write are atomic; failed verification does not consume a valid code.

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
- Active role grant uniqueness.
- Mentor assignment uniqueness/lifecycle constraints after final review.
- Enrollment reuse serialized with transaction/lock and appropriate uniqueness constraint where compatible with the open cross-template policy.
- All multi-row operations use trusted atomic transactions.
- Foreign keys/indexes are reviewed for query performance; PostgreSQL does not automatically index every referencing FK.

Suggested query indexes: assignments by profile/date; entries by assignment/date; association rows by referenced item; revisions by entry/revision; correction requests by entry/status; pending enrollments by normalized email/status; activation codes by enrollment/expiry; mentor assignments by mentor/trainee/status.

## 6. Trusted transactional workflows

### Activation
Authenticate; verify email; normalize and match email; lock/validate enrollment and code; verify expiry/revocation/use state and template/assignment eligibility; serialize code consumption; then atomically consume code, activate enrollment, create assignment, and write audit event. Failed checks must not consume a valid code or create partial state.

### Pending enrollment reuse and code replacement
Find an eligible pending enrollment by normalized email and selected template/scope. Reuse it rather than create a duplicate. Under lock, revoke the prior unused code, issue/store only a hash for a new code, set a fresh 24-hour expiry, and write audit history. Already activated enrollment is not reusable for duplicate assignment creation. Cross-template concurrency policy remains open.

### Assignment/template transition
Authorized Super Admin selects keep-current or transition. If transition: validate destination template, create/activate destination assignment, suspend prior active assignment, write transition and audit records in one transaction. Roll back all on failure.

### Draft and submission
Trainee can create/edit draft under own eligible active assignment. Validate common fields, JSONB schema/version, references, and privacy rules. Submission sets `SUBMITTED` and `submitted_at`. Trainee cannot directly update a submitted entry.

### Mentor review
Authenticate mentor, check active trainee-wide mentor relationship, verify record belongs to assigned trainee, then append a review event. Mentor cannot approve correction requests.

### Correction (L-04, L-07, L-17, L-23)
The trainee submits a complete proposed correction with mandatory reason and expected current revision; submission does not mutate the entry. Enforce one open request per entry. Trainee withdrawal is allowed only before decision and is audited. Only administration can approve/reject and authorize application. Approval alone does not apply the change. At apply time, compare expected revision with current revision; if stale, block application and refer to administration for review without automatic rebasing. Otherwise snapshot complete before/after state, including associations, update current row and associations, append revision, update request status to `APPLIED`, and audit in one transaction. Any failure rolls back all changes.

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
- Review `SECURITY DEFINER` functions for fixed safe `search_path`, narrow privileges, explicit execution grants, and privilege-escalation risks.
- Avoid recursive RLS helper policies.
- Service-role secret remains server-side.
- Ordinary clients cannot update/delete revision and audit history.
- Activation hashes are not readable by trainees or mentors.

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

Before migrations: review all three design documents together; resolve open decisions required for security/integrity; finalize exact SQL types, constraints, composite FKs, indexes, grants, and RLS; specify trusted functions; prepare version-controlled migrations and seeds; run real local/test database checks; review rollback and deployment.

**Current status: CONSOLIDATED DESIGN DRAFT through L-37 — NOT APPROVED FOR IMPLEMENTATION.**


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
