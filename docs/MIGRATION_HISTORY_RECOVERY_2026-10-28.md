# Migration History Recovery — 2026-10-28

## Purpose

Recover a reproducible database history for MENTORO without replaying DDL against the existing test database or touching production. This branch is a recovery/audit branch; it does not apply database changes.

## Verified test environment

- Supabase project: `mentoro-platform-test` (`dkqrpndqfwmyevylbbse`)
- Status at audit time: `ACTIVE_HEALTHY`
- PostgreSQL: 17.11
- Public tables found: 17; all reported with RLS enabled.
- Specialty seed data: 6 rows.
- Supabase security advisor: no findings at audit time. This does not replace manual privilege/function review.

## Migration history in the database

The test database reports these eight applied migration records:

| Version | Name | SQL file in current repository branch? |
| --- | --- | --- |
| 20261028060841 | restrict_rls_auto_enable_function | Missing |
| 20261028061628 | core_independent_enrollment_schema_v1 | Missing |
| 20261028061834 | rls_policy_and_foreign_key_hardening | Missing |
| 20261028062421 | current_user_workflow_wrappers | Missing |
| 20261028062818 | mentor_reviews_and_admin_training_setup | Missing |
| 20261028090042 | restrict_current_browser_table_privileges | Present |
| 20261028090059 | restrict_postgres_default_table_privileges | Present |
| 20261028090137 | least_privilege_browser_write_columns | Present |

The first five migration records existed in the database history but were absent from the trainee-auth branch. The exact five SQL files were recovered from the existing `feature/independent-training-enrollments` branch and copied into this recovery branch. This restores the missing files in Git, but does not by itself prove that their current contents are byte-for-byte identical to the SQL originally applied to the database.

## Findings requiring care

- The database currently contains 17 public tables and a set of helper routines/policies. Reconstructing a migration from current schema alone can lose historical intent, ordering, grants, triggers, storage policies, and edge-case safeguards.
- The public `SECURITY DEFINER` functions inspected during this audit (`admin_confirm_application`, `mentor_review_application`, and `provision_trainee_profile`) showed EXECUTE grants to `postgres` and `service_role`; the `rls_auto_enable` event-trigger function showed a `postgres` grant. Keep these grants explicit when recovering SQL.
- The security advisor returned no lints, but this is not proof that the full migration history is reproducible or that runtime workflows pass end-to-end.
- The existing production project was not accessed or modified as part of this audit.

## Safe recovery plan

1. Compare the recovered SQL against the current test database definitions: tables/columns/constraints/indexes, RLS policies, grants/default privileges, functions and their ACLs, triggers/event triggers, private-schema helpers, storage buckets/policies, and seed data.
2. Verify the recovered files are identical to the blobs on the source feature branch and inspect the source branch history to establish provenance.
3. Run a clean-room replay on a *disposable, newly created* Supabase project and compare its schema/security inventory with the current test project.
4. Resolve any differences and confirm all migrations are replayable in timestamp order without manual SQL-editor steps.
5. Do not replay these migrations on `mentoro-platform-test`; the existing database already records them as applied. Do not run anything against production.

## Acceptance criteria

- A new isolated database can be provisioned from repository migrations without manual SQL-editor steps.
- Schema, constraints, indexes, functions, function grants, RLS policies, table/column privileges, triggers, storage policies, and seed data match the reviewed expected inventory.
- Runtime auth/application/logbook flows pass integration tests.
- The Vercel preview environment is independently configured and browser-tested before the PR is considered production-ready.

## Current state

No schema changes were made by this recovery audit. No production deployment, PR merge, or production database change was performed.
