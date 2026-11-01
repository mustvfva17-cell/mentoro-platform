-- Keep trainee-facing application history consistent when a confirmed enrollment is cancelled.
-- Approval metadata is intentionally retained as historical evidence; the lifecycle reason stays in audit_logs.
CREATE OR REPLACE FUNCTION app_private.transition_my_training_enrollment(
  p_enrollment_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_action text := upper(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_enrollment public.training_enrollments%ROWTYPE;
  v_is_admin boolean;
  v_is_assigned_mentor boolean;
  v_previous_status text;
  v_next_status text;
  v_transition_at timestamptz;
  v_audit_action text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated training workspace access is required' USING ERRCODE = '42501';
  END IF;

  IF p_enrollment_id IS NULL OR v_action NOT IN ('START', 'COMPLETE', 'CANCEL') THEN
    RAISE EXCEPTION 'Choose a valid enrollment and lifecycle action' USING ERRCODE = '22023';
  END IF;

  IF length(coalesce(v_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Lifecycle reason must be 1000 characters or fewer' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'CANCEL' AND length(coalesce(v_reason, '')) < 10 THEN
    RAISE EXCEPTION 'A cancellation reason of 10–1000 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_enrollment
  FROM public.training_enrollments AS e
  WHERE e.id = p_enrollment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training enrollment not found' USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := app_private.is_platform_admin();
  v_is_assigned_mentor := app_private.is_mentor()
    AND v_enrollment.mentor_profile_id = v_actor_id
    AND EXISTS (
      SELECT 1 FROM public.mentor_profiles AS mp
      WHERE mp.profile_id = v_actor_id
        AND mp.profile_status = 'APPROVED'
    );

  IF NOT v_is_admin AND NOT v_is_assigned_mentor THEN
    RAISE EXCEPTION 'Only the assigned approved Mentor or an active platform admin may change this enrollment'
      USING ERRCODE = '42501';
  END IF;

  -- Use wall-clock time only after the row lock is acquired and the actor is authorized.
  v_transition_at := clock_timestamp();
  v_previous_status := v_enrollment.status;

  CASE v_action
    WHEN 'START' THEN
      IF v_previous_status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Only confirmed training can be started' USING ERRCODE = '55000';
      END IF;
      IF v_enrollment.starts_at > v_transition_at THEN
        RAISE EXCEPTION 'Training cannot be started before its scheduled start time' USING ERRCODE = '55000';
      END IF;
      IF v_enrollment.ends_at <= v_transition_at THEN
        RAISE EXCEPTION 'The scheduled training window has ended; review the enrollment instead of starting it'
          USING ERRCODE = '55000';
      END IF;
      v_next_status := 'ACTIVE';
      v_audit_action := 'TRAINING_ENROLLMENT_STARTED';

    WHEN 'COMPLETE' THEN
      IF v_previous_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Only active training can be completed' USING ERRCODE = '55000';
      END IF;
      IF v_enrollment.ends_at > v_transition_at THEN
        RAISE EXCEPTION 'Training cannot be completed before its scheduled end time' USING ERRCODE = '55000';
      END IF;
      v_next_status := 'COMPLETED';
      v_audit_action := 'TRAINING_ENROLLMENT_COMPLETED';

    WHEN 'CANCEL' THEN
      IF v_previous_status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'Only confirmed or active training can be cancelled' USING ERRCODE = '55000';
      END IF;
      v_next_status := 'CANCELLED';
      v_audit_action := 'TRAINING_ENROLLMENT_CANCELLED';
  END CASE;

  UPDATE public.training_enrollments
  SET status = v_next_status,
      completed_at = CASE WHEN v_next_status = 'COMPLETED' THEN v_transition_at ELSE completed_at END,
      cancelled_at = CASE WHEN v_next_status = 'CANCELLED' THEN v_transition_at ELSE cancelled_at END
  WHERE id = v_enrollment.id;

  -- Keep the trainee-facing application history aligned with its enrollment.
  -- The decision actor/timestamps/reasons remain intact as historical approval evidence.
  IF v_next_status = 'CANCELLED' THEN
    UPDATE public.training_applications
    SET status = 'CANCELLED',
        updated_at = v_transition_at
    WHERE id = v_enrollment.source_application_id
      AND status <> 'CANCELLED';
  END IF;

  INSERT INTO public.audit_logs(actor_profile_id, action, entity_type, entity_id, outcome, reason, metadata)
  VALUES (
    v_actor_id,
    v_audit_action,
    'TRAINING_ENROLLMENT',
    v_enrollment.id,
    'SUCCESS',
    v_reason,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'new_status', v_next_status,
      'starts_at', v_enrollment.starts_at,
      'ends_at', v_enrollment.ends_at,
      'source_application_id', v_enrollment.source_application_id,
      'transitioned_at', v_transition_at
    )
  );

  RETURN jsonb_build_object(
    'enrollment_id', v_enrollment.id,
    'previous_status', v_previous_status,
    'status', v_next_status,
    'action', v_action,
    'transitioned_at', v_transition_at
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.transition_my_training_enrollment(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.transition_my_training_enrollment(uuid, text, text)
  TO authenticated;
