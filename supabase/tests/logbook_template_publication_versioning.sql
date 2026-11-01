-- Rollback-only integration test for single-assignable-version publication.
-- Run only on mentoro-platform-test; the synthetic template, versions, and audit row are rolled back.
BEGIN;
DO $test$
DECLARE
  v_admin uuid;
  v_specialty uuid;
  v_template uuid;
  v_old_version uuid;
  v_new_version uuid;
  v_assignable_count integer;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL LIMIT 1;
  SELECT id INTO v_specialty FROM public.specialties WHERE is_active LIMIT 1;
  IF v_admin IS NULL OR v_specialty IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active platform admin and specialty are required';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin::text)::text,true);

  INSERT INTO public.logbook_templates(specialty_id,slug,title,description,is_active)
  VALUES(v_specialty,'publication-test-'||replace(gen_random_uuid()::text,'-',''),
    'Rollback-only publication fixture','Synthetic fixture; never a clinical template.',false)
  RETURNING id INTO v_template;

  INSERT INTO public.logbook_template_versions(
    template_id,version_number,status,is_assignable,schema_definition,template_definition,
    source_notes,published_at,published_by
  ) VALUES (
    v_template,1,'PUBLISHED',true,
    jsonb_build_object('$schema','https://json-schema.org/draft/2020-12/schema','type','object',
      'fields',jsonb_build_array(jsonb_build_object('key','field_one','label','Field one','type','text'))),
    jsonb_build_object('renderer','JSON'),
    'Synthetic prior publication fixture used only by this rollback-only integration test.',
    now(),v_admin
  ) RETURNING id INTO v_old_version;

  INSERT INTO public.logbook_template_versions(
    template_id,version_number,status,is_assignable,schema_definition,template_definition,source_notes
  ) VALUES (
    v_template,2,'DRAFT',false,
    jsonb_build_object('$schema','https://json-schema.org/draft/2020-12/schema','type','object',
      'fields',jsonb_build_array(jsonb_build_object('key','field_one','label','Field one','type','text'))),
    jsonb_build_object('renderer','JSON'),
    'Synthetic next-version fixture; not clinically approved and rolled back after test.'
  ) RETURNING id INTO v_new_version;

  PERFORM public.admin_publish_logbook_template_version(
    v_new_version,'Synthetic review note for versioning invariant verification only.'
  );

  IF NOT EXISTS(
    SELECT 1 FROM public.logbook_template_versions
    WHERE id=v_old_version AND status='PUBLISHED' AND is_assignable=false
  ) THEN RAISE EXCEPTION 'Older published version was incorrectly made non-published or remained assignable'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.logbook_template_versions
    WHERE id=v_new_version AND status='PUBLISHED' AND is_assignable=true
  ) THEN RAISE EXCEPTION 'New version was not published and made assignable'; END IF;

  SELECT count(*)::integer INTO v_assignable_count
  FROM public.logbook_template_versions WHERE template_id=v_template AND is_assignable=true;
  IF v_assignable_count<>1 THEN RAISE EXCEPTION 'Expected exactly one assignable version, found %',v_assignable_count; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.logbook_templates WHERE id=v_template AND is_active=true)
  THEN RAISE EXCEPTION 'Template was not activated by the test publication'; END IF;

  RAISE NOTICE 'Publication versioning passed: old history preserved, one current version assignable, parent lock applied.';
END
$test$;
ROLLBACK;
