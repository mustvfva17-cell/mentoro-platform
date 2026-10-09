# MENTORO Platform — Consolidated Data Model

**Status:** Design draft — pending final review and approval  
**Phase:** Architecture and Data Model  
**Implementation status:** Documentation only; no migrations or database tests are claimed.

## 1. Scope and principles

MENTORO is a centralized medical training platform. The first release supports General Surgery, Neurology, and Anaesthesia & Critical Care.

- One central identity per person.
- A trainee may have historical assignments over time but at most one active assignment platform-wide.
- Switching logbooks suspends the previous assignment and activates the destination atomically.
- Administrators choose per trainee whether to retain the current template version or transition.
- Mentors can access assigned trainees only; mentor scope is trainee-wide across their permitted records.
- Only administration may approve/reject submitted-record correction requests and authorize their application.
- Drafts are editable by the owning trainee; submitted records require a documented correction workflow.
- Specialty-specific fields use `JSONB` validated against a versioned schema selected by template version and log type.
- Activation is bound to a verified normalized email and a pending enrollment.
- Patient-identifying information is prohibited in log entries.
- Exposure documentation is not competence certification.
- Historical records remain attached to their original assignment and template version.

## 2. Entity inventory

| Entity | Purpose |
|---|---|
| `profiles` | Central application identity linked to Supabase Auth |
| `user_roles` | Server-managed `SUPER_ADMIN`, `TRAINEE`, `MENTOR` grants |
| `specialties` | Supported specialties |
| `logbook_templates` | Versioned logbook definitions and lifecycle |
| `trainee_assignments` | Trainee enrollment in a specific template version |
| `mentor_assignments` | Trainee-wide mentor relationship |
| `pending_enrollments` | Email-bound enrollment invitation and state |
| `activation_codes` | Hashed single-use codes associated with pending enrollments |
| `template_transitions` | Auditable successful assignment/template transitions |
| `roadmap_targets` | Version-specific roadmap targets |
| `contexts` | Version-specific contexts |
| `procedures` | Version-specific procedures |
| `log_entries` | Shared record fields plus versioned specialty JSONB payload |
| `log_entry_targets` | Target associations and exposure depth |
| `log_entry_contexts` | Context associations |
| `log_entry_procedures` | Procedure associations |
| `mentor_reviews` | Separate review events |
| `log_entry_correction_requests` | Requested submitted-record corrections and administrative decisions |
| `log_entry_revisions` | Append-only full before/after snapshots for applied corrections |
| `audit_logs` | Security-sensitive and administrative event history |
| `log_entry_schema_registry` | Database-backed, versioned schema definitions selected by template version and log type; exact schema format remains open |

## 3. Relationships

- `auth.users` 1:1 `profiles`.
- `profiles` 1:N `user_roles`.
- `specialties` 1:N `logbook_templates`.
- `profiles` 1:N `trainee_assignments` over time.
- `logbook_templates` 1:N `trainee_assignments`.
- `profiles` (mentor) 1:N `mentor_assignments`; each mentor assignment also references one trainee profile.
- `pending_enrollments` 1:N historical `activation_codes`; trusted logic ensures only one currently usable code per pending enrollment.
- A successful activation links a pending enrollment to the resulting assignment.
- `trainee_assignments` 1:N `log_entries`.
- Each template version owns its roadmap targets, contexts, procedures, and payload schema versions.
- `log_entries` connect to targets, contexts, and procedures through association tables.
- `log_entries` 1:N `mentor_reviews`, correction requests, and revisions.
- `template_transitions` references the prior and destination assignments/template versions.
- `audit_logs` record trusted actors and security-sensitive actions.

## 4. Entity definitions and rules

### 4.1 `profiles`
Proposed fields: `id UUID PK REFERENCES auth.users(id)`, `full_name`, `created_at`, `updated_at`. Identity is derived from authenticated Supabase Auth identity. Account deletion/anonymization remains open.

### 4.2 `user_roles`
Proposed fields: `id`, `user_id`, `role`, `created_at`, `granted_by`, `revoked_at`. Allowed roles for the initial model: `SUPER_ADMIN`, `TRAINEE`, `MENTOR`. Only trusted workflows grant/revoke roles. The initial release has one Super Admin with platform-wide scope. Recovery uses Supabase Auth plus a secured emergency procedure (L-22); exact operational controls remain open. A uniqueness rule must prevent duplicate active grants while retaining revocation history.

### 4.3 `specialties`
Proposed fields: `id`, `name`, `slug`, `description`, `is_active`, `created_at`. Seed General Surgery, Neurology, and Anaesthesia & Critical Care. Deactivation must not invalidate history.

### 4.4 `logbook_templates`
Proposed fields: `id`, `specialty_id`, `version_label`, `status`, `is_assignable BOOLEAN NOT NULL DEFAULT FALSE`, `created_at`, `published_at`, `published_by`. Status values: `DRAFT`, `PUBLISHED`, `ARCHIVED`. A published version is immutable in curriculum meaning; changes require a new version or explicit reviewed transition.

Lifecycle status and assignment eligibility are separate:
- `DRAFT`: `is_assignable = FALSE`.
- `PUBLISHED` + `is_assignable = TRUE`: eligible for new assignments and transition destinations.
- `PUBLISHED` + `is_assignable = FALSE`: may remain in use by existing assignments, but is ineligible for new assignments/transitions.
- `ARCHIVED`: ineligible for new assignments/transitions; preserve historical interpretation.
- Changing eligibility never automatically migrates existing trainees; administrators choose per trainee whether to stay or transition.

Enforce eligibility in trusted workflows and database constraints/transaction checks, not only in the UI. Detailed publication/archival/rollback procedures remain open. Unique `(specialty_id, version_label)` and composite key `(id, specialty_id)` are proposed.

### 4.5 `trainee_assignments`
Proposed fields: `id`, `profile_id`, `logbook_template_id`, `status`, `enrolled_at`, `ended_at`, `created_at`, `updated_at`, `created_from_pending_enrollment_id`. Status values: `ACTIVE`, `SUSPENDED`, `COMPLETED`. A partial unique index enforces at most one active assignment per profile. A successful switch suspends the previous assignment and activates the destination in one transaction. The destination template must be eligible. Historical logs remain attached to their original assignment.

### 4.6 `mentor_assignments`
Proposed fields: `id`, `mentor_profile_id`, `trainee_profile_id`, `status`, `assigned_by`, `assigned_at`, `ended_at`, `created_at`. Status values: `ACTIVE`, `ENDED`, `REVOKED`. Mentor scope is trainee-wide, not assignment-specific. In the initial release, only the Super Admin creates/ends/revokes these relationships. A mentor may read permitted records only for currently assigned trainees and may create mentor reviews within that scope.

### 4.7 `pending_enrollments`
Proposed fields: `id`, `normalized_email`, `logbook_template_id`, `status`, `created_by`, `created_at`, `updated_at`, `activated_by_profile_id`, `activated_at`, `cancelled_at`. Status values: `PENDING`, `ACTIVATED`, `REVOKED`, `EXPIRED`, `CANCELLED`.

- Email is normalized by trusted logic.
- Activation requires authenticated, verified email matching the invitation.
- If an eligible pending enrollment already exists for the same normalized email and selected template/scope, reuse it rather than create a duplicate.
- Reuse must not apply to an already activated enrollment.
- Concurrent creation/reuse must be serialized safely.
- Whether different templates for the same email may have simultaneous pending enrollments remains open.

### 4.8 `activation_codes`
Proposed fields: `id`, `pending_enrollment_id`, `code_hash`, `created_by`, `created_at`, `expires_at`, `used_at`, `used_by`, `revoked_at`, `replaced_by_code_id`. Store only secure hashes. Codes are single-use, expire 24 hours after issue, may be revoked before use, and replacement invalidates the previous unused code. `expires_at` is mandatory and assigned by trusted logic. Validation, consumption, enrollment activation, assignment creation, and audit event are atomic. Failed verification does not consume a valid code.

### 4.9 `template_transitions`
Proposed fields: `id`, `profile_id`, `from_assignment_id`, `to_assignment_id`, `from_template_id`, `to_template_id`, `initiated_by`, `transitioned_at`, `reason`, `mapping_summary`, `status`. Successful transition record and assignment changes commit atomically. Cross-version mapping must be explicit, reviewed, and auditable. Failed-attempt storage remains open.

### 4.10 `roadmap_targets`
Proposed fields: `id`, `logbook_template_id`, `target_key`, `track`, `domain`, `module`, `target_name`, `priority`, `expected_frequency`, `minimum_depth`, `is_active`, `created_at`. Target identity, controlled vocabularies, and cross-version mapping rules remain open. Deactivation preserves historical interpretation.

### 4.11 `contexts` and `procedures`
Each is template-version-specific in the current proposal. Proposed fields: `id`, `logbook_template_id`, `category`, `name`, `is_active`, `created_at`. Global sharing is not assumed.

### 4.12 `log_entries`
Proposed typed fields: `id`, `trainee_assignment_id`, `logbook_template_id`, `log_type`, `status`, `occurred_at`, `submitted_at`, `reflection_notes`, `payload JSONB`, `schema_registry_id` (stable FK to the exact schema definition), `created_at`, `updated_at`, `revision_number`.

- Status: `DRAFT` or `SUBMITTED`.
- Shared fields remain typed columns; specialty/record-type-specific fields are in `JSONB`.
- Payload is validated server-side against the exact schema definition linked by `schema_registry_id`; the selected definition must match the assigned template version and `log_type`. Never resolve historical entries against the latest schema.
- Record and reference associations must use the same template version.
- Trainees may edit drafts under their own eligible active assignment.
- Submitted records are not directly editable by trainees.
- Patient-identifying information is prohibited.
- The schema registry is database-backed. JSON Schema Draft 2020-12 is the schema format, and Ajv 8 is the backend validation library under L-25; exact storage representation and execution boundary remain for detailed design.

### 4.13 Association tables
`log_entry_targets`, `log_entry_contexts`, and `log_entry_procedures` associate entries with reference items. Each association carries `logbook_template_id` to support composite foreign keys proving version consistency. `log_entry_targets` additionally carries `exposure_depth` and optional notes. Final depth vocabulary and per-specialty requirements must be checked against reviewed source materials.

### 4.14 `mentor_reviews`
Proposed fields: `id`, `log_entry_id`, `mentor_profile_id`, `status`, `comments`, `reviewed_at`, `created_at`. A mentor must have an eligible trainee-wide mentor assignment for the record's trainee. Review statuses and whether review changes entry status remain open. Reviews are append-only events.

### 4.15 `log_entry_correction_requests`
Proposed fields: `id`, `log_entry_id`, `requested_by`, `requested_at`, `reason`, `proposed_changes JSONB`, `status`, `reviewed_by`, `reviewed_at`, `review_decision_reason`, `applied_revision_id`. Status: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `APPLIED`. Only administration approves/rejects and authorizes application. The exact request initiation and UI workflow remain open.

### 4.16 `log_entry_revisions`
Proposed fields: `id`, `log_entry_id`, `revision_number`, `corrected_by`, `corrected_at`, `reason`, `before_snapshot JSONB`, `after_snapshot JSONB`, `correction_request_id`, `created_at`. Unique `(log_entry_id, revision_number)`. Snapshots contain all scalar fields and target/context/procedure associations. Ordinary clients cannot update/delete revisions. Stale concurrent corrections are rejected. Entry, associations, revision, request status, and audit event update atomically.

### 4.17 `audit_logs`
Proposed fields: `id`, `actor_profile_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, `metadata JSONB`, `request_id`. Trusted workflows write events. Never include plaintext activation codes, secrets, or patient-identifying information. Retention and export policy remain open.

### 4.18 `log_entry_schema_registry` (accepted concept; detailed schema open)
Purpose: store database-backed, versioned payload schema definitions for a specific template version and log type. Candidate fields: `id`, `logbook_template_id`, `log_type`, `schema_version`, `schema_definition` (representation to be finalized in detailed design), `state`, `created_at`, `published_at`, `created_by`, and publication/audit metadata as needed. Each log entry links to the exact definition through a stable foreign key. Published definitions are immutable; changes require a new version. Schema creation, publication, and state changes use trusted restricted workflows and sensitive actions are audited. JSON Schema Draft 2020-12 and Ajv 8 are selected under L-25. Exact storage representation, validation execution boundary, and detailed publication/rollback procedure remain open.

## 5. Integrity requirements

- Partial unique index on `trainee_assignments(profile_id) WHERE status='ACTIVE'`.
- Composite FK from `(trainee_assignment_id, logbook_template_id)` to the assignment/template pair.
- Composite FKs ensure entry, target, context, and procedure all belong to the same template version.
- Unique `(log_entry_id, revision_number)`.
- Unique `code_hash`; mandatory expiry.
- Constraints/indexes prevent duplicate active mentor assignments for the same mentor/trainee relationship according to lifecycle policy.
- Role grants, activation, assignment transitions, log creation, submission, and correction application use trusted workflows.
- Multi-row operations are atomic.
- Authorization is not based on client-supplied role, actor, or owner identifiers.

## 6. Security and access model

### Trainee
May read permitted own profile/assignment history, assigned-version reference data, own eligible records, and permitted review/correction history. May create/edit own drafts and submit. Cannot access another trainee's private records, self-grant roles, access activation hashes, directly alter submitted entries, or write revision/audit history.

### Mentor
May read records only for trainees with an eligible active mentor assignment; scope is trainee-wide. May create review events within that scope. Cannot browse unrelated trainees, grant roles, create/revoke mentor assignments, directly edit trainee records, or mutate review/revision/audit history. Mentor cannot approve/reject submitted-record corrections.

### Super Admin
The initial release has one Super Admin with platform-wide administrative scope. Through trusted audited workflows, the Super Admin manages enrollments/codes, template assignment/transitions, mentor assignments, template lifecycle, and correction approvals/application. Recovery approach is Supabase Auth plus a secured emergency procedure (L-22). Exact verification, authorized operator(s), emergency-material handling, and post-recovery review remain open. The frontend must not be able to grant Super Admin privileges.

## 7. Open decisions — not approved

2. Remaining operational runbook details for Super Admin bootstrap, recovery, replacement, and break-glass process (core controls are accepted in L-22 and L-29).
3. Exact correction-request initiation fields and UX.
4. Cross-version migration procedures, historical-entry editing policy, and detailed operational publication/rollback workflow for the database-backed schema registry (schema-definition storage is resolved by L-27).
5. Concurrency/uniqueness policy for pending enrollments across different templates for the same email.
6. Account deletion, anonymization, retention, export, and legal policies.
7. Stable target keys and cross-version mapping.
8. Audit taxonomy, retention, and export.
9. Historical dashboard behavior for inactive targets and archived assignments.
10. Mentor-review statuses and whether review affects entry status.
11. Storage of failed transition attempts.
12. Source-approved field and validation requirements per specialty/log type.
13. Detailed operational checklist and runbook for publication, archival, rollback, and template eligibility (core policy is accepted in L-21 and L-28).
14. Retention/deletion policy for expired activation-code rows.

## 8. Approval gates

Before implementation, review this model against `docs/decisions/README.md` and `docs/PHYSICAL_SCHEMA_RLS_CONTRACT.md`, finalize SQL types/constraints/FKs/indexes, define exact RLS and grants, specify trusted transaction functions, prepare version-controlled migrations, and run tests against an actual local/test database.

**Current status: DESIGN DRAFT — NOT APPROVED FOR IMPLEMENTATION.**


## 9. Super Admin recovery (L-22)

The recovery approach is Supabase Auth plus a secured emergency procedure. Do not introduce a parallel identity system or frontend-only role flag. The procedure must be authenticated, narrowly scoped, and auditable. Before production, specify verification steps, authorized operator(s), handling/storage of emergency recovery material, approval requirements, audit events, and post-recovery review. Any temporary elevation must be removed or reviewed after recovery. This is an operational control; a separate application table is not assumed unless a later approved design requires one.



## 4.19 L-23 correction workflow constraints

- Request creation captures the current revision and proposed complete state change; it does not mutate the submitted record.
- Enforce at most one open request per `log_entry_id` with a concurrency-safe database design (for example, a partial unique index once the final open-state predicate is approved and validated). Do not rely only on application/UI checks.
- Withdrawal is permitted only while the request is undecided; preserve the event in audit history.
- Administrative approval does not itself change the log entry. Applying the correction must atomically verify the expected revision, update scalar fields and affected associations, append complete before/after revision snapshots, set request state to `APPLIED`, and write the audit event.
- If the expected revision is stale, block application and refer for administrative review; no automatic rebase.
- If any step fails, the transaction rolls back without partial updates.


## 4.20 L-24 schema registry constraints

- Schema definitions are stored in a database-backed `log_entry_schema_registry`; exact schema format is deferred to detailed design.
- Every log entry must reference a stable, verifiable schema definition compatible with its template version and log type.
- Trusted backend validation is mandatory; client-side validation alone is insufficient.
- Published schema definitions are immutable. Changes require a new schema version.
- New schema versions do not automatically reinterpret or migrate historical entries; each entry remains linked to its original template version and schema definition.
- Creation, publication, and state changes are restricted to trusted workflows and sensitive administrative actions are auditable.
- Cross-version migration, historical-entry editing, exact validation library, schema format, and publication/rollback procedures remain open.


## 4.21 L-25 schema format and validation constraints

- Use JSON Schema Draft 2020-12 for specialty-specific payload definitions.
- Use Ajv 8 in a trusted backend environment for payload validation; pin the dependency version and verify runtime compatibility.
- Validate schema definitions before publication and validate payloads server-side before accepting the relevant create, update, or submit operation.
- Reject non-conforming payloads by default. Frontend validation is supplementary only.
- Authorization, relational integrity, template-transition rules, and database-dependent constraints remain separate controls.
- L-25 does not alter published schemas or reinterpret historical entries and does not settle historical-entry editing policy.
- Exact storage representation, validation execution boundary, and publication/rollback details remain open.


## L-26 — Trusted validation and schema publication/rollback (accepted)

- All application write paths that create, modify, or submit specialty-specific log-entry payloads pass through a centrally defined trusted backend validation path using Ajv 8 and JSON Schema Draft 2020-12.
- Validation uses the exact schema definition selected for the entry's template version and log type. Invalid payloads are rejected before the corresponding write is accepted. Frontend validation is supplementary.
- Alternate write paths must not bypass validation or authorization. RLS and database-dependent integrity constraints remain separate controls.
- Schema definitions must validate before publication. Failed validation/publication is rejected atomically and preserves the previously committed schema state and eligibility configuration.
- Published definitions are immutable; changes require a new version. Publication and eligibility changes use restricted trusted workflows, and sensitive administrative actions are audited.
- An affected version may be disabled for new assignments/new applicable uses. A previously published version may be selected only after compatibility and eligibility are verified for the relevant template version and log type.
- Rollback does not delete or rewrite schema definitions, change historical schema references, reinterpret historical entries, or automatically migrate assignments. Assignment transitions remain governed by accepted transition decisions.
- Exact schema storage representation, backend technology/deployment boundary, cross-version migration, historical-entry editing, and the full operational publication/rollback runbook remain open. L-26 does not authorize implementation or migrations by itself.


## L-27 — JSONB storage for schema registry definitions (accepted)

- Store schema definitions in `log_entry_schema_registry.schema_definition JSONB NOT NULL`. Preserving the original textual formatting or key order is not required; a duplicate original-text copy is not required solely for formatting.
- Validate definitions against JSON Schema Draft 2020-12 before publication using the validation process established by L-25/L-26. JSONB storage alone does not establish validity.
- Each log entry references the exact schema-registry record applicable to its template version and log type. Published definitions cannot be changed in place; changes require a new schema version and registry record.
- Historical entries retain their original schema references; new schema versions do not automatically reinterpret or migrate history.
- Schema creation, publication, and state transitions use restricted trusted workflows, with sensitive administrative actions audited. JSONB does not replace authorization, relational integrity, RLS, or validation.
- Cross-version migration, historical-entry editing, and the detailed operational publication/rollback runbook remain open. L-27 does not authorize implementation or migrations by itself.


## L-28 — Template lifecycle operations (accepted)

- Template states remain `DRAFT`, `PUBLISHED`, and `ARCHIVED`; assignment eligibility is separate and governed by `is_assignable` under L-21.
- Publication requires successful automated schema validation and applicable publication checks, plus documented administrative approval through a restricted trusted workflow. Failed checks or publication must not leave partial state.
- Published template-version content cannot be modified in place; changes require a new version. Sensitive lifecycle changes must be audited with actor, timestamp, action, and reason.
- Eligibility changes do not automatically migrate, suspend, or replace existing assignments. Publishing, disabling eligibility, archiving, and rollback do not automatically move trainees; transitions remain separate authorized operations under L-03/L-21.
- Rollback disables new use of the affected version and may restore eligibility to a previously published version only after checking validity, eligibility, and compatibility. Rollback does not rewrite versions or history, reinterpret entries, or automatically migrate assignments.
- Archival is terminal for the archived record. Archived templates cannot be reopened or assigned; archival does not delete templates, assignments, or history. Reuse of archived content requires a new version and the applicable publication checks.
- Trusted backend/database controls must enforce these rules; frontend filtering alone is insufficient. Detailed operational runbooks may be separate but must implement this decision.
- Cross-version migration and historical-entry editing remain open. L-28 does not authorize implementation or migrations by itself.


## L-29 — Super Admin emergency recovery procedure (accepted)

- Emergency recovery may be initiated and executed only by a pre-authorized operator under a documented procedure. Requester identity and authority must be verified through a documented method independent of frontend-controlled state and user-editable role claims. Supabase Auth remains the authentication mechanism; recovery must not create a parallel identity system or bypass authentication.
- Recovery requires approval from two independently authorized persons whenever operationally available. If a second approver is unavailable and delay risks permanent administrative lockout, a narrowly scoped documented exception may be used. The exception must record its justification, operator, approval limitation, actions performed, and why normal approval was unavailable.
- An exception does not waive identity verification, authentication, least privilege, or audit recording, and always requires independent post-recovery review.
- Recovery materials must be stored securely and separately from the application and source repository, with restricted and documented access. Recovery grants only minimum necessary privileges; temporary privileges, credentials, and emergency access mechanisms must be revoked or reviewed promptly.
- Audit records capture the request, verification outcome, operator, approver or exception rationale, timestamps, actions, and resulting privilege changes. An independent authorized reviewer who did not execute recovery reviews the outcome and relevant audit records, documenting conclusions, irregularities, and corrective actions.
- Before production, an operational runbook must specify authorized operators, verification evidence, recovery-material handling, emergency contacts, approval/exception steps, and review deadline.
- L-29 is design-only and does not authorize implementation or migrations.
