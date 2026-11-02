# Independent Logbook per Training Enrollment

**Decision:** L-43  
**Accepted:** 2026-11-02, explicitly reconfirmed by the project owner  
**Supersedes:** L-42 (one persistent logbook per trainee-specialty)  
**Implementation status:** Runtime/UI correction and a guarded forward migration are proposed in PR #27; not merged, deployed, or applied. Live database inventory and migration validation remain pending.

## Product rule

Every distinct training enrollment/booking between one trainee and one assigned mentor has its own independent logbook instance. This remains true when the same trainee repeats the same specialty with another mentor, another slot, or in a later training period.

A new enrollment starts with a blank logbook. It does not inherit activities, entries, progress, submissions, mentor reviews, or HTML state from an earlier enrollment. Earlier logbooks remain visible in the trainee's training history and are never merged, overwritten, or reset.

The specialty template may be reused by many enrollments. Reusing a template does not reuse a logbook instance.

## Domain model

```text
Trainee
  ├── Enrollment A (Specialty X, Mentor A, period 1)
  │     └── Logbook A
  │           ├── entries / progress / state revisions
  │           └── Mentor A reviews
  ├── Enrollment B (Specialty X, Mentor B, period 2)
  │     └── Logbook B (new and empty)
  │           ├── separate entries / progress / state revisions
  │           └── Mentor B reviews
  └── Enrollment C (Specialty Y, Mentor C)
        └── Logbook C
```

## Ownership and authorization invariants

1. Each logbook instance belongs to exactly one training enrollment.
2. Each enrollment has at most one logbook instance; for an activated training enrollment, exactly one is provisioned.
3. A logbook instance is never shared across enrollments, even when trainee, specialty, and template version match.
4. The trainee may view their own enrollment history and the logbooks attached to those enrollments.
5. A mentor may access, edit, and review only logbooks belonging to enrollments assigned to that mentor. Knowing a trainee or specialty does not grant access to another enrollment.
6. Administrators may oversee all enrollments and logbooks, with required audit records.
7. The database must not enforce uniqueness on trainee-profile plus specialty. The relevant ownership constraint is one logbook per enrollment.
8. Idempotency applies to retrying the same admin operation/request. A genuinely new booking/enrollment—even for the same trainee and specialty—creates a new logbook.

## Administrator provisioning

When an administrator opens a logbook directly for a trainee, the trusted workflow must create or activate the corresponding training enrollment and create its logbook in the same transaction. The logbook must appear in the trainee workspace immediately after that transaction commits.

A direct-admin assignment must not create a logbook row with no enrollment. It must preserve the selected mentor, specialty, slot/period, template version, assigning administrator, reason, and audit provenance.

## Current repository findings (2026-11-02)

- The original core schema defined `logbook_instances.enrollment_id` as `NOT NULL UNIQUE`, matching L-43.
- The migration `20261031165518_add_profile_edit_and_admin_logbook_assignment.sql` created the correct transaction pattern: insert an `ADMIN_ASSIGNED` application, create a confirmed enrollment, create the enrollment-linked logbook instance, and write the audit event in one function.
- The later migration `20261031172432_add_direct_admin_logbook_assignments.sql` replaced that behavior with nullable `enrollment_id` and a direct `trainee_profile_id` owner. It introduced the orphan path and direct-owner access branches that conflict with L-43.
- PR #27 proposes a forward-only correction: restore `enrollment_id NOT NULL`, remove the direct-owner column and policy branches, restore enrollment-scoped access/state functions, and replace direct assignment with a slot-based atomic enrollment/logbook RPC. The admin form is limited to future open slots whose offering, mentor, and HTML template are eligible and published.
- The new provisioning RPC records a client request UUID in the audit log and uses a transaction advisory lock plus a unique partial index so a retry of the same request returns the original enrollment instead of creating another one.
- The PR migration refuses to proceed if it finds any orphan logbooks, any enrollment without a logbook, any enrollment/logbook template-version mismatch, or duplicate prior request identifiers. It does not infer or reassign old data.
- PR #27 also updates trainee and mentor HTML-logbook context handling and adds static L-43 contract checks. These changes are proposed code only until the PR is reviewed and merged.
- The connected Supabase account exposed no accessible projects during the 2026-11-02 review. The live migration ledger, deployed schema, data inventory, SQL execution, and PostgreSQL integration tests remain unverified. No database migration or live data change is claimed.

## Required implementation and migration sequence

### Phase 1 — Non-production inventory

- Restore access to the intended non-production Supabase project and inspect its actual migration ledger before running any SQL.
- Inventory every logbook instance, enrollment, trainee owner, template version, entry, mentor review, HTML-state revision, and audit event.
- Identify instances with `enrollment_id IS NULL`. For each, determine whether a corresponding enrollment can be established from authoritative slot/mentor/assignment records. Do not guess or attach ambiguous histories.
- Produce a deterministic reconciliation report and obtain review before modifying data.

### Phase 2 — Schema and trusted workflow

- Reinstate a required enrollment foreign key for all logbook instances, retaining historical references safely where archival semantics require them. The proposed migration uses explicit preconditions and aborts without changing rows if legacy data needs reconciliation.
- Enforce one logbook instance per enrollment with a unique constraint on `enrollment_id`.
- Do not add a unique constraint on trainee plus specialty.
- Update direct-admin provisioning so enrollment creation, mentor/slot association, logbook creation, and audit writes are atomic. PR #27 proposes the slot-based RPC with request-level idempotency.
- Make retry handling idempotent for the same operation/request while allowing a distinct new enrollment in the same specialty to create a new instance.
- Update access helpers, RLS, HTML state reads/writes, mentor views, trainee history, and admin provisioning to resolve ownership through the enrollment relationship only. PR #27 proposes these runtime/schema changes; PostgreSQL execution and RLS integration still require non-production validation.
- Remove or close any direct-trainee ownership path that allows a logbook to exist without an enrollment.
- Preserve template-version identity, entries, reviews, state revisions, and audit provenance. Never copy old activities into a new enrollment's logbook.

### Phase 3 — Required tests

- Same trainee + same specialty + two different mentors: two enrollments and two distinct logbook instance IDs.
- Same trainee + same specialty + later training period: new empty logbook; old logbook remains unchanged in history.
- Same trainee + different specialty: separate enrollment and separate logbook.
- Retry the same admin request: no duplicate enrollment or logbook.
- New admin request for a genuinely new booking: new enrollment and new logbook, even if the specialty is unchanged.
- Mentor A cannot read, write, or review Mentor B's enrollment/logbook; administrator can oversee both.
- Trainee can see all their own historical enrollments/logbooks but cannot modify mentor-review provenance.
- Direct-admin assignment never creates an orphan logbook.
- Concurrent requests cannot create two logbooks for the same enrollment.
- Rollback occurs if any required enrollment, logbook, or audit write fails.

## Explicitly not done

- The L-43 runtime/schema correction is proposed in PR #27 but has not been merged, deployed, or verified against a live Supabase project.
- No migration has been applied as part of this decision correction.
- No existing logbook data has been merged, moved, deleted, or reassigned.
- Specialty templates remain Draft/non-assignable until their own clinical review and authorized publication.
