-- Rollback-only authorization test for the admin mentor registration RPC.
-- Run ONLY against mentoro-platform-test or another disposable database with an active admin and trainee.
-- Uses existing test identities only; every attempted registration must be rejected before any mutation.
BEGIN;

DO $test$
DECLARE
  v_admin uuid;
  v_trainee uuid;
  v_rejected boolean;
BEGIN
  SELECT r.user_id INTO v_admin
  FROM public.profile_roles r
  WHERE r.role IN ('ADMIN', 'SUPER_ADMIN') AND r.revoked_at IS NULL
  ORDER BY r.created_at
  LIMIT 1;

  SELECT r.user_id INTO v_trainee
  FROM public.profile_roles r
  WHERE r.role = 'TRAINEE' AND r.revoked_at IS NULL
  ORDER BY r.created_at
  LIMIT 1;

  IF v_admin IS NULL OR v_trainee IS NULL THEN
    RAISE EXCEPTION 'Prerequisites missing: active platform admin and trainee roles are required';
  END IF;

  -- Anonymous callers must not register any account.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}'::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.admin_register_mentor(
      v_trainee, 'Unauthorized fixture', 'Consultant', 'Test only', NULL, false
    );
    RAISE EXCEPTION 'SECURITY_TEST_FAILED: anonymous caller registered a mentor'
      USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Anonymous mentor registration was not rejected';
  END IF;

  -- A trainee cannot invoke the admin RPC, even if they submit another profile UUID.
  PERFORM set_config('request.jwt.claim.sub', v_trainee::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_trainee::text)::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.admin_register_mentor(
      '00000000-0000-0000-0000-000000000001'::uuid,
      'Unauthorized fixture', 'Consultant', 'Test only', NULL, false
    );
    RAISE EXCEPTION 'SECURITY_TEST_FAILED: trainee invoked the admin mentor RPC'
      USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Trainee mentor registration was not rejected';
  END IF;

  -- Even an administrator must use a different account for the mentor role.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin::text)::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.admin_register_mentor(
      v_admin, 'Admin fixture', 'Administrator', 'Test only', NULL, false
    );
    RAISE EXCEPTION 'SECURITY_TEST_FAILED: administrator registered their own account as mentor'
      USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Administrator self-registration was not rejected';
  END IF;

  -- An admin cannot repurpose an active trainee account, even if the call bypasses the UI.
  v_rejected := false;
  BEGIN
    PERFORM public.admin_register_mentor(
      v_trainee, 'Trainee fixture', 'Consultant', 'Test only', NULL, false
    );
    RAISE EXCEPTION 'SECURITY_TEST_FAILED: administrator repurposed a trainee account'
      USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Administrator repurposing of a trainee account was not rejected';
  END IF;
END
$test$;

ROLLBACK;
