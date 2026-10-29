-- Rollback-only integration test for the enrollment lifecycle and post-close logbook guards.
-- Run ONLY on mentoro-platform-test or another disposable database.
BEGIN;

DO $test$
DECLARE
  v_admin uuid;
  v_trainee uuid;
  v_mentor uuid := gen_random_uuid();
  v_mentor_email text := 'lifecycle-mentor-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid';
  v_specialty uuid;
  v_template uuid;
  v_version uuid;
  v_offering uuid;
  v_slot_a uuid;
  v_slot_b uuid;
  v_slot_c uuid;
  v_app_a uuid;
  v_app_b uuid;
  v_app_c uuid;
  v_enrollment_a uuid;
  v_enrollment_b uuid;
  v_enrollment_c uuid;
  v_instance_a uuid;
  v_instance_b uuid;
  v_instance_c uuid;
  v_entry_id uuid;
  v_result jsonb;
  v_rejected boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN', 'SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT tp.profile_id INTO v_trainee
  FROM public.trainee_profiles tp
  JOIN public.profile_roles r ON r.user_id = tp.profile_id
  WHERE r.role = 'TRAINEE' AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT s.id INTO v_specialty
  FROM public.specialties s WHERE s.is_active LIMIT 1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active admin, trainee and specialty are required';
  END IF;

  -- The dedicated test Mentor is fully transactional and has no real training history.
  INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(v_mentor,v_mentor_email,now(),jsonb_build_object('full_name','Lifecycle Test Mentor'),now(),now(),false,false);
  INSERT INTO public.profiles(id,email,full_name)
  VALUES(v_mentor,v_mentor_email,'Lifecycle Test Mentor');
  INSERT INTO public.profile_roles(user_id,role,granted_by)
  VALUES(v_mentor,'MENTOR',v_admin);
  INSERT INTO public.mentor_profiles(profile_id,display_name,professional_title,profile_status,is_public)
  VALUES(v_mentor,'Lifecycle Test Mentor','Test fixture','APPROVED',false);

  INSERT INTO public.logbook_templates(specialty_id,slug,title,description,is_active)
  VALUES(v_specialty,'lifecycle-test-'||replace(gen_random_uuid()::text,'-',''),
    'Rollback-only lifecycle template','Synthetic fixture for the lifecycle integration test.',false)
  RETURNING id INTO v_template;

  INSERT INTO public.logbook_template_versions(
    template_id,version_number,status,is_assignable,schema_definition,template_definition,source_notes
  ) VALUES (
    v_template,1,'DRAFT',false,
    jsonb_build_object('$schema','https://json-schema.org/draft/2020-12/schema','type','object',
      'fields',jsonb_build_array(jsonb_build_object('key','clinical_context','label','Clinical context','type','textarea','required',false))),
    jsonb_build_object('renderer','JSON'),
    'Synthetic lifecycle integration fixture only; not approved as a clinical logbook.'
  ) RETURNING id INTO v_version;

  INSERT INTO public.training_offerings(mentor_profile_id,specialty_id,template_version_id,title,status)
  VALUES(v_mentor,v_specialty,v_version,'Rollback-only lifecycle offering','DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()-interval '1 hour',now()+interval '1 hour',1,'CLOSED')
  RETURNING id INTO v_slot_a;
  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()-interval '3 hours',now()-interval '2 hours',1,'CLOSED')
  RETURNING id INTO v_slot_b;
  INSERT INTO public.training_slots(offering_id,starts_at,ends_at,capacity,status)
  VALUES(v_offering,now()+interval '1 hour',now()+interval '2 hours',1,'CLOSED')
  RETURNING id INTO v_slot_c;

  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES(v_trainee,v_offering,v_slot_a,'ADMIN_CONFIRMED',v_mentor,now(),v_admin,now())
  RETURNING id INTO v_app_a;
  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES(v_trainee,v_offering,v_slot_b,'ADMIN_CONFIRMED',v_mentor,now(),v_admin,now())
  RETURNING id INTO v_app_b;
  INSERT INTO public.training_applications(
    trainee_profile_id,offering_id,slot_id,status,mentor_decision_by,mentor_decided_at,admin_decision_by,admin_decided_at
  ) VALUES(v_trainee,v_offering,v_slot_c,'ADMIN_CONFIRMED',v_mentor,now(),v_admin,now())
  RETURNING id INTO v_app_c;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,
    starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES (
    v_app_a,v_trainee,v_mentor,v_specialty,v_offering,v_slot_a,v_version,
    now()-interval '1 hour',now()+interval '1 hour','CONFIRMED',v_admin,now()
  ) RETURNING id INTO v_enrollment_a;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,
    starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES (
    v_app_b,v_trainee,v_mentor,v_specialty,v_offering,v_slot_b,v_version,
    now()-interval '3 hours',now()-interval '2 hours','ACTIVE',v_admin,now()
  ) RETURNING id INTO v_enrollment_b;

  INSERT INTO public.training_enrollments(
    source_application_id,trainee_profile_id,mentor_profile_id,specialty_id,offering_id,slot_id,template_version_id,
    starts_at,ends_at,status,confirmed_by,confirmed_at
  ) VALUES (
    v_app_c,v_trainee,v_mentor,v_specialty,v_offering,v_slot_c,v_version,
    now()+interval '1 hour',now()+interval '2 hours','CONFIRMED',v_admin,now()
  ) RETURNING id INTO v_enrollment_c;

  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment_a,v_version) RETURNING id INTO v_instance_a;
  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment_b,v_version) RETURNING id INTO v_instance_b;
  INSERT INTO public.logbook_instances(enrollment_id,template_version_id)
  VALUES(v_enrollment_c,v_version) RETURNING id INTO v_instance_c;

  -- Assigned Mentor can start a confirmed enrollment only inside its scheduled window.
  PERFORM set_config('request.jwt.claim.sub',v_mentor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_mentor::text)::text,true);
  v_result := public.transition_my_training_enrollment(v_enrollment_a,'START',NULL);
  IF v_result->>'status'<>'ACTIVE' OR v_result->>'previous_status'<>'CONFIRMED' THEN
    RAISE EXCEPTION 'Starting confirmed training returned an unexpected transition result';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_a AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Confirmed enrollment was not changed to ACTIVE';
  END IF;

  -- Completing before the scheduled end is rejected and leaves state unchanged.
  v_rejected:=false;
  BEGIN
    PERFORM public.transition_my_training_enrollment(v_enrollment_a,'COMPLETE',NULL);
    RAISE EXCEPTION 'TEST_FAILED: early completion was accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR NOT EXISTS(SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_a AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Early completion was not safely rejected';
  END IF;

  -- Scheduled future training cannot start early.
  v_rejected:=false;
  BEGIN
    PERFORM public.transition_my_training_enrollment(v_enrollment_c,'START',NULL);
    RAISE EXCEPTION 'TEST_FAILED: future training was started early' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR NOT EXISTS(SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_c AND status='CONFIRMED') THEN
    RAISE EXCEPTION 'Future training start was not safely rejected';
  END IF;

  -- Trainee identity cannot transition training, including an enrollment they attend.
  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_trainee::text)::text,true);
  v_rejected:=false;
  BEGIN
    PERFORM public.transition_my_training_enrollment(v_enrollment_c,'CANCEL','Requested by test trainee');
    RAISE EXCEPTION 'TEST_FAILED: trainee changed enrollment lifecycle' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Trainee lifecycle change was not denied'; END IF;

  -- A draft entry can be created and submitted while its enrollment is open.
  INSERT INTO public.logbook_entries(instance_id,entry_type,title,entry_date,payload,status,created_by)
  VALUES(v_instance_a,'LEARNING_ACTIVITY','Open enrollment synthetic entry',current_date,
    jsonb_build_object('clinical_context','Synthetic non-clinical test data'),'DRAFT',v_trainee)
  RETURNING id INTO v_entry_id;
  PERFORM public.set_logbook_entry_submitted(v_trainee,v_entry_id);
  IF NOT EXISTS(SELECT 1 FROM public.logbook_entries WHERE id=v_entry_id AND status='SUBMITTED') THEN
    RAISE EXCEPTION 'A logbook entry in an open enrollment could not be submitted';
  END IF;

  -- Admin can cancel a future confirmed enrollment, with a meaningful reason.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin::text)::text,true);
  v_rejected:=false;
  BEGIN
    PERFORM public.transition_my_training_enrollment(v_enrollment_c,'CANCEL','');
    RAISE EXCEPTION 'TEST_FAILED: cancellation without a reason was accepted' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Cancellation reason requirement was not enforced'; END IF;

  v_result := public.transition_my_training_enrollment(v_enrollment_c,'CANCEL','Synthetic schedule cancellation');
  IF v_result->>'status'<>'CANCELLED' OR NOT EXISTS(
    SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_c AND status='CANCELLED' AND cancelled_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Admin cancellation was not persisted with cancelled_at'; END IF;

  -- A completed enrollment becomes read-only and cannot be cancelled again.
  PERFORM set_config('request.jwt.claim.sub',v_mentor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_mentor::text)::text,true);
  v_result := public.transition_my_training_enrollment(v_enrollment_b,'COMPLETE',NULL);
  IF v_result->>'status'<>'COMPLETED' OR NOT EXISTS(
    SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_b AND status='COMPLETED' AND completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Expired active training was not completed with completed_at'; END IF;

  v_rejected:=false;
  BEGIN
    PERFORM public.transition_my_training_enrollment(v_enrollment_b,'CANCEL','Not allowed after completion');
    RAISE EXCEPTION 'TEST_FAILED: completed enrollment was cancelled' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Completed enrollment accepted a terminal-state reversal'; END IF;

  -- Assigned Mentor can cancel an active enrollment, but must provide a reason.
  v_result := public.transition_my_training_enrollment(v_enrollment_a,'CANCEL','Synthetic mentor cancellation after disruption');
  IF v_result->>'status'<>'CANCELLED' OR NOT EXISTS(
    SELECT 1 FROM public.training_enrollments WHERE id=v_enrollment_a AND status='CANCELLED' AND cancelled_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Assigned Mentor could not cancel active training with a reason'; END IF;

  -- Direct entry writes are blocked after cancellation/completion even when using a privileged SQL session.
  PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_trainee::text)::text,true);
  v_rejected:=false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id,entry_type,title,entry_date,payload,status,created_by)
    VALUES(v_instance_b,'LEARNING_ACTIVITY','Must be blocked after completion',current_date,
      jsonb_build_object('clinical_context','Synthetic non-clinical test data'),'DRAFT',v_trainee);
    RAISE EXCEPTION 'TEST_FAILED: draft inserted into completed enrollment' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Completed enrollment still accepted draft writes'; END IF;

  v_rejected:=false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id,entry_type,title,entry_date,payload,status,created_by)
    VALUES(v_instance_c,'LEARNING_ACTIVITY','Must be blocked after cancellation',current_date,
      jsonb_build_object('clinical_context','Synthetic non-clinical test data'),'DRAFT',v_trainee);
    RAISE EXCEPTION 'TEST_FAILED: draft inserted into cancelled enrollment' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Cancelled enrollment still accepted draft writes'; END IF;

  v_rejected:=false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id,entry_type,title,entry_date,payload,status,created_by)
    VALUES(v_instance_a,'LEARNING_ACTIVITY','Must be blocked after mentor cancellation',current_date,
      jsonb_build_object('clinical_context','Synthetic non-clinical test data'),'DRAFT',v_trainee);
    RAISE EXCEPTION 'TEST_FAILED: draft inserted into mentor-cancelled enrollment' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE '55000' THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Mentor-cancelled enrollment still accepted draft writes'; END IF;

  IF (SELECT count(*) FROM public.audit_logs
      WHERE entity_type='TRAINING_ENROLLMENT'
        AND entity_id IN (v_enrollment_a,v_enrollment_b,v_enrollment_c)
        AND action IN ('TRAINING_ENROLLMENT_STARTED','TRAINING_ENROLLMENT_COMPLETED','TRAINING_ENROLLMENT_CANCELLED')) <> 4 THEN
    RAISE EXCEPTION 'Expected four audited enrollment lifecycle transitions';
  END IF;

  RAISE NOTICE 'Enrollment lifecycle passed: role checks, scheduled start/end guards, required cancellation reason, timestamps, audit log, and read-only structured logbooks after closure.';
END
$test$;

ROLLBACK;
