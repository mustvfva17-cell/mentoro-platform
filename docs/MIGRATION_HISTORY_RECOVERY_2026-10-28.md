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

The test database currently reports these sixteen applied migration records:

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
| 20261028093412 | harden_trainee_verification_bucket | Present |
| 20261028093532 | enforce_server_submission_timestamp | Present |
| 20261028094412 | fix_scoped_logbook_submission_rpc | Present |
| 20261028100024 | fix_application_offering_slot_binding | Present |
| 20261028101524 | revoke_submission_timestamp_client_write | Present |
| 20261028103649 | prevent_nontrainee_self_provisioning | Present |
| 20261028113918 | revoke_browser_maintain_privilege | Present |

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

The current migration connection is `postgres` and catalog inspection confirms it is not a member of `supabase_admin`, so it cannot change that role's default privileges. Supabase's [official Knowledge Base article](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema) documents that this role is reserved and its default ACLs cannot be altered by the project SQL role. A read-only inventory found no current relation or function in `public` owned by `supabase_admin`; therefore this is a future-object/platform ownership concern, not a grant found on current MENTORO tables. Keep application objects created by `postgres` with explicit privileges and RLS, avoid installing extensions into exposed `public` when they can be placed in `extensions`, and audit owners/grants after extension installs, restores, and platform upgrades. No attempt was made to bypass role ownership. The current-table `MAINTAIN` grants described below have been revoked for browser roles.

## PostgreSQL 17 MAINTAIN privilege on existing tables

PostgreSQL 17 added a table-level `MAINTAIN` privilege. A direct `has_table_privilege` inventory on `mentoro-platform-test` found that both `anon` and `authenticated` had `MAINTAIN` on all 17 public tables, even though their `TRUNCATE` privilege count was already zero. The earlier migration revoked `TRUNCATE`, `REFERENCES`, and `TRIGGER`, but did not account for `MAINTAIN`.

Migration `20261028113918_revoke_browser_maintain_privilege.sql` conditionally revokes `MAINTAIN` from `anon` and `authenticated` on all existing public tables when the server version is PostgreSQL 17 or later; dynamic SQL keeps it parse-compatible with older PostgreSQL versions. It was applied to the **test project only**. The post-migration check returned zero `MAINTAIN` grants for both browser roles across all 17 public tables; both roles also retained zero `TRUNCATE` grants. The security advisor returned no findings after the change. This does not resolve the separate `supabase_admin` default-privilege ownership issue for future tables.

## Scoped logbook submission RPC

The original `set_logbook_entry_submitted` function updated `updated_at` explicitly, but the least-privilege grants intentionally restrict browser UPDATE columns and a table trigger already maintains `updated_at`. That made the RPC inconsistent with the column grants.

Migration `20261028094412_fix_scoped_logbook_submission_rpc.sql` changes the RPC to update only `status`; database triggers populate `submitted_at` and `updated_at`. The trainee UI now calls this scoped RPC instead of directly updating submission timestamps. The contract check verifies that the UI uses the RPC and that the RPC does not directly update timestamp columns.

## Least-privilege correction for submitted_at

The original column-grant migration allowed `authenticated` to UPDATE `submitted_at`, even after the scoped submission RPC was changed to update only `status`. The row-level policy and BEFORE trigger protected the supported submission transition, so this was an unnecessary privilege rather than a demonstrated timestamp forgery path.

Migration `20261028101524_revoke_submission_timestamp_client_write.sql` revokes direct browser UPDATE on `submitted_at`. Catalog validation then confirmed:
- `authenticated` cannot UPDATE `submitted_at` or `updated_at`.
- `authenticated` can still UPDATE `status`, as needed for the scoped submission RPC.
- The server-side submission timestamp trigger remains enabled.

A rollback-only RPC test after this privilege change passed: the entry became `SUBMITTED`, the database generated `submitted_at`, `authenticated` could still update `status`, and direct UPDATE permission on `submitted_at` was denied.

## Logbook submission timestamp integrity

The trainee client previously sent `submitted_at` directly when transitioning an entry from `DRAFT` to `SUBMITTED`. A caller using the API directly could supply an arbitrary timestamp even though row ownership and state transitions were restricted.

Migration `20261028093532_enforce_server_submission_timestamp.sql` adds a `BEFORE UPDATE` trigger that overwrites `submitted_at` with the database statement timestamp for the allowed `DRAFT` → `SUBMITTED` transition. The trigger function has no EXECUTE grants to browser roles and does not use `SECURITY DEFINER`; the trigger itself remains active. A read-only catalog check confirmed the trigger is enabled and direct EXECUTE is denied to both `anon` and `authenticated`.

## Repository-to-test-database schema comparison

A read-only catalog comparison between the 17 tables declared by `20261028061628_core_independent_enrollment_schema_v1.sql` and the live test database found:
- All 17 tables exist with the same column names as the recovered core migration.
- All 35 explicit index names declared across the repository migration set exist in the test database.
- All 22 public-schema RLS policies declared by the migrations match the live policy names and commands; the two Storage policies are also present.
- All seven application-table triggers declared by the migrations are enabled in the live database.
- The current ledger contains the 16 migration versions in this recovery sequence, with repository filenames matching the recorded version/name pairs.

This establishes catalog-level consistency for these inventories, not a clean-room migration replay. It does not prove the recovered five SQL bodies were the exact scripts originally applied in the historical environment.

## Application-to-slot RLS binding fix

A transactional negative test confirmed that the original `applications_submit_own` policy could accept an application whose `offering_id` referenced Offering A while its `slot_id` referenced Offering B. Inside the policy's `EXISTS` subquery, the unqualified `offering_id` name resolved to the joined `training_slots.offering_id` column instead of the outer application's column, making that part of the predicate ineffective.

Migration `20261028100024_fix_application_offering_slot_binding.sql` recreates the policy and explicitly qualifies both outer-row references:
- `o.id = training_applications.offering_id`
- `s.id = training_applications.slot_id`

The fix was applied to `mentoro-platform-test` only. A rollback-only transaction demonstrated that the normal matching offering/slot application is accepted while a mismatched pairing is rejected by RLS. The same transaction was rolled back; follow-up catalog/count checks confirmed no synthetic auth users, applications, enrollments, logbook entries, reviews, or storage rows remained. The migration version in the Git filename matches the test database's migration ledger.

## Verification storage limits

The `trainee-verification` bucket is private and now enforces the client UI's upload constraints at the Storage layer:
- Maximum object size: 8 MiB (8,388,608 bytes).
- Allowed MIME types: `image/jpeg`, `image/png`, and `application/pdf`.
- It contained zero objects when the limits were applied, so no existing uploads were affected.

Migration `20261028093412_harden_trainee_verification_bucket.sql` creates/configures the bucket idempotently and applies these limits during replay, rather than relying only on client-side checks.

## Transactional verification smoke test

A rollback-only database smoke test confirmed that an authenticated user with a confirmed email can provision a pending trainee profile; an unconfirmed identity is rejected and receives no profile. It then registered a synthetic university-ID object in the private verification bucket, submitted the document through the current-user RPC, and approved it through the admin review wrapper. The result was a `VERIFIED` trainee profile and an `APPROVED` verification document. A follow-up read confirmed that the synthetic identities, verification row, and Storage object were all removed by transaction rollback.

## Role-safe trainee provisioning

Migration `20261028103649_prevent_nontrainee_self_provisioning.sql` hardens `app_private.provision_current_trainee`. Before this fix, any confirmed signed-in account could call the current-user wrapper, which always attempted to provision a trainee role/profile. Existing mentor/admin accounts could therefore pick up an unintended active `TRAINEE` role when invoking that RPC; this was a role-separation defect, not evidence of cross-user data access.

The updated wrapper permits:
- A new confirmed identity with no existing `profiles` row to create its first trainee profile.
- An existing identity with an active `TRAINEE` role to call idempotent provisioning.

It rejects an existing profile that has no active `TRAINEE` role. The trainee frontend also checks active roles before entering its trainee workspace, but the database-side guard is the authoritative protection against direct RPC calls.

A rollback-only transaction test passed on `mentoro-platform-test`: an existing ADMIN-only identity was denied and did not receive a TRAINEE role, while a separate new confirmed identity successfully provisioned a trainee profile. The transaction was rolled back; follow-up counts confirmed zero synthetic auth users, profiles, roles, or trainee profiles remained. Production was not changed.

## Build dependency reproducibility

The branch does not contain `package-lock.json` or `npm-shrinkwrap.json`. The workflow currently runs `npm install`, and `package.json` uses semver ranges for Vite and Supabase JS. The production build and contract checks pass, but the exact dependency tree is not locked in source control.

Before treating CI as fully repeatable, generate a lockfile using the intended Node/npm toolchain, review and commit it, and switch CI to `npm ci`. Do not hand-author a lockfile: let npm resolve and record package versions and integrity data.

## Findings and limits

- The database contains 17 public tables and helper routines/policies. Reconstructing a migration from current schema alone can lose historical intent, ordering, grants, triggers, storage policies, and edge-case safeguards.
- The exact SQL originally applied for the five recovered historical migrations cannot be proven from migration version/name metadata alone.
- A clean-room replay is still outstanding. An attempt to create a disposable Supabase development branch returned `Branching is supported only on the Pro plan or above`; no branch was created and no branch compute charges started. The quoted branch rate was $0.01344/hour, but the plan entitlement blocked creation.
- Vercel preview setup is still blocked: the previous attempt to create a separate project returned 403. A Vercel team owner must authorize/create a preview project and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Browser/e2e tests with real trainee, mentor, and admin identities have not been run. The current test database has no persistent trainee/mentor profiles, offerings, slots, applications, enrollments, logbook instances, entries, reviews, or assessments. Rollback-only SQL workflow tests have exercised the booking/logbook path with synthetic identities, but browser/auth end-to-end tests are still outstanding.

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

The five recovered historical migration files, ten subsequent hardening/repair migrations, the PostgreSQL 17 browser-privilege fix, and this audit note are present on the recovery branch. The helper-function ACL, verification-bucket limits, server-side submission timestamp trigger, application-to-slot RLS fix, and direct submitted_at write revocation were applied only to `mentoro-platform-test` and then checked through catalog queries and rollback-only functional tests. PR #1 was merged into `main` on 2026-10-28 at 11:21:59 UTC. PR #2 remains an open draft targeting `main`; this work session did not merge it. The `mentoro-platform-test` database alone was modified by the documented test migrations. Production was not accessed or modified during this work session, and no production deployment was initiated by this session.
