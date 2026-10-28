-- The public endpoint must run with its owner privileges so the private implementation
-- can remain inaccessible directly to browser roles. The private function still checks auth.uid()
-- and app_private.is_platform_admin() before any write.
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
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
