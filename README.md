# MENTORO Platform

MENTORO connects medical trainees with structured clinical training and mentorship. This repository contains the current trainee-facing foundation and the reviewed Supabase database workflow under active development.

## Current implementation

- Vite frontend using vanilla JavaScript and CSS.
- Supabase Auth for trainee sign-up, email confirmation, and sign-in.
- Trainee profile provisioning through a current-user RPC.
- Private university-ID uploads to the `trainee-verification` Storage bucket.
- Published training discovery and trainee applications.
- Current schema paths still include enrollment-owned and direct-admin-owned logbook instances. Accepted decision L-42 targets one persistent logbook per trainee-specialty; that transition is not yet implemented.
- Draft logbook entries and submission to the assigned mentor for review.
- Supabase RLS, scoped workflow RPCs, database-generated submission timestamps, and least-privilege browser grants.

The frontend work is still under review. Mentor/admin dashboards, complete template-driven logbook forms, browser end-to-end coverage, and specialty-by-specialty template migration are not yet complete.

## Branch and migration safety

### Merged work on main

- PR #1 — trainee workspace/auth foundation — merged on 2026-10-28.
- PR #2 — migration-history recovery — merged on 2026-11-01. Its recovery note says the source migration files were restored byte-for-byte, while the database migration ledger stores version/name metadata and cannot prove the original SQL bodies; a clean-room replay remains required.
- PR #21 — Anesthesia & Critical Care central HTML runtime — merged on 2026-11-02.
- PR #22 and PR #23 — read-only browser harness fixes — merged on 2026-11-02.
- The six specialty modules and six HTML runtime paths are registered in the central repository.
- Last runtime/code commit verified by CI and Vercel: `daf555ae8b2ddb10fb5d50c844b5531c5348d427`. GitHub Actions run [41436124850](https://github.com/mustvfva17-cell/mentoro-platform/actions/runs/41436124850) passed migration-history checks, frontend/schema contracts, lifecycle-monitor checks, production build, and Chromium read-only smoke tests. GitHub recorded Vercel **success — “Deployment has completed”** for that code commit; its deployment detail/alias was not independently verified.
- Latest main commit is `9433f2517156a8d4943ac73efa851ccdfb7a0a89`, merged through docs-only PR #24. GitHub Actions run [41437280857](https://github.com/mustvfva17-cell/mentoro-platform/actions/runs/41437280857) passed. Vercel reported **“Deployment rate limited — retry in 24 hours”** for this docs-only commit; this does not establish a new deployment. Do not infer that the latest main commit is live on a production domain.

### Migration and publication safety

- The repository contains 59 SQL migration files. CI validates unique migration version prefixes and normalized contents; this does not prove that a remote database has applied them.
- The six specialty seed migrations create template versions with status `DRAFT` and `is_assignable = false`. Technical registration does not establish clinical approval or make a template eligible for booking.
- The latest specialty template versions must remain non-assignable until their specialty-specific clinical review and authorized publication are complete.
- The repository's older migration-recovery note refers to a test project named `mentoro-platform-test` and a 20-version ledger. On 2026-11-02, the connected Supabase account tool returned no accessible projects, so the current existence of that project and its remote migration ledger could not be verified.
- **Do not replay or apply the migration history to any database until the intended Supabase project is accessible and its actual migration ledger has been inspected.** Do not run development migrations against production.

### Accepted logbook ownership decision (L-42)

- L-42, accepted by the project owner and recorded on 2026-11-01, specifies one persistent logbook per trainee-specialty pair. Each enrollment remains a separate operational/mentor context and references that specialty logbook.
- The current SQL/runtime still contains enrollment-owned logbook instances and a separate direct-admin assignment path. It does not yet enforce canonical trainee-specialty uniqueness or complete the required enrollment-to-logbook association. L-42 is therefore an accepted target, not an implemented production invariant.
- See [the L-42 lifecycle and migration contract](docs/LOGBOOK_PER_SPECIALTY_LIFECYCLE.md).

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

The repository now contains an npm-generated `package-lock.json` (`lockfileVersion: 3`, 74 locked packages). GitHub Actions uses `npm ci` against the committed lockfile; validation run [40692616988](https://github.com/mustvfva17-cell/mentoro-platform/actions/runs/40692616988) passed dependency installation, migration-history checks, frontend/schema contracts, and the Vite production build. Do not edit the lockfile by hand; regenerate it with npm when dependency definitions intentionally change.

## Preview environment

Use a dedicated non-production Supabase project for local development and Preview deployments. Configure the public browser variables only in the Vercel Preview environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The server-only environment template keeps `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and any separately reviewed `SUPABASE_SECRET_KEY` out of browser bundles. Never expose a secret/service-role key through a `VITE_*` variable or commit credentials to Git.

The last runtime/code commit `daf555ae8b2ddb10fb5d50c844b5531c5348d427` has a successful Vercel completion status, but its deployment environment and alias were not independently verified. The later docs-only main commit `9433f2517156a8d4943ac73efa851ccdfb7a0a89` was rate-limited by Vercel; it has no new successful deployment status. The connected Supabase account currently exposes no accessible projects, so the database URL and migration target must be re-established before authenticated Preview end-to-end testing.

## Expected trainee flow

The target flow after the accepted L-42 migration is:

1. Sign up and confirm the email address.
2. Sign in and upload a university ID (JPG, PNG, or PDF, maximum 8 MiB).
3. Wait for an administrator to verify the trainee account.
4. Browse published offerings with future open slots and submit an application.
5. The assigned mentor reviews the application.
6. An administrator confirms the booking or directly provisions an approved specialty logbook.
7. The administrator provisions at most one persistent logbook for the trainee-specialty pair; a confirmed training enrollment is linked to that logbook rather than creating a second one.
8. Each enrollment and mentor relationship remains a distinct operational context. Mentor access remains limited to the assigned enrollment/context; the trainee's specialty logbook history is retained across enrollments.

**Implementation note:** step 7 is the accepted L-42 target and is not yet implemented in the current schema/runtime. The existing enrollment-owned paths must be migrated and reconciled before this flow can be claimed as live.

## Current validation and outstanding checks

GitHub Actions runs `npm run check:contracts` and `npm run build`. Database workflow checks have also been exercised in rollback-only transactions against the test project. These checks do **not** substitute for browser testing with separate trainee, mentor, and administrator identities.

Outstanding before implementing L-42 or treating the platform as production-ready:

- Restore access to the intended non-production Supabase project and verify its migration ledger; the currently connected Supabase account exposes no projects.
- Perform a clean-room replay/reconciliation on an isolated database. Resolve/review broad default privileges owned by `supabase_admin` for future public objects.
- Implement L-42 across schema, enrollment confirmation, direct admin provisioning, trainee workspace, mentor inbox/review, HTML state access, audit and history provenance. Test repeat/concurrent assignments and multiple enrollments in one specialty.
- Configure and verify the authorized Vercel Preview environment, then run authenticated end-to-end tests with separate trainee, mentor, and administrator identities.
- Complete remaining mentor/admin workspace and specialty template workflows.
- Obtain documented clinical review and authorized publication for each specialty before making any template assignable.

Do not enter patient-identifying information into test environments.
