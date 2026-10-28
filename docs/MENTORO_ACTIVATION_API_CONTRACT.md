# MENTORO MVP — Enrollment & Activation API Contract

**Status:** Superseded legacy workflow contract; not implemented.
**Scope:** Minimum trusted API/database contract for issuing/replacing activation invitations and redeeming a single-use activation code.
**Architecture:** Vercel Node.js API, Supabase Auth, Supabase PostgreSQL, RLS/grants, narrowly scoped atomic database operations.
**Explicit boundary:** This document does not authorize code, migrations, database changes, deployment, or claims of passing tests.

> **Architecture supersession notice — 2026-10-28:** The canonical booking/logbook model is now `docs/MENTORO_TARGET_DATA_MODEL_V2.md`, adopted with `docs/decisions/ADR-03-INDEPENDENT-TRAINING-ENROLLMENTS.md`. Any content in this legacy document that requires one active assignment/logbook per trainee, a trainee-wide mentor relationship, one pending enrollment per email, or activation-code-based training enrollment is superseded and must not be used to implement migrations or protected workflows. Shared security, audit, privacy, role-integrity, correction-history, and immutable-template-version principles remain relevant only where consistent with the new model. No SQL or database changes are authorized by this notice.


## 1. Non-negotiable invariants

1. The authenticated actor is derived from a verified Supabase Auth session; never trust client-supplied actor/profile IDs, roles, email-verification claims, or assignment ownership.
2. Activation requires the Supabase Auth email to be verified and to match the trusted normalized invitation email.
3. At most one `PENDING` enrollment exists per normalized email across templates/specialties.
4. Same email and same selected scope/template reuses the eligible pending enrollment. A different scope cancels/replaces only a pending enrollment and revokes its unused code(s) atomically.
5. Each pending enrollment has at most one unconsumed, unrevoked activation code. Codes are single-use, expire 24 hours after issuance, and only a secure hash is stored.
6. Activation creates at most one assignment from an enrollment, and the trainee has at most one `ACTIVE` assignment platform-wide.
7. The destination template must be `PUBLISHED` and `is_assignable = TRUE`.
8. Code consumption, enrollment activation, assignment creation, and required audit writes commit in one transaction. Any failure, including audit failure, rolls back the whole operation.
9. Concurrent requests cannot bypass uniqueness by racing. Database constraints remain the final defense; trusted locking/transaction design coordinates the workflow.
10. Do not include plaintext codes, passwords, bearer tokens, service-role secrets, or patient-identifying information in logs or audit metadata.

## 2. Minimum API operations

Exact route names are intentionally not fixed until repository routing conventions are inspected. The operations below are logical contracts, not implemented endpoints.

### A. Create or replace an activation invitation (restricted admin operation)

**Input**
- Selected template ID/scope.
- Trainee email address.
- Optional operator-supplied reason if required by the admin workflow.

**Trusted processing**
1. Verify Supabase Auth session and derive the actor.
2. Authorize the platform-wide Super Admin role from trusted state.
3. Normalize the email using one documented canonical rule.
4. Serialize work for that normalized email.
5. If a pending enrollment exists for the same selected scope/template, reuse it; do not create a duplicate enrollment.
6. If a pending enrollment exists for a different scope/template, cancel it and revoke its unused code(s).
7. Verify the selected template is eligible for new assignment.
8. Create/reuse the pending enrollment and issue a new code; persist only its hash and a trusted 24-hour expiry.
9. Write required audit event(s) in the same transaction as state changes.
10. After commit, return the plaintext code once in the authenticated Super Admin response over HTTPS so the administrator can deliver it through their chosen channel. Do not add email/SMS delivery in this MVP slice. Never store the plaintext code. If the response is lost, do not attempt to reconstruct the code from its hash: the administrator must request a replacement, which revokes the prior unused code and issues a new one through the same audited workflow. The UI must warn that the code is shown once and should be shared only with the intended trainee.

**Failure behavior**
- Invalid authorization: deny without changing state.
- Invalid/ineligible template: deny without changing state.
- Transaction/audit failure: rollback all enrollment/code changes.
- Do not reveal whether an unrelated account exists beyond what the authorized workflow requires.

### B. Redeem an activation code

**Input**
- Activation code.
- Authenticated Supabase session; no client-supplied profile ID or email-verification flag is accepted as authority.

**Trusted processing**
1. Verify session; derive authenticated user ID and email/verification status from trusted Auth state.
2. Reject unverified email.
3. Compute the code hash using the same documented secure hashing scheme as issuance; never log the raw code.
4. Begin the atomic database operation and serialize/lock the relevant enrollment/code and assignment invariant.
5. Verify code exists, is unexpired, unused, and unrevoked; enrollment is `PENDING`; normalized email matches; template is `PUBLISHED` and assignable; and the user has no active assignment.
6. If the code is already used, permit an idempotent success response only when the same authenticated profile is the recorded activation profile and the unique assignment created from that enrollment exists. Return the existing assignment summary; do not create or mutate a second assignment. Otherwise treat the code as unavailable.
7. For a first successful redemption, atomically mark the code used, activate the enrollment, record the activating profile/time, create exactly one assignment linked to the source enrollment, and insert required audit events.
8. Commit before reporting success.

**Failure behavior**
- Invalid, expired, used, revoked, mismatched-email, ineligible-template, or already-assigned cases produce a generic safe failure response.
- Failed validation does not consume a code that otherwise remains valid.
- If any write or required audit insert fails, roll back all state changes.
- Concurrent redemption of the same code results in at most one successful transaction.

## 3. Response contract

Use a consistent JSON response envelope; exact HTTP status mapping is a later API implementation detail. Responses must not leak whether a code belongs to another email, whether another user's account exists, raw database errors, SQL details, tokens, or stored hashes.

Minimum logical outcomes:
- `success`: activation completed and assignment exists.
- `invalid_or_unavailable_code`: code is invalid, expired, used, revoked, or no longer eligible.
- `email_verification_required`: session email is not verified.
- `scope_not_assignable`: requested enrollment target is no longer eligible.
- `already_has_active_assignment`: account already has an active assignment; no new assignment is created.
- `temporarily_unavailable`: safe generic response for transactional/infrastructure failure; operation is not reported successful.

Do not rely on client-side messages or status checks for authorization. Server logs must use a request/correlation ID and omit secrets.

## 4. Transaction and concurrency requirements

The exact RPC signatures, SQL locks, isolation level, and partial-index syntax are not finalized here. The implementation design must prove all of the following:
- Unique pending enrollment per normalized email across scopes.
- Unique active assignment per profile.
- At most one active usable code per enrollment.
- Same-code concurrent redemption is single-winner.
- Different-scope replacement cannot race with another create/replacement and leave two pending enrollments.
- A retry after a committed activation but lost response returns the existing result only to the same authenticated profile, using the used-code/enrollment/assignment linkage; all other reuse attempts fail safely.
- Enforce at most one assignment per source enrollment with a unique constraint/index on non-null `created_from_pending_enrollment_id`, in addition to at most one active assignment per profile.
- Required audit rows are part of the same transaction as state changes.
- A failed transaction leaves enrollment, code, assignment, and audit state consistent.

Candidate database constraints described in the Physical Schema/RLS Contract are proposals only until migration review. Never implement these guarantees using UI checks alone.

## 4.1 Candidate database enforcement and execution boundary

The physical-schema contract proposes these final-defense uniqueness rules:
- One `PENDING` enrollment per `normalized_email` across all templates.
- One code per enrollment where `used_at IS NULL AND revoked_at IS NULL`; expired unused codes must be explicitly revoked before replacement because expiry is evaluated at redemption, not by a time-dependent index predicate.
- One assignment per non-null `created_from_pending_enrollment_id`.
- One `ACTIVE` assignment per `profile_id`.

These are candidate migration definitions, not applied constraints. Required FKs, status consistency checks, grants, and exact SQL must be reviewed alongside them.

Default to `SECURITY INVOKER`. The trusted Vercel API verifies the Supabase session and derives the profile UUID; clients must not call a privileged RPC or choose the profile ID. RPC execution should be restricted to the trusted server database role actually used by the API, with explicit review of `anon`/`authenticated` grants and RLS behavior. If `SECURITY DEFINER` is proposed, require a written justification plus fixed safe `search_path`, minimal grants, owner-privilege review, and an identity-binding proof before approval.

Serialize create/replacement operations by normalized email within the database transaction. Activation must lock code/enrollment in a documented stable order and serialize the trainee's active-assignment invariant; database unique indexes remain the final defense. Exact lock primitive and isolation level are intentionally not frozen until the PostgreSQL/Supabase execution model and tests are reviewed.

Profile provisioning is a precondition: if Auth registration succeeded but the required `profiles` row is not yet available, activation must fail retryably without consuming the code. Profile provisioning/reconciliation must be idempotent and trusted; do not report full signup/enrollment success until required profile state exists.

## 5. Minimal test matrix required before release

- Verified matching email + valid code + eligible template → one assignment, enrollment activated, code consumed, audit event present.
- Unverified email → denied; no state change.
- Email mismatch → denied; no code consumption.
- Expired/used/revoked/invalid code → denied; no assignment.
- Unassignable or archived template → denied; no assignment.
- Existing active assignment → denied; no second assignment.
- Two simultaneous redemptions of the same code → exactly one success.
- Two simultaneous invitations for the same normalized email → at most one pending enrollment.
- Concurrent different-scope replacement → one final pending enrollment and only its current unused code remains usable.
- Injected audit-write failure → full rollback.
- Retry after ambiguous network response from the same authenticated profile → same activation result and no duplicate assignment.
- Reuse of a consumed code by a different profile → generic failure and no information disclosure.
- Activation response is lost after issuance → prior plaintext cannot be recovered; replacement revokes the previous code and audits the new issuance.
- Responses/logs contain no plaintext activation code or other secret.

Tests must run against a real local/test PostgreSQL or Supabase environment before migrations or production writes are considered ready. No such tests are claimed by this document.

## 6. Explicitly deferred

To keep the MVP narrow, this contract does not specify:
- Detailed `mentor_assignments` and `template_transitions` RPCs.
- General API routing conventions, frontend screens, email/SMS delivery provider, rate-limit thresholds, alerting, or observability stack.
- Production retention periods for expired/revoked code rows.
- Specialty log-entry schemas and logbook submission/correction workflows.

These items remain subject to their previously accepted security and policy decisions when their implementation becomes necessary.
