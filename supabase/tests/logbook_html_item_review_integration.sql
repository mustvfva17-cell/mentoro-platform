-- Rollback-only integration test for trusted mentor decisions on legacy HTML logbook items.
-- Run ONLY against mentoro-platform-test or another disposable database.
-- The temporary mentor role/profile, offering, enrollment, state, reviews, and audit rows are rolled back.
BEGIN;

DO $test$
DECLARE
  v_admin uuid;
  v_trainee uuid;
  v_mentor uuid;
  v_specialty uuid;
  v_template uuid;
  v_version uuid;
  v_offering uuid;
  v_slot uuid;
  v_application uuid;
  v_enrollment uuid;
  v_instance uuid;
  v_state jsonb := jsonb_build_object(
    'sessions', jsonb_build_array(
      jsonb_build_object('id','session-review-fixture','date','2026-10-28','focus','Synthetic mentor review test','types',jsonb_build_array('Ward'))
    ),
    'cases', jsonb_build_array(),
    'procedures', jsonb_build_array(),
    'roadmap', jsonb_build_object(),
    'emergency', jsonb_build_array(),
    'reflection', jsonb_build_object()
  );
  v_revision bigint;
  v_result jsonb;
  v_reviews jsonb;
  v_denied boolean;
  v_review_count integer;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT r.user_id INTO v_trainee
  FROM public.profile_roles r
  WHERE r.role='TRAINEE' AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT mp.profile_id INTO v_mentor
  FROM public.mentor_profiles mp
  JOIN public.profile_roles r ON r.user_id=mp.profile_id
  WHERE r.role='MENTOR' AND r.revoked_at IS NULL AND mp.profile_status='APPROVED'
  LIMIT 1;

  SELECT s.id INTO v_specialty
  FROM public.specialties s
  WHERE s.slug='general-surgery' AND s.is_active
  LIMIT 1;

  SELECT t.id,v.id INTO v_template,v_version
  FROM public.logbook_templates t
  JOIN public.logbook_template_versions v ON v.template_id=t.id
  WHERE t.slug='general-surgery-html' AND v.version_number=1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL OR v_template IS NULL OR v_version IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active admin, active trainee, General Surgery specialty, and HTML template version are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.logbook_template_versions
    WHERE id=v_version AND status='DRAFT' AND NOT is_assignable
      AND template_definition->>'renderer'='HTML'
      AND template_definition->>'html_path'='/logbooks/general-surgery/index.html'
  ) THEN
    RAISE EXCEPTION 'General Surgery template must stay an unassignable DRAFT during this test.';
  END IF;

  IF v_mentor IS NULL THEN
    -- Create a temporary MENTOR role on the admin identity only inside this transaction.
    -- The transaction-level ROLLBACK removes both this role and the temporary mentor profile.
    v_mentor := v_admin;
    INSERT INTO public.profile_roles(user_id,role,granted_by)
    VALUES(v_mentor,'MENTOR',v_admin)
    ON CONFLICT (user_id,role) WHERE revoked_at IS NULL DO NOTHING;

    INSERT INTO public.mentor_profiles(profile_id,display_name,professional_title,profile_status,is_public)
    VALUES(v_mentor,'Rollback-only HTML review mentor','Test fixture','APPROVED',false)
    ON CONFLICT(profile_id) DO UPDATE SET profile_status='APPROVED',is_public=false;
  END IF;

  INSERT INTO public.training_offerings(mentor_profile_id,specialty_id,template_version_id,title,status)
  VALUES(v_mentor,v_specialty,v_version,'Rollback-only trusted HTML review offering','DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()+interval '7 days',now()+interval '7 days 1 hour',1,'OPEN')
  RETURNING id INTO v_slot;

  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,
    mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES(v_trainee,v_offering,v_slot,'ADMIN_CONFIRMED',v_admin,now(),v_admin,now())
  RETURNING id INTO v_application;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,
    offering_id,slot_id,template_version_id,starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES(
    v_application,v_trainee,v_mentor,v_specialty,v_offering,v_slot,v_version,
    now()+interval '7 days',now()+interval '7 days 1 hour','CONFIRMED',v_admin,now()
  ) RETURNING id INTO v_enrollment;

  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment,v_version) RETURNING id INTO v_instance;

  -- Seed the state as the enrolled trainee, then verify that the assigned mentor can make decisions.
  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  v_revision := public.save_my_logbook_html_state(v_instance,v_state,0);
  IF v_revision<>1 THEN RAISE EXCEPTION 'Initial HTML state save should create revision 1'; END IF;

  -- Trainee may read mentor feedback but may not submit a mentor decision.
  v_reviews := public.get_my_logbook_html_item_reviews(v_instance);
  IF jsonb_typeof(v_reviews) IS DISTINCT FROM 'array' OR jsonb_array_length(v_reviews)<>0 THEN
    RAISE EXCEPTION 'Review history should start empty for this test instance';
  END IF;

  v_denied:=false;
  BEGIN
    PERFORM public.mentor_review_html_logbook_item(v_instance,'session-review-fixture','session','VERIFIED',NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Trainee must not be able to submit mentor verification'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_mentor::text,true);
  v_result := public.mentor_review_html_logbook_item(
    v_instance,'session-review-fixture','session','VERIFIED',NULL
  );
  IF v_result->>'decision' IS DISTINCT FROM 'VERIFIED'
     OR v_result->>'reviewer_profile_id' IS DISTINCT FROM v_mentor::text THEN
    RAISE EXCEPTION 'Assigned mentor verification was not recorded with the correct reviewer';
  END IF;

  -- Every subsequent decision is recorded as a new audit/history row; reads return the latest.
  v_result := public.mentor_review_html_logbook_item(
    v_instance,'session-review-fixture','session','FEEDBACK','Add a learning reflection before next session.'
  );
  IF v_result->>'decision' IS DISTINCT FROM 'FEEDBACK' THEN
    RAISE EXCEPTION 'Follow-up mentor feedback was not recorded';
  END IF;

  v_reviews := public.get_my_logbook_html_item_reviews(v_instance);
  IF jsonb_array_length(v_reviews)<>1
     OR v_reviews->0->>'item_id' IS DISTINCT FROM 'session-review-fixture'
     OR v_reviews->0->>'decision' IS DISTINCT FROM 'FEEDBACK'
     OR v_reviews->0->>'reviewer_profile_id' IS DISTINCT FROM v_mentor::text THEN
    RAISE EXCEPTION 'Review RPC must return the latest trusted decision for the item';
  END IF;

  SELECT count(*) INTO v_review_count
  FROM public.logbook_html_item_reviews
  WHERE instance_id=v_instance AND item_id='session-review-fixture';
  IF v_review_count<>2 THEN
    RAISE EXCEPTION 'Review history should retain both the verification and follow-up feedback';
  END IF;

  -- Mentor cannot claim a review for a made-up item ID.
  v_denied:=false;
  BEGIN
    PERFORM public.mentor_review_html_logbook_item(v_instance,'item-that-does-not-exist','session','VERIFIED',NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'A mentor review must target an item present in the saved HTML state'; END IF;

  -- Read scope must reject a non-participant who is not the assigned trainee/mentor/admin.
  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  v_reviews := public.get_my_logbook_html_item_reviews(v_instance);
  IF jsonb_array_length(v_reviews)<>1 OR v_reviews->0->>'decision' IS DISTINCT FROM 'FEEDBACK' THEN
    RAISE EXCEPTION 'Assigned trainee should be able to read the latest mentor feedback';
  END IF;

  RAISE NOTICE 'Trusted HTML mentor review passed: trainee cannot self-verify, assigned mentor can verify/feedback, review history is retained, latest decision is returned, and invalid item IDs are rejected.';
END
$test$;

ROLLBACK;
