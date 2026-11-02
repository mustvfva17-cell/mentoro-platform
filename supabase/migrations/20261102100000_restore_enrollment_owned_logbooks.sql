-- Restore L-43: every logbook instance is owned by exactly one training enrollment.
-- This migration intentionally fails closed if any legacy direct-to-trainee instances remain.
-- Such rows require an authoritative, reviewed reconciliation; never infer an enrollment.

DO $$
DECLARE
  v_orphan_count bigint;
BEGIN
  SELECT count(*) INTO v_orphan_count
  FROM public.logbook_instances
  WHERE enrollment_id IS NULL;

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION
      'L-43 migration blocked: % logbook instance(s) have no enrollment. Inventory and reconcile them before retrying; no rows were changed.',
      v_orphan_count
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- The original core schema already made enrollment_id UNIQUE. Restore NOT NULL
-- and remove the temporary direct-trainee ownership field only after the guard.
DROP POLICY IF EXISTS logbook_template_versions_read_published ON public.logbook_template_versions;

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
      AND app_private.can_access_enrollment(i.enrollment_id)
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
    JOIN public.training_enrollments e ON e.id = i.enrollment_id
    WHERE i.id = p_instance_id
      AND e.trainee_profile_id = auth.uid()
      AND e.status IN ('CONFIRMED', 'ACTIVE')
      AND i.status = 'ACTIVE'
      AND i.archived_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION app_private.owns_instance(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.owns_instance(uuid)
  TO authenticated;

CREATE POLICY logbook_template_versions_read_published
ON public.logbook_template_versions FOR SELECT TO authenticated
USING (
  (status = 'PUBLISHED' AND EXISTS (
    SELECT 1 FROM public.logbook_templates t
    WHERE t.id = logbook_template_versions.template_id AND t.is_active = true
  ))
  OR app_private.is_platform_admin()
  OR EXISTS (
    SELECT 1
    FROM public.logbook_instances li
    WHERE li.template_version_id = logbook_template_versions.id
      AND app_private.can_access_enrollment(li.enrollment_id)
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

  SELECT e.trainee_profile_id, e.mentor_profile_id, e.id, tv.template_definition
    INTO v_trainee_id, v_mentor_id, v_enrollment_id, v_template_definition
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
       '/logbooks/cardiology/index.html',
       '/logbooks/neurology/index.html',
       '/logbooks/pediatrics/index.html',
       '/logbooks/anesthesia-icu/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  IF NOT app_private.can_access_enrollment(v_enrollment_id) THEN
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

  SELECT e.trainee_profile_id, e.id, e.status, li.archived_at, tv.template_definition
    INTO v_trainee_id, v_enrollment_id, v_enrollment_status, v_archived_at, v_template_definition
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
       '/logbooks/cardiology/index.html',
       '/logbooks/neurology/index.html',
       '/logbooks/pediatrics/index.html',
       '/logbooks/anesthesia-icu/index.html'
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

REVOKE ALL ON FUNCTION app_private.save_my_logbook_html_state(uuid, jsonb, bigint)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.save_my_logbook_html_state(uuid, jsonb, bigint)
  TO authenticated;

-- Prevent a second distinct request from reusing an idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_admin_assignment_request_id_uidx
  ON public.audit_logs (request_id)
  WHERE action = 'ADMIN_ASSIGNED_TRAINEE_LOGBOOK' AND request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.admin_assign_trainee_logbook(uuid, uuid, text);
DROP FUNCTION IF EXISTS app_private.admin_assign_trainee_logbook(uuid, uuid, text);

CREATE OR REPLACE FUNCTION app_private.admin_assign_trainee_enrollment_logbook(
  p_trainee_profile_id uuid,
  p_slot_id uuid,
  p_reason text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_slot public.training_slots%ROWTYPE;
  v_offering public.training_offerings%ROWTYPE;
  v_application_id uuid;
  v_enrollment_id uuid;
  v_instance_id uuid;
  v_reserved integer;
  v_existing_entity_id uuid;
  v_existing_actor_id uuid;
  v_existing_entity_type text;
  v_existing_metadata jsonb;
  v_template_definition jsonb;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;
  IF p_trainee_profile_id IS NULL OR p_slot_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Choose a trainee, an available training slot, and a request identifier'
      USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) > 1000 THEN
    RAISE EXCEPTION 'Assignment note must be 1000 characters or fewer'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize retries for the same client request. A retry returns the original
  -- enrollment only when actor, trainee, and slot all match exactly.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT al.entity_id, al.actor_profile_id, al.entity_type, al.metadata
    INTO v_existing_entity_id, v_existing_actor_id, v_existing_entity_type, v_existing_metadata
  FROM public.audit_logs al
  WHERE al.action = 'ADMIN_ASSIGNED_TRAINEE_LOGBOOK'
    AND al.request_id = p_request_id::text
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_entity_type <> 'TRAINING_ENROLLMENT'
       OR v_existing_entity_id IS NULL
       OR v_existing_actor_id IS DISTINCT FROM v_actor_id
       OR v_existing_metadata ->> 'trainee_profile_id' IS DISTINCT FROM p_trainee_profile_id::text
       OR v_existing_metadata ->> 'training_slot_id' IS DISTINCT FROM p_slot_id::text THEN
      RAISE EXCEPTION 'This request identifier has already been used for a different assignment'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing_entity_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.trainee_profiles tp
    JOIN public.profiles p ON p.id = tp.profile_id
    JOIN public.profile_roles r ON r.user_id = tp.profile_id
    WHERE tp.profile_id = p_trainee_profile_id
      AND p.account_status <> 'SUSPENDED'
      AND r.role = 'TRAINEE'
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected account is not an active trainee profile'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_slot
  FROM public.training_slots s
  WHERE s.id = p_slot_id
  FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'OPEN' OR v_slot.starts_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Selected training slot is not available'
      USING ERRCODE = '55000';
  END IF;

  SELECT o.* INTO v_offering
  FROM public.training_offerings o
  JOIN public.mentor_profiles mp ON mp.profile_id = o.mentor_profile_id
  JOIN public.profile_roles mr ON mr.user_id = mp.profile_id
  WHERE o.id = v_slot.offering_id
    AND o.status = 'PUBLISHED'
    AND mp.profile_status = 'APPROVED'
    AND mp.is_public = true
    AND mr.role = 'MENTOR'
    AND mr.revoked_at IS NULL
  FOR SHARE OF o, mp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected training or mentor is no longer available'
      USING ERRCODE = '55000';
  END IF;

  SELECT tv.template_definition INTO v_template_definition
  FROM public.logbook_template_versions tv
  JOIN public.logbook_templates t ON t.id = tv.template_id
  WHERE tv.id = v_offering.template_version_id
    AND tv.status = 'PUBLISHED'
    AND tv.is_assignable = true
    AND t.is_active = true
    AND t.specialty_id = v_offering.specialty_id
  FOR SHARE OF tv, t;
  IF NOT FOUND
     OR v_template_definition ->> 'renderer' IS DISTINCT FROM 'HTML'
     OR coalesce(v_template_definition ->> 'html_path', '') NOT IN (
       '/logbooks/medical-oncology/index.html',
       '/logbooks/general-surgery/index.html',
       '/logbooks/cardiology/index.html',
       '/logbooks/neurology/index.html',
       '/logbooks/pediatrics/index.html',
       '/logbooks/anesthesia-icu/index.html'
     ) THEN
    RAISE EXCEPTION 'Selected training does not have a published, assignable registered HTML logbook'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.training_enrollments e
  WHERE e.slot_id = v_slot.id
    AND e.status IN ('CONFIRMED', 'ACTIVE');
  IF v_reserved >= v_slot.capacity THEN
    RAISE EXCEPTION 'Training slot capacity has been reached'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.training_enrollments e
    WHERE e.trainee_profile_id = p_trainee_profile_id
      AND e.slot_id = v_slot.id
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'This trainee already has this active training assignment'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.training_applications (
    trainee_profile_id, offering_id, slot_id, applicant_note, status,
    admin_decision_by, admin_decided_at, admin_decision_reason
  ) VALUES (
    p_trainee_profile_id, v_offering.id, v_slot.id, nullif(trim(p_reason), ''),
    'ADMIN_ASSIGNED', v_actor_id, clock_timestamp(),
    coalesce(nullif(trim(p_reason), ''), 'Assigned directly by platform administration')
  ) RETURNING id INTO v_application_id;

  INSERT INTO public.training_enrollments (
    source_application_id, trainee_profile_id, mentor_profile_id, specialty_id,
    offering_id, slot_id, template_version_id, starts_at, ends_at, status, confirmed_by
  ) VALUES (
    v_application_id, p_trainee_profile_id, v_offering.mentor_profile_id,
    v_offering.specialty_id, v_offering.id, v_slot.id, v_offering.template_version_id,
    v_slot.starts_at, v_slot.ends_at, 'CONFIRMED', v_actor_id
  ) RETURNING id INTO v_enrollment_id;

  INSERT INTO public.logbook_instances (
    enrollment_id, template_version_id, assigned_by, assignment_reason, status
  ) VALUES (
    v_enrollment_id, v_offering.template_version_id, v_actor_id,
    nullif(trim(p_reason), ''), 'ACTIVE'
  ) RETURNING id INTO v_instance_id;

  INSERT INTO public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, reason, metadata, request_id
  ) VALUES (
    v_actor_id, 'ADMIN_ASSIGNED_TRAINEE_LOGBOOK', 'TRAINING_ENROLLMENT', v_enrollment_id,
    nullif(trim(p_reason), ''),
    jsonb_build_object(
      'trainee_profile_id', p_trainee_profile_id,
      'application_id', v_application_id,
      'logbook_instance_id', v_instance_id,
      'training_slot_id', v_slot.id,
      'template_version_id', v_offering.template_version_id
    ),
    p_request_id::text
  );

  RETURN v_enrollment_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_assign_trainee_enrollment_logbook(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_assign_trainee_enrollment_logbook(uuid, uuid, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_trainee_enrollment_logbook(
  p_trainee_profile_id uuid,
  p_slot_id uuid,
  p_reason text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_assign_trainee_enrollment_logbook(
    p_trainee_profile_id, p_slot_id, p_reason, p_request_id
  );
$$;
REVOKE ALL ON FUNCTION public.admin_assign_trainee_enrollment_logbook(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_trainee_enrollment_logbook(uuid, uuid, text, uuid)
  TO authenticated;

ALTER TABLE public.logbook_instances
  DROP CONSTRAINT IF EXISTS logbook_instances_exactly_one_owner,
  ALTER COLUMN enrollment_id SET NOT NULL,
  DROP COLUMN IF EXISTS trainee_profile_id;

DROP INDEX IF EXISTS public.logbook_instances_trainee_profile_idx;

COMMENT ON COLUMN public.logbook_instances.enrollment_id IS
  'The sole owner context for this logbook instance. Exactly one instance per training enrollment.';
COMMENT ON COLUMN public.logbook_instances.assigned_by IS
  'Administrator who directly provisioned the linked enrollment/logbook, when applicable.';
COMMENT ON COLUMN public.logbook_instances.assignment_reason IS
  'Administrator-provided reason for direct enrollment/logbook provisioning, when applicable.';
