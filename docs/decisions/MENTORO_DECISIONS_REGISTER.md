# MENTORO Platform — Architecture Decision Register

**Status:** Consolidated decision register — pending final review  
**Phase:** Architecture and Data Model  
**Implementation status:** Documentation only; no implementation is implied.

This register contains only decisions explicitly accepted by the user. Other proposals remain open and must not be inferred as approved.

## Accepted decisions

### L-03 — One Active Assignment and Assignment Transition
**Status: Accepted**

- A trainee may have at most one `ACTIVE` assignment across the platform.
- A trainee may retain multiple historical assignments over time.
- Switching logbooks is an explicit, authorized transition.
- On a successful switch, the prior active assignment becomes `SUSPENDED` and the destination assignment becomes `ACTIVE` in the same database transaction.
- Any failure rolls back the transition.
- Historical log entries remain linked to their original assignment and template version.
- Reactivating a suspended assignment uses the same transition workflow.

### L-04 — Auditable Administrative Corrections
**Status: Accepted**

- Corrections to submitted records preserve the original record and affected target, context, and procedure associations.
- Current state and revision history update atomically.
- Each applied correction records actor, timestamp, mandatory reason, and revision identifier.
- Ordinary application clients cannot modify or delete revision history.
- Silent overwrites and unresolved concurrent-edit conflicts are prohibited.

### L-07 — Complete Before-and-After Revision State
**Status: Accepted**

- Each applied correction preserves complete before-and-after state, including scalar fields and all affected target/context/procedure associations.
- Each revision records the authorized actor, edit time, mandatory reason, and revision identity.
- Stale concurrent corrections are rejected or explicitly resolved.
- Current record, associations, revision history, correction request state, and audit event update atomically.

### L-08 — Activation Code Expiry and Replacement
**Status: Accepted**

- Activation codes are single-use and expire 24 hours after issue.
- Store only a secure hash, never plaintext.
- Unused codes may be revoked.
- Issuing a replacement invalidates the previous unused code.
- A replacement receives a new 24-hour validity period.
- Validation and consumption are atomic; failed verification does not consume a valid code.
- Rate limiting and safe error handling are required.

### L-09 — Trainee Self-Service Registration
**Status: Accepted**

- Trainees create accounts using Supabase Auth email/password.
- Password recovery uses Supabase Auth.
- Registration and logbook activation are separate steps.
- Failed activation must not create duplicate profiles or assignments.
- Eligible pending enrollments can receive replacement activation codes under L-08 and L-20.

### L-10 — Email-Bound Activation
**Status: Accepted**

- An administrator creates a pending enrollment tied to a normalized email and selected eligible logbook template version.
- The activation code references the pending enrollment.
- Activation requires an authenticated account with verified email matching the pending enrollment after trusted normalization.
- Trusted server-side logic validates identity, email, code state, enrollment state, template eligibility, and assignment eligibility.
- Code consumption, enrollment activation, assignment creation, and relevant audit event occur atomically.
- Activation codes never grant administrative privileges.
- If the trainee already has an active assignment, activation must use the explicit transition workflow rather than creating a second active assignment.

### L-12 — Three-Specialty MVP
**Status: Accepted**

The first release supports all three specialties:
1. General Surgery
2. Neurology
3. Anaesthesia & Critical Care

Identity, authorization, enrollment, assignments, audit, and common record infrastructure are shared. Roadmaps, fields, validation rules, record types, and coverage criteria remain specialty-specific. Existing specialty logbook projects are reference material only, remain outside the new repository, and are not runtime dependencies. Curriculum content must be source-based, not invented.

### L-13 — Mentor Access Scope
**Status: Accepted**

- A mentor may access and review records only for trainees explicitly assigned to that mentor.
- Mentor scope is **trainee-wide**, not limited to one assignment or specialty, subject to the trainee's currently permitted records and applicable privacy/access rules.
- Authorization is enforced server-side and through database/RLS controls where applicable.
- Client-supplied IDs or role claims never grant access.
- Ending/revoking a mentor assignment blocks future access according to policy but does not erase historical reviews or audit records.

### L-14 — Trainee Editing After Submission
**Status: Accepted**

- Trainees may freely edit their own drafts, subject to validation and privacy rules.
- Trainees cannot directly overwrite submitted records.
- Changes to submitted records require a documented correction request or explicitly authorized correction workflow.
- Applied corrections preserve complete before-and-after state under L-04 and L-07.

### L-15 — Per-Trainee Template Version Choice
**Status: Accepted**

- Administrators choose per trainee whether to keep the current template version or transition to a newer published version.
- Staying on the current version does not change the assignment.
- Version transition is explicit and auditable and follows the atomic transition workflow in L-03.
- Historical entries remain linked to their original assignment and template version.
- Cross-version roadmap mapping must be explicit, reviewed, and auditable; labels alone do not establish equivalence.

### L-16 — Super Admin Scope for Initial Release
**Status: Accepted**

- The initial release uses one Super Admin with platform-wide administrative permissions.
- This does not imply approval for additional scoped administrative roles.
- Administrative powers are still exercised through authenticated, trusted workflows and audited where applicable.
- The method for securely bootstrapping, replacing, or recovering the Super Admin account remains an open operational decision.

### L-17 — Submitted-Record Correction Approval
**Status: Accepted**

- Only the administration may approve or reject correction requests and authorize application of corrections.
- Mentors may review assigned trainees' records but do not receive correction-approval authority from their mentor role.
- Exact request initiation and submission UI details remain implementation details, provided no submitted record is changed without the authorized administrative workflow.
- Every applied correction must preserve complete snapshots and audit information under L-04 and L-07.

### L-18 — Versioned JSONB Specialty Payload
**Status: Accepted**

- Shared log-entry fields are stored in typed relational columns.
- Specialty- and record-type-specific fields are stored in `JSONB`.
- Every payload is validated against a versioned schema selected by the assigned logbook template version and log type.
- Schema identity/version and validation behavior must be deterministic and testable.
- Client-side validation alone is insufficient.
- The exact schema registry representation and validation implementation remain open.

### L-19 — Mentor Assignment Is Trainee-Wide
**Status: Accepted**

- A mentor assignment references the mentor profile and trainee profile, not an individual specialty assignment.
- While the mentor relationship is eligible, the mentor may access permitted records belonging to that trainee across specialties/assignments according to platform policy.
- Mentor access must still respect the trainee's record permissions, submission/privacy constraints, and review workflow.
- Assignment creation, ending, and revocation are controlled by the Super Admin in the initial release.

### L-20 — Reuse Eligible Pending Enrollment
**Status: Accepted**

- When an eligible pending enrollment already exists for the same normalized email and selected enrollment scope/template, the system reuses that pending enrollment instead of creating a duplicate.
- Issuing a replacement code invalidates the previous unused code and creates a new code with a new 24-hour expiry.
- The exact uniqueness scope must be enforced in trusted logic and, where practical, by database constraints.
- An already activated enrollment must not be reused to create a duplicate assignment.
- Code issuance and replacement must be auditable.
- The uniqueness/reuse behavior for simultaneous pending enrollments across different templates/specialties remains open unless explicitly decided later.

### L-21 — Template Assignment Eligibility
**Status: Accepted**

- Template lifecycle status and eligibility for new assignments are separate concepts.
- Template statuses are `DRAFT`, `PUBLISHED`, and `ARCHIVED`.
- Add `is_assignable BOOLEAN NOT NULL DEFAULT FALSE` to `logbook_templates`.
- `DRAFT` templates are never assignable.
- A `PUBLISHED` template may be assigned to new trainees or used as a transition destination only when `is_assignable = TRUE`.
- A `PUBLISHED` template with `is_assignable = FALSE` may remain assigned to existing trainees, but cannot receive new assignments or be a transition destination.
- `ARCHIVED` templates cannot receive new assignments or be transition destinations. Historical assignments and records remain interpretable.
- Changing `is_assignable` does not automatically migrate existing trainees; administrators choose per trainee whether to stay on the current version or transition.
- Database constraints and trusted workflows must enforce these rules; frontend filtering alone is insufficient.

### L-22 — Super Admin Recovery
**Status: Accepted**

- Super Admin recovery uses Supabase Auth together with a secured emergency procedure.
- Supabase Auth remains the authentication mechanism; emergency recovery must not create a parallel identity system or bypass authentication.
- Emergency recovery must be narrowly scoped, authenticated, auditable, and documented.
- Recovery must not depend on a frontend-only flag or a user-editable role claim.
- Exact emergency verification steps, authorized operator(s), recovery-material handling, approval requirements, and post-recovery review remain open and must be specified before production.
- Any emergency role grant or recovery action must be recorded in an audit trail; temporary privileges must be removed or reviewed after recovery.

### L-23 — Submitted-Record Correction Workflow
**Status: Accepted**

- A trainee may submit a correction request for a submitted record, including the proposed replacement values and a mandatory reason. A request represents one complete correction operation, including affected scalar fields and target/context/procedure associations.
- Submitting a request does not modify the submitted record. The original state remains current until the authorized administrative workflow applies an approved correction.
- Only administration may approve or reject a request and authorize application. Mentor status does not grant correction-approval authority.
- Each request is tied to the record revision it was based on. If the current revision changes before application, automatic application is blocked and the request is referred for administrative review; changes are not silently rebased onto the newer revision.
- Applying an approved correction updates the record and its affected associations, appends a complete before-and-after revision, updates the request state, and writes the audit event in one atomic transaction. A failed transaction must not leave partial correction state.
- Only one open correction request may exist per log entry at a time. This must be enforced by trusted logic and an appropriate database-level concurrency-safe constraint/mechanism, not frontend checks alone.
- The requesting trainee may withdraw the request before it is decided. Withdrawal changes the request state only; it does not alter the submitted record and must remain auditable.
- Correction request states are `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, and `APPLIED`. Approval and successful application are distinct: an approved request is not considered applied unless the atomic correction transaction succeeds.

## Cross-cutting constraints accepted in the design

- Supabase Auth is the central identity provider.
- Roles are server-managed; users cannot grant themselves roles.
- At most one active assignment per trainee is enforced at database level.
- Template-to-entry-to-reference-item integrity is enforced at database level.
- Revision and audit history are append-only through ordinary application operations.
- Supabase service-role secrets are never exposed in frontend code.
- Patient-identifying information must not be stored in log entries.
- Documented exposure is not proof of competence, certification, or authorization for independent practice.
- Development/test and production environments remain separate; production must not be destructively reset.


### L-24 — Database-Backed Versioned Schema Registry
**Status: Accepted**

- Schema definitions are stored in a database-backed `log_entry_schema_registry`; the exact stored representation is finalized in detailed design, with JSONB or another representation to be evaluated there.
- Each log entry is linked to a stable, verifiable schema definition selected by its logbook template version and log type. Reads and validation must never resolve a historical entry against merely the latest schema.
- Every specialty-specific payload is validated in a trusted backend. Frontend validation is supplementary and is never the security boundary.
- A published schema definition is immutable. Any change requires a new schema version; published definitions must not be silently replaced.
- Historical entries remain linked to their original template version and schema definition. Creating a new schema version does not automatically reinterpret or migrate historical entries.
- Schema creation, publication, and state changes use trusted, restricted workflows. Sensitive administrative schema actions must be auditable.
- This decision does not finalize the schema format, validation library, cross-version migration approach, historical-entry editing policy, or detailed publication/rollback workflows; those remain open for separate review and approval.


### L-25 — JSON Schema Draft 2020-12 and Ajv Validation
**Status: Accepted**

- JSON Schema Draft 2020-12 is the schema-definition standard for specialty-specific payloads by log type.
- Ajv 8 is the validation library used in a trusted backend environment. The dependency version must be pinned and its compatibility with the approved runtime verified.
- Schema definitions must be validated before publication. Payloads must be validated server-side before the relevant create, update, or submit operation is accepted.
- Non-conforming payloads are rejected by default. Frontend validation is supplementary and cannot bypass backend validation.
- User authorization, relationship integrity, template-version transition rules, and constraints requiring database access remain separate controls; JSON Schema/Ajv does not replace them.
- This decision does not modify published schema definitions or reinterpret historical records, and does not settle historical-entry editing policy.
- The exact location and execution boundary of validation, and detailed schema publication/rollback procedures, remain subject to implementation design review before migrations or backend deployment.

## Open decisions — not approved

| ID | Open question | Why it remains open |
|---|---|---|
| OD-01 | What are the detailed publication, archival, rollback, and eligibility-change procedures beyond L-21? | Template lifecycle operations |
| OD-02 | What exact emergency verification, operator authorization, recovery-material handling, and post-recovery review steps are required? | Operational security; recovery approach is fixed by L-22 |
| OD-03 | What exact request-initiation UI details and additional request fields are required beyond L-23? | UI/detail design remains open; core correction lifecycle is accepted |
| OD-04 | What are the cross-version migration procedures, historical-entry editing policy, and operational publication/rollback runbook for the schema registry? | L-27 resolves schema-definition storage as JSONB; migration and operational procedures remain open |
| OD-05 | How are concurrent pending-enrollment creation requests serialized across different templates for one email? | Duplicate invitation prevention |
| OD-06 | What are account deletion, anonymization, retention, export, and legal policies? | Privacy and lifecycle |
| OD-07 | What are stable target-key and cross-version mapping rules? | Historical coverage |
| OD-08 | What are the audit event taxonomy, retention period, and export policy? | Traceability |
| OD-09 | How should inactive targets and archived assignments appear in historical dashboards? | Historical interpretation |
| OD-10 | What mentor-review statuses are required, and does review affect entry status? | Review workflow |
| OD-11 | Are failed transition attempts stored in `template_transitions` or only in `audit_logs`? | Audit model |
| OD-12 | What are the final source-approved field/validation requirements per specialty and log type? | Specialty correctness |
| OD-13 | What are the publication, archival, rollback, and template-eligibility policies? | Template lifecycle |
| OD-14 | What is the final retention/deletion policy for expired activation-code rows? | Security and retention |
| OD-15 | What are the exact Super Admin emergency verification, operator authorization, and post-recovery review procedures? | Avoiding administrative lockout; recovery approach is fixed by L-22 |

## Consistency rule

When an accepted decision changes, update this register and both design documents together and preserve the decision history. A proposal, example, or generated document does not itself imply approval.

**Current status: decisions recorded through L-27; design documents remain pending final review. No implementation is claimed.**


### L-26 — Trusted Validation and Schema Publication/Rollback
**Status: Accepted**

**Central validation boundary**
- All application write paths that create, modify, or submit specialty-specific log-entry payloads must pass through a centrally defined, trusted backend validation path.
- The validation path uses Ajv 8 with JSON Schema Draft 2020-12 and validates against the exact schema definition selected for the entry's logbook template version and log type.
- A payload that fails validation must be rejected before the corresponding write is accepted.
- Frontend validation is supplementary and is not a security boundary.
- Direct or alternate write paths must not bypass required validation and authorization controls. Database-dependent integrity constraints and RLS remain separate controls.
- The specific backend technology and deployment boundary remain subject to implementation design review.

**Schema publication**
- A schema definition must pass schema validation before publication.
- If validation or publication fails, the operation is rejected atomically, preserving the previously committed schema state and eligibility configuration.
- Published schema definitions remain immutable. Any change requires a new schema version.
- Publication and eligibility changes use restricted, trusted workflows; sensitive administrative actions are audited.

**Disabling an affected schema and rollback**
- When a published schema version is identified as affected, its eligibility for new assignments or other applicable new uses may be disabled through an authorized, auditable workflow.
- Disabling eligibility does not delete or rewrite the schema definition or change historical entries' schema references.
- A previously published version may be selected for new use only if it is explicitly verified as compatible and eligible for the relevant template version and log type.
- Rollback must not silently modify published schema definitions, reinterpret historical entries, or automatically migrate existing trainee assignments.
- Any necessary trainee assignment transition remains subject to accepted assignment-transition and template-version decisions.

**Separation of concerns and remaining scope**
- JSON Schema/Ajv validation does not replace authorization, relational integrity, RLS, or database constraints.
- This decision does not finalize the physical schema-registry representation, exact backend technology, cross-version migration procedures, historical-entry editing policy, or complete operational publication/rollback runbook. Those remain open for separate review and approval.
- This decision does not authorize migrations or backend implementation by itself.


### L-27 — JSONB Storage for Schema Registry Definitions
**Status: Accepted**

**Storage representation**
- Store each schema definition in a `schema_definition JSONB NOT NULL` column in the database-backed `log_entry_schema_registry`.
- The stored representation preserves the JSON definition's data and meaning; preservation of the original textual formatting or key order is not required.
- A separate copy of the original JSON text is not required solely for formatting preservation.

**Validation and publication**
- Schema definitions must be validated against the approved JSON Schema Draft 2020-12 requirements before publication, using the validation process established by L-25 and L-26.
- JSONB storage does not itself establish schema validity or guarantee compatibility with the selected schema draft.
- Failed validation or publication must preserve the previously committed schema state under L-26.

**Version identity and immutability**
- Each log entry must reference the exact schema-registry record applicable to its logbook template version and log type.
- Published schema definitions must not be updated or replaced in place. Any change requires a new schema version and registry record.
- Historical entries must retain their original schema references; creating a new schema version must not automatically reinterpret or migrate historical entries.

**Security and integrity**
- Schema creation, publication, and state transitions must use restricted, trusted workflows, with sensitive administrative actions audited.
- Authorization, relational integrity, RLS, and validation remain separate controls; JSONB storage does not replace them.

**Scope and remaining open decisions**
- This decision does not require storing a duplicate copy of the original JSON text or mandate a content hash.
- Cross-version migration, historical-entry editing, and the detailed operational publication/rollback runbook remain open for separate review and approval.
- This decision does not authorize migrations or backend implementation by itself.
