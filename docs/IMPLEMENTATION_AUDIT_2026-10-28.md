# MENTORO Implementation Audit — 2026-10-28

## Scope and environments

- Repository: `mustvfva17-cell/mentoro-platform`
- Test database: Supabase project `dkqrpndqfwmyevylbbse` (`mentoro-platform-test`), verified `ACTIVE_HEALTHY`.
- Production Supabase project was reported as `INACTIVE` during this audit. No production database changes were made.
- Existing Vercel team projects include the public `mentoro` site and several standalone specialty logbooks. No Vercel project named `mentoro-platform` was found in the team project list, and the platform repository is not listed among the team's linked Git projects.
- No deployment was triggered by this work.

## Verified database state

The test database has the core platform tables: profiles and role assignments, trainee and mentor profiles, verification documents, specialties, training offerings and slots, applications, enrollments, versioned logbook templates, logbook instances and entries, mentor reviews, assessments, and audit logs. RLS is enabled on the listed public tables. The six active specialty records are Anaesthesia & Critical Care, Cardiology, General Surgery, Medical Oncology, Neurology, and Ophthalmology.

Five migrations were already recorded in the test database before this audit. The database had therefore advanced beyond the repository's older `IMPLEMENTATION_STATUS.md` wording that described the project as documentation-only.

## Security finding and remediation

The initial privilege audit found `TRUNCATE`, `REFERENCES`, and `TRIGGER` grants on public tables for the browser roles `anon` and `authenticated`. RLS does not protect against `TRUNCATE`, so these grants were unnecessary and unsafe.

Applied to the **test database only**:

1. Migration `20261028090042_restrict_current_browser_table_privileges`: revoked those three privileges from `anon` and `authenticated` on current public tables.
2. Migration `20261028090059_restrict_postgres_default_table_privileges`: revoked broad default table privileges for future public tables created by the `postgres` role.
3. Migration `20261028090137_least_privilege_browser_write_columns`: granted only the required column-level writes for logbook entries, training applications, and mentor reviews. Clients cannot insert application decision fields or overwrite review/audit timestamps.

Post-migration checks returned no remaining `TRUNCATE`, `REFERENCES`, or `TRIGGER` grants to either browser role on current public tables. Effective privilege checks confirmed that the intended column-level trainee workflow writes are granted, that clients cannot insert admin decision fields, and that `authenticated` cannot truncate `public.profiles`.

**Remaining database follow-up:** the connected database role cannot alter default privileges owned by `supabase_admin`. Those defaults must be reviewed by an owner with the required privileges, particularly before creating additional tables as that role. This audit did not change or claim to fix that owner-specific default ACL.

The Supabase security advisor returned no findings at the time of this audit, but that did not detect the broad table grants; direct privilege checks were necessary.

## Application work on `feat/trainee-auth-foundation`

The branch replaces the placeholder screen with a first trainee-side workflow:

- Supabase email/password sign-up and sign-in using public Vite environment variables only.
- Idempotent trainee profile provisioning through the database's `provision_current_trainee` RPC after email confirmation.
- University-ID upload to the private `trainee-verification` bucket and document registration through `record_verification_document`.
- Trainee dashboard with account status, training listings and available slots, application submission, current enrollments, per-enrollment logbooks, draft entries, and entry submission for mentor review.
- Responsive styling for mobile and desktop.

The UI uses the existing RLS-protected tables and does not introduce a service-role key into the browser.

## Not yet verified / remaining work

- The application build and browser flow have **not** been executed. The attempt to clone the repository for a local build failed because the execution environment could not resolve `github.com`. Do not treat this branch as production-ready.
- The Vercel Preview project/environment needs to be connected to `mentoro-platform` and configured with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. No environment-variable values or secrets were changed.
- No end-to-end tests were run against real trainee, mentor, or admin accounts.
- The current branch is a review candidate, not a production deployment. Admin and mentor dashboards, robust end-to-end tests, full template-driven logbook fields, and the six specialty template migrations remain to be implemented.
