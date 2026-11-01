-- Keep the public RPC as SECURITY INVOKER. Authorization lives in the private implementation.
CREATE OR REPLACE FUNCTION public.admin_publish_logbook_template_version(
  p_version_id uuid,
  p_review_notes text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_publish_logbook_template_version(p_version_id, p_review_notes);
$$;

REVOKE ALL ON FUNCTION public.admin_publish_logbook_template_version(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_publish_logbook_template_version(uuid, text)
  TO authenticated;
