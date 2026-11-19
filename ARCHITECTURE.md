# MENTORO Platform Architecture

> **Document status.** This file began as the design-phase baseline (ADR-01 was accepted as design-only on 2026-10-11). Parts of it describe decisions that were later superseded or built differently. Superseded statements are kept for decision history and are marked **Superseded** or **As built**. Where this file and the repository disagree, the repository (`supabase/migrations/`, `src/`, `api/`, `supabase/functions/`) and the [README](README.md) win. The review that produced these annotations is [docs/SYSTEM_REVIEW.md](docs/SYSTEM_REVIEW.md).
>
> | Topic | Design baseline (this file) | As built in the repository |
> | --- | --- | --- |
> | Logbook cardinality | One logbook per trainee and specialty (L-42) | **One independent logbook per training enrollment (L-43)** — `supabase/migrations/20261102100000_restore_enrollment_owned_logbooks.sql` |
> | Trusted backend | Vercel Node.js API for protected writes | `api/` holds only `auth/me.js`, `health.js` and `license/{admin,config}.js`. Protected workflows are `SECURITY DEFINER` RPCs behind `public.*` wrappers; licensing runs in the `mentoro-license` Supabase Edge Function |
> | Payload validation | Ajv 8 / JSON Schema in the backend | No Ajv dependency. Entry payloads are validated in PostgreSQL (`validate_logbook_entry_payload`); HTML-logbook state is validated by shape and size limits in `save_my_logbook_html_state` |
> | Deployment | Logbooks only inside the central deployment | Integrated runtimes in `public/logbooks/` **and** licensed standalone, local-first logbooks in `vercel-logbooks/` (each directory is its own project root) |
> | Specialties | Six source modules | Seven registered modules (adds Ophthalmology) |

## Project Vision
MENTORO is a centralized medical training platform. Specialty logbooks are modules/templates inside this single repository. The integrated runtimes are deployed with the central platform; the licensed standalone logbooks under `vercel-logbooks/` are separate project roots (**As built**; the original design deployed everything with the central platform).

The source set originally received for consolidation contained six modules; the central registry now holds seven:
1. General Surgery
2. Medical Oncology
3. Cardiology
4. Neurology
5. Pediatrics
6. Anaesthesia & Critical Care
7. Ophthalmology

Standalone ZIP archives were source material for audit and controlled porting. They are not runtime deployments and must not be copied blindly: each module must be adapted to the central authentication, storage, authorization, review, and build contracts.

## Technology Stack
- Frontend: Vite, Vanilla JavaScript, and CSS.
- Trusted application backend (design baseline): Vercel-hosted Node.js API for protected writes and server-side authorization/validation. **As built:** see the status table above.
- Identity and sessions: Supabase Auth.
- Database: Supabase PostgreSQL with RLS, explicit grants/constraints, and narrowly scoped RPC/database functions for atomic multi-row workflows.
- Specialty payload validation (design baseline): Ajv 8 with JSON Schema Draft 2020-12 in the trusted backend. **As built:** validation lives in PostgreSQL; Ajv is not a dependency.
- Hosting/version control: Vercel, Git, and GitHub.

The approved security and atomicity boundaries are defined in ADR-01 in the decisions register. This stack decision is design-only; it does not authorize implementation or migrations.

## Roles, Identity, and Enrollment Flow
- One central identity per user.
- **Superseded by L-43:** ~~A trainee may have one persistent logbook per specialty over the entire training journey in that specialty.~~ Each confirmed training enrollment has its own independent logbook. A repeat booking in the same specialty starts a fresh logbook and earlier logbooks remain in the trainee's history.
- Only platform administration may provision/activate a logbook. The catalogue is centrally available to administrators, not as a trainee template picker. **As built:** the logbook is created atomically with the enrollment, either when an administrator confirms an application or through direct administrative assignment.
- **Superseded by L-43:** ~~Training enrollments and mentor bookings remain separate records. Additional mentors or training periods in the same specialty reuse the same logbook instance and its history.~~ A new enrollment never reuses a previous enrollment's logbook.
- A different specialty may have a separate logbook, but it must also be provisioned by administration.
- Template-version changes are explicit administrative transitions on the existing logbook; they do not create a second logbook.
- Activation codes must be single-use, securely stored as hashes, and must not grant Admin privileges. (The licensed standalone logbooks use separate license codes, hashed at rest, that activate one phone per license.)
- Subsequent access uses authenticated sessions.

The original cardinality and lifecycle rule was recorded in L-42 of the decision register and was superseded by L-43 (see [docs/LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md](docs/LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md)).

## Preliminary Core Entities
*Historical.* The implemented schema lives in `supabase/migrations/`; start with `20261028061628_core_independent_enrollment_schema_v1.sql`. The original preliminary list (no columns, finalized relationships, or migrations were defined at the time):
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
**As built:** the Node.js API holds only identity, health and licensing endpoints. Authorization for protected writes is enforced in PostgreSQL (RLS plus `SECURITY DEFINER` RPCs with `search_path = ''` behind `public` wrappers that derive the actor from `auth.uid()`). The text below is the accepted design.

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

## Logbook Lifecycle and Cardinality (L-42) — Superseded by L-43
*This section is retained as decision history. It must not be implemented; see the README and [docs/LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md](docs/LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md).*

- The persistent logbook owner is the trainee-specialty pair, not an individual booking, mentor, slot, or enrollment.
- PostgreSQL must enforce at most one logbook instance for each trainee and specialty.
- Training enrollments associate with the existing specialty logbook. A new enrollment in an already provisioned specialty must reuse that logbook and must not create or reset another instance.
- Only an authenticated platform administrator can create/provision the logbook. Trainees cannot select from the template catalogue or self-create logbooks.
- Existing enrollment-owned logbooks must be reconciled without losing records, review history, state revisions, audit history, or template-version provenance before the model is switched.
- Mentor access remains governed by the approved role/security decisions; sharing one persistent logbook must not silently widen a mentor's authorization scope.

## Specialty Modules
- Each specialty retains its own roadmap, log types, validation rules, and presentation requirements.
- The seven registered modules live beneath the same central application (`public/logbooks/`), with licensed standalone copies under `vercel-logbooks/`.
- Shared platform services manage identity, authorization, logbook provisioning, enrollments, and common infrastructure.

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

### Implementation status (added during the stage-1 review)
The repository implements the database half of this ADR (RLS, grants, `SECURITY DEFINER` RPCs behind wrappers, row locks and idempotency keys for atomic workflows). It does not implement the Node.js write backend or Ajv validation; the licensing Edge Function (`supabase/functions/mentoro-license`) uses the Supabase secret key server-side. If the ADR's backend and Ajv decisions are still intended, record a follow-up ADR; otherwise record the as-built decision so this file stops contradicting the code.
