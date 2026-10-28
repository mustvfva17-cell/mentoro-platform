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

The trainee and mentor workspaces are implemented as MVPs. The admin workspace can review trainee verification through short-lived signed document URLs, confirm mentor-approved bookings, create offerings/slots, create and inspect inactive logbook-template drafts, and submit a draft for an audited publication workflow. The trainee UI renders supported fields from the template version attached to that specific logbook instance, saves them to the entry payload, preserves the entry type when revising a returned entry, and treats required boolean fields as explicit Yes/No answers. An admin can create new immutable draft versions for an existing template; publishing a newer version stops assigning older versions to new offerings while leaving historical references intact. The public admin-template RPCs now use `SECURITY INVOKER` wrappers that delegate to private `SECURITY DEFINER` implementations with an active-admin check; this removed the three associated public `SECURITY DEFINER` Advisor findings. The test Auth project still reports leaked-password protection disabled. No template has been clinically reviewed or published in the test database; no template is made bookable by this change. Specialty-by-specialty medical template migration and browser end-to-end testing remain incomplete.

## Branch and migration safety

The work is split across pull requests to keep review and deployment boundaries explicit:

- **PR #1 — trainee foundation:** merged into `main`.
- **PR #2 — migration recovery/security:** restored migration history, lockfile, and CI checks; draft for review.
- **PR #3 — mentor workspace:** scoped mentor inbox and logbook review workflow; stacked on PR #2.
- **PR #4 — administrator workspace:** admin verification, booking control, and training operations; stacked on PR #3.
- **PR #5 — logbook template drafts/schema UI:** template draft creation, review queue, database schema guard, and schema-driven entry fields; stacked on PR #4.

Do not merge the draft stack out of order. PRs #2–#5 remain under review. No Production database migration or deployment was performed for the draft-template work.

The test Supabase project is `mentoro-platform-test`. Do not replay the recovered migrations on that project because its migration ledger already records them as applied. A clean-room migration replay still requires an isolated disposable database. Do not run development migrations against production.

## Requirements and local setup

Requirements: a supported Node.js LTS release and npm.

```sh
npm ci
npm run dev
```

Run the migration-history and source-contract checks, then build:

```sh
npm run check:migrations
npm run check:contracts
npm run build
```

The lockfile is committed and CI installs dependencies with `npm ci`. The migration-history guard rejects malformed filenames, duplicate version prefixes, empty SQL, and identical migration contents under different versions. The source-contract suite checks admin-only RPC usage, short-lived private document links, template schema validation, and safe logbook workflow boundaries.

## Preview environment

Use only the test Supabase project for local development and Preview deployments. Configure these public browser variables in the **Preview** environment of an independently authorized Vercel Preview project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is intended for browser use; database access must still be constrained by RLS and grants. Never expose a Supabase secret/service-role key through a `VITE_` variable or commit credentials to Git.

The `feat/admin-workspace-mvp` branch Preview was manually opened by the owner with the test Supabase connection and Auth redirect allow-list. The `feat/logbook-template-drafts` branch has a Ready Vercel deployment, but its branch-specific Vercel Preview variables could not be verified through the current settings connection. Open it manually and confirm the Supabase configuration warning is gone before testing authentication. Keep variables scoped to Preview and this branch; do not change Production variables.

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

GitHub Actions installs with `npm ci`, runs `npm run check:migrations` and `npm run check:contracts`, then runs `npm run build`. Database workflow checks have also been exercised in rollback-only transactions against the test project. These checks do **not** substitute for browser testing with separate trainee, mentor, and administrator identities.

Outstanding before considering a merge:

- Clean-room migration replay on an isolated database.
- Resolve/review broad default privileges owned by `supabase_admin` for future public objects.
- Confirm the Vercel Preview branch variables and manually test the schema-driven template/logbook flow.
- Confirm the branch-scoped Vercel Preview variables and manually test the full trainee-to-mentor/admin journey.
- Add browser end-to-end tests for separate trainee, mentor, and admin identities; manually verify the template-version creation/publication workflow.
- Review both stacked pull requests together; do not merge PR #1 alone.

Do not enter patient-identifying information into test environments.
