# MENTORO — Implementation Status

**Updated:** 2026-10-09
**Phase:** Architecture and data-model decisions
**Implementation status:** Documentation only. No migrations, application implementation, or database tests are claimed.

## Accepted through this update

- Decisions register: accepted decisions through L-31.
- Data model and Physical Schema/RLS Contract: design drafts updated to reflect L-31.
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

## Remaining review gates

- Finalize the precise open-state predicate and concurrency-safe uniqueness mechanism for correction requests in the migration design.
- Finalize schema-registry storage representation, exact backend technology/deployment boundary, detailed operational publication/rollback runbook, cross-version migration, and historical-entry editing separately.
- Resolve other open decisions only through explicit user approval; L-30 resolves OD-03 only and does not approve unrelated open decisions.
- Review all design documents together before implementation, then define migrations, grants/RLS, trusted functions, seed data, and rollback strategy.

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
