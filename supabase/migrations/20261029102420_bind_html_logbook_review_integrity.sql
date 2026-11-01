-- Tie new HTML logbook mentor reviews to the exact saved item content.
-- Existing reviews remain in history but cannot be represented as current without a content fingerprint.
ALTER TABLE public.logbook_html_item_reviews
  ADD COLUMN item_digest text,
  ADD COLUMN reviewed_state_revision bigint,
  ADD CONSTRAINT logbook_html_item_reviews_digest_format
    CHECK (item_digest IS NULL OR item_digest ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT logbook_html_item_reviews_state_revision_positive
    CHECK (reviewed_state_revision IS NULL OR reviewed_state_revision > 0);

CREATE INDEX logbook_html_item_reviews_current_lookup_idx
  ON public.logbook_html_item_reviews(instance_id, item_type, item_id, review_order DESC);

CREATE OR REPLACE FUNCTION app_private.get_html_logbook_review_item(
  p_state jsonb, p_item_type text, p_item_id text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_items jsonb;
  v_match_count integer;
  v_item jsonb;
BEGIN
  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object'
     OR nullif(trim(coalesce(p_item_id, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_item_type
    WHEN 'session' THEN v_items := p_state -> 'sessions';
    WHEN 'case' THEN v_items := p_state -> 'cases';
    WHEN 'procedure' THEN v_items := p_state -> 'procedures';
    WHEN 'discussion' THEN v_items := p_state -> 'procedures';
    WHEN 'emergency' THEN v_items := p_state -> 'emergency';
    ELSE RETURN NULL;
  END CASE;

  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer INTO v_match_count
  FROM jsonb_array_elements(v_items) AS elements(value)
  WHERE elements.value ->> 'id' = p_item_id
    AND CASE p_item_type
      WHEN 'procedure' THEN
        coalesce(elements.value ->> 'kind', 'procedure') <> 'discussion'
        AND NOT (elements.value ? 'topic')
      WHEN 'discussion' THEN
        elements.value ->> 'kind' = 'discussion'
        OR elements.value ? 'topic'
      ELSE true
    END;

  -- Duplicate IDs are ambiguous; never treat an arbitrary matching item as reviewed.
  IF v_match_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT elements.value INTO v_item
  FROM jsonb_array_elements(v_items) AS elements(value)
  WHERE elements.value ->> 'id' = p_item_id
    AND CASE p_item_type
      WHEN 'procedure' THEN
        coalesce(elements.value ->> 'kind', 'procedure') <> 'discussion'
        AND NOT (elements.value ? 'topic')
      WHEN 'discussion' THEN
        elements.value ->> 'kind' = 'discussion'
        OR elements.value ? 'topic'
      ELSE true
    END;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION app_private.get_html_logbook_review_item(jsonb, text, text)
  FROM PUBLIC, anon, authenticated, service_role;



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
       '/logbooks/general-surgery/index.html'
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


REVOKE ALL ON FUNCTION app_private.mentor_review_html_logbook_item(uuid, text, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mentor_review_html_logbook_item(uuid, text, text, text, text)
  TO authenticated;
