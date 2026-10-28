# MENTORO Platform

MENTORO connects medical trainees with structured clinical training and mentorship. This repository contains the current trainee-facing foundation and the reviewed Supabase database workflow under active development.

## Current implementation

- Vite frontend using vanilla JavaScript and CSS.
- Supabase Auth for trainee sign-up, email confirmation, and sign-in.
- Trainee profile provisioning through a current-user RPC.
- Private university-ID uploads to the `trainee-verification` Storage bucket.
- Published training discovery and trainee applications.
- Separate enrollment and logbook instance for each confirmed training.
- Draft logbook entries and submission to the assigned mentor for review.
- Supabase RLS, scoped workflow RPCs, database-generated submission timestamps, and least-privilege browser grants.

The frontend work is still under review. Mentor/admin dashboards, complete template-driven logbook forms, browser end-to-end coverage, and specialty-by-specialty template migration are not yet complete.

## Branch and migration safety

The work is tracked across these pull requests:

- **PR #1 — trainee foundation:** merged into `main` on 2026-10-28. This does not constitute production-readiness approval.
- **PR #2 — migration recovery/security:** open as a draft and targets `main`; it restores historical migration files and adds database hardening. The latest test-database ledger has 20 records, but four newer migration source files are still missing from the repository and must be recovered before the migration history can be considered complete.

**Do not merge PR #2 or deploy to production until it has been reviewed and the outstanding migration/security and end-to-end checks are complete.** The test-only PostgreSQL 17 `MAINTAIN` privilege fix is recorded in PR #2. No production database changes or production deployment were initiated by the work described in the recovery PR.

The test Supabase project is `mentoro-platform-test`. Do not replay migrations on that project because its ledger already records them as applied. Four recorded migration versions currently lack matching SQL files in the checked branches; recover the exact originals before attempting a clean-room replay in an isolated disposable database. Do not run development migrations against production.

## Requirements and local setup

Requirements: a supported Node.js LTS release and npm.

```sh
npm install
npm run dev
```

Build and run the current source-contract check:

```sh
npm run check:contracts
npm run build
```

The repository currently has no committed npm lockfile, so `npm install` is not yet fully reproducible. Before relying on repeatable dependency resolution, generate and review `package-lock.json` using the intended Node/npm toolchain, commit it, and switch CI to `npm ci`. Do not hand-author a lockfile.

## Preview environment

Use only the test Supabase project for local development and Preview deployments. Configure these public browser variables in the **Preview** environment of an independently authorized Vercel Preview project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is intended for browser use; database access must still be constrained by RLS and grants. Never expose a Supabase secret/service-role key through a `VITE_` variable or commit credentials to Git.

The independent Preview project and environment configuration are not yet verified. Creating a separate Vercel project returned 403 in the available team context. A Vercel team owner must authorize or create the Preview project and connect this repository before browser-based end-to-end testing can be completed.

## Expected trainee flow

1. Sign up and confirm the email address.
2. Sign in and upload a university ID (JPG, PNG, or PDF, maximum 8 MiB).
3. Wait for an administrator to verify the trainee account.
4. Browse published offerings with future open slots and submit an application.
5. The assigned mentor reviews the application.
6. An administrator confirms the booking.
7. Confirmation creates an enrollment with its own independent logbook instance.
8. The trainee saves draft entries and submits them for review by the assigned mentor.

A trainee may have multiple enrollments in the same specialty; each enrollment must retain a separate logbook and history. Past training records must not be copied into a new enrollment. Mentors should access only their assigned enrollments, while administrators can oversee all enrollments.

## Current validation and outstanding checks

GitHub Actions runs `npm run check:contracts` and `npm run build`. Database workflow checks have also been exercised in rollback-only transactions against the test project. These checks do **not** substitute for browser testing with separate trainee, mentor, and administrator identities.

Outstanding before considering a merge:

- Clean-room migration replay on an isolated database.
- Resolve/review broad default privileges owned by `supabase_admin` for future public objects.
- Generate and commit a reviewed npm lockfile, then use `npm ci` in CI.
- Configure an independent Vercel Preview and test the full trainee-to-mentor/admin journey.
- Add browser end-to-end tests and complete mentor/admin workspaces.
- Review both stacked pull requests together; do not merge PR #1 alone.

Do not enter patient-identifying information into test environments.
