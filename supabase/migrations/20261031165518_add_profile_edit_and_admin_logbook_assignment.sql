-- Allow administrators to assign an already-published logbook offering directly to an existing trainee.
-- The assignment still creates a normal enrollment and an independent logbook instance.
ALTER TABLE public.training_applications
  DROP CONSTRAINT IF EXISTS training_applications_status_check;
ALTER TABLE public.training_applications
  ADD CONSTRAINT training_applications_status_check
  CHECK (status IN ('SUBMITTED', 'MENTOR_APPROVED', 'MENTOR_REJECTED', 'ADMIN_CONFIRMED', 'ADMIN_ASSIGNED', 'WITHDRAWN', 'CANCELLED'));

ALTER TABLE public.training_applications
  DROP CONSTRAINT IF EXISTS training_applications_check;
ALTER TABLE public.training_applications
  ADD CONSTRAINT training_applications_check
  CHECK (
    (status = 'SUBMITTED' AND mentor_decision_by IS NULL AND mentor_decided_at IS NULL AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR (status IN ('MENTOR_APPROVED', 'MENTOR_REJECTED') AND mentor_decision_by IS NOT NULL AND mentor_decided_at IS NOT NULL AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR (status = 'ADMIN_CONFIRMED' AND mentor_decision_by IS NOT NULL AND mentor_decided_at IS NOT NULL AND admin_decision_by IS NOT NULL AND admin_decided_at IS NOT NULL)
    OR (status = 'ADMIN_ASSIGNED' AND mentor_decision_by IS NULL AND mentor_decided_at IS NULL AND admin_decision_by IS NOT NULL AND admin_decided_at IS NOT NULL)
    OR (status = 'WITHDRAWN' AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR status = 'CANCELLED'
  );

DROP INDEX IF EXISTS public.training_applications_one_open_request_per_slot;
CREATE UNIQUE INDEX training_applications_one_open_request_per_slot
  ON public.training_applications (trainee_profile_id, offering_id, slot_id)
  WHERE status IN ('SUBMITTED', 'MENTOR_APPROVED', 'ADMIN_ASSIGNED');

CREATE OR REPLACE FUNCTION app_private.update_current_trainee_profile(
  p_full_name text,
  p_university_name text,
  p_faculty_name text,
  p_year_of_study smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_trainee() THEN
    RAISE EXCEPTION 'Active trainee session required' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_full_name, ''))) < 2 OR length(trim(p_full_name)) > 160
     OR length(trim(coalesce(p_university_name, ''))) < 2 OR length(trim(p_university_name)) > 200
     OR length(trim(coalesce(p_faculty_name, ''))) < 2 OR length(trim(p_faculty_name)) > 200
     OR p_year_of_study IS NULL OR p_year_of_study NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Complete your name, university, faculty, and valid year of study' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET full_name = trim(p_full_name)
  WHERE id = v_actor_id;

  UPDATE public.trainee_profiles
  SET university_name = trim(p_university_name),
      faculty_name = trim(p_faculty_name),
      year_of_study = p_year_of_study
  WHERE profile_id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trainee profile was not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.update_current_trainee_profile(text, text, text, smallint)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_current_trainee_profile(text, text, text, smallint)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.update_current_trainee_profile(
  p_full_name text,
  p_university_name text,
  p_faculty_name text,
  p_year_of_study smallint
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.update_current_trainee_profile(p_full_name, p_university_name, p_faculty_name, p_year_of_study);
$$;
REVOKE ALL ON FUNCTION public.update_current_trainee_profile(text, text, text, smallint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_current_trainee_profile(text, text, text, smallint)
  TO authenticated;

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
