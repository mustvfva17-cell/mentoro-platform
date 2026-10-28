CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated;

CREATE TABLE public.specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ar text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text,
  full_name text,
  account_status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (account_status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  verification_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_status = 'VERIFIED' AND verified_at IS NOT NULL) OR account_status <> 'VERIFIED')
);
CREATE UNIQUE INDEX profiles_email_ci_unique ON public.profiles (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE public.profile_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('TRAINEE', 'MENTOR', 'ADMIN', 'SUPER_ADMIN')),
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX profile_roles_one_active_role_per_user
  ON public.profile_roles (user_id, role) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX profile_roles_one_active_super_admin
  ON public.profile_roles ((role))
  WHERE role = 'SUPER_ADMIN' AND revoked_at IS NULL;

CREATE TABLE public.trainee_profiles (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  university_name text,
  faculty_name text,
  year_of_study smallint CHECK (year_of_study IS NULL OR year_of_study BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mentor_profiles (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  display_name text,
  professional_title text,
  institution text,
  bio text,
  photo_path text,
  profile_status text NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (profile_status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.verification_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_profile_id uuid NOT NULL REFERENCES public.trainee_profiles(profile_id) ON DELETE RESTRICT,
  bucket_id text NOT NULL DEFAULT 'trainee-verification' CHECK (bucket_id = 'trainee-verification'),
  object_path text NOT NULL,
  document_type text NOT NULL DEFAULT 'UNIVERSITY_ID'
    CHECK (document_type IN ('UNIVERSITY_ID', 'ENROLLMENT_LETTER', 'OTHER')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  review_note text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, object_path),
  CHECK ((status IN ('APPROVED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR status NOT IN ('APPROVED', 'REJECTED'))
);

CREATE TABLE public.logbook_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  specialty_id uuid NOT NULL REFERENCES public.specialties(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.logbook_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.logbook_templates(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  is_assignable boolean NOT NULL DEFAULT false,
  schema_definition jsonb NOT NULL,
  template_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_notes text,
  published_at timestamptz,
  published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CHECK (NOT is_assignable OR status = 'PUBLISHED')
);

CREATE TABLE public.training_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id uuid NOT NULL REFERENCES public.mentor_profiles(profile_id) ON DELETE RESTRICT,
  specialty_id uuid NOT NULL REFERENCES public.specialties(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.logbook_template_versions(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  delivery_mode text NOT NULL DEFAULT 'IN_PERSON' CHECK (delivery_mode IN ('IN_PERSON', 'ONLINE', 'HYBRID')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.training_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES public.training_offerings(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX training_slots_open_by_offering_idx ON public.training_slots (offering_id, starts_at) WHERE status = 'OPEN';

CREATE TABLE public.training_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainee_profile_id uuid NOT NULL REFERENCES public.trainee_profiles(profile_id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES public.training_offerings(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES public.training_slots(id) ON DELETE RESTRICT,
  applicant_note text,
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'MENTOR_APPROVED', 'MENTOR_REJECTED', 'ADMIN_CONFIRMED', 'WITHDRAWN', 'CANCELLED')),
  mentor_decision_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentor_decided_at timestamptz,
  mentor_decision_reason text,
  admin_decision_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_decided_at timestamptz,
  admin_decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'SUBMITTED' AND mentor_decision_by IS NULL AND mentor_decided_at IS NULL AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR (status IN ('MENTOR_APPROVED', 'MENTOR_REJECTED') AND mentor_decision_by IS NOT NULL AND mentor_decided_at IS NOT NULL AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR (status = 'ADMIN_CONFIRMED' AND mentor_decision_by IS NOT NULL AND mentor_decided_at IS NOT NULL AND admin_decision_by IS NOT NULL AND admin_decided_at IS NOT NULL)
    OR (status = 'WITHDRAWN' AND admin_decision_by IS NULL AND admin_decided_at IS NULL)
    OR status = 'CANCELLED'
  )
);
CREATE UNIQUE INDEX training_applications_one_open_request_per_slot
  ON public.training_applications (trainee_profile_id, offering_id, slot_id)
  WHERE status IN ('SUBMITTED', 'MENTOR_APPROVED');

CREATE TABLE public.training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_application_id uuid NOT NULL UNIQUE REFERENCES public.training_applications(id) ON DELETE RESTRICT,
  trainee_profile_id uuid NOT NULL REFERENCES public.trainee_profiles(profile_id) ON DELETE RESTRICT,
  mentor_profile_id uuid NOT NULL REFERENCES public.mentor_profiles(profile_id) ON DELETE RESTRICT,
  specialty_id uuid NOT NULL REFERENCES public.specialties(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES public.training_offerings(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES public.training_slots(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.logbook_template_versions(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  confirmed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL) OR status <> 'COMPLETED'),
  CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR status <> 'CANCELLED')
);
CREATE INDEX training_enrollments_trainee_history_idx
  ON public.training_enrollments (trainee_profile_id, starts_at DESC);
CREATE INDEX training_enrollments_mentor_status_idx
  ON public.training_enrollments (mentor_profile_id, status, starts_at);

CREATE TABLE public.logbook_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL UNIQUE REFERENCES public.training_enrollments(id) ON DELETE RESTRICT,
  template_version_id uuid NOT NULL REFERENCES public.logbook_template_versions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE public.logbook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.logbook_instances(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('SESSION', 'CASE', 'PROCEDURE', 'EMERGENCY', 'REFLECTION', 'ROADMAP', 'LEARNING_ACTIVITY')),
  title text NOT NULL DEFAULT '',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'ARCHIVED')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'DRAFT' AND submitted_at IS NULL) OR (status <> 'DRAFT' AND submitted_at IS NOT NULL))
);
CREATE INDEX logbook_entries_instance_date_idx ON public.logbook_entries (instance_id, entry_date DESC, created_at DESC);

CREATE TABLE public.entry_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.logbook_entries(id) ON DELETE RESTRICT,
  reviewer_profile_id uuid NOT NULL REFERENCES public.mentor_profiles(profile_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('VERIFIED', 'FEEDBACK', 'NEEDS_REVISION')),
  feedback text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entry_reviews_entry_history_idx ON public.entry_reviews (entry_id, reviewed_at DESC);

CREATE TABLE public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.training_enrollments(id) ON DELETE RESTRICT,
  assessor_profile_id uuid NOT NULL REFERENCES public.mentor_profiles(profile_id) ON DELETE RESTRICT,
  assessment_type text NOT NULL CHECK (assessment_type IN ('FORMATIVE', 'COMPETENCY')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'FINAL')),
  rubric_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  narrative_feedback text,
  assessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('SUBMITTED', 'FINAL') AND assessed_at IS NOT NULL) OR status = 'DRAFT')
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  CHECK (octet_length(metadata::text) <= 8192)
);

CREATE OR REPLACE FUNCTION app_private.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = auth.uid()
      AND r.role IN ('ADMIN', 'SUPER_ADMIN')
      AND r.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_trainee()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = 'TRAINEE'
      AND r.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_mentor()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = auth.uid()
      AND r.role = 'MENTOR'
      AND r.revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_verified_trainee()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_trainee() AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.account_status = 'VERIFIED'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.can_access_application(p_application_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_platform_admin() OR EXISTS (
    SELECT 1
    FROM public.training_applications a
    JOIN public.training_offerings o ON o.id = a.offering_id
    WHERE a.id = p_application_id
      AND (a.trainee_profile_id = auth.uid()
        OR (o.mentor_profile_id = auth.uid() AND app_private.is_mentor()))
  );
$$;

CREATE OR REPLACE FUNCTION app_private.can_access_enrollment(p_enrollment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.is_platform_admin() OR EXISTS (
    SELECT 1
    FROM public.training_enrollments e
    WHERE e.id = p_enrollment_id
      AND (e.trainee_profile_id = auth.uid()
        OR (e.mentor_profile_id = auth.uid() AND app_private.is_mentor()))
  );
$$;

CREATE OR REPLACE FUNCTION app_private.can_access_instance(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.logbook_instances i
    WHERE i.id = p_instance_id
      AND app_private.can_access_enrollment(i.enrollment_id)
  );
$$;

CREATE OR REPLACE FUNCTION app_private.owns_instance(p_instance_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.logbook_instances i
    JOIN public.training_enrollments e ON e.id = i.enrollment_id
    WHERE i.id = p_instance_id
      AND e.trainee_profile_id = auth.uid()
      AND e.status IN ('CONFIRMED', 'ACTIVE')
  );
$$;

CREATE OR REPLACE FUNCTION app_private.can_access_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.logbook_entries le
    WHERE le.id = p_entry_id
      AND app_private.can_access_instance(le.instance_id)
  );
$$;

CREATE OR REPLACE FUNCTION app_private.bootstrap_first_admin(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_profile_id
      AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The initial administrator must be an existing profile with a verified email';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.role IN ('ADMIN', 'SUPER_ADMIN') AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active platform administrator already exists';
  END IF;

  INSERT INTO public.profile_roles (user_id, role, granted_by)
  VALUES (p_profile_id, 'SUPER_ADMIN', p_profile_id);

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason)
  VALUES (p_profile_id, 'INITIAL_SUPER_ADMIN_BOOTSTRAPPED', 'PROFILE', p_profile_id,
          'Restricted database-owner bootstrap operation');
END;
$$;
REVOKE ALL ON FUNCTION app_private.bootstrap_first_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provision_trainee_profile(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_email text;
BEGIN
  SELECT lower(u.email) INTO v_auth_email
  FROM auth.users u
  WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL;

  IF v_auth_email IS NULL OR v_auth_email <> lower(coalesce(p_email, '')) THEN
    RAISE EXCEPTION 'Verified authentication identity required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, v_auth_email, nullif(trim(p_full_name), ''))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = coalesce(public.profiles.full_name, EXCLUDED.full_name),
        updated_at = now();

  INSERT INTO public.profile_roles (user_id, role)
  VALUES (p_user_id, 'TRAINEE')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.trainee_profiles (profile_id)
  VALUES (p_user_id)
  ON CONFLICT (profile_id) DO NOTHING;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, 'TRAINEE_PROFILE_PROVISIONED', 'PROFILE', p_user_id,
          jsonb_build_object('provisioning', 'auth_verified'));

  RETURN p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.provision_trainee_profile(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_trainee_profile(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mentor_review_application(
  p_actor_id uuid,
  p_application_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.training_applications%ROWTYPE;
  v_mentor_id uuid;
  v_next_status text;
BEGIN
  IF p_decision NOT IN ('APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'Unsupported mentor decision';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = p_actor_id AND r.role = 'MENTOR' AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active mentor role required' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app
  FROM public.training_applications a
  WHERE a.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND OR v_app.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Application is not available for mentor review';
  END IF;

  SELECT o.mentor_profile_id INTO v_mentor_id
  FROM public.training_offerings o
  WHERE o.id = v_app.offering_id AND o.status = 'PUBLISHED';

  IF v_mentor_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Application is outside this mentor scope' USING ERRCODE = '42501';
  END IF;

  v_next_status := CASE WHEN p_decision = 'APPROVE' THEN 'MENTOR_APPROVED' ELSE 'MENTOR_REJECTED' END;

  UPDATE public.training_applications
  SET status = v_next_status,
      mentor_decision_by = p_actor_id,
      mentor_decided_at = now(),
      mentor_decision_reason = nullif(trim(p_reason), ''),
      updated_at = now()
  WHERE id = p_application_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, reason)
  VALUES (p_actor_id, 'MENTOR_APPLICATION_' || p_decision, 'TRAINING_APPLICATION', p_application_id, nullif(trim(p_reason), ''));

  RETURN p_application_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mentor_review_application(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_review_application(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_confirm_application(
  p_actor_id uuid,
  p_application_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.training_applications%ROWTYPE;
  v_offering public.training_offerings%ROWTYPE;
  v_slot public.training_slots%ROWTYPE;
  v_version public.logbook_template_versions%ROWTYPE;
  v_reserved integer;
  v_enrollment_id uuid;
  v_logbook_instance_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_roles r
    WHERE r.user_id = p_actor_id
      AND r.role IN ('ADMIN', 'SUPER_ADMIN')
      AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active platform admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT a.* INTO v_app
  FROM public.training_applications a
  WHERE a.id = p_application_id
  FOR UPDATE;

  IF NOT FOUND OR v_app.status <> 'MENTOR_APPROVED' THEN
    RAISE EXCEPTION 'Only mentor-approved applications can be confirmed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.profile_roles r ON r.user_id = p.id
    WHERE p.id = v_app.trainee_profile_id
      AND p.account_status = 'VERIFIED'
      AND r.role = 'TRAINEE' AND r.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Trainee account is not verified' USING ERRCODE = '42501';
  END IF;

  SELECT o.* INTO v_offering
  FROM public.training_offerings o
  WHERE o.id = v_app.offering_id AND o.status = 'PUBLISHED'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training offering is not available';
  END IF;

  SELECT s.* INTO v_slot
  FROM public.training_slots s
  WHERE s.id = v_app.slot_id AND s.offering_id = v_offering.id AND s.status = 'OPEN'
  FOR UPDATE;

  IF NOT FOUND OR v_slot.starts_at <= now() THEN
    RAISE EXCEPTION 'Training slot is not available';
  END IF;

  SELECT count(*)::integer INTO v_reserved
  FROM public.training_enrollments e
  WHERE e.slot_id = v_slot.id AND e.status IN ('CONFIRMED', 'ACTIVE');

  IF v_reserved >= v_slot.capacity THEN
    RAISE EXCEPTION 'Training slot capacity has been reached';
  END IF;

  SELECT tv.* INTO v_version
  FROM public.logbook_template_versions tv
  WHERE tv.id = v_offering.template_version_id
    AND tv.status = 'PUBLISHED' AND tv.is_assignable = true
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offering does not reference an assignable published logbook template';
  END IF;

  IF v_version.template_id NOT IN (
    SELECT t.id FROM public.logbook_templates t
    WHERE t.specialty_id = v_offering.specialty_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'Template version does not match offering specialty';
  END IF;

  INSERT INTO public.training_enrollments (
    source_application_id, trainee_profile_id, mentor_profile_id,
    specialty_id, offering_id, slot_id, template_version_id,
    starts_at, ends_at, status, confirmed_by
  )
  VALUES (
    v_app.id, v_app.trainee_profile_id, v_offering.mentor_profile_id,
    v_offering.specialty_id, v_offering.id, v_slot.id, v_version.id,
    v_slot.starts_at, v_slot.ends_at, 'CONFIRMED', p_actor_id
  )
  RETURNING id INTO v_enrollment_id;

  INSERT INTO public.logbook_instances (enrollment_id, template_version_id)
  VALUES (v_enrollment_id, v_version.id)
  RETURNING id INTO v_logbook_instance_id;

  UPDATE public.training_applications
  SET status = 'ADMIN_CONFIRMED',
      admin_decision_by = p_actor_id,
      admin_decided_at = now(),
      admin_decision_reason = 'Booking confirmed by platform administration',
      updated_at = now()
  WHERE id = v_app.id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id, metadata)
  VALUES (p_actor_id, 'TRAINING_ENROLLMENT_CONFIRMED', 'TRAINING_ENROLLMENT', v_enrollment_id,
          jsonb_build_object('application_id', v_app.id, 'logbook_instance_id', v_logbook_instance_id,
                             'template_version_id', v_version.id));

  RETURN v_enrollment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_confirm_application(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_application(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_logbook_entry_submitted(
  p_actor_id uuid,
  p_entry_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry public.logbook_entries%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Actor identity mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT le.* INTO v_entry
  FROM public.logbook_entries le
  JOIN public.logbook_instances i ON i.id = le.instance_id
  JOIN public.training_enrollments e ON e.id = i.enrollment_id
  WHERE le.id = p_entry_id
    AND e.trainee_profile_id = p_actor_id
    AND e.status IN ('CONFIRMED', 'ACTIVE')
  FOR UPDATE OF le;

  IF NOT FOUND OR v_entry.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only your draft entries can be submitted' USING ERRCODE = '42501';
  END IF;

  UPDATE public.logbook_entries
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE id = p_entry_id;

  INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id)
  VALUES (p_actor_id, 'LOGBOOK_ENTRY_SUBMITTED', 'LOGBOOK_ENTRY', p_entry_id);

  RETURN p_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trainee_profiles_set_updated_at BEFORE UPDATE ON public.trainee_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER mentor_profiles_set_updated_at BEFORE UPDATE ON public.mentor_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER logbook_entries_set_updated_at BEFORE UPDATE ON public.logbook_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trainee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

GRANT EXECUTE ON FUNCTION app_private.is_platform_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_trainee() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_mentor() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_verified_trainee() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_instance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.owns_instance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_access_entry(uuid) TO authenticated;

GRANT SELECT ON public.specialties TO anon, authenticated;
GRANT SELECT ON public.mentor_profiles, public.training_offerings, public.training_slots,
  public.logbook_templates, public.logbook_template_versions TO anon, authenticated;
GRANT SELECT ON public.profiles, public.profile_roles, public.trainee_profiles,
  public.verification_documents, public.training_applications, public.training_enrollments,
  public.logbook_instances, public.logbook_entries, public.entry_reviews, public.assessments,
  public.audit_logs TO authenticated;

GRANT INSERT (trainee_profile_id, offering_id, slot_id, applicant_note)
  ON public.training_applications TO authenticated;
GRANT INSERT (instance_id, entry_type, title, entry_date, payload)
  ON public.logbook_entries TO authenticated;
GRANT UPDATE (title, entry_date, payload)
  ON public.logbook_entries TO authenticated;
GRANT DELETE ON public.logbook_entries TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.specialties, public.profiles, public.profile_roles,
  public.trainee_profiles, public.mentor_profiles, public.verification_documents,
  public.logbook_templates, public.logbook_template_versions, public.training_offerings,
  public.training_slots, public.training_applications, public.training_enrollments,
  public.logbook_instances, public.logbook_entries, public.entry_reviews, public.assessments,
  public.audit_logs TO service_role;

CREATE POLICY specialties_public_read ON public.specialties
  FOR SELECT TO anon, authenticated
  USING (is_active OR app_private.is_platform_admin());
CREATE POLICY profiles_read_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR app_private.is_platform_admin());
CREATE POLICY profile_roles_read_own_or_admin ON public.profile_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR app_private.is_platform_admin());
CREATE POLICY trainee_profiles_read_own_or_admin ON public.trainee_profiles
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR app_private.is_platform_admin());
CREATE POLICY mentor_profiles_public_or_owner_read ON public.mentor_profiles
  FOR SELECT TO anon, authenticated
  USING (is_public OR profile_id = auth.uid() OR app_private.is_platform_admin());
CREATE POLICY verification_documents_read_scoped ON public.verification_documents
  FOR SELECT TO authenticated
  USING (trainee_profile_id = auth.uid() OR app_private.is_platform_admin());
CREATE POLICY logbook_templates_read_active ON public.logbook_templates
  FOR SELECT TO anon, authenticated
  USING (is_active OR app_private.is_platform_admin());
CREATE POLICY logbook_template_versions_read_published ON public.logbook_template_versions
  FOR SELECT TO anon, authenticated
  USING (
    (status = 'PUBLISHED' AND EXISTS (
      SELECT 1 FROM public.logbook_templates t
      WHERE t.id = template_id AND t.is_active = true
    )) OR app_private.is_platform_admin()
  );
CREATE POLICY training_offerings_read_published ON public.training_offerings
  FOR SELECT TO anon, authenticated
  USING (
    (status = 'PUBLISHED' AND EXISTS (
      SELECT 1 FROM public.mentor_profiles mp
      WHERE mp.profile_id = mentor_profile_id
        AND mp.is_public = true AND mp.profile_status = 'APPROVED'
    )) OR mentor_profile_id = auth.uid() OR app_private.is_platform_admin()
  );
CREATE POLICY training_slots_read_available ON public.training_slots
  FOR SELECT TO anon, authenticated
  USING (
    (status = 'OPEN' AND EXISTS (
      SELECT 1 FROM public.training_offerings o
      JOIN public.mentor_profiles mp ON mp.profile_id = o.mentor_profile_id
      WHERE o.id = offering_id AND o.status = 'PUBLISHED'
        AND mp.is_public = true AND mp.profile_status = 'APPROVED'
    )) OR EXISTS (
      SELECT 1 FROM public.training_offerings o
      WHERE o.id = offering_id AND o.mentor_profile_id = auth.uid()
    ) OR app_private.is_platform_admin()
  );
CREATE POLICY applications_read_in_scope ON public.training_applications
  FOR SELECT TO authenticated
  USING (app_private.can_access_application(id));
CREATE POLICY applications_submit_own ON public.training_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    trainee_profile_id = auth.uid()
    AND status = 'SUBMITTED'
    AND app_private.is_verified_trainee()
    AND EXISTS (
      SELECT 1
      FROM public.training_offerings o
      JOIN public.training_slots s ON s.offering_id = o.id
      JOIN public.logbook_template_versions tv ON tv.id = o.template_version_id
      JOIN public.logbook_templates t ON t.id = tv.template_id
      WHERE o.id = offering_id
        AND s.id = slot_id
        AND o.status = 'PUBLISHED'
        AND s.status = 'OPEN'
        AND s.starts_at > now()
        AND tv.status = 'PUBLISHED'
        AND tv.is_assignable = true
        AND t.is_active = true
        AND t.specialty_id = o.specialty_id
    )
  );
CREATE POLICY enrollments_read_in_scope ON public.training_enrollments
  FOR SELECT TO authenticated
  USING (app_private.can_access_enrollment(id));
CREATE POLICY logbook_instances_read_in_scope ON public.logbook_instances
  FOR SELECT TO authenticated
  USING (app_private.can_access_instance(id));
CREATE POLICY logbook_entries_read_in_scope ON public.logbook_entries
  FOR SELECT TO authenticated
  USING (app_private.can_access_instance(instance_id));
CREATE POLICY logbook_entries_insert_own_drafts ON public.logbook_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'DRAFT' AND submitted_at IS NULL
    AND created_by = auth.uid()
    AND app_private.owns_instance(instance_id)
  );
CREATE POLICY logbook_entries_update_own_drafts ON public.logbook_entries
  FOR UPDATE TO authenticated
  USING (status = 'DRAFT' AND app_private.owns_instance(instance_id))
  WITH CHECK (status = 'DRAFT' AND app_private.owns_instance(instance_id) AND created_by = auth.uid() AND submitted_at IS NULL);
CREATE POLICY logbook_entries_delete_own_drafts ON public.logbook_entries
  FOR DELETE TO authenticated
  USING (status = 'DRAFT' AND app_private.owns_instance(instance_id));
CREATE POLICY entry_reviews_read_in_scope ON public.entry_reviews
  FOR SELECT TO authenticated
  USING (app_private.can_access_entry(entry_id));
CREATE POLICY assessments_read_in_scope ON public.assessments
  FOR SELECT TO authenticated
  USING (app_private.can_access_enrollment(enrollment_id));
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (app_private.is_platform_admin());

INSERT INTO public.specialties (slug, name_en, name_ar, is_active) VALUES
  ('general-surgery', 'General Surgery', 'الجراحة العامة', true),
  ('cardiology', 'Cardiology', 'أمراض القلب', true),
  ('neurology', 'Neurology', 'المخ والأعصاب', true),
  ('anaesthesia-critical-care', 'Anaesthesia & Critical Care', 'التخدير والعناية المركزة', true),
  ('medical-oncology', 'Medical Oncology', 'طب الأورام', true),
  ('ophthalmology', 'Ophthalmology', 'طب وجراحة العيون', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
SELECT s.id, 'general-surgery', 'General Surgery Clinical Logbook',
       'Pilot template based on the existing MENTORO General Surgery logbook. Requires clinical schema review before assignment.',
       true
FROM public.specialties s
WHERE s.slug = 'general-surgery'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.logbook_template_versions (
  template_id, version_number, status, is_assignable,
  schema_definition, template_definition, source_notes
)
SELECT t.id, 1, 'DRAFT', false,
       jsonb_build_object(
         '$schema', 'https://json-schema.org/draft/2020-12/schema',
         'type', 'object',
         'additionalProperties', true
       ),
       jsonb_build_object(
         'versionLabel', 'v1',
         'sections', jsonb_build_array('Clinical sessions', 'Case log', 'Procedures', 'Emergency templates', 'Roadmap', 'Reflection'),
         'source', 'MENTORO General Surgery logbook project v4',
         'readiness', 'DRAFT: needs reviewed, source-traceable field schema before use for training'
       ),
       'Existing MENTORO General Surgery logbook project v4; source-traceable clinical schema approval pending.'
FROM public.logbook_templates t
WHERE t.slug = 'general-surgery'
ON CONFLICT (template_id, version_number) DO NOTHING;

-- Keep the university-ID bucket private. The app must upload under {auth.uid()}/...
INSERT INTO storage.buckets (id, name, public)
VALUES ('trainee-verification', 'trainee-verification', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY trainee_verification_upload_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trainee-verification'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND app_private.is_trainee()
  );
CREATE POLICY trainee_verification_read_own_or_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'trainee-verification'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR app_private.is_platform_admin()
    )
  );

