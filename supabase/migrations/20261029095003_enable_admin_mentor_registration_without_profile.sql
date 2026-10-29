-- Dedicated Mentor onboarding for a confirmed Auth identity without an existing MENTORO profile.
-- User metadata may defer first-time trainee provisioning but never grants workspace permission.
-- Mentor access is only created by this administrator-checked RPC.

CREATE OR REPLACE FUNCTION app_private.provision_current_trainee(p_full_name text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_email text;
BEGIN
 IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication is required' USING ERRCODE='42501'; END IF;
 -- Serialize first-time trainee provisioning against the Mentor registration RPC.
 SELECT lower(u.email) INTO v_email FROM auth.users u
 WHERE u.id=v_user_id AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL FOR UPDATE;
 IF v_email IS NULL THEN RAISE EXCEPTION 'Confirm your email before creating a MENTORO profile' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_user_id)
    AND NOT EXISTS(SELECT 1 FROM public.profile_roles r WHERE r.user_id=v_user_id AND r.role='TRAINEE' AND r.revoked_at IS NULL)
 THEN RAISE EXCEPTION 'Account is not assigned to the trainee workspace' USING ERRCODE='42501'; END IF;
 RETURN public.provision_trainee_profile(v_user_id,v_email,p_full_name);
END;
$function$;

CREATE OR REPLACE FUNCTION app_private.admin_register_mentor_by_email(
 p_mentor_email text,p_display_name text,p_professional_title text,p_institution text,p_bio text,p_make_public boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor_id uuid:=auth.uid(); v_mentor_profile_id uuid; v_auth_email text; v_auth_full_name text;
BEGIN
 IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
   RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE='42501';
 END IF;
 IF nullif(trim(p_mentor_email),'') IS NULL OR length(trim(p_mentor_email))>320 OR position('@' IN trim(p_mentor_email))<2
    OR nullif(trim(p_display_name),'') IS NULL OR length(trim(p_display_name))>160
    OR nullif(trim(p_professional_title),'') IS NULL OR length(trim(p_professional_title))>160
    OR length(coalesce(p_institution,''))>200 OR length(coalesce(p_bio,''))>2000
 THEN RAISE EXCEPTION 'Valid email, display name, professional title, and bounded profile fields are required' USING ERRCODE='22023'; END IF;

 -- Row lock serializes this registration against first-time trainee self-provisioning.
 SELECT u.id,lower(u.email),nullif(trim(u.raw_user_meta_data->>'full_name'),'')
 INTO v_mentor_profile_id,v_auth_email,v_auth_full_name
 FROM auth.users u
 WHERE lower(u.email)=lower(trim(p_mentor_email)) AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
 FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'A confirmed Auth account with this email was not found. The person must create the account and confirm the email first.'
     USING ERRCODE='42501';
 END IF;
 IF v_mentor_profile_id=v_actor_id THEN RAISE EXCEPTION 'The signed-in administrator cannot register their own account as a mentor' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.profile_roles r WHERE r.user_id=v_mentor_profile_id AND r.role IN ('ADMIN','SUPER_ADMIN'))
 THEN RAISE EXCEPTION 'Administrator accounts cannot be registered as mentors' USING ERRCODE='42501'; END IF;
 -- Never convert current or historical trainee identities.
 IF EXISTS(SELECT 1 FROM public.profile_roles r WHERE r.user_id=v_mentor_profile_id AND r.role='TRAINEE')
    OR EXISTS(SELECT 1 FROM public.trainee_profiles tp WHERE tp.profile_id=v_mentor_profile_id)
    OR EXISTS(SELECT 1 FROM public.training_applications a WHERE a.trainee_profile_id=v_mentor_profile_id)
    OR EXISTS(SELECT 1 FROM public.training_enrollments e WHERE e.trainee_profile_id=v_mentor_profile_id)
    OR EXISTS(SELECT 1 FROM public.verification_documents d WHERE d.trainee_profile_id=v_mentor_profile_id)
 THEN RAISE EXCEPTION 'This account already has trainee access or history. Create a separate dedicated Mentor account.' USING ERRCODE='42501'; END IF;

 INSERT INTO public.profiles(id,email,full_name)
 VALUES(v_mentor_profile_id,v_auth_email,coalesce(v_auth_full_name,nullif(trim(p_display_name),'')))
 ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,
   full_name=coalesce(nullif(trim(public.profiles.full_name),''),EXCLUDED.full_name),updated_at=now();
 INSERT INTO public.profile_roles(user_id,role,granted_by) VALUES(v_mentor_profile_id,'MENTOR',v_actor_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.mentor_profiles(profile_id,display_name,professional_title,institution,bio,profile_status,is_public)
 VALUES(v_mentor_profile_id,nullif(trim(p_display_name),''),nullif(trim(p_professional_title),''),
   nullif(trim(p_institution),''),nullif(trim(p_bio),''),'APPROVED',coalesce(p_make_public,false))
 ON CONFLICT(profile_id) DO UPDATE SET display_name=EXCLUDED.display_name,professional_title=EXCLUDED.professional_title,
   institution=EXCLUDED.institution,bio=EXCLUDED.bio,profile_status='APPROVED',is_public=EXCLUDED.is_public,updated_at=now();
 INSERT INTO public.audit_logs(actor_profile_id,action,entity_type,entity_id,metadata)
 VALUES(v_actor_id,'MENTOR_PROFILE_REGISTERED','MENTOR_PROFILE',v_mentor_profile_id,
   jsonb_build_object('registration_method','confirmed_auth_email'));
 RETURN v_mentor_profile_id;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.admin_register_mentor_by_email(text,text,text,text,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_register_mentor_by_email(text,text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_register_mentor_by_email(
 p_mentor_email text,p_display_name text,p_professional_title text,p_institution text,p_bio text,p_make_public boolean
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$ SELECT app_private.admin_register_mentor_by_email(
 p_mentor_email,p_display_name,p_professional_title,p_institution,p_bio,p_make_public
); $function$;
REVOKE ALL ON FUNCTION public.admin_register_mentor_by_email(text,text,text,text,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_register_mentor_by_email(text,text,text,text,text,boolean) TO authenticated;
