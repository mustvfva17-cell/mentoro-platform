-- Restore the single-current-assignable-version rule for all renderer types.
-- Existing versions remain published for historical offerings/enrollments; only their assignability changes.
CREATE OR REPLACE FUNCTION app_private.admin_publish_logbook_template_version(p_version_id uuid, p_review_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_template_id uuid;
  v_target_template_id uuid;
  v_status text;
  v_schema jsonb;
  v_template_definition jsonb;
  v_source_notes text;
  v_renderer text;
  v_html_path text;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL
     OR length(trim(coalesce(p_review_notes, ''))) < 20
     OR length(p_review_notes) > 4000 THEN
    RAISE EXCEPTION 'A review decision with at least 20 characters is required' USING ERRCODE = '22023';
  END IF;

  -- Lock the parent template before locking any version row. This serializes publication
  -- of two different versions belonging to the same template and avoids cross-version deadlocks.
  SELECT v.template_id INTO v_target_template_id
  FROM public.logbook_template_versions v
  WHERE v.id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template version not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.logbook_templates t
  WHERE t.id = v_target_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent logbook template not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT v.template_id, v.status, v.schema_definition, v.template_definition, v.source_notes
    INTO v_template_id, v_status, v_schema, v_template_definition, v_source_notes
  FROM public.logbook_template_versions v
  WHERE v.id = p_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template version not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_template_id IS DISTINCT FROM v_target_template_id THEN
    RAISE EXCEPTION 'Template version parent changed during publication; retry the review'
      USING ERRCODE = '22023';
  END IF;

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only draft template versions can be published' USING ERRCODE = '22023';
  END IF;

  IF length(trim(coalesce(v_source_notes, ''))) < 20 THEN
    RAISE EXCEPTION 'Add clinical source notes before publication' USING ERRCODE = '22023';
  END IF;

  v_renderer := v_template_definition ->> 'renderer';
  v_html_path := v_template_definition ->> 'html_path';

  IF jsonb_typeof(v_schema) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'A valid schema object is required before publication' USING ERRCODE = '22023';
  END IF;

  IF v_renderer = 'HTML' THEN
    IF v_html_path IS DISTINCT FROM '/logbooks/medical-oncology/index.html' AND v_html_path IS DISTINCT FROM '/logbooks/general-surgery/index.html' THEN
      RAISE EXCEPTION 'This HTML logbook path is not registered as an available MENTORO asset' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF jsonb_typeof(v_schema -> 'fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'A structured schema with fields is required before publication' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_schema -> 'fields') < 1 THEN
      RAISE EXCEPTION 'A structured schema with at least one field is required before publication' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Keep historical versions published for existing references, but stop assigning them to
  -- new offerings. Parent-row locking above serializes this transition across versions.
  UPDATE public.logbook_template_versions
  SET is_assignable = false
  WHERE template_id = v_template_id
    AND id <> p_version_id
    AND is_assignable = true;

  -- The BEFORE trigger validates structured fields or the fixed HTML asset allow-list.
  UPDATE public.logbook_template_versions
  SET status = 'PUBLISHED',
      is_assignable = true,
      published_at = now(),
      published_by = v_actor_id
  WHERE id = p_version_id;

  UPDATE public.logbook_templates
  SET is_active = true
  WHERE id = v_template_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_actor_id, 'LOGBOOK_TEMPLATE_VERSION_PUBLISHED', 'LOGBOOK_TEMPLATE_VERSION', p_version_id,
    jsonb_build_object(
      'template_id', v_template_id,
      'renderer', coalesce(v_renderer, 'JSON'),
      'review_notes', trim(p_review_notes)
    )
  );
END;
$function$;
