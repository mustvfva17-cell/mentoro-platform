# MENTORO Platform Architecture

## Project Vision
MENTORO is a centralized medical training platform supporting three initial specialty logbooks:
1. General Surgery
2. Neurology
3. Anaesthesia & Critical Care

Existing logbook projects are kept outside this repository and must remain untouched. We may consult them later as references, but do not copy or import their code.

## Technology Stack
- Frontend: Vite, Vanilla JavaScript, and CSS.
- Trusted application backend: Vercel-hosted Node.js API for protected writes and server-side authorization/validation.
- Identity and sessions: Supabase Auth.
- Database: Supabase PostgreSQL with RLS, explicit grants/constraints, and narrowly scoped RPC/database functions for atomic multi-row workflows.
- Specialty payload validation: Ajv 8 with JSON Schema Draft 2020-12 in the trusted backend.
- Hosting/version control: Vercel, Git, and GitHub.

The approved security and atomicity boundaries are defined in ADR-01 in the decisions register. This stack decision is design-only; it does not authorize implementation or migrations.

## Roles, Identity, and Enrollment Flow
- One central identity per user.
- A trainee may have multiple specialty assignments.
- Each assignment links a trainee to a specialty and a specific logbook template/version.
- Activation codes must be single-use, securely stored as hashes, and must not grant Admin privileges.
- Subsequent access uses authenticated sessions.

## Preliminary Core Entities
This is a preliminary list of core entities. (No columns, finalized relationships, or migrations are defined yet):
- `profiles`
- `specialties`
- `logbook_templates`
- `trainee_assignments`
- `log_entries`
- `roadmap_targets`
- `log_entry_targets`
- `contexts`
- `procedures`
- `activation_codes`
- `audit_logs`

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
- Phase 01 — Architecture & Data Model
- Phase 02 — Foundation
- Phase 03 — Security & Authentication
- Phase 04 — Product Modules

## Architectural Change Control
All architectural changes must be recorded, reviewed, and approved via Architectural Decision Records (ADRs), which are tracked in the `docs/decisions/` directory.


## ADR-01 — Trusted Backend and Atomic Write Boundary (accepted)

**Status:** Accepted by project owner on 2026-10-11. **Design-only:** no application code, migrations, database changes, or tests are authorized by this ADR.

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
