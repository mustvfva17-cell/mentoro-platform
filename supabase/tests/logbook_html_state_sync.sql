-- Rollback-only integration test for the registered HTML logbook state RPCs.
-- Run ONLY in mentoro-platform-test (or another disposable test database) from SQL Editor.
-- All synthetic template/training rows and HTML state writes are rolled back at the end.
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
  v_state jsonb := '{"sessions":[{"id":"fixture-session","title":"Temporary test session"}],"cases":[],"procedures":[],"roadmap":{"test-item":"done"},"emergency":[],"reflection":{}}'::jsonb;
  v_revision bigint;
  v_denied boolean;
  v_conflicted boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT tp.profile_id INTO v_trainee FROM public.trainee_profiles tp LIMIT 1;
  SELECT mp.profile_id INTO v_mentor FROM public.mentor_profiles mp LIMIT 1;
  SELECT s.id INTO v_specialty FROM public.specialties s WHERE s.is_active LIMIT 1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Test prerequisites missing: need admin, trainee, and active specialty';
  END IF;

  IF v_mentor IS NULL OR v_mentor = v_trainee THEN
    v_mentor := v_admin;
    IF NOT EXISTS (SELECT 1 FROM public.mentor_profiles WHERE profile_id=v_mentor) THEN
      INSERT INTO public.mentor_profiles(profile_id,display_name,profile_status,is_public)
      VALUES (v_mentor,'Rollback-only HTML state fixture','APPROVED',false);
    END IF;
  END IF;

  INSERT INTO public.logbook_templates(specialty_id,slug,title,description,is_active)
  VALUES (v_specialty,'html-state-test-'||substr(replace(gen_random_uuid()::text,'-',''),1,12),
    'Rollback-only HTML state sync fixture','Temporary integration test only.',false)
  RETURNING id INTO v_template;

  INSERT INTO public.logbook_template_versions(template_id,version_number,status,is_assignable,schema_definition,template_definition,source_notes)
  VALUES (
    v_template,1,'DRAFT',false,
    '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
    '{"renderer":"HTML","html_path":"/logbooks/medical-oncology/index.html","source":"Rollback-only test fixture","sections":["Sessions","Cases"]}'::jsonb,
    'Rollback-only HTML state integration test; not clinical content.'
  ) RETURNING id INTO v_version;

  INSERT INTO public.training_offerings(mentor_profile_id,specialty_id,template_version_id,title,status)
  VALUES (v_mentor,v_specialty,v_version,'Rollback-only HTML state fixture','DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()+interval '7 days',now()+interval '7 days 1 hour',1,'OPEN')
  RETURNING id INTO v_slot;

  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES (v_trainee,v_offering,v_slot,'ADMIN_CONFIRMED',v_admin,now(),v_admin,now())
  RETURNING id INTO v_application;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,
    starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES (
    v_application,v_trainee,v_mentor,v_specialty,v_offering,v_slot,v_version,
    now()+interval '7 days',now()+interval '7 days 1 hour','CONFIRMED',v_admin,now()
  ) RETURNING id INTO v_enrollment;

  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment,v_version) RETURNING id INTO v_instance;

  -- The assigned trainee sees an empty instance-scoped state at revision zero.
  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  v_loaded := public.get_my_logbook_html_state(v_instance);
  IF COALESCE((v_loaded->>'revision')::bigint,-1) <> 0 OR v_loaded->'state'->'sessions' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Initial trainee HTML logbook state was not empty at revision zero';
  END IF;

  -- First save creates revision 1; second save requires the matching revision.
  v_revision := public.save_my_logbook_html_state(v_instance,v_state,0);
  IF v_revision <> 1 THEN RAISE EXCEPTION 'Expected first revision 1, got %',v_revision; END IF;
  v_loaded := public.get_my_logbook_html_state(v_instance);
  IF v_loaded->'state' <> v_state OR (v_loaded->>'revision')::bigint <> 1 THEN
    RAISE EXCEPTION 'Saved state did not round-trip for the assigned trainee';
  END IF;
  v_revision := public.save_my_logbook_html_state(v_instance,v_state||'{"reflection":{"summary":"second revision"}}'::jsonb,1);
  IF v_revision <> 2 THEN RAISE EXCEPTION 'Expected second revision 2, got %',v_revision; END IF;

  -- A stale writer must get a conflict rather than overwrite the newer revision.
  v_conflicted := false;
  BEGIN
    PERFORM public.save_my_logbook_html_state(v_instance,v_state,1);
  EXCEPTION WHEN SQLSTATE '40001' THEN v_conflicted := true;
  END;
  IF NOT v_conflicted THEN RAISE EXCEPTION 'Stale HTML logbook revision was not rejected'; END IF;

  -- The assigned mentor may read but may not save the trainee's HTML state.
  PERFORM set_config('request.jwt.claim.sub',v_mentor::text,true);
  v_loaded := public.get_my_logbook_html_state(v_instance);
  IF (v_loaded->>'revision')::bigint <> 2 THEN RAISE EXCEPTION 'Assigned mentor could not read the latest state'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.save_my_logbook_html_state(v_instance,v_state,2);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Assigned mentor was incorrectly allowed to save trainee HTML state'; END IF;

  RAISE NOTICE 'HTML state RPC integration passed: trainee save/load, monotonic revision, stale-write conflict, mentor read-only access. All rows will be rolled back.';
END
$test$;

ROLLBACK;
