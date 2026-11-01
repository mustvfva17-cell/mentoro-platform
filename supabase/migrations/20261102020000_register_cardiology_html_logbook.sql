-- Register the central Cardiology HTML runtime while preserving the latest
-- trusted authorization, state revision, enrollment locking, and item-review integrity.
-- Clinical template publication remains a separate administrator review decision.

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
      IF v_html_path IS DISTINCT FROM '/logbooks/medical-oncology/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/general-surgery/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/cardiology/index.html' THEN
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
  v_target_template_id uuid;
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

  v_renderer := v_template_definition ->> 'renderer';
  v_html_path := v_template_definition ->> 'html_path';

  IF jsonb_typeof(v_schema) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A valid schema object is required before publication' USING ERRCODE = '22023';
  END IF;

  IF v_renderer = 'HTML' THEN
    IF v_html_path IS DISTINCT FROM '/logbooks/medical-oncology/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html' THEN
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
$function$;

CREATE OR REPLACE FUNCTION app_private.get_my_logbook_html_state(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_mentor_id uuid;
  v_enrollment_id uuid;
  v_template_definition jsonb;
  v_state jsonb;
  v_revision bigint := 0;
  v_updated_at timestamptz;
BEGIN
  IF v_actor_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated logbook instance access is required' USING ERRCODE = '42501';
  END IF;

  SELECT li.trainee_profile_id, li.enrollment_id, tv.template_definition
    INTO v_trainee_id, v_enrollment_id, v_template_definition
  FROM public.logbook_instances li
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = p_instance_id AND li.enrollment_id IS NULL;

  IF FOUND THEN
    v_mentor_id := NULL;
  ELSE
    SELECT e.trainee_profile_id, e.mentor_profile_id, e.id, tv.template_definition
      INTO v_trainee_id, v_mentor_id, v_enrollment_id, v_template_definition
    FROM public.logbook_instances li
    JOIN public.training_enrollments e ON e.id = li.enrollment_id
    JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
    WHERE li.id = p_instance_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id <> v_trainee_id
     AND (v_mentor_id IS NULL OR v_actor_id <> v_mentor_id)
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
$;
REVOKE ALL ON FUNCTION app_private.get_my_logbook_html_state(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_logbook_html_state(uuid)
  TO authenticated;
CREATE OR REPLACE FUNCTION public.get_my_logbook_html_state(p_instance_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $
  SELECT app_private.get_my_logbook_html_state(p_instance_id);
$;
REVOKE ALL ON FUNCTION public.get_my_logbook_html_state(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_logbook_html_state(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION app_private.save_my_logbook_html_state(p_instance_id uuid, p_state jsonb, p_expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_enrollment_id uuid;
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

  SELECT li.trainee_profile_id, li.enrollment_id, li.archived_at, tv.template_definition
    INTO v_trainee_id, v_enrollment_id, v_archived_at, v_template_definition
  FROM public.logbook_instances li
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = p_instance_id AND li.enrollment_id IS NULL
  FOR SHARE OF li;

  IF FOUND THEN
    v_enrollment_status := 'CONFIRMED';
  ELSE
    SELECT e.trainee_profile_id, e.id, e.status, li.archived_at, tv.template_definition
      INTO v_trainee_id, v_enrollment_id, v_enrollment_status, v_archived_at, v_template_definition
    FROM public.logbook_instances li
    JOIN public.training_enrollments e ON e.id = li.enrollment_id
    JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
    WHERE li.id = p_instance_id
    FOR SHARE OF e, li;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_enrollment_id IS NOT NULL THEN
    PERFORM 1 FROM public.training_enrollments e
    WHERE e.id = v_enrollment_id
    FOR SHARE;
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html'
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
  WHERE li.id = p_instance_id
  FOR SHARE OF e, li;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html'
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

CREATE OR REPLACE FUNCTION app_private.get_my_logbook_html_item_reviews(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_mentor_id uuid;
  v_template_definition jsonb;
  v_reviews jsonb;
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
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  IF v_actor_id <> v_trainee_id
     AND v_actor_id <> v_mentor_id
     AND NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'You cannot access reviews for this training logbook' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', latest.id,
        'item_id', latest.item_id,
        'item_type', latest.item_type,
        'decision', latest.decision,
        'feedback', latest.feedback,
        'reviewer_profile_id', latest.reviewer_profile_id,
        'created_at', latest.created_at,
        'reviewed_state_revision', latest.reviewed_state_revision,
        'is_current',
          latest.item_digest IS NOT NULL
          AND item_state.item IS NOT NULL
          AND latest.item_digest = pg_catalog.encode(
            extensions.digest(item_state.item::text, 'sha256'), 'hex'
          )
      )
      ORDER BY latest.review_order DESC
    ),
    '[]'::jsonb
  )
  INTO v_reviews
  FROM (
    SELECT DISTINCT ON (r.item_type, r.item_id)
      r.id, r.item_id, r.item_type, r.decision, r.feedback,
      r.reviewer_profile_id, r.created_at, r.review_order,
      r.item_digest, r.reviewed_state_revision
    FROM public.logbook_html_item_reviews r
    WHERE r.instance_id = p_instance_id
    ORDER BY r.item_type, r.item_id, r.review_order DESC
  ) AS latest
  LEFT JOIN public.logbook_html_states AS state
    ON state.instance_id = p_instance_id
  LEFT JOIN LATERAL (
    SELECT app_private.get_html_logbook_review_item(
      state.state, latest.item_type, latest.item_id
    ) AS item
  ) AS item_state ON true;

  RETURN v_reviews;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.mentor_review_html_logbook_item(
  p_instance_id uuid,
  p_item_id text,
  p_item_type text,
  p_decision text,
  p_feedback text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_trainee_id uuid;
  v_mentor_id uuid;
  v_enrollment_status text;
  v_archived_at timestamptz;
  v_template_definition jsonb;
  v_state jsonb;
  v_revision bigint;
  v_item jsonb;
  v_item_digest text;
  v_review_id uuid;
  v_created_at timestamptz;
  v_feedback text := nullif(trim(coalesce(p_feedback, '')), '');
BEGIN
  IF v_actor_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated logbook review is required' USING ERRCODE = '42501';
  END IF;

  IF nullif(trim(coalesce(p_item_id, '')), '') IS NULL OR length(p_item_id) > 120 THEN
    RAISE EXCEPTION 'A valid HTML logbook item identifier is required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_item_type, '') NOT IN ('session', 'case', 'procedure', 'discussion', 'emergency') THEN
    RAISE EXCEPTION 'Unsupported HTML logbook item type' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_decision, '') NOT IN ('VERIFIED', 'FEEDBACK', 'NEEDS_REVISION') THEN
    RAISE EXCEPTION 'Choose a supported mentor review decision' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(p_feedback, '')) > 2000
     OR (p_decision IN ('FEEDBACK', 'NEEDS_REVISION') AND length(coalesce(v_feedback, '')) < 5) THEN
    RAISE EXCEPTION 'Feedback or a revision request needs a note of 5–2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT e.trainee_profile_id, e.mentor_profile_id, e.status, li.archived_at, tv.template_definition
    INTO v_trainee_id, v_mentor_id, v_enrollment_status, v_archived_at, v_template_definition
  FROM public.logbook_instances li
  JOIN public.training_enrollments e ON e.id = li.enrollment_id
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = p_instance_id
  FOR UPDATE OF li;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Logbook instance not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_id <> v_mentor_id OR NOT app_private.is_mentor() THEN
    RAISE EXCEPTION 'Only the mentor assigned to this training can review its HTML entries' USING ERRCODE = '42501';
  END IF;

  IF v_archived_at IS NOT NULL OR v_enrollment_status NOT IN ('CONFIRMED', 'ACTIVE', 'COMPLETED') THEN
    RAISE EXCEPTION 'This training logbook is not open for mentor review' USING ERRCODE = '55000';
  END IF;

  IF v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  SELECT s.state, s.revision INTO v_state, v_revision
  FROM public.logbook_html_states s
  WHERE s.instance_id = p_instance_id
  FOR SHARE;

  IF NOT FOUND OR jsonb_typeof(v_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'No saved HTML logbook state exists for this training yet' USING ERRCODE = 'P0002';
  END IF;

  v_item := app_private.get_html_logbook_review_item(v_state, p_item_type, p_item_id);
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'The selected item is missing or its identifier is duplicated within this logbook entry type'
      USING ERRCODE = '22023';
  END IF;
  v_item_digest := pg_catalog.encode(extensions.digest(v_item::text, 'sha256'), 'hex');

  INSERT INTO public.logbook_html_item_reviews(
    instance_id, item_id, item_type, decision, feedback, reviewer_profile_id,
    item_digest, reviewed_state_revision
  ) VALUES (
    p_instance_id, p_item_id, p_item_type, p_decision, v_feedback, v_actor_id,
    v_item_digest, v_revision
  )
  RETURNING id, created_at INTO v_review_id, v_created_at;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id,
    'MENTOR_HTML_ITEM_REVIEW_' || p_decision,
    'LOGBOOK_HTML_ITEM',
    p_instance_id,
    jsonb_build_object(
      'review_id', v_review_id,
      'item_id', p_item_id,
      'item_type', p_item_type,
      'decision', p_decision,
      'enrollment_status', v_enrollment_status
    )
  );

  RETURN jsonb_build_object(
    'id', v_review_id,
    'item_id', p_item_id,
    'item_type', p_item_type,
    'decision', p_decision,
    'feedback', v_feedback,
    'reviewer_profile_id', v_actor_id,
    'created_at', v_created_at,
    'reviewed_state_revision', v_revision,
    'is_current', true
  );
END;
$$;

-- CREATE OR REPLACE preserves existing function grants. Public SECURITY INVOKER
-- wrappers continue to delegate to these private implementations.
