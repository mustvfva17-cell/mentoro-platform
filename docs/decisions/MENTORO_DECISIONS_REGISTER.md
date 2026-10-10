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
- Under L-31, only one pending enrollment may exist per normalized email across all templates/specialties. A request for the same normalized email and same template/scope reuses the eligible pending enrollment under L-20. A request for a different template/scope cancels the prior pending enrollment and creates a new one; this must invalidate/revoke any unused activation code for the prior enrollment and be audited. Activated enrollments are never cancelled or reused by this replacement workflow. Concurrent requests must be serialized safely.

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
- The requesting trainee may withdraw a request only while it remains `PENDING` and before an administrative decision. Withdrawal changes the request state to `CANCELLED`, does not alter the submitted record, and must remain auditable.
- Correction request states are `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, and `APPLIED`. Approval and successful application are distinct: an approved request is not considered applied unless the atomic correction transaction succeeds.
- Request contents and proposed values become immutable on submission; lifecycle metadata may change only through the authorized workflow. If the trainee needs to change the proposed correction before a decision, they must withdraw the pending request and submit a new request; the replacement is subject to the one-open-request-per-entry rule.
- Attachments are excluded from correction requests in the initial release.
- An administrator must decide the submitted proposal as-is: the administrator may approve or reject it but must not edit the trainee's proposed replacement values. A changed proposal requires a new request from the trainee.
- A rejection must include a mandatory administrative reason, stored with the decision and included in the audit trail.

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
| OD-01 | What detailed operational checklist and runbook are needed to implement the accepted publication, archival, rollback, and eligibility rules? | **Resolved at policy level by accepted L-40:** pre-publication checks and approval, eligibility-change safeguards, archival, rollback, failure handling, and auditability are established. Detailed production runbooks, technical recovery procedures, and operational responsibilities remain open. |
| OD-02 | What exact operational runbook details, including named operators, verification evidence, recovery-material custody, emergency contacts, and review deadlines, are required before production? | **Resolved at policy level by accepted L-41.** The actual operators, verification evidence, custody details, emergency contacts, and review deadline must be populated in the production runbook before launch. |
| OD-03 | What exact request-initiation UI details and additional request fields are required beyond L-23? | Resolved by accepted L-30: required reason and complete proposed values; no attachments in the initial release; immutable after submission with withdrawal/re-submission; mandatory rejection reason; administrators cannot edit the proposal. |
| OD-04 | What are the cross-version migration procedures, historical-entry editing policy, and operational publication/rollback runbook for the schema registry? | L-27 resolves schema-definition storage as JSONB; migration and operational procedures remain open |
| OD-05 | How are concurrent pending-enrollment creation requests serialized across different templates for one email? | Resolved by accepted L-31: one pending enrollment per normalized email across all templates; same-scope requests reuse it, while different-scope requests cancel and replace it through a trusted atomic workflow with prior unused codes invalidated. Concurrency-safe enforcement details remain for migration design. |
| OD-06 | What are account deletion, anonymization, retention, export, and legal policies? | Resolved at principles level by accepted L-32: separate identity from historical records, disable access, and apply documented data-category-specific retention/deletion/anonymization rules without silent historical alteration. Numeric retention periods, legal exceptions, export procedure, backup handling, and technical mechanisms remain open. |
| OD-07 | What are stable target-key and cross-version mapping rules? | Resolved by accepted L-35: stable target identity plus explicit mapping between template versions. Exact key format, mapping approval authority, multi-target relationship representation, reporting rules, and conflict handling remain open. |
| OD-08 | What are the audit event taxonomy, retention period, and export policy? | Resolved at principles level by accepted L-34: unified audit event model for sensitive events, with separate retention and export policies. Exact event catalogue, numeric retention periods, export format/permissions, backup handling, and operational safeguards remain open. |
| OD-09 | How should inactive targets and archived assignments appear in historical dashboards? | Resolved by accepted L-36: separate current dashboard and historical archive. Detailed filters, historical metric calculations, visual comparison, and handling of unavailable retained data remain open. |
| OD-10 | What mentor-review statuses are required, and does review affect entry status? | Resolved by accepted L-37: mentor review is an independent workflow and does not itself change log-entry status or constitute formal approval. Review-cycle granularity, reopening, trainee responses, and repeated-cycle history remain open. |
| OD-11 | Are failed transition attempts stored in `template_transitions` or only in `audit_logs`? | **Resolved by accepted L-38:** `template_transitions` records only successful transitions; failed/rejected attempts are recorded in `audit_logs`. Operational handling of audit-write failure, detailed failure taxonomy, and retention specifics remain open. |
| OD-12 | What are the final source-approved field/validation requirements per specialty and log type? | **Resolved at policy level by accepted L-39:** source-first requirements with traceable sources/design rationale; unsupported medical requirements remain unapproved. Selecting sources, extracting/reviewing actual fields, assigning detailed approval responsibilities, and final schemas remain open. |
| OD-13 | What detailed operational procedures are required for publication, archival, rollback, and template eligibility? | **Resolved at policy level by accepted L-40:** lifecycle safeguards and required operational principles are defined. Detailed runbooks, audit-write failure handling, technical recovery procedures, and production responsibilities remain open. |
| OD-14 | What is the final retention/deletion policy for expired activation-code rows? | Security and retention |
| OD-15 | What remaining operational details must be specified for Super Admin emergency recovery before production? | **Resolved at policy level by accepted L-41.** Populate environment-specific operator names, contact details, verification evidence, recovery-material custody, and review deadline in the production runbook. |

## Consistency rule

When an accepted decision changes, update this register and both design documents together and preserve the decision history. A proposal, example, or generated document does not itself imply approval.

**Current status: decisions recorded through L-41; design documents remain pending final review. No implementation is claimed.**


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


### L-28 — Template Lifecycle Operations
**Status: Accepted**

**Lifecycle states and assignment eligibility**
- Template lifecycle states remain `DRAFT`, `PUBLISHED`, and `ARCHIVED`. Assignment eligibility is controlled separately by `is_assignable`, consistent with L-21.
- A `DRAFT` template is never assignable.
- A `PUBLISHED` template may receive new assignments or serve as a transition destination only when `is_assignable = TRUE`.
- A `PUBLISHED` template with `is_assignable = FALSE` may remain in use by existing assignments but cannot receive new assignments or serve as a transition destination.
- An `ARCHIVED` template cannot receive new assignments or serve as a transition destination.

**Publication requirements**
- Publication requires successful automated validation of schema definitions and completion of applicable publication checks.
- Publication also requires documented administrative approval through a restricted, trusted workflow.
- A failed validation, failed required check, or unsuccessful publication operation must not result in a partially published template or partially applied eligibility change.
- Once published, a template version's defining content must not be modified in place. Any change to published content requires a new version.
- Publication and sensitive lifecycle changes must be auditable, including the acting administrator, timestamp, action, and reason.

**Eligibility changes and existing assignments**
- Changing `is_assignable` must not automatically migrate, suspend, or replace existing trainee assignments.
- Publishing, disabling eligibility, archiving, or rolling back a template must not automatically move trainees to another template version.
- Any trainee transition remains a separate authorized operation governed by L-03 and L-21.

**Rollback**
- Rollback means disabling new use of an affected version and, where appropriate, restoring eligibility for a previously published version after verifying its validity, eligibility, and compatibility for the intended template and log-type use.
- Rollback must not delete or rewrite template versions, alter historical records, reinterpret historical entries, or automatically migrate existing assignments.
- A previously archived version cannot be reopened by rollback. If its content is needed again, a new version must be created and pass the applicable publication requirements.
- Rollback-related status and eligibility changes must be authorized, auditable, and applied atomically.

**Archival**
- Archival is terminal for the archived template record. An `ARCHIVED` record cannot be returned to `DRAFT` or `PUBLISHED`.
- Archival does not delete the template, its assignments, or its historical records.
- If archived content is needed again, a new template version must be created and pass the applicable publication requirements.

**Enforcement and scope**
- These rules must be enforced through trusted backend/database controls; frontend filtering alone is insufficient.
- The detailed operational checklist and runbook may be documented separately, but must implement these accepted lifecycle rules.
- Cross-version migration and historical-entry editing remain open for separate review and approval.
- This decision does not authorize migrations or backend implementation by itself.


### L-29 — Super Admin Emergency Recovery Procedure
**Status: Accepted**

**Authorized operators and identity verification**
- Emergency recovery may be initiated and executed only by an operator authorized in advance under a documented procedure.
- The requester's identity and authority must be verified using a documented method independent of frontend-controlled state and user-editable role claims.
- Supabase Auth remains the authentication mechanism. Emergency recovery must not create a parallel identity system or bypass authentication.

**Authorization and approvals**
- Emergency privilege recovery requires approval from two independently authorized persons whenever operationally available.
- If a second approver is unavailable and delaying recovery would create a material risk of permanent administrative lockout, a narrowly scoped emergency exception may be used under the documented procedure.
- The exception must include a recorded justification, the identity of the executing operator, the approval limitation, the actions performed, and the reason the normal approval process could not be completed.
- An emergency exception does not waive identity verification, authentication, least-privilege requirements, or audit recording.
- Every use of the exception requires independent post-recovery review.

**Recovery materials and privilege scope**
- Recovery materials must be stored securely and separately from the application and source-code repository, with access restricted to authorized persons.
- Access to and use of recovery materials must be documented.
- Recovery must grant only the minimum privileges required to restore administrative control.
- Temporary privileges, credentials, or emergency access mechanisms must be revoked or reviewed promptly after recovery.

**Audit and post-recovery review**
- The audit record must capture the initiating request, identity-verification outcome, operator, approver or exception rationale, timestamps, actions performed, and resulting privilege changes.
- An independent authorized reviewer who did not execute the recovery must review the outcome, relevant audit records, and privilege changes.
- The reviewer must document the conclusion, any irregularities, and any corrective actions required.
- Successful authentication alone does not constitute completion of the recovery procedure.

**Operational requirements and scope**
- Before production, an operational runbook must define the authorized operators, identity-verification evidence, secure recovery-material handling, emergency contact process, approval and exception steps, and post-recovery review deadline.
- The implementation must preserve the existing authentication and authorization boundaries and must not depend on frontend-only controls.
- This decision does not authorize migrations or backend implementation by itself.


### L-30 — Submitted-Record Correction Request Details
**Status: Accepted**

- A correction request is tied to one submitted log entry and the exact revision on which the request is based. It contains the trainee's mandatory correction reason and complete proposed replacement state, including every affected scalar field and target/context/procedure association. Requester identity and request timestamps are derived by trusted system logic.
- Correction-request attachments are excluded from the initial release.
- Once submitted, the request's content and proposed values are immutable; lifecycle metadata may change only through the authorized workflow. The trainee may withdraw it only while it is still `PENDING` and before an administrative decision. Withdrawal sets the request to `CANCELLED`, is audited, and does not change the submitted entry. To change the proposal, the trainee must withdraw the pending request and submit a new one. The one-open-request-per-entry rule in L-23 continues to apply.
- The Super Admin must decide the proposal as submitted: approve it as-is or reject it. The administrator must not edit the trainee's proposed values. Any changed proposal must come from a new trainee-submitted request.
- A rejection requires a non-empty administrative reason. Store the reason with the decision and include it in the audit trail. Approval and successful application remain distinct under L-23; the entry changes only through the approved atomic application workflow.
- L-30 resolves OD-03. It is a design decision only and does not authorize migrations, backend implementation, or database changes.


### L-31 — One Pending Enrollment Per Normalized Email
**Status: Accepted**

- At most one `PENDING` enrollment may exist for a normalized email across all specialties and template versions.
- When an eligible pending enrollment exists for the same normalized email and the same selected template/scope, trusted logic reuses that enrollment under L-20; it does not create a duplicate.
- When an administrator requests a different template/scope for that normalized email, the system must cancel the existing pending enrollment and create a new pending enrollment rather than mutate the old enrollment's template/scope. The operation must be performed through trusted logic and be atomic: cancel the old enrollment, revoke/invalidate its unused activation codes, create the replacement enrollment and its activation code as applicable, and record the relevant audit event. Failure must not leave a partially replaced invitation.
- This replacement workflow never cancels or reuses an already activated enrollment and must not create duplicate assignments. If the trainee already has an active assignment, activation still follows the explicit transition workflow under L-03/L-10.
- Concurrent create/reuse/replacement attempts for the same normalized email must be serialized and enforced through trusted logic and an appropriate database-level concurrency-safe mechanism; frontend checks alone are insufficient.
- L-31 resolves OD-05 at the policy level. Exact constraints/indexes and transaction implementation remain migration-design work. L-31 is design-only and does not authorize migrations or backend implementation.


### L-32 — Account Deletion, Data Retention, and Historical Integrity
**Status: Accepted**

- Account closure or deletion does not automatically require deleting historical training records linked to the account. Identity data and historical records should be managed separately to the extent supported by the design and applicable obligations.
- Access must be disabled through a trusted server-side process when required by the account-closure workflow. Disabling access alone does not constitute completion of a data-deletion request.
- A documented policy must define, by data category, purpose and retention period; applicable deletion and anonymization conditions; handling of backups and derived data where relevant; and procedures for deletion, export, and applicable legal rights.
- Historical records, revision history, and audit records must not be silently deleted or altered. Any permitted deletion or anonymization must use a restricted trusted workflow and be documented according to the approved audit policy.
- Personal data that no longer has a justified retention basis should not be retained unnecessarily. Historical integrity does not justify indefinite retention of all personal data.
- Account deletion or anonymization must not silently change the meaning of historical records, reassign them to another person, or make them appear to be new records.
- Before production, operational and legal policies must define retention periods, deletion/anonymization/export handling, responsible permissions, and effects on records and backups.
- L-32 establishes principles only. Numeric retention periods, specific legal exceptions, final technical deletion/anonymization mechanisms, and database changes remain open. L-32 does not authorize implementation or migrations.


### L-34 — Audit Taxonomy, Retention, and Export
**Status: Accepted**

- Use a unified audit model for sensitive security, administrative, and training-record events across the platform.
- Where applicable, event records include trusted actor identity, event type, affected entity/type, timestamp, outcome, required reason, and a reference to the related revision or decision.
- Ordinary users cannot modify or delete audit records through normal application operations. Writes must use restricted trusted paths; client-supplied actor identity or role is not authoritative.
- Organize sensitive events into categories including authentication/security, enrollment/activation, assignment/transition, correction/revision, template/schema lifecycle, administrative emergency recovery, and audit export. The detailed event catalogue remains open.
- Define a separate documented retention policy by event category, purpose, and applicable legal obligations, including relevant deletion/anonymization and backup handling. L-34 does not establish numeric retention periods or require indefinite retention.
- Restrict audit export to authorized roles and purposes. The export policy must define scope, privacy controls, file handling, and recording of export requests and outcomes.
- Exact event types, database schema, retention periods, export formats/permissions, and operational safeguards remain open. L-34 establishes principles only and does not authorize migrations or backend implementation.


### L-35 — Stable Target Identity & Cross-Version Mapping
**Status: Accepted**

1. **Stable identity:** Every training target must have a stable identifier independent of its name or description, remaining distinct across changes and template versions.
2. **Version-specific definitions:** A target's definition within each template version remains independently preserved as historical content, including its name, description, and version-specific properties.
3. **Explicit mapping:** Relationships between targets in different versions must be recorded explicitly. Equivalence must not be inferred from name or description similarity alone.
4. **Supported relationship types:** `SAME_TARGET` (same target continues), `REPLACED_BY` (an old target is replaced), `SPLIT_INTO` (an old target splits into multiple targets), `MERGED_INTO` (multiple old targets merge into a new target), and `NO_EQUIVALENT` (no equivalent target exists in the new version).
5. **Historical integrity:** Trainee records remain linked to their original template version and are not automatically reinterpreted or changed when a new version is published.
6. **Coverage and reporting:** Historical target coverage is not automatically transferred to or aggregated into new-version targets. Cross-version reporting may use only explicit, approved mappings and only where the applicable reporting rules permit it.
7. **Mapping governance:** Mappings must be reviewable and traceable, and an authorized approval authority must be defined before mappings are used in cross-version coverage reports. The exact authority remains open.
8. **No implicit migration:** A mapping does not itself migrate historical records, change existing assignments, or automatically transfer trainee data.
9. **Open details:** Stable-key format and naming rules, approval authority, representation of multi-target mappings, exact reporting calculations, and handling of incomplete or conflicting mappings remain open.

L-35 is design-only. It does not authorize database migrations, schema changes, or implementation.


### L-36 — Historical Dashboards for Inactive Targets and Archived Assignments
**Status: Accepted**

1. **Current dashboard:** The primary dashboard displays progress for the active assignment only, against the logbook template version linked to that assignment. Current metrics are calculated from targets and records in that assignment's scope under its applicable calculation rules. Historical assignments do not automatically contribute to current progress.
2. **Historical archive:** Provide a separate historical view for inactive and archived assignments, accessible subject to authorization and applicable data-retention policies. Display each historical record against its original assignment and template version, preserving historical target definitions.
3. **Historical integrity:** Archiving an assignment does not delete its historical records or automatically transfer them to another assignment. Historical progress remains distinct from current progress.
4. **Cross-version comparison:** Comparisons may be shown where explicit, approved mappings exist under L-35. Such comparison does not mean an old achievement automatically satisfies a current-version requirement; equivalence must not be inferred from names alone.
5. **Authorization:** Current and historical views remain subject to existing authorization rules. Historical views do not grant additional access to mentors or other roles. Availability of historical data remains subject to applicable retention and data-management policy, consistent with L-32.
6. **Open details:** Archive filters by specialty, date range, and template version; display behavior for retired, replaced, or split targets; historical metric calculations; visual comparison details; and handling of data unavailable under retention policy remain open.
7. **Implementation boundary:** L-36 is design-only and does not authorize migrations, database changes, backend changes, or UI implementation.


### L-37 — Mentor Review Workflow and Statuses
**Status: Accepted**

1. **Separate concerns:** Mentor review is independent of log-entry status and formal approval. Changing review status does not automatically change entry status and is not formal approval.
2. **Review statuses:** Use `NOT_REVIEWED` (review has not started), `IN_REVIEW` (review is in progress), `FEEDBACK_PROVIDED` (feedback has been provided), and `REVIEWED` (the current review cycle is complete with no outstanding feedback within that cycle). These statuses describe review only and do not replace entry or formal approval statuses.
3. **No formal approval:** No mentor-review status constitutes formal approval. Formal approval and correction authorization/application remain governed by prior decisions, including L-17, L-23, and L-30.
4. **Feedback:** Mentors may provide educational feedback within their permissions, but cannot directly edit submitted entries or apply corrections. Feedback alone does not change the entry, constitute formal rejection, or imply trainee agreement.
5. **Authorization and auditability:** Mentors may review only records for trainees assigned to them, subject to existing authorization rules. Review status changes and feedback must be traceable, including trusted actor identity and timestamp. Client-supplied identity or role is not authoritative.
6. **Open details:** Whether review attaches to each entry or each entry revision; whether a completed review can be reopened; how trainee responses and feedback resolution are represented; whether separate open/resolved feedback states are needed; and how repeated review cycles preserve prior history remain open.
7. **Implementation boundary:** L-37 is design-only and does not authorize migrations, database changes, backend changes, or UI implementation.


### L-38 — Failed Assignment Transitions and Audit Logging
**Status: Accepted**

1. **Successful transitions:** `template_transitions` records only assignment/template transitions that actually completed successfully. Each successful transition is also recorded in `audit_logs`.
2. **Atomic success:** The assignment-state change, successful transition record, and associated audit event must commit atomically. A partially completed transition must not be represented as successful.
3. **Failed or rejected attempts:** Failed/rejected attempts are recorded in `audit_logs` only. They must not create a `template_transitions` row representing a transition that did not occur. Logging an attempt does not change assignment state.
4. **Audit information:** Where applicable, record trusted actor identity, timestamp, operation type, target assignment, outcome, and failure/rejection reason. Minimize collected data and do not include secrets or unnecessary sensitive details.
5. **Authorization and integrity:** Existing authorization and transition rules, including L-03 and L-21, continue to apply. Client-supplied identity or role claims are not authoritative.
6. **Retention:** Audit events follow L-34 audit retention/export principles and L-32 data-management and retention principles.
7. **Open operational details:** Handling audit-write failures; final failure/rejection taxonomy; detailed retention for failed attempts; repeated or suspicious attempt handling; and technical atomicity/consistency mechanisms remain open.
8. **Implementation boundary:** L-38 is design-only. It does not authorize migrations, database changes, backend changes, or UI implementation.


### L-39 — Source-First Specialty Requirements and Validation
**Status: Accepted**

1. **Source-first policy:** Medical requirements for each specialty and log type must be grounded in identified, approved sources, including source/version details where applicable. Unsupported assumptions must not be presented as approved medical requirements.
2. **Traceability:** Each requirement must be traceable either to a supporting source or to a documented platform design decision. Distinguish source-supported requirements, platform design decisions, and requirements awaiting verification/approval.
3. **Field and validation specification:** Before approving a log type's requirements, document applicable required/optional fields, data types, allowed values, and validation constraints, along with the supporting source or rationale. A medical validation rule must not be made mandatory merely for implementation convenience.
4. **Schema publication:** L-24 through L-28 continue to apply. Technical schema validity is necessary but does not establish medical correctness or completeness. Medical content must be reviewed and approved through the trusted workflow before being treated as final.
5. **Unresolved requirements:** Unverified or undocumented medical requirements remain open for review and must not be filled by guessing. L-39 does not establish that all fields or requirements for General Surgery, Neurology, or Anaesthesia & Critical Care have already been defined.
6. **Scope and implementation boundary:** This policy applies to the three MVP specialties and their relevant log types. L-39 does not itself approve a specific field list or final schema and does not authorize migrations, database changes, backend changes, or UI implementation.
7. **Remaining work:** Identify and document approved sources for each specialty/log type; extract and review actual field requirements; define detailed approval responsibilities; and prepare final schemas consistent with approved requirements and template versions.


### L-40 — Template Lifecycle Operational Safeguards
**Status: Accepted**

1. **Scope and consistency:** L-40 defines operational safeguards for template publication, eligibility changes, archival, and rollback. L-21 and L-28 remain authoritative for lifecycle states, assignment eligibility, and publication requirements.
2. **Pre-publication checklist:** Before publication, the trusted workflow verifies schema validity and applicable required checks, confirms documented administrative approval through a restricted trusted workflow, and ensures unresolved medical requirements are not treated as approved final requirements under L-39. A failed required check must not leave a partially published template or partially applied eligibility change.
3. **Eligibility changes:** Changes to `is_assignable` must validate the template state and L-21/L-28 eligibility rules, run through a trusted workflow, and record actor, timestamp, action, and reason. Frontend filtering alone is insufficient. Eligibility changes do not automatically migrate, suspend, or replace existing trainee assignments.
4. **Archival:** Archival must be validated and audited. An archived version cannot receive new assignments or serve as a transition destination. Historical assignments and records remain linked to and interpretable against their original version; archival does not delete, transfer, or reinterpret them. An archived version is not reopened; future use requires a new version subject to applicable checks and approval.
5. **Rollback:** Rollback disables new use of the affected version. Eligibility for a previously published version may be restored only after verifying validity and compatibility for the intended template/log-type use. Rollback must not modify published content in place, delete or rewrite versions/history, change historical schema references, reinterpret historical entries, or automatically migrate trainees. Trainee transitions remain separate authorized operations under L-03 and L-21.
6. **Failure handling and consistency:** Lifecycle operations must prevent partially applied or inconsistent committed states. Failed operations must not be treated as successful or leave partially published state/eligibility changes. The previously committed state is preserved according to the trusted operation's consistency guarantees, and current state must be checked before retry.
7. **Auditability:** Sensitive lifecycle changes are recorded through trusted workflows, including actor, timestamp, action, reason, and outcome where applicable. L-34 governs audit principles. Client-supplied identity or role claims are not authoritative.
8. **Open operational details:** Detailed production checklists/runbooks; technical recovery and retry procedures; handling audit-write failure; precise operational responsibilities and review steps; and technical consistency mechanisms remain open for production readiness.
9. **Implementation boundary:** L-40 is design/operational policy only. It does not authorize migrations, database changes, backend changes, or UI implementation.


### L-41 — Super Admin Emergency Recovery Runbook (accepted)
**Status: Accepted**

**Authorized operators and identity verification**
- Emergency recovery is limited to people pre-authorized under a documented procedure.
- The requester's identity and authority must be verified independently of frontend state and user-editable role claims.
- Supabase Auth remains the authentication mechanism; recovery must not create a parallel identity system or bypass authentication.

**Approval process**
- Two independent authorized approvers are required whenever operationally available.
- If a second approver is unavailable and delay creates a material risk of permanent administrative lockout, a narrowly scoped, documented exception is permitted.
- Record the exception rationale, executing operator, approval limitation, why the normal process was unavailable, and actions performed.
- An exception does not waive identity verification, authentication, least privilege, or audit requirements.

**Recovery materials and privilege scope**
- Store recovery materials securely, separately from the application and source-code repository, with access limited to authorized people; document access and use.
- Grant only the minimum privileges required to restore administrative control.
- Revoke or promptly review temporary privileges, credentials, and emergency access mechanisms when no longer needed.

**Audit and independent review**
- A trusted audit trail records the request, verification, operator, approver(s) or exception, timestamps, actions, and resulting privileges, without exposing secrets or unnecessary sensitive data.
- An authorized reviewer independent of the recovery operator reviews the recovery, documents the conclusion, and records irregularities and corrective actions.

**Production readiness**
- Before production, the operational runbook must name authorized operators, define acceptable verification evidence, recovery-material custody, emergency contacts, approval and exception steps, and the deadline for independent review.
- L-41 resolves OD-02 and OD-15 at the policy level. Actual names, contact details, evidence choices, and deadlines must be filled into the operational runbook before production; this decision does not invent those operational facts.

**Implementation boundary**
- L-41 is a design and operational-policy decision only. It authorizes no migrations, database changes, backend implementation, or UI implementation.
