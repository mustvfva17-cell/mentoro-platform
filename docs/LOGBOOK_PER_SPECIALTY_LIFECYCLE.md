# One Persistent Logbook per Trainee per Specialty

**Decision:** L-42  
**Accepted:** 2026-11-02  
**Implementation status:** Not implemented in the live schema/runtime. This document defines the migration and integration contract.

## Product rule

The six specialty templates are intended to be centrally available to MENTORO administration after controlled import and registration. They are not a menu from which trainees can choose. The administrator decides which specialty logbook to provision for each trainee and when to open it.

A trainee has at most one persistent logbook for a given specialty for the whole training journey in that specialty. More bookings, training periods, or mentors in that same specialty reuse the existing logbook and its complete history. A second specialty may have a separate logbook.

The logbook is not owned by a booking or an individual mentor enrollment. Enrollments remain separate operational records.

## Domain model target

```text
Trainee
  ├── Specialty A
  │     └── One persistent Logbook A
  │            ├── entries and specialty progress
  │            ├── state/revision history
  │            └── multiple Training Enrollments
  │                   ├── mentor / slot / period 1
  │                   └── mentor / slot / period 2
  └── Specialty B
        └── One persistent Logbook B (only after admin provisioning)
```

The target physical schema needs:
- A canonical logbook owner: trainee_profile_id plus specialty_id.
- A database uniqueness constraint/index on that pair.
- An explicit enrollment-to-logbook association so multiple enrollments can reference the same persistent instance.
- Entry and review provenance sufficient to preserve the training period/context and the applicable template version.
- A single atomic administrative provisioning operation that checks the active trainee, specialty, published/assignable template version, and existing logbook before creating anything.
- Enrollment confirmation/activation logic that reuses the canonical logbook instead of inserting a new instance.
- RLS and trusted functions that retain existing trainee, administrator, and mentor authorization boundaries.

Exact table/column names and the final mentor visibility model must be reviewed against the current SQL/RLS implementation before migration. Do not widen mentor access merely because enrollments now share one logbook.

## Required behavior

1. **First assignment:** an administrator selects a trainee, specialty, and eligible template version. The system creates one instance and writes an audit event atomically.
2. **Repeat assignment, same specialty:** the system returns an already-assigned result (or the canonical instance where explicitly safe). It must not insert another instance or reset state.
3. **Second mentor / later period, same specialty:** the new enrollment references the same logbook instance. The previous entries and progress remain.
4. **Different specialty:** a different logbook may be provisioned, but only by an administrator.
5. **Template version update:** an administrator performs an explicit, audited transition on the existing logbook. No silent reassignment and no new instance.
6. **Trainee workspace:** only provisioned logbooks are visible. There is no self-service template picker or create action.
7. **Concurrency:** two simultaneous admin requests or enrollment confirmations cannot create duplicates; database uniqueness and transaction/locking logic decide the winner.
8. **History:** entries, mentor reviews, HTML-state revisions, and audit records remain preserved and attributable. No destructive merge or history reset.

## Current code/schema findings

- The original core schema defined logbook_instances.enrollment_id as NOT NULL UNIQUE, which encodes one instance per enrollment.
- Migration 20261031172432_add_direct_admin_logbook_assignments.sql permits either an enrollment owner or a direct trainee owner, but has no uniqueness on trainee plus specialty. Its direct assignment RPC inserts a new row each time.
- Migration 20261031165518_add_profile_edit_and_admin_logbook_assignment.sql creates a training-backed enrollment and a new logbook instance for a direct admin slot assignment.
- The current training confirmation path reports that each confirmed booking gets a separate instance.
- Mentor inbox/review functions join logbook instances directly to a single enrollment through enrollment_id. The enrollment-specific write guard and entry RLS policies also assume one logbook instance belongs to one enrollment. These controls must be redesigned together; changing only the instance uniqueness constraint would break mentor review and write access.
- The trainee dashboard currently renders logbooks from both enrollment records and directly assigned logbook instances, so it can display multiple cards for the same specialty. The workspace must be changed to display the canonical trainee-specialty logbook once.
- HTML-state load/save and HTML mentor-review authorization also resolve access through the current instance ownership model and must be updated with the new association model.
- The central specialty registry and trusted HTML allowlists now cover six runtime paths: Medical Oncology, General Surgery, Cardiology, Neurology, Pediatrics, and Anesthesia & Critical Care.
- The six uploaded ZIPs are standalone Vite source archives, but six adapted HTML runtimes are now registered in the central repository. They must not be copied wholesale over the central versions because the central runtimes add the authenticated state bridge, centralized Mentor Review, and read-only behavior.

## Migration sequence (do not skip)

### Phase 1 — Inventory and preflight
- Inspect the live database migration history and current row counts; verify which migrations are deployed.
- Inventory all logbook instances by trainee, specialty, template version, enrollment, archive state, and attached entries/reviews/state rows.
- Identify trainees with multiple instances in one specialty and distinguish real histories from test/duplicate assignments.
- Produce a deterministic reconciliation report. Do not merge ambiguous data automatically.

### Phase 2 — Schema and trusted workflows
- Introduce the trainee-specialty canonical owner and enrollment-to-logbook association.
- Backfill specialty identity from the referenced template version.
- Add the unique trainee-specialty constraint only after duplicates are reconciled.
- Update admin provisioning to be atomic and idempotent.
- Update enrollment activation/confirmation so it links to the canonical instance and never creates a second one.
- Update entry/state/review authorization and provenance consistently; do not rely on UI filtering.
- Keep historical template-version identity and revision/audit records intact.

### Phase 3 — Application
- Update trainee workspace to show one card per specialty, not one card per enrollment.
- Update admin workspace to show whether a trainee already has the specialty logbook and prevent duplicate assignment in the UI, while relying on database constraints for enforcement.
- Keep training bookings/enrollments as separate cards/history if needed, but do not duplicate logbook cards.
- Adapt each specialty module to the shared authenticated state bridge. Replace its local-storage-only persistence with per-instance central state; any local cache must be namespaced by instance and must not become the source of truth.
- Replace hard-coded two-path allowlists with a centrally registered, validated module registry.

### Phase 4 — Validation and rollout
- Test two enrollments/two mentors in one specialty and prove both link to the same instance.
- Test two specialties for one trainee and prove they receive separate instances.
- Test repeated and concurrent admin assignments and confirm no duplicates.
- Test that trainee cannot open an unassigned template.
- Test mentor and admin access against the approved authorization contract.
- Test that all legacy entries, reviews, state revisions, and audit history survive migration.
- Deploy first to a preview/staging database and environment; production rollout only after verified reconciliation and regression tests.

## Specialty modules now registered centrally

- General Surgery
- Medical Oncology
- Cardiology
- Neurology
- Pediatrics
- Anaesthesia & Critical Care

All six now have central specialty registrations and HTML runtime paths in the single MENTORO repository. Clinical content must still be reviewed and approved before publication; technical integration and CI validation do not establish medical correctness or completeness.

## Explicitly not done

- L-42 has not been implemented in the live schema/runtime. The current model still includes enrollment-owned instances and direct-admin-owned instances; no canonical trainee-specialty uniqueness constraint or complete enrollment-to-logbook association is in place.
- No live Supabase migration has been applied or verified by this work. The connected Supabase account returned no accessible projects on 2026-11-02, so the remote migration ledger and any existing rows could not be inspected.
- The latest GitHub commit has a successful Vercel status (“Deployment has completed”), but the deployment environment/alias was not independently verified; no production-domain claim is made.
- No specialty has received verified clinical approval or has been made assignable by these integration merges.
- The six original ZIP archives are retained as reference/audit sources. Their contents were adapted into central runtimes rather than copied as separate deployments.

Before implementing L-42, restore access to the intended non-production Supabase project, inspect its real migration ledger and logbook-instance inventory, create a deterministic reconciliation report, then implement and test the schema/RLS/trusted-workflow transition. Do not apply the L-42 migration to production before reconciliation and isolated rollback/regression tests.
