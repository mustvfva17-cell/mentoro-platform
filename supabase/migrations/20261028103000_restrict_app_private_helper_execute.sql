-- Functions grant EXECUTE to PUBLIC by default in PostgreSQL. Revoke that
-- default for the current app_private helpers, then grant only the roles needed
-- by RLS policies and the reviewed trainee/mentor workflows.

REVOKE ALL ON FUNCTION app_private.is_platform_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_platform_admin()
  TO anon, authenticated;

REVOKE ALL ON FUNCTION app_private.is_trainee()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_trainee()
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.is_mentor()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_mentor()
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.is_verified_trainee()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_verified_trainee()
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.can_access_application(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_application(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.can_access_enrollment(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_enrollment(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.can_access_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_instance(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.owns_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.owns_instance(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.can_access_entry(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_entry(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION app_private.is_assigned_mentor_for_entry(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_assigned_mentor_for_entry(uuid)
  TO authenticated;
