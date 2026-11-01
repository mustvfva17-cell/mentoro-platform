
-- Permit a logbook instance to belong directly to a trainee profile, independently of a training slot.
-- Existing training-backed instances retain their enrollment relationship.
ALTER TABLE public.logbook_instances
  ALTER COLUMN enrollment_id DROP NOT NULL,
  ADD COLUMN trainee_profile_id uuid REFERENCES public.trainee_profiles(profile_id) ON DELETE CASCADE,
  ADD COLUMN assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN assignment_reason text,
  ADD CONSTRAINT logbook_instances_exactly_one_owner
    CHECK ((enrollment_id IS NULL) <> (trainee_profile_id IS NULL)),
  ADD CONSTRAINT logbook_instances_assignment_reason_length
    CHECK (assignment_reason IS NULL OR length(assignment_reason) <= 1000);

CREATE INDEX logbook_instances_trainee_profile_idx
  ON public.logbook_instances (trainee_profile_id, created_at DESC)
  WHERE trainee_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.can_access_instance(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.logbook_instances i
    WHERE i.id = p_instance_id
      AND (
        (i.enrollment_id IS NULL AND (
          i.trainee_profile_id = auth.uid() OR app_private.is_platform_admin()
        ))
        OR (i.enrollment_id IS NOT NULL AND app_private.can_access_enrollment(i.enrollment_id))
      )
  );
$$;
REVOKE ALL ON FUNCTION app_private.can_access_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.can_access_instance(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION app_private.owns_instance(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.logbook_instances i
    LEFT JOIN public.training_enrollments e ON e.id = i.enrollment_id
    WHERE i.id = p_instance_id
      AND (
        (i.enrollment_id IS NULL AND i.trainee_profile_id = auth.uid() AND i.status = 'ACTIVE' AND i.archived_at IS NULL)
        OR (i.enrollment_id IS NOT NULL AND e.trainee_profile_id = auth.uid()
            AND e.status IN ('CONFIRMED', 'ACTIVE'))
      )
  );
$$;
REVOKE ALL ON FUNCTION app_private.owns_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.owns_instance(uuid)
  TO authenticated;

DROP POLICY IF EXISTS logbook_template_versions_read_published ON public.logbook_template_versions;
CREATE POLICY logbook_template_versions_read_published
ON public.logbook_template_versions FOR SELECT TO authenticated
USING (
  (status = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM public.logbook_templates t
    WHERE t.id = logbook_template_versions.template_id AND t.is_active = true
  ))
  OR app_private.is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM public.logbook_instances li
    WHERE li.template_version_id = logbook_template_versions.id
      AND li.enrollment_id IS NULL
      AND li.trainee_profile_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION app_private.get_my_logbook_html_state(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
       '/logbooks/general-surgery/index.html'
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
$$;
REVOKE ALL ON FUNCTION app_private.get_my_logbook_html_state(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_logbook_html_state(uuid)
  TO authenticated;
CREATE OR REPLACE FUNCTION public.get_my_logbook_html_state(p_instance_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.get_my_logbook_html_state(p_instance_id);
$$;
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



DROP FUNCTION IF EXISTS public.admin_assign_trainee_logbook(uuid, uuid, text);
DROP FUNCTION IF EXISTS app_private.admin_assign_trainee_logbook(uuid, uuid, text);
CREATE OR REPLACE FUNCTION app_private.admin_assign_trainee_logbook(
  p_trainee_profile_id uuid,
  p_template_version_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_instance_id uuid;
  v_template_definition jsonb;
  v_template_status text;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;
  IF p_trainee_profile_id IS NULL OR p_template_version_id IS NULL THEN
    RAISE EXCEPTION 'Choose a trainee and an active HTML logbook' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) > 1000 THEN
    RAISE EXCEPTION 'Assignment note must be 1000 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trainee_profiles tp
    JOIN public.profiles p ON p.id = tp.profile_id
    JOIN public.profile_roles r ON r.user_id = tp.profile_id
    WHERE tp.profile_id = p_trainee_profile_id
      AND p.account_status <> 'SUSPENDED'
      AND r.role = 'TRAINEE' AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected account is not an active trainee profile' USING ERRCODE = '42501';
  END IF;

  SELECT tv.template_definition, tv.status
    INTO v_template_definition, v_template_status
  FROM public.logbook_template_versions tv
  JOIN public.logbook_templates t ON t.id = tv.template_id
  WHERE tv.id = p_template_version_id AND t.is_active = true
  FOR SHARE OF tv, t;
  IF NOT FOUND OR v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html'
     ) THEN
    RAISE EXCEPTION 'Selected logbook is not an active registered HTML template' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.logbook_instances (
    enrollment_id, trainee_profile_id, assigned_by, assignment_reason, template_version_id, status
  ) VALUES (
    NULL, p_trainee_profile_id, v_actor_id, nullif(trim(p_reason), ''),
    p_template_version_id, 'ACTIVE'
  ) RETURNING id INTO v_instance_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, metadata)
  VALUES (
    v_actor_id, 'ADMIN_ASSIGNED_TRAINEE_LOGBOOK', 'LOGBOOK_INSTANCE', v_instance_id,
    nullif(trim(p_reason), ''),
    jsonb_build_object('trainee_profile_id', p_trainee_profile_id, 'template_version_id', p_template_version_id,
                       'template_status', v_template_status, 'private_assignment', true)
  );
  RETURN v_instance_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_assign_trainee_logbook(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_assign_trainee_logbook(uuid, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_trainee_logbook(
  p_trainee_profile_id uuid,
  p_template_version_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_assign_trainee_logbook(p_trainee_profile_id, p_template_version_id, p_reason);
$$;
REVOKE ALL ON FUNCTION public.admin_assign_trainee_logbook(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_trainee_logbook(uuid, uuid, text)
  TO authenticated;
