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

  RETURN public.provision_trainee_profile(v_user_id, v_email, p_full_name);
END;
$$;
REVOKE ALL ON FUNCTION app_private.provision_current_trainee(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.provision_current_trainee(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.provision_current_trainee(p_full_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.provision_current_trainee(p_full_name);
$$;
REVOKE ALL ON FUNCTION public.provision_current_trainee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_current_trainee(text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.mentor_review_current_application(
  p_application_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_mentor() THEN
    RAISE EXCEPTION 'Active mentor session required' USING ERRCODE = '42501';
  END IF;

  RETURN public.mentor_review_application(v_actor_id, p_application_id, p_decision, p_reason);
END;
$$;
REVOKE ALL ON FUNCTION app_private.mentor_review_current_application(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mentor_review_current_application(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_review_my_application(
  p_application_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.mentor_review_current_application(p_application_id, p_decision, p_reason);
$$;
REVOKE ALL ON FUNCTION public.mentor_review_my_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mentor_review_my_application(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_confirm_current_application(p_application_id uuid)
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

  RETURN public.admin_confirm_application(v_actor_id, p_application_id);
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_confirm_current_application(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_confirm_current_application(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_confirm_my_application(p_application_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_confirm_current_application(p_application_id);
$$;
REVOKE ALL ON FUNCTION public.admin_confirm_my_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_my_application(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.record_current_verification_document(
  p_object_path text,
  p_document_type text DEFAULT 'UNIVERSITY_ID'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_doc_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_trainee() THEN
    RAISE EXCEPTION 'Trainee session required' USING ERRCODE = '42501';
  END IF;

  IF p_document_type NOT IN ('UNIVERSITY_ID', 'ENROLLMENT_LETTER', 'OTHER') THEN
    RAISE EXCEPTION 'Unsupported verification document type';
  END IF;

  IF p_object_path IS NULL
     OR (storage.foldername(p_object_path))[1] IS DISTINCT FROM v_actor_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects so
       WHERE so.bucket_id = 'trainee-verification'
         AND so.name = p_object_path
     ) THEN
    RAISE EXCEPTION 'Upload the document to your private verification folder first' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor_id
      AND p.account_status IN ('PENDING_VERIFICATION', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'This account does not require new verification evidence';
  END IF;

  UPDATE public.verification_documents
  SET status = 'SUPERSEDED'
  WHERE trainee_profile_id = v_actor_id AND status = 'PENDING';

  INSERT INTO public.verification_documents (trainee_profile_id, object_path, document_type)
  VALUES (v_actor_id, p_object_path, p_document_type)
  RETURNING id INTO v_doc_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_id, 'VERIFICATION_DOCUMENT_SUBMITTED', 'VERIFICATION_DOCUMENT', v_doc_id,
          jsonb_build_object('document_type', p_document_type));

  RETURN v_doc_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.record_current_verification_document(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.record_current_verification_document(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_verification_document(
  p_object_path text,
  p_document_type text DEFAULT 'UNIVERSITY_ID'
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.record_current_verification_document(p_object_path, p_document_type);
$$;
REVOKE ALL ON FUNCTION public.record_verification_document(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_verification_document(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.admin_review_trainee_verification(
  p_trainee_profile_id uuid,
  p_document_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_doc public.verification_documents%ROWTYPE;
  v_target_status text;
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_platform_admin() THEN
    RAISE EXCEPTION 'Active platform admin session required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'Unsupported verification decision';
  END IF;

  SELECT d.* INTO v_doc
  FROM public.verification_documents d
  WHERE d.id = p_document_id
    AND d.trainee_profile_id = p_trainee_profile_id
  FOR UPDATE;

  IF NOT FOUND OR v_doc.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Verification document is not pending review';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_trainee_profile_id
      AND p.account_status IN ('PENDING_VERIFICATION', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'Account is not awaiting identity verification';
  END IF;

  v_target_status := CASE WHEN p_decision = 'APPROVE' THEN 'VERIFIED' ELSE 'REJECTED' END;

  UPDATE public.verification_documents
  SET status = CASE WHEN p_decision = 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
      reviewed_by = v_actor_id,
      reviewed_at = now(),
      review_note = nullif(trim(p_reason), '')
  WHERE id = v_doc.id;

  UPDATE public.profiles
  SET account_status = v_target_status,
      verified_by = v_actor_id,
      verified_at = CASE WHEN p_decision = 'APPROVE' THEN now() ELSE NULL END,
      verification_reason = nullif(trim(p_reason), ''),
      updated_at = now()
  WHERE id = p_trainee_profile_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason)
  VALUES (v_actor_id, 'TRAINEE_VERIFICATION_' || p_decision, 'PROFILE', p_trainee_profile_id, nullif(trim(p_reason), ''));

  RETURN p_trainee_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION app_private.admin_review_trainee_verification(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_review_trainee_verification(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_trainee_verification(
  p_trainee_profile_id uuid,
  p_document_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT app_private.admin_review_trainee_verification(
    p_trainee_profile_id, p_document_id, p_decision, p_reason
  );
$$;
REVOKE ALL ON FUNCTION public.admin_review_trainee_verification(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_trainee_verification(uuid, uuid, text, text) TO authenticated;

