-- Create a new immutable draft version under an existing template, without changing its published versions.
CREATE OR REPLACE FUNCTION app_private.admin_create_logbook_template_version_draft(
  p_template_id uuid,
  p_schema_definition jsonb,
  p_template_definition jsonb,
  p_source_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_template_id uuid;
  v_version_number integer;
  v_version_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'Choose an existing template' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_source_notes, ''))) < 20 OR length(p_source_notes) > 4000 THEN
    RAISE EXCEPTION 'Add source notes describing the curriculum/source and required reviewer (at least 20 characters)' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_schema_definition) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_schema_definition -> 'fields') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_schema_definition -> 'fields') < 1 THEN
    RAISE EXCEPTION 'A structured schema containing at least one field is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_template_definition, '{}'::jsonb)) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Template definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Lock the parent template so concurrent admins cannot allocate the same version number.
  SELECT t.id INTO v_template_id
  FROM public.logbook_templates t
  WHERE t.id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(max(v.version_number), 0) + 1
    INTO v_version_number
  FROM public.logbook_template_versions v
  WHERE v.template_id = v_template_id;

  INSERT INTO public.logbook_template_versions (
    template_id, version_number, status, is_assignable, schema_definition,
    template_definition, source_notes
  ) VALUES (
    v_template_id, v_version_number, 'DRAFT', false, p_schema_definition,
    coalesce(p_template_definition, '{}'::jsonb), trim(p_source_notes)
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'LOGBOOK_TEMPLATE_VERSION_DRAFT_CREATED', 'LOGBOOK_TEMPLATE_VERSION', v_version_id,
    jsonb_build_object('template_id', v_template_id, 'version_number', v_version_number,
                       'field_count', jsonb_array_length(p_schema_definition -> 'fields'))
  );

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_version_draft(uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_create_logbook_template_version_draft(
  p_template_id uuid,
  p_schema_definition jsonb,
  p_template_definition jsonb,
  p_source_notes text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
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
