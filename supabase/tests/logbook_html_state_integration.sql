-- Rollback-only integration test for the existing HTML logbook's per-enrollment state RPCs.
-- Run ONLY in mentoro-platform-test or another disposable database with an admin and trainee profile.
-- All fixtures are created in this transaction and removed by the final ROLLBACK.
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
  v_slot_a uuid;
  v_slot_b uuid;
  v_application_a uuid;
  v_application_b uuid;
  v_enrollment_a uuid;
  v_enrollment_b uuid;
  v_instance_a uuid;
  v_instance_b uuid;
  v_revision bigint;
  v_second_revision bigint;
  v_read jsonb;
  v_review jsonb;
  v_reviews jsonb;
  v_state_a jsonb := jsonb_build_object(
    'sessions', jsonb_build_array(jsonb_build_object('id','session-fixture','date','2026-10-28','focus','Synthetic integration test')),
    'cases', jsonb_build_array(),
    'procedures', jsonb_build_array(),
    'roadmap', jsonb_build_object('fixture-topic', true),
    'emergency', jsonb_build_array(),
    'reflection', jsonb_build_object('fixture-note','No clinical data')
  );
  v_state_b jsonb := jsonb_build_object(
    'sessions', jsonb_build_array(jsonb_build_object('id','session-fixture','date','2026-10-28','focus','Second training only')),
    'cases', jsonb_build_array(),
    'procedures', jsonb_build_array(),
    'roadmap', jsonb_build_object(),
    'emergency', jsonb_build_array(),
    'reflection', jsonb_build_object()
  );
  v_rejected boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN', 'SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT tp.profile_id INTO v_trainee
  FROM public.trainee_profiles tp
  JOIN public.profile_roles r ON r.user_id=tp.profile_id
  WHERE r.role='TRAINEE' AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT mp.profile_id INTO v_mentor
  FROM public.mentor_profiles mp
  JOIN public.profile_roles r ON r.user_id=mp.profile_id
  WHERE r.role='MENTOR' AND r.revoked_at IS NULL AND mp.profile_status='APPROVED'
  LIMIT 1;

  SELECT s.id INTO v_specialty
  FROM public.specialties s
  WHERE s.is_active
  LIMIT 1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active platform admin, active trainee, and active specialty are required.';
  END IF;

  IF v_mentor IS NULL THEN
    -- The temporary mentor profile/role exists only inside this rollback-only transaction.
    v_mentor := v_admin;
    INSERT INTO public.mentor_profiles(profile_id, display_name, professional_title, profile_status, is_public)
    VALUES (v_mentor, 'Rollback-only HTML state fixture', 'Test fixture', 'APPROVED', false)
    ON CONFLICT (profile_id) DO NOTHING;
    INSERT INTO public.profile_roles(user_id, role, granted_by)
    VALUES (v_mentor, 'MENTOR', v_admin);
  END IF;

  INSERT INTO public.logbook_templates(specialty_id, slug, title, description, is_active)
  VALUES (
    v_specialty,
    'html-state-test-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'Rollback-only HTML state integration fixture',
    'Synthetic fixture for per-instance state RPC testing.',
    false
  ) RETURNING id INTO v_template;

  INSERT INTO public.logbook_template_versions(
    template_id, version_number, status, is_assignable, schema_definition,
    template_definition, source_notes
  ) VALUES (
    v_template, 1, 'DRAFT', false,
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
    '{"renderer":"HTML","html_path":"/logbooks/medical-oncology/index.html","sections":["Roadmap","Sessions","Clinical Cases"],"versionLabel":"TEST ONLY"}'::jsonb,
    'Rollback-only integration fixture. Not a clinical template and not approved for use.'
  ) RETURNING id INTO v_version;

  INSERT INTO public.training_offerings(mentor_profile_id, specialty_id, template_version_id, title, status)
  VALUES (v_mentor, v_specialty, v_version, 'Rollback-only HTML state offering', 'DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id, starts_at, ends_at, capacity, status)
  VALUES (v_offering, now() + interval '7 days', now() + interval '7 days 1 hour', 1, 'OPEN')
  RETURNING id INTO v_slot_a;

  INSERT INTO public.training_slots(offering_id, starts_at, ends_at, capacity, status)
  VALUES (v_offering, now() + interval '8 days', now() + interval '8 days 1 hour', 1, 'OPEN')
  RETURNING id INTO v_slot_b;

  INSERT INTO public.training_applications(
    trainee_profile_id, offering_id, slot_id, status,
    mentor_decision_by, mentor_decided_at, admin_decision_by, admin_decided_at
  ) VALUES (
    v_trainee, v_offering, v_slot_a, 'ADMIN_CONFIRMED',
    v_admin, now(), v_admin, now()
  ) RETURNING id INTO v_application_a;

  INSERT INTO public.training_applications(
    trainee_profile_id, offering_id, slot_id, status,
    mentor_decision_by, mentor_decided_at, admin_decision_by, admin_decided_at
  ) VALUES (
    v_trainee, v_offering, v_slot_b, 'ADMIN_CONFIRMED',
    v_admin, now(), v_admin, now()
  ) RETURNING id INTO v_application_b;

  INSERT INTO public.training_enrollments(
    source_application_id, trainee_profile_id, mentor_profile_id, specialty_id,
    offering_id, slot_id, template_version_id, starts_at, ends_at,
    status, confirmed_by, confirmed_at
  ) VALUES (
    v_application_a, v_trainee, v_mentor, v_specialty, v_offering, v_slot_a, v_version,
    now() + interval '7 days', now() + interval '7 days 1 hour',
    'CONFIRMED', v_admin, now()
  ) RETURNING id INTO v_enrollment_a;

  INSERT INTO public.training_enrollments(
    source_application_id, trainee_profile_id, mentor_profile_id, specialty_id,
    offering_id, slot_id, template_version_id, starts_at, ends_at,
    status, confirmed_by, confirmed_at
  ) VALUES (
    v_application_b, v_trainee, v_mentor, v_specialty, v_offering, v_slot_b, v_version,
    now() + interval '8 days', now() + interval '8 days 1 hour',
    'CONFIRMED', v_admin, now()
  ) RETURNING id INTO v_enrollment_b;

  INSERT INTO public.logbook_instances(enrollment_id, template_version_id)
  VALUES (v_enrollment_a, v_version)
  RETURNING id INTO v_instance_a;

  INSERT INTO public.logbook_instances(enrollment_id, template_version_id)
  VALUES (v_enrollment_b, v_version)
  RETURNING id INTO v_instance_b;

  PERFORM set_config('request.jwt.claim.sub', v_trainee::text, true);

  v_revision := public.save_my_logbook_html_state(v_instance_a, v_state_a, 0);
  IF v_revision <> 1 THEN RAISE EXCEPTION 'First cloud save should create revision 1'; END IF;

  v_read := public.get_my_logbook_html_state(v_instance_a);
  IF (v_read ->> 'revision')::bigint <> 1 OR v_read -> 'state' <> v_state_a THEN
    RAISE EXCEPTION 'Reload did not return the saved state for the same enrollment';
  END IF;

  v_second_revision := public.save_my_logbook_html_state(v_instance_a, v_state_b, 1);
  IF v_second_revision <> 2 THEN RAISE EXCEPTION 'Second cloud save should increment revision to 2'; END IF;

  v_read := public.get_my_logbook_html_state(v_instance_b);
  IF (v_read ->> 'revision')::bigint <> 0
     OR v_read -> 'state' = v_state_b
     OR v_read -> 'state' = v_state_a THEN
    RAISE EXCEPTION 'A second enrollment must not inherit the first enrollment HTML state';
  END IF;

  -- Stale writes must not silently overwrite a newer save.
  v_rejected := false;
  BEGIN
    PERFORM public.save_my_logbook_html_state(v_instance_a, v_state_a, 1);
  EXCEPTION WHEN SQLSTATE '40001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Stale revision should have been rejected'; END IF;

  -- The assigned mentor can review a saved item using the separate review audit trail.
  PERFORM set_config('request.jwt.claim.sub', v_mentor::text, true);
  v_review := public.mentor_review_html_logbook_item(
    v_instance_a, 'session-fixture', 'session', 'FEEDBACK', 'Discuss the differential diagnosis.'
  );
  IF v_review ->> 'item_id' <> 'session-fixture'
     OR v_review ->> 'decision' <> 'FEEDBACK'
     OR v_review ->> 'feedback' <> 'Discuss the differential diagnosis.' THEN
    RAISE EXCEPTION 'Mentor item review did not return the saved decision';
  END IF;

  v_review := public.mentor_review_html_logbook_item(
    v_instance_a, 'session-fixture', 'session', 'NEEDS_REVISION', 'Add a clearer clinical reasoning summary.'
  );
  IF v_review ->> 'decision' <> 'NEEDS_REVISION' THEN
    RAISE EXCEPTION 'Second mentor decision was not saved';
  END IF;

  v_reviews := public.get_my_logbook_html_item_reviews(v_instance_a);
  IF jsonb_array_length(v_reviews) <> 1
     OR v_reviews -> 0 ->> 'item_id' <> 'session-fixture'
     OR v_reviews -> 0 ->> 'decision' <> 'NEEDS_REVISION'
     OR v_reviews -> 0 ->> 'feedback' <> 'Add a clearer clinical reasoning summary.' THEN
    RAISE EXCEPTION 'Latest mentor item review did not win deterministic ordering';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.mentor_review_html_logbook_item(
      v_instance_a, 'missing-session', 'session', 'VERIFIED', NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Mentor review should reject an item absent from the saved logbook state'; END IF;

  -- The assigned mentor may read the logbook but cannot modify trainee-owned state.
  v_read := public.get_my_logbook_html_state(v_instance_a);
  IF (v_read ->> 'revision')::bigint <> 2 OR v_read -> 'state' <> v_state_b THEN
    RAISE EXCEPTION 'Assigned mentor could not read the current logbook state';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.save_my_logbook_html_state(v_instance_a, v_state_a, 2);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Assigned mentor must not be able to save trainee state'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_trainee::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.mentor_review_html_logbook_item(
      v_instance_a, 'session-fixture', 'session', 'VERIFIED', NULL
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Trainee must not be able to issue mentor review decisions'; END IF;

  -- Even a platform admin may read a trainee's logbook, but cannot save as that trainee.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.save_my_logbook_html_state(v_instance_a, v_state_a, 2);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Non-trainee writer should have been rejected'; END IF;

  RAISE NOTICE 'HTML state and mentor-review checks passed: save/reload, per-enrollment isolation, revision conflicts, assigned-mentor read-only access, per-item review round-trip, unknown-item rejection, and trainee review denial.';
END
$test$;

ROLLBACK;
