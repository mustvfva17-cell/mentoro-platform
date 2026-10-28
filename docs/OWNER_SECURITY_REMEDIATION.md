# Owner Security Remediation Notes

Date: 2026-10-28

Scope: the isolated `mentoro-platform-test` Supabase project only. These observations were gathered with a read-only audit; this document does not authorize or perform production changes.

## Verified current state

- The test database migration ledger contains 16 entries, matching the migration filenames recorded on the recovery branch.
- Supabase Security Advisor returned no security lints at the time of this check.
- All 17 current application tables in `public` have no `MAINTAIN`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege for `anon` or `authenticated`. Migration `20261028113918_revoke_browser_maintain_privilege.sql` was applied to the test project; the post-migration privilege query returned zero `MAINTAIN` and zero `TRUNCATE` grants for both browser roles.
- The application database session's `postgres` role has tightened default table privileges in `public`; the current role is not a member of `supabase_admin` and cannot `SET ROLE supabase_admin`.
- `pg_default_acl` still shows `supabase_admin` defaults in `public` granting browser roles privileges on future objects: broad table privileges, sequence privileges, and function `EXECUTE`. This remains an owner-level/platform-role review item, not a verified exploit of any current application table.
- `app_private.is_platform_admin()` is executable by `anon` in the current ACL. This grant is presently used by RLS policies shared with anonymous readers, which evaluate the admin predicate while applying public-read rules. Do not revoke it in isolation; if changing it, first redesign the affected policies and rerun anonymous-read plus authenticated-role tests.

The PostgreSQL 17 `MAINTAIN` gap on existing application tables is closed on the test project. The separate default-ACL concern below remains open because it affects future objects created by `supabase_admin`, not the current 17 application tables.

## Performance advisor observations

The Supabase performance advisor reported 23 indexes as unused during this check (informational level). The test project currently has no persistent trainee/mentor workflow data or representative application workload, so these usage counters are not a sound basis for removing indexes. In particular, indexes used by foreign-key checks, RLS predicates, mentor/enrollment filtering, and logbook history should be evaluated against representative query plans and real usage before any removal. No index was dropped as part of this audit.

## Supabase-managed default ACLs: role-level change is not available

The `pg_default_acl` inventory shows that the internal `supabase_admin` role grants `anon`, `authenticated`, and `service_role` broad defaults for future tables, sequences, and functions created by that role in `public`. Supabase documents that `postgres` cannot alter these defaults or become a member of the reserved `supabase_admin` role; an `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` attempt is expected to fail with a permission error. See the [official Supabase Knowledge Base explanation](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema).

This is a **future-object/platform ownership concern**, not a privilege found on the current MENTORO tables:

- The connected `postgres` role's default privileges in `public` are restricted for browser roles: new tables get only the reviewed `service_role` maintenance grants; sequences have no browser-role defaults; new functions are executable by `postgres` by default.
- A read-only inventory found **no current relation or function in `public` owned by `supabase_admin`** in the test project.
- Existing MENTORO tables are owned/managed separately, and the PostgreSQL 17 `MAINTAIN` and `TRUNCATE` grants have been removed for `anon` and `authenticated`.

### Practical prevention

1. Keep application tables, policies, and RPCs created through the normal `postgres` migration role with explicit grants and RLS.
2. Avoid creating extensions in the exposed `public` schema. Where an extension supports it, install it in the `extensions` schema instead; review any existing extension before moving it.
3. After any extension install, database restore, or platform upgrade, audit which objects in `public` are owned by `supabase_admin` and inspect their actual grants.
4. If an extension must remain in `public` or its objects cannot be moved safely, consult Supabase's documented guidance/support instead of trying to alter the reserved role's defaults or revoke privileges that `postgres` did not grant.

For a read-only inventory of the defaults:

```sql
SELECT
  d.defaclrole::regrole::text AS owner_role,
  COALESCE(n.nspname, '(global)') AS schema_name,
  d.defaclobjtype AS object_type,
  d.defaclacl::text AS default_acl
FROM pg_default_acl AS d
LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
WHERE d.defaclrole::regrole::text IN ('postgres', 'supabase_admin')
  AND (n.nspname = 'public' OR d.defaclnamespace = 0)
ORDER BY owner_role, schema_name, object_type;
```

And for current relations/functions owned by `supabase_admin` in `public`:

```sql
SELECT 'relation' AS object_type, c.relname AS object_name
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relowner = 'supabase_admin'::regrole
UNION ALL
SELECT 'function', p.oid::regprocedure::text
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proowner = 'supabase_admin'::regrole
ORDER BY object_type, object_name;
```

## Verification after extension installs, restores, or upgrades

After extension installs, restores, or upgrades, rerun both read-only inventories above and confirm any new `supabase_admin`-owned objects in `public` are intentional and have reviewed grants. Re-check privileges on the 17 existing application tables separately; default ACLs concern future objects and do not replace current-object ACL verification.

## Release blockers not resolved by this document

- Clean-room migration replay is still outstanding.
- The dependency tree is not reproducible until a reviewed lockfile is generated and CI switches to `npm ci`.
- Browser/e2e tests with actual trainee, mentor, and admin sessions are still outstanding.
- A separate Vercel Preview project and Preview-only test Supabase configuration still require authorized team-owner action.

No production database was changed as part of this audit.
