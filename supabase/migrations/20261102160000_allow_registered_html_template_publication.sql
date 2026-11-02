-- Allow clinical publication of registered HTML logbooks without synthetic JSON fields.
-- Preserve structured JSON-template publication, parent-row locking, version immutability,
-- one-current-assignable-version semantics, admin checks, and audited clinical review.

CREATE OR REPLACE FUNCTION app_private.guard_logbook_template_version_schema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_field jsonb;
  v_option jsonb;
  v_field_count integer;
  v_distinct_option_count integer;
  v_type text;
  v_is_registered_html boolean := false;
  v_section_count integer;
  v_invalid_section_count integer;
BEGIN
  IF jsonb_typeof(NEW.schema_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook schema definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(NEW.template_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook template definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF NEW.schema_definition ? 'fields' THEN
    IF jsonb_typeof(NEW.schema_definition -> 'fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Logbook schema fields must be an array' USING ERRCODE = '22023';
    END IF;

    v_field_count := jsonb_array_length(NEW.schema_definition -> 'fields');
    IF v_field_count < 1 OR v_field_count > 100 THEN
      RAISE EXCEPTION 'A structured logbook schema must contain between 1 and 100 fields' USING ERRCODE = '22023';
    END IF;

    FOR v_field IN SELECT value FROM jsonb_array_elements(NEW.schema_definition -> 'fields')
    LOOP
      v_type := v_field ->> 'type';
      IF jsonb_typeof(v_field) IS DISTINCT FROM 'object'
         OR coalesce(v_field ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
         OR length(trim(coalesce(v_field ->> 'label', ''))) < 1
         OR length(coalesce(v_field ->> 'label', '')) > 160
         OR coalesce(v_type, '') NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select') THEN
        RAISE EXCEPTION 'Each schema field needs a unique valid key, label, and supported type' USING ERRCODE = '22023';
      END IF;

      IF v_type = 'select' THEN
        IF jsonb_typeof(v_field -> 'options') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_field -> 'options') < 2
           OR jsonb_array_length(v_field -> 'options') > 50 THEN
          RAISE EXCEPTION 'Select fields need between 2 and 50 options' USING ERRCODE = '22023';
        END IF;

        FOR v_option IN SELECT value FROM jsonb_array_elements(v_field -> 'options')
        LOOP
          IF jsonb_typeof(v_option) IS DISTINCT FROM 'string'
             OR nullif(trim(v_option #>> '{}'), '') IS NULL
             OR length(v_option #>> '{}') > 120 THEN
            RAISE EXCEPTION 'Select options must be non-empty strings of at most 120 characters' USING ERRCODE = '22023';
          END IF;
        END LOOP;

        SELECT count(DISTINCT lower(trim(option_value #>> '{}')))::integer
        INTO v_distinct_option_count
        FROM jsonb_array_elements(v_field -> 'options') AS options(option_value);
        IF v_distinct_option_count <> jsonb_array_length(v_field -> 'options') THEN
          RAISE EXCEPTION 'Select options must be unique, ignoring case' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;

    IF (
      SELECT count(DISTINCT field ->> 'key')
      FROM jsonb_array_elements(NEW.schema_definition -> 'fields') AS items(field)
    ) <> v_field_count THEN
      RAISE EXCEPTION 'Logbook schema field keys must be unique' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- HTML runtimes are publishable only when their route is explicitly registered
  -- by MENTORO's central specialty module registry and their section metadata is valid.
  IF NEW.template_definition ->> 'renderer' = 'HTML'
     AND NEW.template_definition ->> 'html_path' IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html',
       '/logbooks/neurology/index.html',
       '/logbooks/pediatrics/index.html',
       '/logbooks/anesthesia-icu/index.html'
     )
     AND jsonb_typeof(NEW.template_definition -> 'sections') = 'array' THEN
    v_section_count := jsonb_array_length(NEW.template_definition -> 'sections');
    IF v_section_count BETWEEN 1 AND 30 THEN
      SELECT count(*)::integer
      INTO v_invalid_section_count
      FROM jsonb_array_elements(NEW.template_definition -> 'sections') AS sections(section)
      WHERE jsonb_typeof(section) IS DISTINCT FROM 'string'
         OR length(trim(section #>> '{}')) < 1
         OR length(section #>> '{}') > 120;
      v_is_registered_html := v_invalid_section_count = 0;
    END IF;
  END IF;

  IF NEW.status = 'PUBLISHED' OR NEW.is_assignable THEN
    IF NEW.template_definition ->> 'renderer' = 'HTML' THEN
      IF NOT v_is_registered_html THEN
        RAISE EXCEPTION 'A published/assignable HTML template requires a registered runtime path and valid sections' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(NEW.schema_definition -> 'fields') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'A published/assignable template requires structured fields or a registered HTML runtime' USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(NEW.schema_definition -> 'fields') < 1 THEN
        RAISE EXCEPTION 'A published/assignable template requires at least one structured field' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF length(trim(coalesce(NEW.source_notes, ''))) < 20 THEN
      RAISE EXCEPTION 'A published/assignable template requires source and clinical review notes' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_logbook_template_version_schema()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_logbook_template_version_schema
  ON public.logbook_template_versions;
CREATE TRIGGER guard_logbook_template_version_schema
BEFORE INSERT OR UPDATE OF schema_definition, template_definition, status, is_assignable, source_notes
ON public.logbook_template_versions
FOR EACH ROW
EXECUTE FUNCTION app_private.guard_logbook_template_version_schema();

CREATE OR REPLACE FUNCTION app_private.admin_publish_logbook_template_version(
  p_version_id uuid,
  p_review_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_template_id uuid;
  v_target_template_id uuid;
  v_status text;
  v_schema jsonb;
  v_template_definition jsonb;
  v_source_notes text;
  v_renderer text;
  v_html_path text;
  v_section_count integer;
  v_invalid_section_count integer;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL
     OR length(trim(coalesce(p_review_notes, ''))) < 20
     OR length(p_review_notes) > 4000 THEN
    RAISE EXCEPTION 'A review decision with at least 20 characters is required' USING ERRCODE = '22023';
  END IF;

  -- Lock the parent template before locking any version row. This serializes publication
  -- of two different versions belonging to the same template and avoids cross-version deadlocks.
  SELECT v.template_id INTO v_target_template_id
  FROM public.logbook_template_versions v
  WHERE v.id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template version not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.logbook_templates t
  WHERE t.id = v_target_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent logbook template not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT v.template_id, v.status, v.schema_definition, v.template_definition, v.source_notes
    INTO v_template_id, v_status, v_schema, v_template_definition, v_source_notes
  FROM public.logbook_template_versions v
  WHERE v.id = p_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_id IS DISTINCT FROM v_target_template_id THEN
    RAISE EXCEPTION 'Template version parent changed during publication; retry the review'
      USING ERRCODE = '22023';
  END IF;

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft template versions can be published' USING ERRCODE = '22023';
  END IF;

  IF length(trim(coalesce(v_source_notes, ''))) < 20 THEN
    RAISE EXCEPTION 'Add clinical source notes before publication' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_schema) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_template_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Valid schema and template definition objects are required before publication'
      USING ERRCODE = '22023';
  END IF;

  v_renderer := v_template_definition ->> 'renderer';
  v_html_path := v_template_definition ->> 'html_path';

  IF v_renderer = 'HTML' THEN
    IF v_html_path NOT IN (
      '/logbooks/medical-oncology/index.html',
      '/logbooks/general-surgery/index.html',
      '/logbooks/cardiology/index.html',
      '/logbooks/neurology/index.html',
      '/logbooks/pediatrics/index.html',
      '/logbooks/anesthesia-icu/index.html'
    ) THEN
      RAISE EXCEPTION 'This HTML logbook path is not registered as an available MENTORO asset'
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_template_definition -> 'sections') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A registered HTML logbook requires section metadata' USING ERRCODE = '22023';
    END IF;

    v_section_count := jsonb_array_length(v_template_definition -> 'sections');
    IF v_section_count < 1 OR v_section_count > 30 THEN
      RAISE EXCEPTION 'A registered HTML logbook requires between 1 and 30 sections'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*)::integer
    INTO v_invalid_section_count
    FROM jsonb_array_elements(v_template_definition -> 'sections') AS sections(section)
    WHERE jsonb_typeof(section) IS DISTINCT FROM 'string'
       OR length(trim(section #>> '{}')) < 1
       OR length(section #>> '{}') > 120;

    IF v_invalid_section_count > 0 THEN
      RAISE EXCEPTION 'HTML logbook section names must be non-empty strings of at most 120 characters'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF jsonb_typeof(v_schema -> 'fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A structured schema with fields is required before publication'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_schema -> 'fields') < 1 THEN
      RAISE EXCEPTION 'A structured schema with at least one field is required before publication'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Keep historical versions published for existing references, but stop assigning them to
  -- new offerings. Parent-row locking above serializes this transition across versions.
  UPDATE public.logbook_template_versions
  SET is_assignable = false
  WHERE template_id = v_template_id
    AND id <> p_version_id
    AND is_assignable = true;

  -- The BEFORE trigger validates structured fields or the fixed HTML asset allow-list.
  UPDATE public.logbook_template_versions
  SET status = 'PUBLISHED',
      is_assignable = true,
      published_at = now(),
      published_by = v_actor_id
  WHERE id = p_version_id;

  UPDATE public.logbook_templates
  SET is_active = true
  WHERE id = v_template_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'LOGBOOK_TEMPLATE_VERSION_PUBLISHED', 'LOGBOOK_TEMPLATE_VERSION', p_version_id,
    jsonb_build_object(
      'template_id', v_template_id,
      'renderer', coalesce(v_renderer, 'JSON'),
      'review_notes', trim(p_review_notes)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.admin_publish_logbook_template_version(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
-- Browser callers use the existing owner-checked public wrapper; the private helper stays unexecutable by API roles.

COMMENT ON FUNCTION app_private.admin_publish_logbook_template_version(uuid, text) IS
  'Admin-only publication of structured or registered HTML logbook template versions after source and clinical review notes are recorded.';

