CREATE OR REPLACE FUNCTION app_private.provision_current_trainee(p_full_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = v_user_id AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Confirm your email before creating a MENTORO profile' USING ERRCODE = '42501';
  END IF;

  -- Existing profiles must already have an active TRAINEE assignment.
  -- New confirmed identities with no profile may provision their first trainee profile.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = v_user_id
      AND r.role = 'TRAINEE'
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Account is not assigned to the trainee workspace' USING ERRCODE = '42501';
  END IF;

  RETURN public.provision_trainee_profile(v_user_id, v_email, p_full_name);
END;
$$;
