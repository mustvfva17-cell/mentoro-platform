-- Register the existing General Surgery HTML asset in the fixed allow-list.
-- This migration preserves all current admin, access, revision, state-shape, and size checks.
-- Only Medical Oncology and General Surgery repository-owned HTML paths are accepted.

CREATE OR REPLACE FUNCTION app_private.guard_logbook_template_version_schema()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_field jsonb;
  v_option jsonb;
  v_field_count integer;
  v_distinct_option_count integer;
  v_type text;
  v_renderer text;
  v_html_path text;
BEGIN
  IF jsonb_typeof(NEW.schema_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook schema definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_renderer := NEW.template_definition ->> 'renderer';
  v_html_path := NEW.template_definition ->> 'html_path';

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

  IF NEW.status = 'PUBLISHED' OR NEW.is_assignable THEN
    IF v_renderer = 'HTML' THEN
      IF v_html_path IS DISTINCT FROM '/logbooks/medical-oncology/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/general-surgery/index.html' THEN
        RAISE EXCEPTION 'This HTML logbook path is not registered as an available MENTORO asset' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF jsonb_typeof(NEW.schema_definition -> 'fields') IS DISTINCT FROM 'array'
         OR jsonb_array_length(NEW.schema_definition -> 'fields') < 1 THEN
        RAISE EXCEPTION 'A published/assignable structured template requires fields' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF length(trim(coalesce(NEW.source_notes, ''))) < 20 THEN
      RAISE EXCEPTION 'A published/assignable template requires source and clinical review notes' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.admin_publish_logbook_template_version(p_version_id uuid, p_review_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_template_id uuid;
  v_status text;
  v_schema jsonb;
  v_template_definition jsonb;
  v_source_notes text;
  v_renderer text;
  v_html_path text;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL
     OR length(trim(coalesce(p_review_notes, ''))) < 20
     OR length(p_review_notes) > 4000 THEN
    RAISE EXCEPTION 'A review decision with at least 20 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT v.template_id, v.status, v.schema_definition, v.template_definition, v.source_notes
    INTO v_template_id, v_status, v_schema, v_template_definition, v_source_notes
  FROM public.logbook_template_versions v
  WHERE v.id = p_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft template versions can be published' USING ERRCODE = '22023';
  END IF;

  IF length(trim(coalesce(v_source_notes, ''))) < 20 THEN
    RAISE EXCEPTION 'Add clinical source notes before publication' USING ERRCODE = '22023';
  END IF;

  v_renderer := v_template_definition ->> 'renderer';
  v_html_path := v_template_definition ->> 'html_path';

  IF jsonb_typeof(v_schema) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A valid schema object is required before publication' USING ERRCODE = '22023';
  END IF;

  IF v_renderer = 'HTML' THEN
    IF v_html_path IS DISTINCT FROM '/logbooks/medical-oncology/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/general-surgery/index.html' THEN
      RAISE EXCEPTION 'This HTML logbook path is not registered as an available MENTORO asset' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF jsonb_typeof(v_schema -> 'fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A structured schema with fields is required before publication' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_schema -> 'fields') < 1 THEN
      RAISE EXCEPTION 'A structured schema with at least one field is required before publication' USING ERRCODE = '22023';
    END IF;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION app_private.get_my_logbook_html_state(p_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_mentor_id uuid;
  v_template_definition jsonb;
  v_state jsonb;
  v_revision bigint := 0;
  v_updated_at timestamptz;
BEGIN
  IF v_actor_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated logbook instance access is required' USING ERRCODE = '42501';
  END IF;

  SELECT e.trainee_profile_id, e.mentor_profile_id, tv.template_definition
    INTO v_trainee_id, v_mentor_id, v_template_definition
  FROM public.logbook_instances li
  JOIN public.training_enrollments e ON e.id = li.enrollment_id
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id <> v_trainee_id
     AND v_actor_id <> v_mentor_id
     AND NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'You cannot access this training logbook' USING ERRCODE = '42501';
  END IF;

  SELECT s.state, s.revision, s.updated_at
    INTO v_state, v_revision, v_updated_at
  FROM public.logbook_html_states s
  WHERE s.instance_id = p_instance_id;

  IF NOT FOUND THEN
    v_state := '{"sessions":[],"cases":[],"procedures":[],"roadmap":{},"emergency":[],"reflection":{}}'::jsonb;
    v_revision := 0;
    v_updated_at := NULL;
  END IF;

  RETURN jsonb_build_object('state', v_state, 'revision', v_revision, 'updated_at', v_updated_at);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.save_my_logbook_html_state(p_instance_id uuid, p_state jsonb, p_expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_enrollment_status text;
  v_archived_at timestamptz;
  v_template_definition jsonb;
  v_key text;
  v_item jsonb;
  v_new_revision bigint;
BEGIN
  IF v_actor_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated logbook instance access is required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'A valid logbook state revision is required' USING ERRCODE = '22023';
  END IF;

  SELECT e.trainee_profile_id, e.status, li.archived_at, tv.template_definition
    INTO v_trainee_id, v_enrollment_status, v_archived_at, v_template_definition
  FROM public.logbook_instances li
  JOIN public.training_enrollments e ON e.id = li.enrollment_id
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = p_instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id <> v_trainee_id THEN
    RAISE EXCEPTION 'Only the assigned trainee can save this HTML logbook' USING ERRCODE = '42501';
  END IF;

  IF v_archived_at IS NOT NULL OR v_enrollment_status NOT IN ('CONFIRMED', 'ACTIVE') THEN
    RAISE EXCEPTION 'This training logbook is read-only' USING ERRCODE = '55000';
  END IF;

  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR pg_column_size(p_state) > 1048576 THEN
    RAISE EXCEPTION 'Logbook state must be a JSON object no larger than 1 MiB' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_state ? 'sessions' AND p_state ? 'cases' AND p_state ? 'procedures'
          AND p_state ? 'roadmap' AND p_state ? 'emergency' AND p_state ? 'reflection') THEN
    RAISE EXCEPTION 'Logbook state is missing required sections' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_state)
  LOOP
    IF v_key NOT IN ('sessions', 'cases', 'procedures', 'roadmap', 'emergency', 'reflection') THEN
      RAISE EXCEPTION 'Unknown logbook state section: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF jsonb_typeof(p_state -> 'sessions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state -> 'cases') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state -> 'procedures') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state -> 'emergency') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state -> 'roadmap') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_state -> 'reflection') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook sections have an invalid shape' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_state -> 'sessions') > 1000
     OR jsonb_array_length(p_state -> 'cases') > 1000
     OR jsonb_array_length(p_state -> 'procedures') > 1000
     OR jsonb_array_length(p_state -> 'emergency') > 1000
     OR (SELECT count(*) FROM jsonb_object_keys(p_state -> 'roadmap')) > 2000
     OR (SELECT count(*) FROM jsonb_object_keys(p_state -> 'reflection')) > 100 THEN
    RAISE EXCEPTION 'Logbook state exceeds a supported section size' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT unnest(ARRAY['sessions', 'cases', 'procedures', 'emergency'])
  LOOP
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_state -> v_key)
    LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Every item in % must be a JSON object', v_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  IF p_expected_revision = 0 THEN
    INSERT INTO public.logbook_html_states(instance_id,state,revision,updated_by,created_at,updated_at)
    VALUES (p_instance_id,p_state,1,v_actor_id,now(),now())
    ON CONFLICT (instance_id) DO NOTHING
    RETURNING revision INTO v_new_revision;
  ELSE
    UPDATE public.logbook_html_states
    SET state=p_state, revision=revision+1, updated_by=v_actor_id, updated_at=now()
    WHERE instance_id=p_instance_id AND revision=p_expected_revision
    RETURNING revision INTO v_new_revision;
  END IF;

  IF v_new_revision IS NULL THEN
    RAISE EXCEPTION 'LOGBOOK_STATE_CONFLICT: This logbook changed elsewhere. Reopen it to load the latest saved state.'
      USING ERRCODE = '40001';
  END IF;
  RETURN v_new_revision;
END;
$function$;

-- Seed the imported owner-provided General Surgery interface as a DRAFT only.
DO $seed$
DECLARE
  v_template_id uuid;
  v_version_id uuid;
BEGIN
  INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
  VALUES (
    'd4921709-a57c-4a65-8e3c-34f38343ed1d'::uuid,
    'general-surgery-html',
    'General Surgery Clinical Logbook',
    'Existing MENTORO General Surgery HTML logbook with Overview, Roadmap, Sessions, Clinical Cases, Procedures, Emergency, Progress, and Reflection views.',
    false
  )
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO v_template_id
  FROM public.logbook_templates
  WHERE slug = 'general-surgery-html';

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve the General Surgery HTML template after seed';
  END IF;

  SELECT id INTO v_version_id
  FROM public.logbook_template_versions
  WHERE template_id = v_template_id AND version_number = 1;

  IF v_version_id IS NULL THEN
    INSERT INTO public.logbook_template_versions (
      template_id, version_number, status, is_assignable, schema_definition,
      template_definition, source_notes
    ) VALUES (
      v_template_id, 1, 'DRAFT', false,
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
      jsonb_build_object(
        'renderer', 'HTML',
        'html_path', '/logbooks/general-surgery/index.html',
        'source', 'Existing owner-provided General Surgery HTML logbook',
        'sections', jsonb_build_array('Overview','Roadmap','Sessions','Clinical Cases','Procedures','Emergency','Progress','Reflection'),
        'clinical_review_required', true
      ),
      'Existing owner-provided HTML interface; verify integration and complete authorized clinical review before publication.'
    );
  END IF;
END
$seed$;
