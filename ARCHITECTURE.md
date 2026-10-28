# MENTORO Platform Architecture

## Project Vision

MENTORO is a centralized medical training and mentorship platform. One trainee account may enroll in several independent trainings at the same time, including multiple trainings in one specialty. Each confirmed enrollment gets its own independent logbook instance, linked to one mentor, one specialty, one training period/status, and one published version of the specialty template.

Existing specialty logbooks are retained as reference sources while their schemas and UI behaviors are assessed. Do not copy an old app wholesale or deploy an unvalidated ZIP; migrate the approved clinical requirements into the shared logbook engine and keep each specialty definition versioned.

## Technology Stack
- Frontend: Vite, Vanilla JavaScript, and CSS.
- Trusted application backend: Vercel-hosted Node.js API for protected writes and server-side authorization/validation.
- Identity and sessions: Supabase Auth.
- Database: Supabase PostgreSQL with RLS, explicit grants/constraints, and narrowly scoped RPC/database functions for atomic multi-row workflows.
- Specialty payload validation: Ajv 8 with JSON Schema Draft 2020-12 in the trusted backend.
- Hosting/version control: Vercel, Git, and GitHub.

The protected-write boundary remains Vercel API + Supabase Auth + PostgreSQL RLS/scoped RPCs. The current test schema is implemented and tracked by the migrations under `supabase/migrations/`; the full UI/API flow is still under development. No production migration or deployment has been made.

## Roles, Identity, and Enrollment Flow
- One central identity per person, with a trainee profile and optionally a mentor profile when the role is granted by an authorized admin.
- A trainee can hold multiple concurrent applications/enrollments, including the same specialty and same mentor.
- Each enrollment has exactly one trainee and one mentor, and creates exactly one independent logbook instance pinned to a published template version.
- Account signup and university-ID verification are separate from training application, mentor review, and admin booking confirmation.
- Mentor authorization is scoped to the mentor on each enrollment. A mentor cannot access unrelated enrollments of the same trainee.
- Prior activation-code and one-active-assignment rules are superseded by ADR-03.

## Core Entities

The current schema includes `profiles`, `profile_roles`, `trainee_profiles`, `mentor_profiles`, `verification_documents`, `specialties`, `training_offerings`, `training_slots`, `training_applications`, `training_enrollments`, `logbook_templates`, `logbook_template_versions`, `logbook_instances`, `logbook_entries`, `entry_reviews`, `assessments`, and `audit_logs`. The canonical relationships and lifecycle rules are documented in `docs/MENTORO_TARGET_DATA_MODEL_V2.md`.

The four current migration files are applied only to the isolated test Supabase project. The production project and public website are unchanged.

## Trusted Backend, Security, and Atomicity (ADR-01)
- Protected write workflows pass through a Vercel-hosted Node.js API that verifies the Supabase Auth session and derives the actor from verified authentication state.
- The backend performs object-level authorization and checks trainee, mentor, assignment, specialty, template-version, and lifecycle scope as applicable. Client-supplied IDs, role labels, ownership claims, or permission assertions are not authoritative.
- PostgreSQL RLS remains enabled for protected data and is designed together with explicit grants and constraints. Backend checks supplement, not replace, RLS.
- Use narrowly scoped PostgreSQL RPC/database functions and transactions for multi-row operations requiring all-or-nothing behavior. Related state changes and required revision, transition, and audit records must commit atomically.
- All specialty payload writes are validated in the trusted backend with Ajv 8 / JSON Schema Draft 2020-12 against the exact schema selected by template version and log type. Frontend validation is supplementary.
- Never expose the Supabase service-role key or privileged secrets to browser code, client bundles, public assets, logs, or repository files. Any privileged server-side credential use requires explicit justification, secure server-only configuration, least privilege, and does not bypass authorization.
- Do not permit alternate write paths to bypass authorization, schema validation, lifecycle constraints, or required audit behavior. Concurrency-sensitive invariants must be enforced in database/transaction design, not only in the UI.
- Any future SECURITY DEFINER function requires explicit review of search_path, execute grants, owner privileges, and RLS interaction. ADR-01 does not pre-approve specific function implementations.

### Atomic workflow examples
Activation/enrollment, assignment transitions, correction application, and template/schema publication or eligibility changes must use a reviewed transaction boundary where all related state and required audit/revision/transition records either commit together or roll back together. A failed operation must not leave partial state or be reported as successful.

### Implementation boundary
Exact SQL types, constraints, grants, RLS policies, RPC signatures, locking/isolation choices, API routing, error contracts, and audit-write failure handling remain implementation-design work. No migrations, code, secrets, deployment, or tests are created or approved by ADR-01.

## Specialty Modules
- Each specialty retains its own roadmap, log types, validation rules, and presentation requirements.
- Shared platform services manage identity, authorization, assignments, and common infrastructure.

## Coverage Semantics
- Coverage represents documented exposure, not competence or certification.
- Historical evidence must not disappear merely because a reference item becomes inactive.
- Do not store patient-identifying information in training logs.

## Environment Strategy
- Keep development and production environments separate.
- Never run destructive database resets against production.

## Implementation Phases
- Phase 01 — Canonical architecture and data model (completed for the initial test schema).
- Phase 02 — Database security/RLS baseline (applied to isolated test; authenticated actor-level and concurrency tests still required).
- Phase 03 — Auth, account verification, role dashboards, and booking workflow (in progress).
- Phase 04 — General Surgery logbook vertical slice and mentor review (pending).
- Phase 05 — Migrate and validate remaining specialty templates (pending).
- Phase 06 — Preview acceptance testing before any production rollout (pending).

## Architectural Change Control
All architectural changes must be recorded, reviewed, and approved via Architectural Decision Records (ADRs), which are tracked in the `docs/decisions/` directory.


## ADR-01 — Trusted Backend and Atomic Write Boundary (accepted)

**Status:** Accepted by project owner on 2026-10-11. ADR-01 defines the intended trusted write boundary; implementation details and migration status are tracked in `docs/IMPLEMENTATION_STATUS.md`.

### Decision
- Use a Vercel-hosted Node.js API as the trusted application backend for protected write workflows and other operations requiring server-side authorization or schema validation.
- Use Supabase Auth for identity/session authentication and Supabase PostgreSQL as the data store. Use PostgreSQL transactions and narrowly scoped RPC/database functions for multi-row operations that must succeed or fail atomically; keep RLS and database constraints as independent defense-in-depth controls.
- Use Ajv 8 with JSON Schema Draft 2020-12 in the trusted backend for specialty payload validation against the exact schema version associated with the relevant template version and log type.
- Frontend validation is usability support only. It must not be treated as an authorization, integrity, or medical-content boundary.

### Security boundaries
- The backend must verify the Supabase Auth session/token and derive the acting identity from verified authentication state. Never trust client-supplied user IDs, role labels, assignment IDs, ownership claims, or other authorization assertions without server-side verification.
- Authorization must be checked for every protected operation, including object-level access and assignment/template scope. RLS remains enabled for protected data and must be designed alongside explicit database grants; backend authorization does not replace RLS.
- Never expose the Supabase service-role key or other privileged secrets to browser code, public assets, client bundles, logs, or repository files. Prefer user-scoped credentials and least privilege; any privileged server-side credential use must be narrowly justified, isolated to server configuration, and never bypass application authorization checks.
- Do not create alternate direct-write paths that bypass required authorization, schema validation, lifecycle rules, or audit behavior. Any deliberately permitted direct database operation must be explicitly designed, granted, and tested against the same security contract.

### Atomicity and audit boundaries
- Multi-step operations such as activation/enrollment, assignment transition, correction application, schema publication/eligibility changes, and other accepted workflows requiring all-or-nothing behavior must use a transaction/RPC boundary that atomically applies all related state changes and required audit/revision/transition records.
- A failed operation must not leave partial state or be reported as successful. Concurrency-sensitive invariants must be enforced by database constraints/locking/transaction design, not UI checks alone.
- Trusted backend and database function permissions must follow least privilege. Functions using SECURITY DEFINER, if selected, require explicit justification, safe search_path handling, restricted execute grants, and review; no such implementation detail is assumed approved by this ADR.
- RLS policies, grants, constraints, trusted function interfaces, transaction boundaries, and audit-write failure behavior must be specified and reviewed before migrations or production writes. The service-role key must not be used as a substitute for a proper authorization model.

### Consequences and remaining design work
- Vercel Node.js is the selected trusted API runtime; exact API routing/layout, session propagation, error contracts, deployment configuration, and privileged-operation policy remain implementation-design tasks.
- Exact SQL types, keys, indexes, RLS policies, grants, RPC signatures, transaction isolation/locking choices, and migration sequencing remain open until the executable database/security design is reviewed.
- This ADR does not approve any SQL migration, schema change, backend/frontend implementation, secret provisioning, deployment, or test-completion claim.
