-- Prevent future public tables created by the postgres role from inheriting
-- broad browser privileges. New browser-facing permissions must be granted
-- explicitly alongside reviewed RLS policies.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
