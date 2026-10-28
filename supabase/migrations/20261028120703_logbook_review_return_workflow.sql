-- Support a complete mentor feedback cycle without granting browser roles direct
-- control over submission state or review decisions.

-- Trainees may edit their own drafts or entries explicitly returned for revision.
-- They cannot change status, submitted_at, or updated_at directly.
DROP POLICY IF EXISTS logbook_entries_update_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_update_own_drafts
ON public.logbook_entries
FOR UPDATE TO authenticated
USING (
  status IN ('DRAFT', 'RETURNED')
  AND app_private.owns_instance(instance_id)
)
WITH CHECK (
  status IN ('DRAFT', 'RETURNED')
  AND app_private.owns_instance(instance_id)
  AND created_by = (SELECT auth.uid())
  AND (
    (status = 'DRAFT' AND submitted_at IS NULL)
    OR (status = 'RETURNED' AND submitted_at IS NOT NULL)
  )
);

REVOKE UPDATE (status) ON TABLE public.logbook_entries FROM authenticated;
REVOKE INSERT ON TABLE public.entry_reviews FROM authenticated;
REVOKE INSERT (entry_id, reviewer_profile_id, decision, feedback)
ON TABLE public.entry_reviews FROM authenticated;

-- A resubmission after RETURNED gets a new database-generated timestamp.
CREATE OR REPLACE FUNCTION app_private.enforce_entry_submission_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('DRAFT', 'RETURNED') AND NEW.status = 'SUBMITTED' THEN
    NEW.submitted_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Keep an auditable distinction between first submission and resubmission.
CREATE OR REPLACE FUNCTION app_private.audit_entry_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('DRAFT', 'RETURNED') AND NEW.status = 'SUBMITTED' THEN
    INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id)
    VALUES (
      auth.uid(),
      CASE WHEN OLD.status = 'RETURNED'
        THEN 'LOGBOOK_ENTRY_RESUBMITTED'
        ELSE 'LOGBOOK_ENTRY_SUBMITTED'
      END,
      'LOGBOOK_ENTRY',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Internal least-privilege submission implementation.
CREATE OR REPLACE FUNCTION app_private.submit_current_logbook_entry(
  p_actor_id uuid,
  p_entry_id uuid
)
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
  FOR UPDATE;

  IF NOT FOUND OR v_entry.status NOT IN ('DRAFT', 'RETURNED') THEN
    RAISE EXCEPTION 'Only your draft or returned entries can be submitted' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION app_private.submit_current_logbook_entry(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.submit_current_logbook_entry(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_logbook_entry_submitted(
  p_actor_id uuid,
  p_entry_id uuid
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.submit_current_logbook_entry(p_actor_id, p_entry_id);
$$;
REVOKE ALL ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) TO authenticated;

-- An assigned mentor can see submitted entries only when the current submission
-- is not already answered. Re-submitting a returned entry makes it pending again.
CREATE OR REPLACE FUNCTION app_private.mentor_list_my_logbook_entries(p_limit integer DEFAULT 100)
RETURNS TABLE (
  entry_id uuid,
  entry_type text,
  title text,
  entry_date date,
  submitted_at timestamptz,
  training_title text,
  specialty_name text,
  trainee_name text,
  university_name text,
  faculty_name text,
  year_of_study smallint,
  previous_review_decision text,
  previous_review_feedback text,
  previous_reviewed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_mentor() THEN
    RAISE EXCEPTION 'Active mentor session required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Logbook page size must be between 1 and 200' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    le.id,
    le.entry_type,
    le.title,
    le.entry_date,
    le.submitted_at,
    o.title,
    sp.name_en,
    COALESCE(NULLIF(trim(p.full_name), ''), 'Trainee'),
    tp.university_name,
    tp.faculty_name,
    tp.year_of_study,
    recent.decision,
    recent.feedback,
    recent.reviewed_at
  FROM public.logbook_entries AS le
  JOIN public.logbook_instances AS li ON li.id = le.instance_id
  JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
  JOIN public.training_offerings AS o ON o.id = e.offering_id
  LEFT JOIN public.specialties AS sp ON sp.id = o.specialty_id
  LEFT JOIN public.trainee_profiles AS tp ON tp.profile_id = e.trainee_profile_id
  LEFT JOIN public.profiles AS p ON p.id = e.trainee_profile_id
  LEFT JOIN LATERAL (
    SELECT er.decision, er.feedback, er.reviewed_at
    FROM public.entry_reviews AS er
    WHERE er.entry_id = le.id
    ORDER BY er.reviewed_at DESC, er.id DESC
    LIMIT 1
  ) AS recent ON true
  WHERE e.mentor_profile_id = v_actor_id
    AND le.status = 'SUBMITTED'
    AND (recent.reviewed_at IS NULL OR le.submitted_at > recent.reviewed_at)
  ORDER BY le.submitted_at DESC, le.id DESC
  LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION app_private.mentor_list_my_logbook_entries(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mentor_list_my_logbook_entries(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_list_my_logbook_entries(p_limit integer DEFAULT 100)
RETURNS TABLE (
  entry_id uuid,
  entry_type text,
  title text,
  entry_date date,
  submitted_at timestamptz,
  training_title text,
  specialty_name text,
  trainee_name text,
  university_name text,
  faculty_name text,
  year_of_study smallint,
  previous_review_decision text,
  previous_review_feedback text,
  previous_reviewed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM app_private.mentor_list_my_logbook_entries(p_limit);
$$;
REVOKE ALL ON FUNCTION public.mentor_list_my_logbook_entries(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mentor_list_my_logbook_entries(integer) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.mentor_review_current_entry(
  p_entry_id uuid,
  p_decision text,
  p_feedback text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_submitted_at timestamptz;
  v_review_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_mentor() THEN
    RAISE EXCEPTION 'Active mentor session required' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('VERIFIED', 'FEEDBACK', 'NEEDS_REVISION') THEN
    RAISE EXCEPTION 'Unsupported logbook review decision' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_feedback, '')) > 2000 THEN
    RAISE EXCEPTION 'Feedback must be 2000 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF p_decision IN ('FEEDBACK', 'NEEDS_REVISION') AND nullif(btrim(p_feedback), '') IS NULL THEN
    RAISE EXCEPTION 'Feedback is required for this decision' USING ERRCODE = '22023';
  END IF;

  SELECT le.submitted_at INTO v_submitted_at
  FROM public.logbook_entries AS le
  JOIN public.logbook_instances AS li ON li.id = le.instance_id
  JOIN public.training_enrollments AS e ON e.id = li.enrollment_id
  WHERE le.id = p_entry_id
    AND e.mentor_profile_id = v_actor_id
    AND le.status = 'SUBMITTED'
  FOR UPDATE OF le;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry is unavailable for review by this mentor' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entry_reviews AS er
    WHERE er.entry_id = p_entry_id
      AND er.reviewed_at >= v_submitted_at
  ) THEN
    RAISE EXCEPTION 'This submission has already been reviewed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.entry_reviews (entry_id, reviewer_profile_id, decision, feedback)
  VALUES (p_entry_id, v_actor_id, p_decision, nullif(btrim(p_feedback), ''))
  RETURNING id INTO v_review_id;

  IF p_decision = 'NEEDS_REVISION' THEN
    UPDATE public.logbook_entries
    SET status = 'RETURNED'
    WHERE id = p_entry_id AND status = 'SUBMITTED';
  END IF;

  RETURN v_review_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.mentor_review_current_entry(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mentor_review_current_entry(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_review_my_entry(
  p_entry_id uuid,
  p_decision text,
  p_feedback text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.mentor_review_current_entry(p_entry_id, p_decision, p_feedback);
$$;
REVOKE ALL ON FUNCTION public.mentor_review_my_entry(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mentor_review_my_entry(uuid, text, text) TO authenticated;
