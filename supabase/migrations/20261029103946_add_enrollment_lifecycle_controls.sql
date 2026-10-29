-- Add an audited, server-authorized lifecycle for each independent training enrollment.
-- Rules: the assigned active Mentor or a platform admin may start, complete, or cancel.
-- Start only inside the scheduled window; completion only after the scheduled end.
-- Cancellation of a confirmed/active enrollment requires a reason and is terminal.

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
  v_transition_at timestamptz := now();
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

CREATE OR REPLACE FUNCTION public.transition_my_training_enrollment(
  p_enrollment_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.transition_my_training_enrollment(p_enrollment_id, p_action, p_reason);
$$;

REVOKE ALL ON FUNCTION public.transition_my_training_enrollment(uuid, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_my_training_enrollment(uuid, text, text)
  TO authenticated;

-- Keep structured logbook writes and submissions read-only after an enrollment
-- is completed/cancelled, or if its own logbook instance has been archived.
CREATE OR REPLACE FUNCTION app_private.guard_enrollment_logbook_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instance_id uuid;
  v_enrollment_status text;
  v_instance_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.instance_id IS DISTINCT FROM OLD.instance_id THEN
    RAISE EXCEPTION 'A logbook entry cannot be moved to another enrollment instance' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_instance_id := OLD.instance_id;
  ELSE
    v_instance_id := NEW.instance_id;
  END IF;

  SELECT e.status, li.status
    INTO v_enrollment_status, v_instance_status
  FROM public.logbook_instances AS li
  JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
  WHERE li.id = v_instance_id
  FOR SHARE OF e, li;

  IF NOT FOUND
     OR v_instance_status <> 'ACTIVE'
     OR v_enrollment_status NOT IN ('CONFIRMED', 'ACTIVE') THEN
    RAISE EXCEPTION 'This training logbook is read-only because its enrollment is no longer open'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_enrollment_logbook_writes()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_enrollment_logbook_writes ON public.logbook_entries;
CREATE TRIGGER guard_enrollment_logbook_writes
BEFORE INSERT OR UPDATE OR DELETE ON public.logbook_entries
FOR EACH ROW EXECUTE FUNCTION app_private.guard_enrollment_logbook_writes();

DROP POLICY IF EXISTS logbook_entries_insert_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_insert_own_drafts
ON public.logbook_entries FOR INSERT TO authenticated
WITH CHECK (
  status = 'DRAFT'
  AND submitted_at IS NULL
  AND created_by = (SELECT auth.uid())
  AND app_private.owns_instance(instance_id)
  AND EXISTS (
    SELECT 1
    FROM public.logbook_instances AS li
    JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
    WHERE li.id = public.logbook_entries.instance_id
      AND li.status = 'ACTIVE'
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  )
);

DROP POLICY IF EXISTS logbook_entries_update_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_update_own_drafts
ON public.logbook_entries FOR UPDATE TO authenticated
USING (
  status IN ('DRAFT', 'RETURNED')
  AND app_private.owns_instance(instance_id)
  AND EXISTS (
    SELECT 1
    FROM public.logbook_instances AS li
    JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
    WHERE li.id = public.logbook_entries.instance_id
      AND li.status = 'ACTIVE'
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  )
)
WITH CHECK (
  status IN ('DRAFT', 'RETURNED')
  AND app_private.owns_instance(instance_id)
  AND created_by = (SELECT auth.uid())
  AND (
    (status = 'DRAFT' AND submitted_at IS NULL)
    OR (status = 'RETURNED' AND submitted_at IS NOT NULL)
  )
  AND EXISTS (
    SELECT 1
    FROM public.logbook_instances AS li
    JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
    WHERE li.id = public.logbook_entries.instance_id
      AND li.status = 'ACTIVE'
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  )
);

DROP POLICY IF EXISTS logbook_entries_delete_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_delete_own_drafts
ON public.logbook_entries FOR DELETE TO authenticated
USING (
  status = 'DRAFT'
  AND app_private.owns_instance(instance_id)
  AND EXISTS (
    SELECT 1
    FROM public.logbook_instances AS li
    JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
    WHERE li.id = public.logbook_entries.instance_id
      AND li.status = 'ACTIVE'
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  )
);

CREATE OR REPLACE FUNCTION app_private.submit_current_logbook_entry(p_actor_id uuid, p_entry_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.logbook_entries%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Actor identity mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT le.* INTO v_entry
  FROM public.logbook_entries AS le
  WHERE le.id = p_entry_id
    AND app_private.owns_instance(le.instance_id)
    AND EXISTS (
      SELECT 1
      FROM public.logbook_instances AS li
      JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
      WHERE li.id = le.instance_id
        AND li.status = 'ACTIVE'
        AND e.status IN ('CONFIRMED', 'ACTIVE')
    )
  FOR UPDATE OF le;

  IF NOT FOUND OR v_entry.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Only your draft or returned entries in an open enrollment can be submitted'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.logbook_entries
  SET status = 'SUBMITTED'
  WHERE id = p_entry_id AND status IN ('DRAFT', 'RETURNED');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry changed before submission; refresh and retry';
  END IF;

  RETURN p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.submit_current_logbook_entry(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.submit_current_logbook_entry(uuid, uuid)
  TO authenticated;
