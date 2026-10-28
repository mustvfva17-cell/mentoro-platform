-- Keep mentor registration restricted to a separate, confirmed account with no trainee history.
-- The UI checks are helpful, but the database must enforce the same boundary for direct RPC callers.
CREATE OR REPLACE FUNCTION app_private.admin_register_mentor(
  p_mentor_profile_id uuid,
  p_display_name text,
  p_professional_title text,
  p_institution text,
  p_bio text,
  p_make_public boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_mentor_profile_id IS NULL OR p_mentor_profile_id = v_actor_id THEN
    RAISE EXCEPTION 'Choose a separate dedicated mentor account' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_mentor_profile_id
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Mentor must first create an account and confirm its email' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profile_roles r
    WHERE r.user_id = p_mentor_profile_id
      AND r.role IN ('ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Administrator accounts cannot be registered as mentors' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profile_roles r
    WHERE r.user_id = p_mentor_profile_id
      AND r.role = 'TRAINEE'
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Use a separate account without an active trainee role' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.training_applications a
       WHERE a.trainee_profile_id = p_mentor_profile_id
     )
     OR EXISTS (
       SELECT 1 FROM public.training_enrollments e
       WHERE e.trainee_profile_id = p_mentor_profile_id
     )
     OR EXISTS (
       SELECT 1 FROM public.verification_documents d
       WHERE d.trainee_profile_id = p_mentor_profile_id
     ) THEN
    RAISE EXCEPTION 'This account has trainee history and cannot be repurposed as a mentor' USING ERRCODE = '42501';
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
$function$;

REVOKE ALL ON FUNCTION app_private.admin_register_mentor(uuid, text, text, text, text, boolean)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_register_mentor(uuid, text, text, text, text, boolean)
  TO authenticated;
