-- Rollback-only integration test for the registered General Surgery HTML asset.
-- Run ONLY against mentoro-platform-test or another disposable test database.
-- This script creates a synthetic enrollment and state row, then rolls everything back.
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
  v_loaded jsonb;
  v_state jsonb := jsonb_build_object(
    'sessions', jsonb_build_array(jsonb_build_object('id','gs-session-fixture','focus','Synthetic General Surgery integration test')),
    'cases', jsonb_build_array(),
    'procedures', jsonb_build_array(),
    'roadmap', jsonb_build_object('gs-fixture-topic',true),
    'emergency', jsonb_build_array(),
    'reflection', jsonb_build_object('summary','Synthetic test only')
  );
  v_revision bigint;
  v_denied boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL
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

  SELECT s.id INTO v_specialty FROM public.specialties s WHERE s.slug='general-surgery' AND s.is_active;

  SELECT t.id,v.id INTO v_template,v_version
  FROM public.logbook_templates t
  JOIN public.logbook_template_versions v ON v.template_id=t.id
  WHERE t.slug='general-surgery-html' AND v.version_number=1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL OR v_template IS NULL OR v_version IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active admin, trainee, General Surgery specialty, and seeded HTML template are required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.logbook_template_versions v
    WHERE v.id=v_version AND v.status='DRAFT' AND NOT v.is_assignable
      AND v.template_definition->>'renderer'='HTML'
      AND v.template_definition->>'html_path'='/logbooks/general-surgery/index.html'
  ) THEN
    RAISE EXCEPTION 'General Surgery HTML template must remain an unassignable DRAFT during this integration test.';
  END IF;

  IF v_mentor IS NULL OR v_mentor=v_trainee THEN
    v_mentor:=v_admin;
    INSERT INTO public.mentor_profiles(profile_id,display_name,professional_title,profile_status,is_public)
    VALUES(v_mentor,'Rollback-only General Surgery test mentor','Test fixture','APPROVED',false)
    ON CONFLICT(profile_id) DO NOTHING;
  END IF;

  INSERT INTO public.training_offerings(mentor_profile_id,specialty_id,template_version_id,title,status)
  VALUES(v_mentor,v_specialty,v_version,'Rollback-only General Surgery HTML state test','DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()+interval '7 days',now()+interval '7 days 1 hour',1,'OPEN')
  RETURNING id INTO v_slot;

  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES(v_trainee,v_offering,v_slot,'ADMIN_CONFIRMED',v_admin,now(),v_admin,now())
  RETURNING id INTO v_application;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,
    starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES(
    v_application,v_trainee,v_mentor,v_specialty,v_offering,v_slot,v_version,
    now()+interval '7 days',now()+interval '7 days 1 hour','CONFIRMED',v_admin,now()
  ) RETURNING id INTO v_enrollment;

  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment,v_version) RETURNING id INTO v_instance;

  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  v_loaded:=public.get_my_logbook_html_state(v_instance);
  IF (v_loaded->>'revision')::bigint<>0 OR v_loaded->'state'->'sessions'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Initial General Surgery HTML state should be empty at revision zero';
  END IF;

  v_revision:=public.save_my_logbook_html_state(v_instance,v_state,0);
  IF v_revision<>1 THEN RAISE EXCEPTION 'General Surgery HTML save should create revision one'; END IF;

  v_loaded:=public.get_my_logbook_html_state(v_instance);
  IF (v_loaded->>'revision')::bigint<>1 OR v_loaded->'state'<>v_state THEN
    RAISE EXCEPTION 'General Surgery HTML state did not round-trip';
  END IF;

  IF v_mentor IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub',v_mentor::text,true);
    v_loaded:=public.get_my_logbook_html_state(v_instance);
    IF (v_loaded->>'revision')::bigint<>1 THEN
      RAISE EXCEPTION 'Assigned mentor should be able to read General Surgery state';
    END IF;

    v_denied:=false;
    BEGIN
      PERFORM public.save_my_logbook_html_state(v_instance,v_state,1);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'Assigned mentor must not write trainee-owned General Surgery state'; END IF;
  END IF;

  RAISE NOTICE 'General Surgery HTML integration passed: registered-path read/write, initial empty state, save/reload, and assigned-mentor read-only access. All fixtures roll back.';
END
$test$;

ROLLBACK;
