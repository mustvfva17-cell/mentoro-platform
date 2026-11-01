-- Store trusted mentor decisions for entries in the legacy HTML logbook.
-- Trainees never write to this table directly; every mutation is checked against the assigned mentor.
CREATE TABLE public.logbook_html_item_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.logbook_instances(id) ON DELETE CASCADE,
  item_id text NOT NULL CHECK (length(trim(item_id)) BETWEEN 1 AND 120),
  item_type text NOT NULL CHECK (item_type IN ('session', 'case', 'procedure', 'discussion', 'emergency')),
  decision text NOT NULL CHECK (decision IN ('VERIFIED', 'FEEDBACK', 'NEEDS_REVISION')),
  feedback text,
  reviewer_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logbook_html_item_review_feedback_required
    CHECK (decision = 'VERIFIED' OR length(trim(coalesce(feedback, ''))) >= 5),
  CONSTRAINT logbook_html_item_review_feedback_size
    CHECK (length(coalesce(feedback, '')) <= 2000)
);

ALTER TABLE public.logbook_html_item_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.logbook_html_item_reviews FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX logbook_html_item_reviews_latest_idx
  ON public.logbook_html_item_reviews(instance_id, item_id, created_at DESC, id DESC);

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
       '/logbooks/general-surgery/index.html'
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
        'created_at', latest.created_at
      )
      ORDER BY latest.created_at DESC, latest.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_reviews
  FROM (
    SELECT DISTINCT ON (r.item_id)
      r.id, r.item_id, r.item_type, r.decision, r.feedback, r.reviewer_profile_id, r.created_at
    FROM public.logbook_html_item_reviews r
    WHERE r.instance_id = p_instance_id
    ORDER BY r.item_id, r.created_at DESC, r.id DESC
  ) AS latest;

  RETURN v_reviews;
END;
$$;

REVOKE ALL ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid)
  TO authenticated;

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
  v_item_exists boolean := false;
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
       '/logbooks/general-surgery/index.html'
     ) THEN
    RAISE EXCEPTION 'This instance is not assigned to a registered HTML logbook' USING ERRCODE = '22023';
  END IF;

  SELECT s.state INTO v_state
  FROM public.logbook_html_states s
  WHERE s.instance_id = p_instance_id;

  IF NOT FOUND OR jsonb_typeof(v_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'No saved HTML logbook state exists for this training yet' USING ERRCODE = 'P0002';
  END IF;

  v_item_exists := CASE p_item_type
    WHEN 'session' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state -> 'sessions') AS item(value)
      WHERE value ->> 'id' = p_item_id
    )
    WHEN 'case' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state -> 'cases') AS item(value)
      WHERE value ->> 'id' = p_item_id
    )
    WHEN 'procedure' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state -> 'procedures') AS item(value)
      WHERE value ->> 'id' = p_item_id
        AND coalesce(value ->> 'kind', 'procedure') <> 'discussion'
        AND NOT (value ? 'topic')
    )
    WHEN 'discussion' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state -> 'procedures') AS item(value)
      WHERE value ->> 'id' = p_item_id
        AND (value ->> 'kind' = 'discussion' OR value ? 'topic')
    )
    WHEN 'emergency' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_state -> 'emergency') AS item(value)
      WHERE value ->> 'id' = p_item_id
    )
    ELSE false
  END;

  IF NOT coalesce(v_item_exists, false) THEN
    RAISE EXCEPTION 'The selected item is not present in this training logbook' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.logbook_html_item_reviews(
    instance_id, item_id, item_type, decision, feedback, reviewer_profile_id
  ) VALUES (
    p_instance_id, p_item_id, p_item_type, p_decision, v_feedback, v_actor_id
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
    'created_at', v_created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.mentor_review_html_logbook_item(uuid, text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mentor_review_html_logbook_item(uuid, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_logbook_html_item_reviews(p_instance_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.get_my_logbook_html_item_reviews(p_instance_id);
$$;

REVOKE ALL ON FUNCTION public.get_my_logbook_html_item_reviews(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_logbook_html_item_reviews(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_review_html_logbook_item(
  p_instance_id uuid,
  p_item_id text,
  p_item_type text,
  p_decision text,
  p_feedback text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.mentor_review_html_logbook_item(
    p_instance_id, p_item_id, p_item_type, p_decision, p_feedback
  );
$$;

REVOKE ALL ON FUNCTION public.mentor_review_html_logbook_item(uuid, text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mentor_review_html_logbook_item(uuid, text, text, text, text)
  TO authenticated;
