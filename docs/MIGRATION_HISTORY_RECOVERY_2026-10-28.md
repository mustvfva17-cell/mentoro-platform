# Migration History Recovery — 2026-10-28

## Purpose

Recover a reproducible database history for MENTORO, verify its existing test schema/security posture, and avoid changing production. This is a recovery/audit branch and remains a draft for review.

## Verified test environment

- Supabase project: `mentoro-platform-test` (`dkqrpndqfwmyevylbbse`)
- Status at latest check: `ACTIVE_HEALTHY`
- PostgreSQL: 17.11
- Public tables found: 17; all reported with RLS enabled.
- Specialty seed data: 6 rows.
- Supabase security advisor: no findings at latest check. This does not replace manual privilege/function review.

## Migration history in the database

The test database currently reports these nine applied migration records:

| Version | Name | SQL file in recovery branch? |
| --- | --- | --- |
| 20261028060841 | restrict_rls_auto_enable_function | Recovered |
| 20261028061628 | core_independent_enrollment_schema_v1 | Recovered |
| 20261028061834 | rls_policy_and_foreign_key_hardening | Recovered |
| 20261028062421 | current_user_workflow_wrappers | Recovered |
| 20261028062818 | mentor_reviews_and_admin_training_setup | Recovered |
| 20261028090042 | restrict_current_browser_table_privileges | Present |
| 20261028090059 | restrict_postgres_default_table_privileges | Present |
| 20261028090137 | least_privilege_browser_write_columns | Present |
| 20261028092340 | restrict_app_private_helper_execute | Present |

The first five migration records existed in the database history but were absent from the trainee-auth branch. The SQL files were recovered from the existing `feature/independent-training-enrollments` branch. Their Git blob SHAs match the source branch blobs exactly, confirming byte-for-byte identity with those source-branch files. The database stores migration version/name metadata rather than a verifiable copy of each original SQL body, so equivalence to the SQL originally applied remains unproven.

## Privilege audit and fix

A direct read-only privilege inventory found that these ten `app_private` helper functions had effective EXECUTE rights for `anon` because PostgreSQL grants function execution to `PUBLIC` by default:

- `is_trainee()`
- `is_mentor()`
- `is_verified_trainee()`
- `can_access_application(uuid)`
- `can_access_enrollment(uuid)`
- `can_access_instance(uuid)`
- `owns_instance(uuid)`
- `can_access_entry(uuid)`
- `is_assigned_mentor_for_entry(uuid)`
- `is_platform_admin()`

Migration `20261028092340_restrict_app_private_helper_execute.sql` revokes the inherited broad grants and restores the intended role grants: `is_platform_admin()` remains callable by `anon` and `authenticated`, while the other listed helpers are executable by `authenticated` only. This is least-privilege hardening; the prior result did not by itself establish access to trainee data.

After applying this migration to the **test project only**, read-only checks confirmed:
- The nine non-admin helper functions above no longer have EXECUTE for `anon` or `service_role`.
- `is_platform_admin()` remains executable by `anon` and `authenticated`, matching its explicit grant.
- All ten helpers remain executable by `authenticated` as required by RLS policies/workflows.
- The database migration history includes version `20261028092340`, matching the recovered repository file.

The security advisor had no lints, but its result did not reveal this permission issue; direct privilege inspection was necessary.

## Remaining default-privilege ownership issue

The live default-ACL inventory also reports broad defaults for objects created by role `supabase_admin` in schema `public`:

- Future tables: grants to `anon`, `authenticated`, and `service_role`.
- Future sequences: grants to `anon`, `authenticated`, and `service_role`.
- Future functions in `public`: EXECUTE grants to `anon`, `authenticated`, and `service_role`.

The current migration connection is `postgres` and does not have membership in `supabase_admin`, so it cannot change that role's default privileges. This is a **follow-up for a Supabase project owner** to review and harden in a controlled way. No attempt was made to bypass role ownership. The existing objects in the current app schema were separately checked and do not inherit those permissions automatically; the concern is future objects created by that role.

## Findings and limits

- The database contains 17 public tables and helper routines/policies. Reconstructing a migration from current schema alone can lose historical intent, ordering, grants, triggers, storage policies, and edge-case safeguards.
- The exact SQL originally applied for the five recovered historical migrations cannot be proven from migration version/name metadata alone.
- A clean-room replay is still outstanding. An attempt to create a disposable Supabase development branch returned `Branching is supported only on the Pro plan or above`; no branch was created and no branch compute charges started. The quoted branch rate was $0.01344/hour, but the plan entitlement blocked creation.
- Vercel preview setup is still blocked: the previous attempt to create a separate project returned 403. A Vercel team owner must authorize/create a preview project and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Browser/e2e tests with real trainee, mentor, and admin identities have not been run. The current test database has no trainee/mentor profiles, offerings, slots, applications, enrollments, logbook instances, entries, reviews, or assessments, so it cannot exercise the full booking/logbook flow without approved fixtures.

## Next steps

1. Compare the recovered SQL with the existing test database definitions, including columns, constraints, indexes, RLS policies, function ACLs, default privileges, triggers/event triggers, storage policies, and seed data.
2. Replay the repository migrations in timestamp order on a disposable project once an eligible isolated environment is available.
3. Resolve differences and confirm a clean replay without manual SQL-editor steps.
4. Configure an independent Vercel preview and run the auth/application/logbook workflow end-to-end.
5. Do not replay the recovered historical migrations on `mentoro-platform-test`; it already records those versions as applied. Do not run anything against production.


The GitHub Actions workflow now runs `npm run check:contracts` before the production build. It checks literal `entry_type` values in `src/main.js` against the core migration when that file is present; on branches missing recovered migration history, it falls back to the reviewed allowed-value list and emits a warning.

## Acceptance criteria

- An isolated database can be provisioned from the repository migrations without manual SQL-editor steps.
- Schema, constraints, indexes, functions, function grants, RLS policies, table/column privileges, triggers, storage policies, and seed data match the reviewed expected inventory.
- Runtime auth/application/logbook flows pass integration tests.
- The Vercel preview environment is independently configured and browser-tested.

## Current state

The five missing migration files, the privilege-hardening migration, and this audit note are present on the recovery branch. The latest privilege-hardening migration was applied only to `mentoro-platform-test` and was checked afterward with read-only privilege queries. Production was not accessed or modified. No PR was merged and no production deployment was made.
