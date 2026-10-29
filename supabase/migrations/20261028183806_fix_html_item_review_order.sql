-- Preserve decision order explicitly so repeated mentor reviews are deterministic.
ALTER TABLE public.logbook_html_item_reviews
  ADD COLUMN review_order bigint GENERATED ALWAYS AS IDENTITY;

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
      r.id, r.item_id, r.item_type, r.decision, r.feedback,
      r.reviewer_profile_id, r.created_at, r.review_order
    FROM public.logbook_html_item_reviews r
    WHERE r.instance_id = p_instance_id
    ORDER BY r.item_id, r.review_order DESC
  ) AS latest;

  RETURN v_reviews;
END;
$$;

REVOKE ALL ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_logbook_html_item_reviews(uuid)
  TO authenticated;
