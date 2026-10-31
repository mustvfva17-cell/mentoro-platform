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
     OR p_year_of_study NOT BETWEEN 1 AND 12 THEN
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
  p_slot_id uuid,
  p_reason text DEFAULT NULL
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
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;
  IF p_trainee_profile_id IS NULL OR p_slot_id IS NULL THEN
    RAISE EXCEPTION 'Choose a trainee and an available training slot' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) > 1000 THEN
    RAISE EXCEPTION 'Assignment note must be 1000 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trainee_profiles tp
    JOIN public.profile_roles r ON r.user_id = tp.profile_id
    WHERE tp.profile_id = p_trainee_profile_id
      AND r.role = 'TRAINEE' AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected account is not an active trainee profile' USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_slot
  FROM public.training_slots s
  WHERE s.id = p_slot_id
  FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'OPEN' OR v_slot.starts_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Selected training slot is not available' USING ERRCODE = '55000';
  END IF;

  SELECT o.* INTO v_offering
  FROM public.training_offerings o
  JOIN public.mentor_profiles mp ON mp.profile_id = o.mentor_profile_id
  JOIN public.profile_roles mr ON mr.user_id = mp.profile_id
  WHERE o.id = v_slot.offering_id
    AND o.status = 'PUBLISHED'
    AND mp.profile_status = 'APPROVED'
    AND mr.role = 'MENTOR' AND mr.revoked_at IS NULL
  FOR SHARE OF o, mp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected training or mentor is no longer available' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.logbook_template_versions tv
    JOIN public.logbook_templates t ON t.id = tv.template_id
    WHERE tv.id = v_offering.template_version_id
      AND tv.status = 'PUBLISHED' AND tv.is_assignable = true
      AND t.is_active = true AND t.specialty_id = v_offering.specialty_id
  ) THEN
    RAISE EXCEPTION 'Selected training does not have an active assignable logbook' USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.training_enrollments e
  WHERE e.slot_id = v_slot.id AND e.status IN ('CONFIRMED', 'ACTIVE');
  IF v_reserved >= v_slot.capacity THEN
    RAISE EXCEPTION 'Training slot capacity has been reached' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.training_enrollments e
    WHERE e.trainee_profile_id = p_trainee_profile_id
      AND e.slot_id = v_slot.id AND e.status IN ('CONFIRMED', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'This trainee already has this training assignment' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.training_applications (
    trainee_profile_id, offering_id, slot_id, applicant_note, status,
    admin_decision_by, admin_decided_at, admin_decision_reason
  ) VALUES (
    p_trainee_profile_id, v_offering.id, v_slot.id, nullif(trim(p_reason), ''),
    'ADMIN_ASSIGNED', v_actor_id, clock_timestamp(), nullif(trim(p_reason), 'Assigned directly by platform administration')
  ) RETURNING id INTO v_application_id;

  INSERT INTO public.training_enrollments (
    source_application_id, trainee_profile_id, mentor_profile_id, specialty_id,
    offering_id, slot_id, template_version_id, starts_at, ends_at, status, confirmed_by
  ) VALUES (
    v_application_id, p_trainee_profile_id, v_offering.mentor_profile_id,
    v_offering.specialty_id, v_offering.id, v_slot.id, v_offering.template_version_id,
    v_slot.starts_at, v_slot.ends_at, 'CONFIRMED', v_actor_id
  ) RETURNING id INTO v_enrollment_id;

  INSERT INTO public.logbook_instances (enrollment_id, template_version_id)
  VALUES (v_enrollment_id, v_offering.template_version_id)
  RETURNING id INTO v_instance_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason, metadata)
  VALUES (
    v_actor_id, 'ADMIN_ASSIGNED_TRAINEE_LOGBOOK', 'TRAINING_ENROLLMENT', v_enrollment_id,
    nullif(trim(p_reason), ''),
    jsonb_build_object('trainee_profile_id', p_trainee_profile_id, 'application_id', v_application_id,
                       'logbook_instance_id', v_instance_id, 'training_slot_id', v_slot.id)
  );
  RETURN v_enrollment_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_assign_trainee_logbook(uuid, uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_assign_trainee_logbook(uuid, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_trainee_logbook(
  p_trainee_profile_id uuid,
  p_slot_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_assign_trainee_logbook(p_trainee_profile_id, p_slot_id, p_reason);
$$;
REVOKE ALL ON FUNCTION public.admin_assign_trainee_logbook(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_trainee_logbook(uuid, uuid, text)
  TO authenticated;
