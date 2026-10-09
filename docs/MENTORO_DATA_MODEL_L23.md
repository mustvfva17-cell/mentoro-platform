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
| `log_entry_schema_registry` | Proposed versioned schema metadata for validating payloads; exact representation remains open |

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
Proposed typed fields: `id`, `trainee_assignment_id`, `logbook_template_id`, `log_type`, `status`, `occurred_at`, `submitted_at`, `reflection_notes`, `payload JSONB`, `schema_version` or resolvable schema reference, `created_at`, `updated_at`, `revision_number`.

- Status: `DRAFT` or `SUBMITTED`.
- Shared fields remain typed columns; specialty/record-type-specific fields are in `JSONB`.
- Payload is validated server-side against the schema version selected by the assigned template version and `log_type`.
- Record and reference associations must use the same template version.
- Trainees may edit drafts under their own eligible active assignment.
- Submitted records are not directly editable by trainees.
- Patient-identifying information is prohibited.
- Exact schema registry representation remains open.

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

### 4.18 `log_entry_schema_registry` (proposed)
Purpose: identify the payload schema for a given template version and log type. Candidate fields: `id`, `logbook_template_id`, `log_type`, `schema_version`, `schema_definition JSONB` or reference to a version-controlled schema artifact, `created_at`, `published_at`, `is_active`. This entity is a design proposal, not a locked choice of implementation. Published schema definitions must be immutable. Exact registry shape and validator remain open.

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

2. Super Admin bootstrap, recovery, replacement, and break-glass process.
3. Exact correction-request initiation fields and UX.
4. Schema registry representation and JSONB validation implementation.
5. Concurrency/uniqueness policy for pending enrollments across different templates for the same email.
6. Account deletion, anonymization, retention, export, and legal policies.
7. Stable target keys and cross-version mapping.
8. Audit taxonomy, retention, and export.
9. Historical dashboard behavior for inactive targets and archived assignments.
10. Mentor-review statuses and whether review affects entry status.
11. Storage of failed transition attempts.
12. Source-approved field and validation requirements per specialty/log type.
13. Detailed template publication, archival, and rollback workflow.
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
