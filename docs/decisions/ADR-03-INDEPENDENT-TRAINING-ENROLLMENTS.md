# ADR-03 — Independent Training Enrollments and Per-Enrollment Logbooks

**Status:** Accepted product architecture decision — 2026-10-28  
**Scope:** Canonical product/data-model decision for booking, mentor access, and logbook lifecycle.  
**Supersedes:** Any earlier design rule requiring one active assignment/logbook per trainee, trainee-wide mentor assignments, one pending enrollment per normalized email, or invitation-code activation as the primary training-entry workflow. Related design documents must be reconciled before executable migrations are approved.

## Context

The earlier data model treated `trainee_assignments` as the trainee's single active logbook and treated mentor relationships as trainee-wide. It also proposed invitation-code activation and a global one-pending-enrollment-per-email rule. These constraints cannot represent the agreed MENTORO product: one trainee may book several trainings concurrently, may have more than one training in the same specialty, and each booking belongs to one mentor and must keep its own logbook and history.

## Accepted decisions

1. **One person, one account.** A trainee has one MENTORO account and profile, regardless of how many trainings they book.
2. **Many concurrent enrollments.** A trainee may have multiple pending applications, confirmed enrollments, and active trainings at the same time, including trainings in the same specialty or with the same mentor. Do not impose a unique active-enrollment or active-logbook constraint on the trainee profile.
3. **One mentor per enrollment.** Each individual enrollment has exactly one trainee, one mentor, one specialty, a training period, and its own lifecycle status. A trainee's relationship with a mentor in one enrollment does not grant that mentor access to the trainee's other enrollments.
4. **One independent logbook per enrollment.** Once a booking is confirmed/activated, create a distinct logbook instance from the approved specialty template version. Enforce at most one instance for a given enrollment (candidate invariant: unique `logbook_instances.enrollment_id`), but allow any number of instances for one trainee across different enrollments. Entries, reviews, assessments, and progress belong to that instance/enrollment and must never be copied or merged automatically across bookings.
5. **Preserve history.** Completing, cancelling, or ending a training does not delete its logbook history. A later booking creates a new instance, initially empty, linked to its own enrollment and template version. Historical entries keep their original enrollment, instance, and template-version references.
6. **Booking workflow.** After sign-up, the trainee uploads university-ID evidence and the account stays `PENDING_VERIFICATION` until an admin reviews it. Verified trainees can browse available mentor-led training offerings/slots and apply. The mentor reviews the application; an admin coordinates/confirms the booking; only then is the enrollment activated and its logbook instance created. The application, enrollment, and logbook instance are different domain records and must not be collapsed into one invitation row.
7. **Enrollment-scoped mentor access.** A mentor can read/review/assess only records belonging to enrollments assigned to that mentor. Admin access is platform-wide and audited. Trainees can access their own enrollments and associated logbook instances.
8. **Shared engine, versioned specialty templates.** Build one reusable logbook engine; specialty templates supply approved, versioned requirements and payload schemas. A new enrollment pins the applicable published template version. Publishing a new version must not silently change existing instances.
9. **No global email uniqueness for training requests.** Email/account uniqueness belongs to identity. Application/enrollment records are separate per booking; do not cancel or overwrite a trainee's other booking merely because the email matches. Any duplicate-request protection must be scoped to a specific offering/slot and must not prevent legitimate concurrent or same-specialty trainings.
10. **Separate learning evidence from formal competency.** Trainee-entered logbook activity, mentor verification/review, and competency assessment are distinct auditable events. Exposure documentation is not itself competency certification.
11. **Privacy.** University-ID evidence belongs in private storage with restricted review access and a defined retention/deletion policy. Do not place patient-identifying information in logbook entries, audit metadata, or sample fixtures.

## Canonical domain model for implementation

- `profiles`: one account/profile per person, with verification state.
- `trainee_profiles` and `mentor_profiles`: role-specific profile data where needed.
- `specialties`: canonical specialty catalogue.
- `training_offerings`: a mentor's published training offer for a specialty, including rules/capacity.
- `training_slots`: bookable periods/capacity where scheduling is slot-based.
- `training_applications`: a trainee's request for a specific offering/slot and its review lifecycle.
- `training_enrollments`: the confirmed training booking; each row binds one trainee, one mentor, one specialty, one period, and status.
- `logbook_templates` and `logbook_template_versions`: shared, reviewed, versioned specialty definitions.
- `logbook_instances`: one isolated instance per enrollment, pinned to a template version.
- `logbook_entries`: entries scoped to a logbook instance; the database must not allow cross-instance references.
- `entry_reviews` / `mentor_reviews` and `assessments`: enrollment-scoped review/competency events with actor, timestamp, and audit trail.
- `audit_logs`: restricted, append-only history for sensitive changes.

Table names are the target model, not a claim that migrations or database tables currently exist. Exact columns, FKs, constraints, grants, RLS, and RPCs require review and tests against the isolated test database before executable migrations are approved.

## Mapping from the superseded model

- `trainee_assignments` must not retain the unique-active-per-profile rule. Replace its domain responsibility with `training_enrollments` plus `logbook_instances`.
- Trainee-wide `mentor_assignments` must not be the authorization basis for logbook access. Scope mentor authorization through the specific enrollment.
- The old `pending_enrollments` + `activation_codes` workflow is not the primary booking workflow. Sign-up identity verification and training application/confirmation are separate processes.
- The old “one PENDING enrollment per normalized email” and cancel-and-replace behavior are superseded. Do not let one booking replace or cancel another booking.
- `template_transitions` must not be used to switch the trainee's single current logbook. Each enrollment keeps its own template-version reference.

## Non-negotiable pre-release gates

- Test that one trainee can hold two simultaneously active enrollments, including two in the same specialty.
- Test that each enrollment yields exactly one distinct logbook instance, and that neither entries nor reviews leak across instances.
- Test mentor isolation across two different trainees and across two enrollments of the same trainee.
- Test that cancellation/completion preserves historical records and a new booking starts with an empty instance.
- Test verification/booking authorization, template-version pinning, audit atomicity, concurrency, and private university-ID storage.
- Do not deploy a migration or enable protected database writes until the test Supabase project is accessible and the approved security/connection model has been exercised.

