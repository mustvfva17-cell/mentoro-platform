# MENTORO Platform Architecture

## Project Vision
MENTORO is a centralized medical training platform supporting three initial specialty logbooks:
1. General Surgery
2. Neurology
3. Anaesthesia & Critical Care

Existing logbook projects are kept outside this repository and must remain untouched. We may consult them later as references, but do not copy or import their code.

## Technology Stack
- Vite
- Vanilla JavaScript
- CSS
- Supabase PostgreSQL
- Supabase Auth
- PostgreSQL Row Level Security (RLS)
- Vercel
- Git and GitHub

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

## Authorization Principles
- Trainees must never access other trainees' private records.
- Authorization must be enforced server-side; client-supplied role labels or user IDs are not proof of permission.
- Never expose the Supabase service-role key in frontend code.

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
