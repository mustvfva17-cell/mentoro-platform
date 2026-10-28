-- The private implementation must only be callable through the checked public wrapper.
REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
