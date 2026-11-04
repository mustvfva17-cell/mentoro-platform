-- Restore the authenticated execute grant required by the SECURITY INVOKER
-- public admin publication RPC. The private helper independently checks
-- auth.uid() and app_private.is_platform_admin() before any publication.
-- Keep anon, PUBLIC, and service_role denied.
GRANT EXECUTE ON FUNCTION app_private.admin_publish_logbook_template_version(uuid, text)
  TO authenticated;
