-- Rollback-only test: confirmed Auth user without a profile can be registered as Mentor by an admin.
-- Run only on mentoro-platform-test. Synthetic identities and all writes roll back.
BEGIN;
DO $test$
DECLARE
 v_admin uuid; v_trainee uuid; v_new_id uuid:=gen_random_uuid(); v_unconfirmed_id uuid:=gen_random_uuid();
 v_email text:='mentor-register-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid';
 v_unconfirmed_email text:='mentor-unconfirmed-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid';
 v_trainee_email text; v_admin_email text; v_registered uuid; v_denied boolean;
BEGIN
 SELECT r.user_id INTO v_admin FROM public.profile_roles r WHERE r.role IN ('ADMIN','SUPER_ADMIN') AND r.revoked_at IS NULL LIMIT 1;
 SELECT r.user_id INTO v_trainee FROM public.profile_roles r WHERE r.role='TRAINEE' AND r.revoked_at IS NULL LIMIT 1;
 IF v_admin IS NULL OR v_trainee IS NULL THEN RAISE EXCEPTION 'Prerequisites missing: active admin and trainee are required'; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES
 (v_new_id,v_email,now(),jsonb_build_object('full_name','Rollback Mentor Fixture'),now(),now(),false,false),
 (v_unconfirmed_id,v_unconfirmed_email,NULL,jsonb_build_object('full_name','Unconfirmed Fixture'),now(),now(),false,false);
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new_id) OR EXISTS(SELECT 1 FROM public.profile_roles WHERE user_id=v_new_id)
 THEN RAISE EXCEPTION 'New Auth fixture unexpectedly has an app profile or role'; END IF;

 PERFORM set_config('request.jwt.claim.sub','',true); PERFORM set_config('request.jwt.claims','{}',true);
 v_denied:=false;
 BEGIN
  PERFORM public.admin_register_mentor_by_email(v_email,'Rollback Mentor Fixture','Consultant',NULL,NULL,false);
  RAISE EXCEPTION 'SECURITY_TEST_FAILED: anonymous caller registered a mentor' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Anonymous registration was not denied'; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_trainee::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_trainee::text)::text,true);
 v_denied:=false;
 BEGIN
  PERFORM public.admin_register_mentor_by_email(v_email,'Rollback Mentor Fixture','Consultant',NULL,NULL,false);
  RAISE EXCEPTION 'SECURITY_TEST_FAILED: trainee invoked admin registration' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Trainee registration was not denied'; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin::text)::text,true);
 v_denied:=false;
 BEGIN
  PERFORM public.admin_register_mentor_by_email(v_unconfirmed_email,'Unconfirmed Fixture','Consultant',NULL,NULL,false);
  RAISE EXCEPTION 'SECURITY_TEST_FAILED: unconfirmed identity registered' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Unconfirmed identity was not denied'; END IF;

 SELECT public.admin_register_mentor_by_email(v_email,'Rollback Mentor Fixture','Consultant','Test-only institution',NULL,false) INTO v_registered;
 IF v_registered<>v_new_id THEN RAISE EXCEPTION 'Registration returned wrong identity'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new_id AND lower(email)=lower(v_email)) THEN RAISE EXCEPTION 'Profile was not created'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profile_roles WHERE user_id=v_new_id AND role='MENTOR' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Mentor role was not granted through RPC'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mentor_profiles WHERE profile_id=v_new_id AND profile_status='APPROVED') THEN RAISE EXCEPTION 'Mentor profile was not created'; END IF;
 IF EXISTS(SELECT 1 FROM public.profile_roles WHERE user_id=v_new_id AND role='TRAINEE') OR EXISTS(SELECT 1 FROM public.trainee_profiles WHERE profile_id=v_new_id)
 THEN RAISE EXCEPTION 'Mentor registration incorrectly provisioned trainee access'; END IF;

 SELECT lower(email) INTO v_trainee_email FROM auth.users WHERE id=v_trainee;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_register_mentor_by_email(v_trainee_email,'Trainee Fixture','Consultant',NULL,NULL,false);
  RAISE EXCEPTION 'SECURITY_TEST_FAILED: trainee converted to Mentor' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Existing trainee identity was not denied'; END IF;

 SELECT lower(email) INTO v_admin_email FROM auth.users WHERE id=v_admin;
 v_denied:=false;
 BEGIN
  PERFORM public.admin_register_mentor_by_email(v_admin_email,'Admin Fixture','Administrator',NULL,NULL,false);
  RAISE EXCEPTION 'SECURITY_TEST_FAILED: administrator converted to Mentor' USING ERRCODE='XX000';
 EXCEPTION WHEN SQLSTATE '42501' THEN v_denied:=true; END;
 IF NOT v_denied THEN RAISE EXCEPTION 'Admin identity was not denied'; END IF;
 RAISE NOTICE 'Mentor registration tests passed: confirmed Auth identity without profile, admin-only authorization, no trainee conversion.';
END
$test$;
ROLLBACK;
