# MENTORO — Implementation Status

**Updated:** 2026-10-11
**Phase:** Final policy review complete; preparing implementation design
**Implementation status:** Documentation only. No migrations, application implementation, or database tests are claimed.

## Accepted through this update

- Decisions register: accepted decisions through L-41; final policy-level review completed, with implementation blockers and deferred work classified.
- Data model and Physical Schema/RLS Contract: consolidated design drafts through L-41; executable implementation details and migrations remain gated.
- L-25 selects JSON Schema Draft 2020-12 and Ajv 8 for schema definitions and trusted-backend payload validation.
- L-26 requires all application write paths to use a central trusted backend validation path, rejects failed schema publication atomically, and defines safe schema eligibility/rollback principles while preserving historical schema references.
- L-24 defines the database-backed versioned schema registry: stable schema references per template version/log type, trusted backend validation, immutable published definitions, preservation of historical schema references, and restricted/audited schema administration.
- L-23 defines the submitted-record correction lifecycle: complete proposed correction, expected-revision check, one open request per entry, trainee withdrawal before decision, administrative decision authority, stale-request review, and atomic application with complete revision/audit state.
- L-30 resolves correction-request details: no attachments in the initial release; submitted request content and proposed values are immutable; the trainee withdraws a pending request and resubmits to change it; the Super Admin approves/rejects as-is; rejection requires a reason; and OD-03 is resolved.

## Not implemented

- No SQL migrations or database changes have been run.
- No RLS policies or trusted transaction functions have been deployed.
- No tests have been executed against PostgreSQL or Supabase.
- Documentation files can be updated directly on GitHub through the connected repository. Local files still require `git pull` to synchronize.

## Implementation blockers vs. deferred work

### Blockers before migrations or production writes

1. Finalize SQL types, constraints, primary/foreign/composite keys, indexes, grants, RLS, and trusted transaction functions.
2. Select the concrete trusted backend/deployment boundary enforcing authentication, authorization, specialty schema validation with Ajv 8/JSON Schema Draft 2020-12, and atomic writes.
3. Define the open correction-request states and concurrency-safe one-open-request-per-entry enforcement.
4. Define concurrency-safe enrollment/activation enforcement consistent with L-08/L-10/L-31.
5. Approve source-traceable medical requirements and final schemas for each specialty/log type before enabling that specialty/log type. Shared infrastructure may be developed in parallel.
6. Implement and run the required security, integrity, concurrency, validation, history, and privacy tests against a real local/test PostgreSQL or Supabase environment.

### Deferred until the relevant feature or production gate

- Cross-version migration tooling and historical-entry editing beyond preserving historical references.
- Detailed historical-dashboard filters/visual comparisons and additional mentor-feedback cycles beyond L-36/L-37.
- Audit export details, numeric retention periods, backup-specific handling, and applicable legal review before production.
- OD-14: retention/deletion policy for expired activation-code rows, to be decided before production.
- L-41 environment-specific recovery operator details and the publication/rollback, retry, and audit-write-failure runbooks before their production use.

Do not create new policy decisions unless implementation reveals a genuine conflict or material security/data-integrity gap. Track non-blocking items as deferred tasks. This review does not authorize migrations or claim implementation/test completion.

- L-26 is accepted as a design decision only. No migrations, backend implementation, or database tests have been run.


- L-27 is accepted as a design decision: schema definitions use `schema_definition JSONB NOT NULL`; preserving original JSON text formatting/key order is not required. Cross-version migration, historical-entry editing, and the detailed operational publication/rollback runbook remain open.
- L-27 is design-only. No migrations, backend implementation, or database tests have been run. Other open decisions remain unapproved.


- L-28 is accepted as a design decision covering template publication checks and approval, immutable published versions, separate assignment eligibility, rollback to a verified previously published version, and terminal archival. Detailed operational runbooks, cross-version migration, and historical-entry editing remain open.
- L-28 is design-only. No migrations, backend implementation, or database tests have been run. Other open decisions remain unapproved.


- L-29 is accepted as a design decision for Super Admin emergency recovery: pre-authorized operators, dual approval when operationally available with a documented narrow emergency exception, separately secured recovery materials, least privilege, audit recording, and independent post-recovery review.
- Named operators, verification evidence, recovery-material custody details, emergency contacts, and review deadlines remain open for the production runbook. No migrations, backend implementation, or database tests have been run; other open decisions remain unapproved.


- L-30 is accepted as a design decision and resolves OD-03. Correction-request attachments are excluded from the initial release; submitted request content and proposed values are immutable; changing a proposal requires withdrawal and resubmission; the Super Admin cannot edit proposed values; rejection requires a reason. The exact open-state predicate and concurrency-safe database enforcement remain open for migration design.
- L-30 is design-only. No migrations, backend implementation, or database tests have been run; other open decisions remain unapproved.


- L-31 is accepted as a design decision and resolves OD-05 at the policy level: one pending enrollment per normalized email across templates; same-scope requests reuse the pending enrollment; different-scope requests cancel and replace it while invalidating unused prior codes and auditing the atomic workflow. Exact concurrency-safe database enforcement remains migration-design work.
- L-31 is design-only. No migrations, backend implementation, or database tests have been run; other open decisions remain unapproved.


- L-32 is accepted as a principles-level decision for account closure/deletion and historical integrity: separate identity from historical records where appropriate, disable access through trusted server-side logic, and define documented data-category-specific retention/deletion/anonymization/export and backup handling without silent historical alteration.
- Numeric retention periods, legal exceptions, detailed export/backup handling, and final technical mechanisms remain open. L-32 is design-only. No migrations, backend implementation, or database tests have been run; other open decisions remain unapproved.


- L-34 is accepted as a principles-level decision: a unified audit model for sensitive events, with separate category-specific retention and controlled export policies. Exact event catalogue, numeric retention periods, export formats/permissions, backup handling, and operational safeguards remain open.
- L-34 is design-only. No migrations, backend implementation, or database tests have been run; other open decisions remain unapproved.


- L-35 is accepted: stable target identity plus explicit, traceable mapping between template versions. Historical records remain linked to their original template version; no automatic reinterpretation, coverage transfer, or assignment migration. Exact key format, mapping approval authority, multi-target representation, reporting rules, and conflict handling remain open.
- L-35 is design-only. No migrations, schema changes, backend implementation, or database tests have been run as a result of this decision.


- L-36 is accepted: current progress is shown separately from a historical archive for inactive/archived assignments. Historical records retain original assignment/template context; no automatic contribution to current progress or transfer between assignments. Cross-version comparisons require explicit approved mappings under L-35.
- Detailed filters, historical metric calculations, visual comparisons, retired/replaced/split target display, and unavailable-data handling remain open. L-36 is design-only. No migrations, database/backend changes, UI implementation, or database tests have been run as a result of this decision.


- L-37 is accepted: mentor review is independent of log-entry status and formal approval, with review states `NOT_REVIEWED`, `IN_REVIEW`, `FEEDBACK_PROVIDED`, and `REVIEWED`. Mentors may provide feedback but cannot directly edit submitted entries or apply corrections; formal approval/correction authority remains governed by prior decisions.
- Review granularity, reopening, trainee responses, feedback-resolution states, and repeated-cycle history remain open. L-37 is design-only. No migrations, database/backend changes, UI implementation, or database tests have been run as a result of this decision.


- L-38 is accepted: `template_transitions` records only successful assignment transitions; failed/rejected attempts are recorded in `audit_logs` only. Successful assignment-state changes, transition records, and associated audit events must commit atomically. Audit events capture the minimum relevant trusted actor, operation, target, outcome, and reason details without secrets or unnecessary sensitive data.
- OD-11 is resolved by L-38 at policy level. Audit-write failure handling, detailed failure taxonomy and retention, repeated/suspicious attempt handling, and exact technical atomicity/consistency mechanisms remain open.
- L-38 is design-only. No migrations, database changes, backend implementation, UI implementation, or database tests have been run as a result of this decision.


- L-39 is accepted: source-first policy for specialty/log-type requirements. Requirements must be traceable to approved sources or documented platform design decisions; distinguish source-supported requirements, design decisions, and items awaiting verification. Technical schema validity alone does not establish medical correctness or completeness.
- OD-12 is resolved at policy level by L-39. Approved source selection, actual field extraction/review, detailed approval responsibilities, and final specialty/log-type schemas remain open.
- L-39 is design-only. No migrations, database changes, backend implementation, UI implementation, or database tests have been run as a result of this decision.


- L-40 is accepted: operational safeguards for template publication, eligibility changes, archival, rollback, failure handling, and auditability. Existing assignments and historical records are not automatically migrated, rewritten, deleted, or reinterpreted by lifecycle operations.
- OD-01 and OD-13 are resolved at policy level by L-40. Detailed production runbooks, technical recovery/retry procedures, audit-write failure handling, operational responsibilities, and technical consistency mechanisms remain open.
- L-40 is design/operational policy only. No migrations, database changes, backend implementation, UI implementation, or database tests have been run as a result of this decision.


- L-41 is accepted: Super Admin emergency recovery requires pre-authorized operators, independent identity/authority verification, two independent approvers when operationally available, a narrow documented exception for material permanent-lockout risk, secure separate recovery-material custody, least privilege, trusted audit, and independent post-recovery review.
- OD-02 and OD-15 are resolved at policy level by L-41. Environment-specific operator names, verification evidence, recovery-material custody, emergency contacts, approval/exception steps, and review deadline must be populated in the production runbook before launch.
- L-41 is design/operational policy only. No migrations, database changes, backend implementation, UI implementation, or database tests have been run as a result of this decision.


## Final review through L-41

The policy-level design review is complete. The project is not yet migration-ready: the executable SQL/RLS/grants/trusted-function design, concrete backend validation boundary, concurrency-safe correction and enrollment/activation enforcement, approved specialty schemas, and actual database-backed test results remain required gates. Shared non-destructive scaffolding may proceed while source-approved specialty schemas are completed, but no specialty/log type should be enabled without its approved schema.

Deferred work is limited to features or production-specific details not required for the current implementation slice; see the Implementation blockers vs. deferred work section above. No migrations, database changes, backend/UI implementation, or database tests are claimed by this documentation update.
