-- Rollback-only integration test for logbook_entries.payload validation.
-- Run ONLY in mentoro-platform-test (or a disposable test database) using the SQL Editor.
-- The transaction is rolled back at the end; it deliberately creates no persistent fixtures.
BEGIN;

DO $test$
DECLARE
  v_admin uuid;
  v_trainee uuid;
  v_specialty uuid;
  v_mentor uuid;
  v_template uuid;
  v_version uuid;
  v_offering uuid;
  v_slot uuid;
  v_application uuid;
  v_enrollment uuid;
  v_instance uuid;
  v_rejected boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN', 'SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT tp.profile_id INTO v_trainee
  FROM public.trainee_profiles tp
  LIMIT 1;

  SELECT s.id INTO v_specialty
  FROM public.specialties s
  WHERE s.is_active
  LIMIT 1;

  SELECT mp.profile_id INTO v_mentor
  FROM public.mentor_profiles mp
  LIMIT 1;

  IF v_admin IS NULL OR v_trainee IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Test prerequisites missing: need an active admin, a trainee profile, and an active specialty.';
  END IF;

  IF v_mentor IS NULL THEN
    v_mentor := v_admin;
    INSERT INTO public.mentor_profiles(profile_id, display_name, profile_status, is_public)
    VALUES (v_mentor, 'Rollback-only payload validation fixture', 'APPROVED', false);
  END IF;

  INSERT INTO public.logbook_templates(specialty_id, slug, title, description, is_active)
  VALUES (
    v_specialty,
    'payload-test-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'Rollback-only payload validation fixture',
    'Temporary fixture created and removed within the same transaction.',
    false
  ) RETURNING id INTO v_template;

  INSERT INTO public.logbook_template_versions(
    template_id, version_number, status, is_assignable, schema_definition,
    template_definition, source_notes
  ) VALUES (
    v_template, 1, 'DRAFT', false,
    '{"fields":[
      {"key":"clinical_context","label":"Clinical context","type":"textarea","required":true,"maxLength":80},
      {"key":"case_count","label":"Case count","type":"number","required":true,"min":0,"max":20},
      {"key":"emergency_seen","label":"Emergency case seen","type":"boolean","required":true},
      {"key":"case_category","label":"Case category","type":"select","required":true,"options":["Medical","Surgical"]},
      {"key":"activity_date","label":"Activity date","type":"date","required":true}
    ]}'::jsonb,
    '{"sections":[{"id":"fixture","title":"Fixture"}]}'::jsonb,
    'Rollback-only synthetic schema test; not clinical content.'
  ) RETURNING id INTO v_version;

  INSERT INTO public.training_offerings(mentor_profile_id, specialty_id, template_version_id, title, status)
  VALUES (v_mentor, v_specialty, v_version, 'Rollback-only payload validation offering', 'DRAFT')
  RETURNING id INTO v_offering;

  INSERT INTO public.training_slots(offering_id, starts_at, ends_at, capacity, status)
  VALUES (v_offering, now() + interval '7 days', now() + interval '7 days 1 hour', 1, 'OPEN')
  RETURNING id INTO v_slot;

  INSERT INTO public.training_applications(
    trainee_profile_id, offering_id, slot_id, status,
    mentor_decision_by, mentor_decided_at, admin_decision_by, admin_decided_at
  ) VALUES (
    v_trainee, v_offering, v_slot, 'ADMIN_CONFIRMED',
    v_admin, now(), v_admin, now()
  ) RETURNING id INTO v_application;

  INSERT INTO public.training_enrollments(
    source_application_id, trainee_profile_id, mentor_profile_id, specialty_id,
    offering_id, slot_id, template_version_id, starts_at, ends_at,
    status, confirmed_by, confirmed_at
  ) VALUES (
    v_application, v_trainee, v_mentor, v_specialty, v_offering, v_slot, v_version,
    now() + interval '7 days', now() + interval '7 days 1 hour',
    'CONFIRMED', v_admin, now()
  ) RETURNING id INTO v_enrollment;

  INSERT INTO public.logbook_instances(enrollment_id, template_version_id)
  VALUES (v_enrollment, v_version)
  RETURNING id INTO v_instance;

  -- Positive case: explicit false is a valid boolean answer.
  INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
  VALUES (
    v_instance, 'LEARNING_ACTIVITY', 'Valid payload fixture', current_date,
    '{"clinical_context":"Observed a supervised consultation","case_count":3,"emergency_seen":false,"case_category":"Surgical","activity_date":"2026-10-28"}'::jsonb,
    'DRAFT', v_trainee
  );

  -- Missing required field must be rejected.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Missing-required rejection', current_date,
      '{"case_count":3,"emergency_seen":false,"case_category":"Surgical","activity_date":"2026-10-28"}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject a missing required field'; END IF;

  -- An unlisted select value must be rejected.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Invalid-select rejection', current_date,
      '{"clinical_context":"Observed a supervised consultation","case_count":3,"emergency_seen":false,"case_category":"Obstetrics","activity_date":"2026-10-28"}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject an unlisted select option'; END IF;

  -- Keys not in the attached template must be rejected.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Unknown-field rejection', current_date,
      '{"clinical_context":"Observed a supervised consultation","case_count":3,"emergency_seen":false,"case_category":"Surgical","activity_date":"2026-10-28","admin_override":true}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject an unknown field key'; END IF;

  -- JSON strings cannot be substituted for typed booleans.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Invalid-type rejection', current_date,
      '{"clinical_context":"Observed a supervised consultation","case_count":3,"emergency_seen":"false","case_category":"Surgical","activity_date":"2026-10-28"}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject an invalid boolean type'; END IF;

  -- Numeric bounds must be enforced by the database, not only by HTML input attributes.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Out-of-range rejection', current_date,
      '{"clinical_context":"Observed a supervised consultation","case_count":21,"emergency_seen":false,"case_category":"Surgical","activity_date":"2026-10-28"}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject a number outside the configured range'; END IF;

  -- Calendar validity must be checked, not only the YYYY-MM-DD shape.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (v_instance, 'LEARNING_ACTIVITY', 'Invalid-date rejection', current_date,
      '{"clinical_context":"Observed a supervised consultation","case_count":3,"emergency_seen":false,"case_category":"Surgical","activity_date":"2026-02-30"}'::jsonb,
      'DRAFT', v_trainee);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject an impossible calendar date'; END IF;

  -- Very large client payloads must be rejected at the database boundary.
  v_rejected := false;
  BEGIN
    INSERT INTO public.logbook_entries(instance_id, entry_type, title, entry_date, payload, status, created_by)
    VALUES (
      v_instance, 'LEARNING_ACTIVITY', 'Oversized-payload rejection', current_date,
      jsonb_build_object('clinical_context', repeat('x', 70000)),
      'DRAFT', v_trainee
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Payload validation did not reject a payload larger than 64 KiB'; END IF;

  RAISE NOTICE 'Payload validation passed: valid entry accepted; missing, unknown, wrong-type, invalid select/date, out-of-range number, and oversized payloads rejected.';
END
$test$;

ROLLBACK;
