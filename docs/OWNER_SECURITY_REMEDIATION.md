# Owner Security Remediation Notes

Date: 2026-10-28

Scope: the isolated `mentoro-platform-test` Supabase project only. These observations were gathered with a read-only audit; this document does not authorize or perform production changes.

## Verified current state

- The test database migration ledger contains 15 entries, matching the migration filenames recorded on the recovery branch.
- Supabase Security Advisor returned no security lints at the time of this check.
- All 17 current application tables in `public` have no `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege for `anon` or `authenticated`.
- The application database session's `postgres` role has tightened default table privileges in `public`; the current role is not a member of `supabase_admin` and cannot `SET ROLE supabase_admin`.
- `pg_default_acl` still shows `supabase_admin` defaults in `public` granting browser roles privileges on future objects: broad table privileges, sequence privileges, and function `EXECUTE`. This remains an owner-level/platform-role review item, not a verified exploit of any current application table.
- `app_private.is_platform_admin()` is executable by `anon` in the current ACL. This grant is presently used by RLS policies shared with anonymous readers, which evaluate the admin predicate while applying public-read rules. Do not revoke it in isolation; if changing it, first redesign the affected policies and rerun anonymous-read plus authenticated-role tests.

## Required owner-level decision: future defaults for objects owned by supabase_admin

The current database session cannot alter `supabase_admin`'s default ACLs. A Supabase project owner should review the platform ownership boundary and determine the supported way to harden these defaults (which may require Supabase support if the managed role is not alterable by the project owner).

Before making a change, inspect the current records using:

```sql
SELECT
  d.defaclrole::regrole::text AS owner_role,
  COALESCE(n.nspname, '(global)') AS schema_name,
  d.defaclobjtype AS object_type,
  d.defaclacl::text AS default_acl
FROM pg_default_acl AS d
LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
WHERE d.defaclrole::regrole::text = 'supabase_admin'
  AND (n.nspname = 'public' OR d.defaclnamespace = 0)
ORDER BY schema_name, object_type;
```

If owner review confirms that application-facing browser roles should not receive any implicit privileges on future objects created by `supabase_admin` in the exposed `public` schema, the following are candidate statements for the authorized owner/maintenance path, **not instructions to run blindly**:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
```

A project/platform owner must decide whether these defaults are intentionally supporting Supabase-managed objects. If the defaults are changed, explicitly grant only the required privileges to any new API object that is intentionally exposed. Re-run the privilege audit and workflow tests afterward, including public mentor/template/training discovery, trainee verification upload and review, enrollment/logbook creation, and mentor/admin operations.

## Verification query after an owner-authorized change

Rerun the `pg_default_acl` inspection above and confirm the public-schema entries no longer grant the unintended default privileges to `anon` or `authenticated`. Separately re-check privileges on the 17 existing application tables; default-ACL changes affect future objects and do not replace current-object ACL verification.

## Release blockers not resolved by this document

- Clean-room migration replay is still outstanding.
- The dependency tree is not reproducible until a reviewed lockfile is generated and CI switches to `npm ci`.
- Browser/e2e tests with actual trainee, mentor, and admin sessions are still outstanding.
- A separate Vercel Preview project and Preview-only test Supabase configuration still require authorized team-owner action.

No production database was changed as part of this audit.
