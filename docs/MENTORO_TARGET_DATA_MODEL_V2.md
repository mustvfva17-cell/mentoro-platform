# MENTORO Target Data Model v2 — Independent Training Enrollments

**Status:** Canonical target model; initial core schema applied to isolated Supabase test only. Not production-ready.  
**Date:** 2026-10-28  
**Decision source:** `docs/decisions/ADR-03-INDEPENDENT-TRAINING-ENROLLMENTS.md`

> This document supersedes the old one-active-`trainee_assignments` model. Do not implement the old global unique-active-assignment rule, trainee-wide mentor scope, one-pending-enrollment-per-email rule, or invitation-code activation path as the main training workflow.

## Current database snapshot (2026-10-28)

The core version of this model is applied only to the isolated Supabase test project and is tracked by numbered SQL files under `supabase/migrations/`. The current schema includes the entities below, with RLS enabled on every application table. Four migration records are present in test. No production Supabase migration has been applied, and the application UI/API is not yet wired end to end.

The seeded General Surgery template is intentionally `DRAFT` and `is_assignable=false`; it must not be offered for actual training until its structured fields and clinical requirements are reviewed and approved. See `docs/IMPLEMENTATION_STATUS.md` for verification results.

## 1. Core invariants

1. One authenticated person has one profile; one trainee profile can have many training applications and many concurrent training enrollments.
2. Every `training_enrollment` belongs to exactly one trainee, one mentor, one specialty, one training period/status, and one confirmed booking/application.
3. Every confirmed enrollment gets exactly one new `logbook_instance`, pinned to one published specialty template version. Multiple enrollments for the same trainee may use the same specialty/template, but must still have distinct instances.
4. A logbook entry, review, and assessment is scoped to the enrollment and instance. No data can be copied, merged, or exposed across enrollments by default.
5. Mentor authorization is derived from the specific enrollment's mentor ID, not from a trainee-wide mentor relation.
6. Historical enrollments and logbook instances remain available according to the retention policy. A new booking starts an empty logbook.
7. An account must be verified by an admin before applying to a training. Training requests do not share a global pending row keyed only by email.
8. Review, verification, assessment, administrative decisions, and sensitive state changes are auditable. Patient-identifying data is prohibited in logbook entries and audit metadata.

## 2. Canonical entities

| Entity | Responsibility | Key relationship/invariant |
|---|---|---|
| `profiles` | One platform profile per auth user; verification status and basic identity | `id = auth.users.id`; no client-controlled role grants |
| `trainee_profiles` | Trainee-only details | One row per trainee profile |
| `mentor_profiles` | Mentor-only details and public training profile | One row per mentor profile |
| `verification_documents` | Metadata for proof of trainee/university identity | Private object key only; reviewed by authorized admin; no public object URL |
| `specialties` | Canonical specialty catalogue | Stable specialty ID |
| `training_offerings` | A mentor's published training offer in a specialty | Links exactly one mentor and one specialty; references an eligible template family |
| `training_slots` | Optional bookable time range and capacity | Belongs to one offering; capacity checks occur transactionally |
| `training_applications` | One trainee's request for an offering/optional slot | Can coexist with other applications by the same trainee |
| `training_enrollments` | Confirmed/active/completed/cancelled booking | One trainee + one mentor + one specialty + period + status; source application is unique when present |
| `logbook_templates` | Stable specialty-specific logbook definition | One template family may have many versions |
| `logbook_template_versions` | Immutable published requirements/schema for a template | New enrollment pins one published version |
| `logbook_instances` | A trainee-specific logbook for one booking | `UNIQUE(enrollment_id)`; intentionally no unique constraint on trainee/profile |
| `logbook_entries` | Trainee case/procedure/learning records | Belongs to one logbook instance; draft vs submitted lifecycle |
| `entry_reviews` | Mentor review/feedback/verification of a particular entry | Reviewer must be the mentor of that instance's enrollment |
| `assessments` | Competency assessment separate from exposure documentation | Bound to one enrollment and applicable template version/framework |
| `audit_logs` | Restricted append-only events for sensitive actions | Actor, action, target, timestamp, reason/outcome where appropriate; no secrets or patient identifiers |

Exact field types and every FK, check, unique predicate, grant, RLS policy, and RPC signature are intentionally gated until the test database can be inspected and the selected server/database connection model tested.

## 3. Identity verification

- Supabase Auth owns the authentication identity. The trusted backend idempotently provisions the matching `profiles` row.
- A new trainee starts with `verification_status = 'PENDING_VERIFICATION'`. They submit university-ID evidence to a **private** storage bucket through an authorized upload flow.
- Only authorized admins can review the original document and set `VERIFIED` or `REJECTED`; review decision, reviewer, and timestamp are recorded.
- Unverified/rejected trainees cannot submit training applications or access protected enrollment/logbook functions. Do not trust a browser-supplied role, verification flag, or profile ID.
- Store document metadata and opaque storage object keys, not public URLs, in the database. Define retention/deletion and signed-read access before production.

## 4. Booking and enrollment lifecycle

1. Trainee creates an Auth account and profile; state remains pending verification.
2. Trainee submits identity evidence; admin verifies or rejects the account.
3. Verified trainee browses published training offerings/slots and submits an application.
4. The relevant mentor reviews the application. Mentor approval is not by itself a confirmed booking.
5. Admin coordinates and confirms the booking after validating slot capacity, offering availability, mentor/specialty consistency, and the approved logbook template version.
6. One atomic trusted operation creates the `training_enrollment`, pins the selected published `logbook_template_version`, creates exactly one `logbook_instance`, and writes required audit records. Capacity reservation and application-to-enrollment linking must be protected from concurrent duplicate confirmations.
7. The trainee records progress in the instance; the mentor can review only records for that specific enrollment. Competency assessment is separate from entry logging.
8. On completion/cancellation, the enrollment is transitioned with audit history; its logbook remains in the trainee's historical archive and is not reused for another training.

Suggested application statuses: `SUBMITTED`, `MENTOR_APPROVED`, `MENTOR_REJECTED`, `ADMIN_CONFIRMED`, `WITHDRAWN`, `CANCELLED`.  
Suggested enrollment statuses: `CONFIRMED`, `ACTIVE`, `COMPLETED`, `CANCELLED`. Final transition rules must be approved in the API contract before executable migration.

## 5. Relationship sketch

- `profiles` 1:0..1 `trainee_profiles`; `profiles` 1:0..1 `mentor_profiles`.
- `mentor_profiles` 1:N `training_offerings`; `specialties` 1:N `training_offerings`; an offering has 0..N slots.
- `trainee_profiles` 1:N `training_applications`; an application references one offering and optionally one slot.
- A confirmed application can result in at most one `training_enrollment`; a trainee can have many concurrent enrollments.
- Each `training_enrollment` has exactly one `logbook_instance`; each instance references one published `logbook_template_version`.
- `logbook_instances` 1:N `logbook_entries`; entries can have 0..N review records and revisions.
- `training_enrollments` 1:N `assessments` over the enrollment lifecycle.

## 6. Required database-level constraints and atomic boundaries

Candidate invariants (not yet approved SQL):

- `UNIQUE(logbook_instances.enrollment_id)`: no confirmed enrollment creates two independent instances on retry; allows many instances per trainee.
- `UNIQUE(training_enrollments.source_application_id)` when source application is non-null: one application cannot be confirmed into multiple enrollments.
- Composite foreign keys or equivalent validated constraints prevent an entry/review/assessment from referencing a template version or enrollment different from its parent instance.
- Enrollment mentor, trainee, specialty, offering, and slot must be consistent. Validate with constraints where feasible plus a trusted transaction boundary.
- Slot capacity and booking confirmation must be serialized/atomic; do not rely on UI counts.
- Profile verification and mentor/application approval must be rechecked at the trusted write boundary.
- Required audit insert and sensitive state changes commit or roll back together.
- Only the trusted server-side write path can confirm bookings, create instances, publish template versions, grant/revoke roles, or perform admin decisions.
- Use idempotency/concurrency guards for confirmation and retries; never solve retries by globally cancelling another enrollment for the same email.

Explicitly prohibited constraint: a partial unique index allowing only one `ACTIVE` training/logbook per `trainee_profile_id`.

## 7. Access-scope contract

| Actor | Permitted scope |
|---|---|
| Trainee | Own profile and verification status; own applications/enrollments; entries, reviews, and assessments under own logbook instances |
| Mentor | Own mentor profile/offerings; applications addressed to that mentor; only enrollments where the enrollment's mentor is the authenticated mentor; reviews/assessments within that enrollment scope |
| Admin | Platform-wide account verification, offering/application/enrollment coordination, template lifecycle, audit review; privileged actions recorded |
| Public/anonymous | Only deliberately public mentor/offering/specialty fields and published non-sensitive content |

This table is a product authorization contract, not a final RLS implementation. The concrete trust boundary, grants, RLS behavior, and database identity must be verified against the isolated Supabase environment before any protected write path is enabled.

## 8. Template and logbook lifecycle

- The template engine is shared across specialties. Specialty differences live in versioned templates/schemas rather than six separate implementations of the same lifecycle.
- Each enrollment pins the selected published template version at creation. Publishing a new version does not mutate instances already created.
- New booking = new instance with no copied log entries. Existing instance/history remains attached to the original enrollment and version.
- Draft entries may be edited by their owning trainee under the approved rules. Submitted entries use the reviewed correction/revision workflow; do not allow silent edits that bypass review/audit policy.
- Entry review lifecycle, such as `NOT_REVIEWED`, `IN_REVIEW`, `FEEDBACK_PROVIDED`, `REVIEWED`, remains separate from entry submission status and from formal competency assessment.
- Approve source-traceable medical requirements and payload schemas for each specialty/log type before enabling it for production use.

## 9. Superseded model elements

The following legacy assumptions must not be carried into the new implementation without a deliberate, separately reviewed reason:

- `trainee_assignments` as a single current logbook, including unique active assignment per profile.
- Switching a trainee from one specialty/logbook by suspending the previous one.
- `mentor_assignments` as trainee-wide access scope.
- `pending_enrollments` and `activation_codes` as the normal workflow for training requests.
- One pending enrollment per normalized email, same-email reuse, or cancel-and-replace semantics.
- A profile-wide active-assignment lock that prevents independent simultaneous bookings.

Security, audit, privacy, role integrity, correction-history, immutable template-version, and medical-schema approval principles from the prior documents remain relevant where consistent with this model.

## 10. Test gates before rollout

- Two active enrollments for one trainee succeed concurrently, including two enrollments in the same specialty and same mentor.
- Each enrollment creates one different logbook instance, including duplicate/retried confirmation requests.
- Entries/reviews/assessments are invisible across different enrollments of the same trainee and across trainees.
- Mentor A cannot access another mentor's enrollment, even for the same trainee.
- A new booking is empty; completing/cancelling the previous enrollment preserves the original history.
- Unverified trainees and unapproved applications cannot bypass the booking flow.
- Concurrent booking cannot exceed a slot's capacity or create duplicate enrollments/instances.
- Template version pinning survives template publication and archival.
- Sensitive write and audit records are atomic; RLS and grants are tested using the actual selected connection/role.
- Private identity documents cannot be read by another trainee/mentor; no patient-identifying data is accepted into log entries or audit metadata.

**Current implementation status:** The initial schema/RLS implementation is applied in the isolated Supabase test project and tracked by four migration files. Security Advisor currently reports no findings. UI/API integration, role-specific RLS tests with real authenticated users, concurrency tests, and the full end-to-end acceptance tests remain pending. Do not deploy the schema to production or publish the General Surgery template yet.
