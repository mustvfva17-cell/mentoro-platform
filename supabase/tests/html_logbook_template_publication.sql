-- Rollback-only integration test for publication of all registered HTML logbook runtimes.
-- Run only on mentoro-platform-test. Every fixture and audit row is rolled back.
BEGIN;

DO $test$
DECLARE
  v_admin uuid;
  v_specialty uuid;
  v_template uuid;
  v_version uuid;
  v_path text;
  v_rejected boolean;
  v_bad_template uuid;
  v_bad_version uuid;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL
  LIMIT 1;

  SELECT s.id INTO v_specialty
  FROM public.specialties s
  WHERE s.is_active = true
  ORDER BY s.slug
  LIMIT 1;

  IF v_admin IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active platform admin and specialty are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin::text)::text, true);

  FOREACH v_path IN ARRAY ARRAY[
    '/logbooks/medical-oncology/index.html',
    '/logbooks/general-surgery/index.html',
    '/logbooks/cardiology/index.html',
    '/logbooks/neurology/index.html',
    '/logbooks/pediatrics/index.html',
    '/logbooks/anesthesia-icu/index.html'
  ]
  LOOP
    INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
    VALUES (
      v_specialty,
      'html-publication-test-' || replace(gen_random_uuid()::text, '-', ''),
      'Rollback-only HTML publication fixture',
      'Synthetic test fixture. No clinical content or real trainee data.',
      false
    )
    RETURNING id INTO v_template;

    INSERT INTO public.logbook_template_versions (
      template_id, version_number, status, is_assignable,
      schema_definition, template_definition, source_notes
    )
    VALUES (
      v_template,
      1,
      'DRAFT',
      false,
      jsonb_build_object('type', 'object', 'additionalProperties', false),
      jsonb_build_object(
        'renderer', 'HTML',
        'html_path', v_path,
        'sections', jsonb_build_array('Sessions', 'Clinical Cases'),
        'clinical_review_required', true
      ),
      'Synthetic owner-provided source fixture for a rollback-only test.'
    )
    RETURNING id INTO v_version;

    PERFORM public.admin_publish_logbook_template_version(
      v_version,
      'Synthetic rollback-only test review; not a clinical approval.'
    );

    IF NOT EXISTS (
      SELECT 1 FROM public.logbook_template_versions
      WHERE id = v_version AND status = 'PUBLISHED' AND is_assignable = true
    ) THEN
      RAISE EXCEPTION 'Registered HTML template was not published and made assignable: %', v_path;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.logbook_templates
      WHERE id = v_template AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Parent template was not activated after publication: %', v_path;
    END IF;
  END LOOP;

  -- Unknown HTML routes must remain unpublishable even when an admin supplies review notes.
  INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
  VALUES (
    v_specialty,
    'html-publication-invalid-path-' || replace(gen_random_uuid()::text, '-', ''),
    'Invalid HTML path fixture',
    'Synthetic negative fixture.',
    false
  )
  RETURNING id INTO v_bad_template;

  INSERT INTO public.logbook_template_versions (
    template_id, version_number, status, is_assignable,
    schema_definition, template_definition, source_notes
  )
  VALUES (
    v_bad_template, 1, 'DRAFT', false,
    jsonb_build_object('type', 'object', 'additionalProperties', false),
    jsonb_build_object(
      'renderer', 'HTML',
      'html_path', '/logbooks/not-registered/index.html',
      'sections', jsonb_build_array('Sessions')
    ),
    'Synthetic invalid-path fixture for a rollback-only test.'
  )
  RETURNING id INTO v_bad_version;

  v_rejected := false;
  BEGIN
    PERFORM public.admin_publish_logbook_template_version(
      v_bad_version,
      'Synthetic negative review fixture; must not publish.'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An unregistered HTML path was incorrectly allowed to publish';
  END IF;

  -- Registered paths without usable sections must also fail closed.
  UPDATE public.logbook_template_versions
  SET template_definition = jsonb_build_object(
    'renderer', 'HTML',
    'html_path', '/logbooks/pediatrics/index.html',
    'sections', jsonb_build_array('', 'Clinical Cases')
  )
  WHERE id = v_bad_version;

  -- The draft update is allowed; publication is not.
  v_rejected := false;
  BEGIN
    PERFORM public.admin_publish_logbook_template_version(
      v_bad_version,
      'Synthetic negative section fixture; must not publish.'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An HTML runtime with invalid section metadata was incorrectly allowed to publish';
  END IF;

  RAISE NOTICE 'HTML publication passed: six registered paths publish without JSON fields; unregistered or malformed HTML runtimes remain blocked.';
END
$test$;

ROLLBACK;
