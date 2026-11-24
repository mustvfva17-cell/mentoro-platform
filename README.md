# MENTORO Platform

MENTORO connects medical trainees with structured clinical training and mentorship. This repository contains the platform (Supabase-backed trainee, mentor and administrator workspaces), the specialty logbooks, and the licensed standalone logbook deployments.

> **Documentation status.** Updated during the stage-1 system review ([docs/SYSTEM_REVIEW.md](docs/SYSTEM_REVIEW.md)). Counts below describe the repository, not any remote environment. Nothing here claims that a migration has been applied to, or that a deployment exists on, a remote Supabase or Vercel project; those facts cannot be verified from this repository.

## Current implementation

- Vite frontend using vanilla JavaScript and CSS (`src/`).
- Supabase Auth for sign-up, email confirmation, and sign-in.
- Trainee profile provisioning through a current-user RPC, and private university-ID uploads to the `trainee-verification` Storage bucket.
- Published training discovery, trainee applications, mentor review of applications, and administrator confirmation.
- Accepted decision L-43: one independent logbook per training enrollment. A repeat booking in the same specialty creates a new enrollment and a fresh logbook; prior records remain in the trainee's history. Migration `20261102100000_restore_enrollment_owned_logbooks.sql` implements it in the repository and fails closed on legacy orphan rows.
- Administrator workspace (`src/admin-workspace.js`): template publication, mentor registration, enrollment lifecycle controls, and direct assignment that creates an enrollment and its logbook in one transaction.
- Seven specialty logbooks (General Surgery, Medical Oncology, Cardiology, Neurology, Pediatrics, Anaesthesia & Critical Care, Ophthalmology) served as static HTML runtimes under `public/logbooks/`. They sync through an origin-validated `postMessage` bridge with revision-checked saves, and mentors review items from a read-only view.
- Licensed standalone logbooks under `vercel-logbooks/<specialty>/`: local-first (IndexedDB) storage, one phone per license, activated through `api/license/*` and the `mentoro-license` Supabase Edge Function. Each directory is a self-contained project root with its own `api/` and `vercel.json`.
- Native (JSON-template) logbook entries with draft, submit, review and return remain in the trainee workspace. The General Surgery JSON pilot was retired by `20261104210000_retire_legacy_general_surgery_json_pilot.sql`.
- Supabase RLS, scoped workflow RPCs, database-generated submission timestamps, and least-privilege browser grants.

Mentor and administrator workspaces have not been exercised in browser end-to-end tests with separate identities, and CI covers them only through contract checks (see "Current validation and outstanding checks").

## Branch and migration safety

### Merged work

- Merged work is tracked in GitHub pull requests. This README deliberately does not pin commit hashes or CI run IDs because they go stale on every merge; read the latest `Validate platform` run on `main` in GitHub Actions for the current verified state.
- PR #2 — migration-history recovery — merged on 2026-11-01. Its recovery note says the source migration files were restored byte-for-byte, while the database migration ledger stores version/name metadata and cannot prove the original SQL bodies; a clean-room replay remains required.
- The seven specialty modules and seven HTML runtime paths are registered in the central repository (`src/logbooks/module-registry.js`, checked by `scripts/check-specialty-html-registry.mjs`).

### Migration and publication safety

- The repository contains 70 SQL migration files at the time of the stage-1 review. `npm run check:migrations` validates unique version prefixes, unique normalized contents, and a few seed/guard contracts; this does not prove that a remote database has applied them.
- The specialty seed migrations create template versions with status `DRAFT` and `is_assignable = false`. Technical registration does not establish clinical approval or make a template eligible for booking.
- The latest specialty template versions must remain non-assignable until their specialty-specific clinical review and authorized publication are complete.
- The repository's older migration-recovery note refers to a test project named `mentoro-platform-test` and a 20-version ledger. On 2026-11-02, the connected Supabase account tool returned no accessible projects, so the current existence of that project and its remote migration ledger could not be verified.
- **Do not replay or apply the migration history to any database until the intended Supabase project is accessible and its actual migration ledger has been inspected.** Do not run development migrations against production.

### Accepted logbook ownership decision (L-43)

- L-43, explicitly reconfirmed by the project owner on 2026-11-02, specifies one independent logbook instance per training enrollment. Two bookings in the same specialty—even with different mentors—must have separate logbooks and separate histories.
- A direct admin opening creates/activates the enrollment and its logbook atomically (`admin_assign_trainee_enrollment_logbook`). Mentors see only logbooks belonging to their assigned enrollments; administrators can oversee all enrollments. A new enrollment starts with no copied activities from prior enrollments.
- In the repository, `20261102100000_restore_enrollment_owned_logbooks.sql` removes the direct-to-profile owner column and requires an enrollment owner, and `scripts/check-per-enrollment-logbooks.mjs` asserts that contract on the source text. No live migration is claimed, and the rule has not been exercised against a remote database from this repository.
- L-42's one-logbook-per-trainee-specialty proposal is superseded and must not be implemented. See [the current per-enrollment lifecycle contract](docs/LOGBOOK_PER_ENROLLMENT_LIFECYCLE.md) and [the superseded L-42 note](docs/LOGBOOK_PER_SPECIALTY_LIFECYCLE.md).

## Requirements and local setup

Requirements: a supported Node.js LTS release and npm.

```sh
npm ci
npm run dev
```

Run all repository checks and build the application:

```sh
npm run check:migrations
npm run check:contracts
npm run build
```

GitHub Actions installs with `npm ci` against the committed `package-lock.json`. Do not edit the lockfile by hand; regenerate it with npm when dependency definitions intentionally change.

## Preview environment

Use a dedicated non-production Supabase project for local development and Preview deployments. Configure the public browser variables only in the Vercel Preview environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The server-only environment template keeps `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and any separately reviewed `SUPABASE_SECRET_KEY` out of browser bundles. Never expose a secret/service-role key through a `VITE_*` variable or commit credentials to Git.

Deployment status and the Supabase project behind each Preview are configured outside this repository and are not verified here. As of the 2026-11-02 review the connected Supabase account exposed no accessible projects; re-verify the intended project and its migration ledger before authenticated Preview end-to-end testing.

## Expected trainee flow

The target flow under accepted decision L-43 is:

1. Sign up and confirm the email address.
2. Sign in and upload a university ID (JPG, PNG, or PDF, maximum 8 MiB).
3. Wait for an administrator to verify the trainee account.
4. Browse published offerings with future open slots and submit an application.
5. The assigned mentor reviews the application.
6. An administrator confirms the booking or directly provisions an approved specialty logbook.
7. The administrator confirms/creates the specific training enrollment and provisions one separate logbook for that enrollment in the same transaction.
8. The new logbook appears in the trainee account immediately after activation. A later booking in the same specialty creates another enrollment and another empty logbook; the old logbook remains in history.
9. The assigned mentor can access only that enrollment's logbook. Administrators can oversee all enrollments and logbooks.

**Implementation note:** L-43 is implemented in the repository (see above) but has not been verified end to end against a live database with separate trainee, mentor and administrator identities.

## Current validation and outstanding checks

The `Validate platform` workflow (`.github/workflows/validate.yml`) runs on pull requests to `main`: install from the lockfile, `npm run check:migrations`, `npm run check:contracts`, the enrollment-lifecycle monitor test, the production build, and Chromium tests for HTML-logbook read-only behaviour, General Surgery local-data preservation and the Cardiology logbook's recovery after a workspace reload. Many contract checks assert source text (regular expressions) rather than runtime behaviour. The SQL scripts in `supabase/tests/` are rollback-only checks that need an existing disposable database with an active administrator and trainee; they are not run in CI. None of this substitutes for browser testing with separate trainee, mentor, and administrator identities.

Outstanding before treating the platform as production-ready:

- Restore access to the intended non-production Supabase project and verify its migration ledger (no project was accessible on 2026-11-02).
- Perform a clean-room replay/reconciliation on an isolated database, then add it to CI. Resolve/review broad default privileges owned by `supabase_admin` for future public objects.
- Verify L-43 on that database: repeat and concurrent assignments, multiple enrollments in one specialty, the direct-admin path, mentor inbox/review, HTML state access, and audit/history provenance.
- Configure and verify the authorized Vercel Preview environment, then run authenticated end-to-end tests with separate trainee, mentor, and administrator identities.
- Obtain documented clinical review and authorized publication for each specialty before making any template assignable.
- Work through the open items in [docs/SYSTEM_REVIEW.md](docs/SYSTEM_REVIEW.md).

Do not enter patient-identifying information into test environments.
