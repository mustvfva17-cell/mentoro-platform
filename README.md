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
- Server-side logbook payload validation against the exact template version attached to each logbook instance.
- Supabase RLS, scoped workflow RPCs, database-generated submission timestamps, and least-privilege browser grants.

The trainee and mentor workspaces are implemented as MVPs. The admin workspace can review trainee verification through short-lived signed document URLs, confirm mentor-approved bookings, create offerings/slots, create and inspect inactive logbook-template drafts, and submit a draft for an audited publication workflow. It surfaces existing HTML logbooks before the optional JSON authoring tools. The Medical Oncology HTML asset is preserved at `public/logbooks/medical-oncology/index.html`; the standalone `?mode=preview` is local-only, while an instance launched from an eligible MENTORO enrollment loads/saves the original HTML state through revision-checked, per-instance Supabase RPCs. Individual HTML sections still need to be surfaced for mentor review; the cloud-state bridge does not yet convert HTML sessions/cases into native per-entry review records. The trainee UI renders supported fields from the template version attached to that specific logbook instance, saves them to the entry payload, preserves the entry type when revising a returned entry, and treats required boolean fields as explicit Yes/No answers. An admin can create new immutable draft versions for an existing template; publishing a newer version stops assigning older versions to new offerings while leaving historical references intact. The database validates every entry payload against the attached version, rejecting unknown keys, missing required values, incorrect types, invalid dates/options, and out-of-range numbers even if a client bypasses the form. The public admin-template RPCs use `SECURITY INVOKER` wrappers. Their private `SECURITY DEFINER` implementations check the current identity's active admin role on every mutation. Because invoker wrappers call those implementations as the authenticated caller, the authenticated role needs EXECUTE on the private functions; keep `app_private` outside PostgREST's exposed schemas and do not treat the function grants alone as authorization. This removed the three public `SECURITY DEFINER` Advisor findings. The test Auth project still reports leaked-password protection disabled. No template has been clinically reviewed or published in the test database; no template is made bookable by this change. Specialty-by-specialty medical template migration and browser end-to-end testing remain incomplete.


## Existing HTML logbook integration

Do not rebuild an existing specialty logbook merely to fit the template editor. The Medical Oncology HTML file is kept intact at `public/logbooks/medical-oncology/index.html`. In admin review it is identified as an HTML runtime, shows its existing sections, and links to a local-only preview instead of reporting that it has no JSON fields. Its standalone `?mode=preview` stores data in a separate browser-local namespace and is for visual inspection only. When launched from a confirmed enrollment with an HTML template version assigned to that logbook instance, the existing HTML interface uses a same-origin message bridge and the `get_my_logbook_html_state` / `save_my_logbook_html_state` RPCs to load/save a JSON state blob scoped to that exact instance, with optimistic revision checking. The RPC boundary verifies the instance's registered HTML asset and the assigned trainee for writes. The mentor workspace now includes a read-only viewer for the legacy HTML state, and it uses the same scoped read RPC. The bridge is not yet a per-entry mentor-review model: HTML sessions/cases/procedures are saved as the legacy HTML state blob, not separate `logbook_entries`; mentor decisions/feedback for those individual HTML items are not captured in the native review workflow yet. The seeded Medical Oncology HTML template version remains `DRAFT` and non-assignable until an authorized human performs the clinical review. Other specialty HTML files must be added to `public/logbooks/<specialty-slug>/index.html` after their source files are available in this repository.

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

The lockfile is committed and CI installs dependencies with `npm ci`. The migration-history guard rejects malformed filenames, duplicate version prefixes, empty SQL, and identical migration contents under different versions. The source-contract suite checks admin-only RPC usage, short-lived private document links, template schema validation, and safe logbook workflow boundaries. A rollback-only database test confirmed that valid payloads are accepted while missing required fields, unlisted select options, and unknown keys are rejected; the transaction left no test rows behind. A full, repeatable database integration script lives at `supabase/tests/logbook_entry_payload_validation.sql`; run it only against the test/disposable database. It wraps synthetic fixtures in `BEGIN`/`ROLLBACK` and tests required fields, select options, unknown keys, typed values, date validity, numeric bounds, and the 64 KiB payload limit. A second rollback-only script at `supabase/tests/logbook_html_state_integration.sql` checks HTML state save/reload, revision conflict detection, enrollment isolation, and trainee-only writes. It has been run against `mentoro-platform-test`; all synthetic rows were rolled back.

## Preview environment

Use only the test Supabase project for local development and Preview deployments. Configure these public browser variables in the **Preview** environment of an independently authorized Vercel Preview project:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The publishable key is intended for browser use; database access must still be constrained by RLS and grants. Never expose a Supabase secret/service-role key through a `VITE_` variable or commit credentials to Git.

The `feat/admin-workspace-mvp` Preview was manually opened by the owner with the test Supabase connection and Auth redirect allow-list. The two public browser variables are explicitly configured for the `feat/logbook-template-drafts` branch and Preview target only. A branch deployment was `READY` at the last check; open the stable alias in `docs/PREVIEW_TESTING.md` and confirm the Supabase warning is gone after the latest commit. Keep all variables scoped to Preview and do not change Production variables.


The `app_private` schema is an implementation boundary, not a browser API. The schema's template write implementations are executable by `authenticated` because the public wrappers are `SECURITY INVOKER`; the implementations independently check `auth.uid()` and the active platform-admin role. Keep `app_private` excluded from PostgREST's exposed schemas. The application must never rely on hidden UI controls or function grants as the sole authorization check.

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
- Confirm the branch-scoped Vercel Preview variables and manually test the full trainee-to-mentor/admin journey, including cloud save/reload and close-time save.
- Add browser end-to-end tests for separate trainee, mentor, and admin identities; manually verify the template-version creation/publication workflow.
- Review both stacked pull requests together; do not merge PR #1 alone.

Do not enter patient-identifying information into test environments.
