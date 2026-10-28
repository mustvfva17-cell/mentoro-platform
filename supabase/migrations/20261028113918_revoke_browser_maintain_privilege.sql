-- PostgreSQL 17 introduced the MAINTAIN table privilege. The earlier browser
-- hardening revoked TRUNCATE/REFERENCES/TRIGGER, but did not account for
-- MAINTAIN. On the test project's PostgreSQL 17.11 catalog, both anon and
-- authenticated still had MAINTAIN on all 17 public tables. Browser roles do
-- not need VACUUM/ANALYZE/CLUSTER/REINDEX-style maintenance privileges.
--
-- Use dynamic SQL so this migration remains compatible with Postgres versions
-- where the MAINTAIN privilege does not exist.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  END IF;
END;
$$;
