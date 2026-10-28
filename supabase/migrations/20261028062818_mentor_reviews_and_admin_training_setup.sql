CREATE OR REPLACE FUNCTION app_private.is_assigned_mentor_for_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_mentor() AND EXISTS (
    SELECT 1
    FROM public.logbook_entries le
    JOIN public.logbook_instances i ON i.id = le.instance_id
    JOIN public.training_enrollments e ON e.id = i.enrollment_id
    WHERE le.id = p_entry_id AND e.mentor_profile_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION app_private.is_assigned_mentor_for_entry(uuid) TO authenticated;

CREATE POLICY entry_reviews_insert_assigned_mentor ON public.entry_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_profile_id = (SELECT auth.uid())
    AND app_private.is_assigned_mentor_for_entry(entry_id)
    AND EXISTS (
      SELECT 1 FROM public.logbook_entries le
      WHERE le.id = entry_id AND le.status = 'SUBMITTED'
    )
  );
GRANT INSERT (entry_id, reviewer_profile_id, decision, feedback)
  ON public.entry_reviews TO authenticated;

CREATE OR REPLACE FUNCTION app_private.audit_entry_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'MENTOR_ENTRY_REVIEW_' || NEW.decision,
    'LOGBOOK_ENTRY',
    NEW.entry_id,
    jsonb_build_object('review_id', NEW.id, 'decision', NEW.decision)
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.audit_entry_review() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER entry_review_audit
AFTER INSERT ON public.entry_reviews
FOR EACH ROW EXECUTE FUNCTION app_private.audit_entry_review();

CREATE OR REPLACE FUNCTION app_private.admin_register_mentor(
  p_mentor_profile_id uuid,
  p_display_name text,
  p_professional_title text,
  p_institution text,
  p_bio text,
  p_make_public boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_mentor_profile_id) THEN
    RAISE EXCEPTION 'Mentor must first have an authenticated MENTORO profile';
  END IF;

  INSERT INTO public.profile_roles (user_id, role, granted_by)
  VALUES (p_mentor_profile_id, 'MENTOR', v_actor_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.mentor_profiles (
    profile_id, display_name, professional_title, institution, bio, profile_status, is_public
  ) VALUES (
    p_mentor_profile_id, nullif(trim(p_display_name), ''),
    nullif(trim(p_professional_title), ''), nullif(trim(p_institution), ''),
    nullif(trim(p_bio), ''), 'APPROVED', coalesce(p_make_public, false)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    professional_title = EXCLUDED.professional_title,
    institution = EXCLUDED.institution,
    bio = EXCLUDED.bio,
    profile_status = 'APPROVED',
    is_public = EXCLUDED.is_public,
    updated_at = now();

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id)
  VALUES (v_actor_id, 'MENTOR_PROFILE_REGISTERED', 'MENTOR_PROFILE', p_mentor_profile_id);

  RETURN p_mentor_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_register_mentor(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_register_mentor(uuid, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_register_mentor(
  p_mentor_profile_id uuid,
  p_display_name text,
  p_professional_title text,
  p_institution text,
  p_bio text,
  p_make_public boolean DEFAULT false
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_register_mentor(
    p_mentor_profile_id, p_display_name, p_professional_title, p_institution, p_bio, p_make_public
  );
$$;
REVOKE ALL ON FUNCTION public.admin_register_mentor(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_mentor(uuid, text, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_create_training_offering(
  p_mentor_profile_id uuid,
  p_specialty_id uuid,
  p_template_version_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text DEFAULT 'IN_PERSON',
  p_publish boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_status text := CASE WHEN p_publish THEN 'PUBLISHED' ELSE 'DRAFT' END;
  v_offering_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_delivery_mode NOT IN ('IN_PERSON', 'ONLINE', 'HYBRID') THEN
    RAISE EXCEPTION 'Unsupported delivery mode';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mentor_profiles mp
    JOIN public.profile_roles r ON r.user_id = mp.profile_id
    WHERE mp.profile_id = p_mentor_profile_id
      AND r.role = 'MENTOR' AND r.revoked_at IS NULL
      AND mp.profile_status = 'APPROVED'
      AND (NOT p_publish OR mp.is_public = true)
  ) THEN
    RAISE EXCEPTION 'Mentor profile is not approved for this offering';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.logbook_template_versions tv
    JOIN public.logbook_templates t ON t.id = tv.template_id
    WHERE tv.id = p_template_version_id
      AND t.specialty_id = p_specialty_id
      AND (NOT p_publish OR (tv.status = 'PUBLISHED' AND tv.is_assignable = true AND t.is_active = true))
  ) THEN
    RAISE EXCEPTION 'Template must match the specialty and be assignable before publishing an offering';
  END IF;

  INSERT INTO public.training_offerings (
    mentor_profile_id, specialty_id, template_version_id, title, description, delivery_mode, status
  ) VALUES (
    p_mentor_profile_id, p_specialty_id, p_template_version_id,
    trim(p_title), nullif(trim(p_description), ''), p_delivery_mode, v_status
  )
  RETURNING id INTO v_offering_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'TRAINING_OFFERING_CREATED', 'TRAINING_OFFERING', v_offering_id,
          jsonb_build_object('status', v_status, 'specialty_id', p_specialty_id,
                             'template_version_id', p_template_version_id));

  RETURN v_offering_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_create_training_offering(uuid, uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_create_training_offering(uuid, uuid, uuid, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_training_offering(
  p_mentor_profile_id uuid,
  p_specialty_id uuid,
  p_template_version_id uuid,
  p_title text,
  p_description text,
  p_delivery_mode text DEFAULT 'IN_PERSON',
  p_publish boolean DEFAULT false
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_create_training_offering(
    p_mentor_profile_id, p_specialty_id, p_template_version_id,
    p_title, p_description, p_delivery_mode, p_publish
  );
$$;
REVOKE ALL ON FUNCTION public.admin_create_training_offering(uuid, uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_training_offering(uuid, uuid, uuid, text, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_create_training_slot(
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_slot_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_capacity < 1 OR p_ends_at <= p_starts_at OR p_starts_at <= now() THEN
    RAISE EXCEPTION 'Slot dates and capacity are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.training_offerings o
    WHERE o.id = p_offering_id AND o.status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'Only a published offering can receive bookable slots';
  END IF;

  INSERT INTO public.training_slots (offering_id, starts_at, ends_at, capacity, status)
  VALUES (p_offering_id, p_starts_at, p_ends_at, p_capacity, 'OPEN')
  RETURNING id INTO v_slot_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'TRAINING_SLOT_CREATED', 'TRAINING_SLOT', v_slot_id,
          jsonb_build_object('offering_id', p_offering_id, 'capacity', p_capacity));

  RETURN v_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_create_training_slot(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_create_training_slot(uuid, timestamptz, timestamptz, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_training_slot(
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity integer DEFAULT 1
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_create_training_slot(p_offering_id, p_starts_at, p_ends_at, p_capacity);
$$;
REVOKE ALL ON FUNCTION public.admin_create_training_slot(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_training_slot(uuid, timestamptz, timestamptz, integer) TO authenticated;

