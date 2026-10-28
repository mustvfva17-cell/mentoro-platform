CREATE OR REPLACE FUNCTION app_private.admin_create_logbook_template_draft(
  p_specialty_id uuid,
  p_slug text,
  p_title text,
  p_description text,
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
  v_version_id uuid;
  v_field jsonb;
  v_field_count integer;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_specialty_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.specialties s WHERE s.id = p_specialty_id AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'Choose an active specialty' USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(p_slug), '') IS NULL
     OR trim(p_slug) !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR length(trim(p_slug)) > 100 THEN
    RAISE EXCEPTION 'Template slug must use lowercase letters, numbers, and single hyphens' USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(p_title), '') IS NULL OR length(trim(p_title)) > 160 THEN
    RAISE EXCEPTION 'Template title is required and must be at most 160 characters' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'Template description must be at most 2000 characters' USING ERRCODE = '22023';
  END IF;

  IF length(trim(coalesce(p_source_notes, ''))) < 20 THEN
    RAISE EXCEPTION 'Add source notes describing the clinical reviewer/source and scope (at least 20 characters)' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_schema_definition) <> 'object'
     OR jsonb_typeof(p_schema_definition -> 'fields') <> 'array' THEN
    RAISE EXCEPTION 'Schema must be an object containing a fields array' USING ERRCODE = '22023';
  END IF;

  v_field_count := jsonb_array_length(p_schema_definition -> 'fields');
  IF v_field_count < 1 OR v_field_count > 100 THEN
    RAISE EXCEPTION 'A draft schema must contain between 1 and 100 fields' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(coalesce(p_template_definition, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Template definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  FOR v_field IN SELECT value FROM jsonb_array_elements(p_schema_definition -> 'fields')
  LOOP
    IF jsonb_typeof(v_field) <> 'object'
       OR coalesce(v_field ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
       OR length(trim(coalesce(v_field ->> 'label', ''))) < 1
       OR length(coalesce(v_field ->> 'label', '')) > 160
       OR coalesce(v_field ->> 'type', '') NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select') THEN
      RAISE EXCEPTION 'Each schema field needs a valid key, label, and supported type' USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_field ->> 'type', '') = 'select'
       AND (jsonb_typeof(v_field -> 'options') <> 'array'
            OR jsonb_array_length(v_field -> 'options') < 2
            OR jsonb_array_length(v_field -> 'options') > 50) THEN
      RAISE EXCEPTION 'Select fields need between 2 and 50 options' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT field ->> 'key')
      FROM jsonb_array_elements(p_schema_definition -> 'fields') AS item(field)) <> v_field_count THEN
    RAISE EXCEPTION 'Schema field keys must be unique' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
  VALUES (p_specialty_id, trim(p_slug), trim(p_title), nullif(trim(coalesce(p_description, '')), ''), false)
  RETURNING id INTO v_template_id;

  INSERT INTO public.logbook_template_versions (
    template_id, version_number, status, is_assignable, schema_definition,
    template_definition, source_notes
  ) VALUES (
    v_template_id, 1, 'DRAFT', false, p_schema_definition,
    coalesce(p_template_definition, '{}'::jsonb), trim(p_source_notes)
  )
  RETURNING id INTO v_version_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'LOGBOOK_TEMPLATE_DRAFT_CREATED', 'LOGBOOK_TEMPLATE', v_template_id,
    jsonb_build_object('version_id', v_version_id, 'specialty_id', p_specialty_id, 'field_count', v_field_count)
  );

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  TO authenticated;

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
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_logbook_template_draft(uuid, text, text, text, jsonb, jsonb, text)
  TO authenticated;
