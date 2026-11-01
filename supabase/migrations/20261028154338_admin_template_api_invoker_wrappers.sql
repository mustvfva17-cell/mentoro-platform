-- Public RPC entry points remain invoker functions. The private implementation performs the
-- privileged writes under SECURITY DEFINER and enforces is_platform_admin() using auth.uid().
-- The private functions are allowed to be executable by authenticated only because every mutation
-- path checks the active administrator role before touching data. This avoids SECURITY DEFINER
-- endpoints in the exposed public API schema while retaining the required elevated implementation.

CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_draft(
  p_specialty_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_schema_definition jsonb,
  p_template_definition jsonb,
  p_source_notes text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_create_logbook_template_draft(
    p_specialty_id, p_slug, p_title, p_description,
    p_schema_definition, p_template_definition, p_source_notes
  );
$$;
REVOKE ALL ON FUNCTION public.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_version_draft(
  p_template_id uuid,
  p_schema_definition jsonb,
  p_template_definition jsonb,
  p_source_notes text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_create_logbook_template_version_draft(
    p_template_id, p_schema_definition, p_template_definition, p_source_notes
  );
$$;
REVOKE ALL ON FUNCTION public.admin_create_logbook_template_version_draft(uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_logbook_template_version_draft(uuid, jsonb, jsonb, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.admin_create_logbook_template_version_draft(uuid, jsonb, jsonb, text)
  TO authenticated;

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
GRANT EXECUTE ON FUNCTION app_private.admin_publish_logbook_template_version(uuid, text)
  TO authenticated;
