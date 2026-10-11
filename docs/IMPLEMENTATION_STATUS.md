# MENTORO — Implementation Status

**Updated:** 2026-10-11
**Phase:** Final policy review complete; preparing implementation design
**Implementation status:** Documentation only. No migrations, application implementation, or database tests are claimed.

- Added `docs/MENTORO_EXECUTABLE_DB_DESIGN_MATRIX.md` as a table-by-table review matrix for `profiles`, `user_roles`, `pending_enrollments`, `activation_codes`, and `trainee_assignments`. It lists candidate uniqueness predicates, trusted write boundaries, RLS/grant review items, activation atomicity, and minimum test gates. It is design-only; the Super Admin global uniqueness strategy, exact role grants/RLS, FK/check constraints, RPC signature, and lock/isolation design remain open. No migrations or tests were run.
- Added `docs/MENTORO_ROLE_SECURITY_CONTRACT.md` to define role grant/revocation behavior, the global Super Admin concurrency guard, emergency recovery constraints, and the Vercel/PostgreSQL privilege-boundary review. It is design-only; the connection model, lock primitive, exact grants/RLS/RPC SQL, and tests remain open.
- Expanded the matrix with a candidate global uniqueness index for one active platform-wide Super Admin, a serialized last-admin revoke guard, and an explicit warning that Supabase service-role access bypasses RLS even for `SECURITY INVOKER` RPCs. The actual Vercel database role/connection model remains a pre-migration decision; no credentials or deployment configuration were changed.

## Accepted executable-design choices (design only)

- Correction requests: `PENDING` is the only decision-pending state; one `PENDING` request per entry. An `APPROVED` request that awaits application also blocks creation of a new request. `REJECTED`, `CANCELLED`, and `APPLIED` do not block a new request. The candidate partial-index predicate and state-transition/locking implementation remain to be finalized.
- Write boundary: sensitive and multi-step writes use the trusted Vercel Node.js API and reviewed atomic database/RPC boundary. A simple direct write is permitted only when its table/operation has an explicitly reviewed GRANTS/RLS/constraint contract.
- Required audit: the event is written in the same transaction as the sensitive state change; audit-write failure rolls back the operation.
- RPC security: `SECURITY INVOKER` by default. Any `SECURITY DEFINER` exception needs explicit justification and review of ownership, safe `search_path`, execute grants, and RLS interaction.
- Identity provisioning: the trusted Vercel Node.js backend is the selected profile-provisioning path after Supabase Auth registration (not a database trigger by default); provisioning must be idempotent and define retry/reconciliation for partial failure.
- Role integrity: role grants/revocations are trusted, audited, and atomic; prevent duplicate active grants per user/role, prevent a second active platform-wide Super Admin, and prevent ordinary operations from removing the last active Super Admin. Initial Super Admin bootstrap is a separate restricted documented operation.
- MVP enrollment/activation: one pending enrollment per normalized email; same-scope requests reuse it; scope replacement cancels the old pending enrollment and revokes unused codes atomically; one unconsumed/unrevoked code per enrollment; redemption, enrollment activation, assignment creation, and required audit writes are atomic.
- MVP assignment integrity: a partial unique index enforces at most one active assignment per profile; activation can create at most one assignment from a pending enrollment and only for an assignable published template. Exact constraints/locking remain migration design.
- Enrollment/activation API contract: `docs/MENTORO_ACTIVATION_API_CONTRACT.md` defines logical admin invitation and code-redemption operations, safe outcomes, transaction invariants, and the minimum race/security test matrix. The MVP delivery choice is one-time display of the plaintext code to the authenticated Super Admin after commit; no email/SMS provider is included. A lost issuance response requires audited replacement. A redemption retry may return the existing result only to the same authenticated profile when the enrollment/assignment linkage proves prior success. Candidate unique-index predicates, the default `SECURITY INVOKER` boundary, restricted server-role execution, lock-order requirements, and profile-provisioning precondition are now documented. These remain design-only; routes, exact RPC signature, SQL constraints/grants/locking, and tests are unimplemented.

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
   - Identity/role-specific gates: settle Auth/profile partial-failure recovery, initial Super Admin bootstrap details, grantor FK behavior, and concurrency-safe last-Super-Admin protection before migration.
2. ADR-01 has selected the trusted backend/deployment boundary (Vercel Node.js API, Supabase Auth, PostgreSQL RLS/grants, and atomic RPC/transactions). The MVP enrollment/activation logical API contract is drafted in `docs/MENTORO_ACTIVATION_API_CONTRACT.md`; exact routes, session handling, RPC signatures, SQL locks/constraints, and executable database contracts remain to be reviewed before migrations.
3. The correction-request policy is defined: one `PENDING` request per entry, and no new request while an `APPROVED` request awaits application. Exact partial-index predicate, state-transition locking, and concurrent enforcement remain migration-design blockers.
4. Enrollment/activation policy and logical atomic operation are drafted for the MVP: pending-enrollment uniqueness per normalized email, serialized scope replacement, one usable code per enrollment, verified-email matching, single-use redemption with same-profile retry handling, assignment linkage to the source enrollment, and atomic audit/state writes. Exact partial indexes, FK/check constraints, RPC signature/security/grants, locking, and race-condition tests remain migration-design blockers.
5. Approve source-traceable medical requirements and final schemas for each specialty/log type before enabling that specialty/log type. Shared infrastructure may be developed in parallel.
6. Implement and run the required security, integrity, concurrency, validation, history, and privacy tests against a real local/test PostgreSQL or Supabase environment.

### Deferred until the relevant feature or production gate

- Detailed executable schema/RLS/RPC contracts for `mentor_assignments` and `template_transitions`; their accepted policy rules remain binding and must be implemented before those features are enabled.

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

The policy-level design review is complete. The project is not yet migration-ready: executable SQL/RLS/grants/trusted-function design, detailed API/session and RPC contracts, concurrency-safe correction and enrollment/activation enforcement, approved specialty schemas, and actual database-backed test results remain required gates. Shared non-destructive scaffolding may proceed while source-approved specialty schemas are completed, but no specialty/log type should be enabled without its approved schema.

Deferred work is limited to features or production-specific details not required for the current implementation slice; see the Implementation blockers vs. deferred work section above. No migrations, database changes, backend/UI implementation, or database tests are claimed by this documentation update.


## Deployment connection review gate (2026-10-11)

- Added `docs/MENTORO_DEPLOYMENT_CONNECTION_REVIEW.md`. The repository was checked for `package.json`, `vercel.json`, `api/index.js`, `supabase/config.toml`, Supabase client setup, environment-variable references, and database connection code; the checked paths/references were not found on `main`.
- This only establishes what is present in the repository, not the live Vercel or Supabase configuration. The actual runtime connection, effective database role and grants, RLS behavior, RPC privileges, pooling/transaction semantics, and lock behavior remain unverified.
- Before migrations or final grants/RPCs, inspect authorized Vercel/Supabase settings without exposing secret values, test against an isolated database, and document the chosen privilege model. Prefer evaluating a dedicated server-only PostgreSQL role without `BYPASSRLS`; if service-role access is retained, explicitly document that RLS is bypassed for that path.
- No application/configuration files, credentials, migrations, policies, RPCs, or tests were changed or executed. This is a documentation-only gate.


## Application foundation scaffold (2026-10-11)

Added the initial app foundation directly on `main`: `package.json`, `.gitignore`, `.env.example`, `index.html`, `src/main.js`, `src/style.css`, `api/health.js`, and `README.md`.

- Frontend scaffold: Vite + vanilla JavaScript/CSS with a minimal MENTORO shell.
- API scaffold: a non-sensitive `/api/health` endpoint that reports application-shell status only; it explicitly does not claim database connectivity or readiness.
- Environment template contains names only. Public browser variables are separated from server-only Supabase values; no real credentials were added.
- No Supabase client, auth flow, database writes, migrations, RLS policies, RPCs, or Ajv schema validation have been implemented. No build or tests were run in a local runtime during this GitHub-only scaffold operation.
- The next implementation gate is to verify the scaffold by pulling it locally and running install/build, then design the first migration and reviewed privilege/RLS boundary before any database write.


## Migration 0001 proposal prepared (2026-10-11)

- Added `docs/MENTORO_MIGRATION_0001_PROPOSAL.md` as a review-only proposal for `profiles`, `user_roles`, and `audit_logs`.
- It preserves open gates rather than inventing executable SQL: actual Vercel/PostgreSQL role and RLS behavior, profile/Auth FK delete semantics under L-32, initial Super Admin bootstrap, last-admin transaction-scoped locking, exact grants/RLS policies, and audit taxonomy/retention.
- No file was added under `supabase/migrations/`; no SQL was run; no Supabase database objects or credentials were changed. The proposal requires review and isolated-database tests before conversion into an executable migration.


## Supabase connection-mode review (2026-10-11)

- Reviewed the project owner's Supabase Connect screenshot and current official Supabase guidance.
- Shared Transaction Pooler (port 6543) is the leading candidate for the Vercel serverless runtime; the default `postgres.<project-ref>` connection identity is not approved for app runtime.
- Added findings and constraints to `docs/MENTORO_DEPLOYMENT_CONNECTION_REVIEW.md`: custom pooler username shape, no prepared statements/session-state assumptions in transaction mode, driver TLS/pool settings, role privilege checks, and the missing Auth JWT context when using raw PostgreSQL.
- Next gate: test a dedicated non-`BYPASSRLS` role and explicit grants in an isolated database; design verified actor propagation; test RLS, transaction rollback, audit failure, and transaction-scoped locks. If this model fails, compare the Data API/server-only secret-key/RPC alternative and document its RLS-bypass implications.
- No database roles, grants, policies, functions, migrations, Vercel environment variables, or credentials were changed. No database connection or runtime tests were performed. This is a documented connection-mode review, not a completed security verification.


## Runtime database role verification plan (2026-10-11)

- Added `docs/MENTORO_RUNTIME_ROLE_VERIFICATION_PLAN.md` with the candidate comparison (dedicated raw-PostgreSQL role versus Data API/RPC), read-only SQL diagnostics, actor-binding requirements, and isolated-database test gates.
- Refined the driver decision: the transaction pooler is suitable for serverless, but driver compatibility must be tested. Current Supabase documentation identifies transaction-mode limitations and a Postgres.js query-pipelining issue; no driver is approved yet.
- The plan specifically prohibits using the administrative `postgres` role as the application runtime identity and keeps migration credentials separate.
- No SQL diagnostics were executed; no database role, grant, policy, function, migration, Vercel variable, or credential was changed. This is a review plan only, not a verified runtime connection.


## ADR-02 — actor context and atomic RPC candidate (2026-10-11)

- Added `docs/decisions/ADR-02-DATA-API-ACTOR-CONTEXT.md` as the recommended candidate to validate first: Supabase Data API/`supabase-js` from the trusted Vercel API, user-token context for user-scoped RLS, and narrowly scoped atomic RPCs for multi-row workflows.
- This avoids using the production `postgres` login in app runtime and avoids raw-Postgres actor-context assumptions. It is still a proposal pending isolated security/concurrency tests, not an accepted production connection model.
- The proposal requires verified actor derivation, server/database authorization, restricted RPC execute grants, reviewed function ownership and safe `search_path`, atomic audit writes, and explicit treatment of any service-role call as bypass-RLS when no user token is present.
- No application code, SQL migrations, roles, grants, policies, RPCs, credentials, or environment variables were changed. Production remains untouched.
- Migration 0001 remains blocked until the test environment and exact bootstrap/FK/locking/grant/RLS/RPC contracts are finalized.
