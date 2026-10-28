-- One-time initial Super Admin bootstrap for an operator running SQL as the database owner.
-- This deliberately has no public wrapper and is not executable by browser/API roles.
-- A dedicated, confirmed, unused test account must be supplied by the operator.
CREATE OR REPLACE FUNCTION app_private.bootstrap_initial_super_admin(p_confirmed_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_matching_users integer;
  v_active_roles integer;
BEGIN
  IF p_confirmed_email IS NULL OR nullif(btrim(p_confirmed_email), '') IS NULL THEN
    RAISE EXCEPTION 'A confirmed account email is required' USING ERRCODE = '22023';
  END IF;

  -- Serialize bootstrap attempts. The unique index on SUPER_ADMIN is a second guard.
  LOCK TABLE public.profile_roles IN EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.profile_roles r
    WHERE r.role IN ('ADMIN', 'SUPER_ADMIN')
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active platform administrator already exists; initial bootstrap is closed'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer
  INTO v_matching_users
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_confirmed_email))
    AND u.email_confirmed_at IS NOT NULL;

  IF v_matching_users <> 1 THEN
    RAISE EXCEPTION 'The email must match exactly one confirmed Auth user'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.id
  INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_confirmed_email))
    AND u.email_confirmed_at IS NOT NULL
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Sign in to MENTORO after confirming the email so the account profile is provisioned'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer
  INTO v_active_roles
  FROM public.profile_roles r
  WHERE r.user_id = v_user_id
    AND r.revoked_at IS NULL;

  IF v_active_roles <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.profile_roles r
    WHERE r.user_id = v_user_id
      AND r.role = 'TRAINEE'
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The target must have exactly one active TRAINEE role and no other active roles'
      USING ERRCODE = '42501';
  END IF;

  -- Never convert an account that has begun verification or real training activity.
  IF EXISTS (
    SELECT 1 FROM public.verification_documents d WHERE d.trainee_profile_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.training_applications a WHERE a.trainee_profile_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.training_enrollments e WHERE e.trainee_profile_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'The target trainee account already has verification or training activity; use a fresh dedicated admin account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profile_roles
  SET revoked_at = statement_timestamp()
  WHERE user_id = v_user_id
    AND role = 'TRAINEE'
    AND revoked_at IS NULL;

  INSERT INTO public.profile_roles (user_id, role, granted_by)
  VALUES (v_user_id, 'SUPER_ADMIN', NULL);

  INSERT INTO public.audit_logs (
    actor_profile_id, action, entity_type, entity_id, outcome, reason, metadata
  ) VALUES (
    NULL,
    'INITIAL_SUPER_ADMIN_BOOTSTRAPPED',
    'PROFILE',
    v_user_id,
    'SUCCESS',
    'Owner-only one-time bootstrap',
    jsonb_build_object('bootstrap_scope', 'initial_super_admin', 'execution', 'database_owner')
  );

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.bootstrap_initial_super_admin(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION app_private.bootstrap_initial_super_admin(text) IS
  'Owner-only one-time initial Super Admin bootstrap. No public wrapper; never grant execution to browser/API roles.';
