-- Public admin RPC entry points are SECURITY INVOKER by design.
-- Their private SECURITY DEFINER helpers must be executable by authenticated callers;
-- the helper independently enforces auth.uid() and active platform-admin status.
-- Keep the helper unavailable to anon, PUBLIC, and service_role.
GRANT EXECUTE ON FUNCTION app_private.admin_publish_logbook_template_version(uuid, text)
  TO authenticated;
