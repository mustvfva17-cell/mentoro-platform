-- Submission remains an authenticated, row-scoped operation; audit is performed by an internal trigger.
CREATE OR REPLACE FUNCTION public.set_logbook_entry_submitted(
  p_actor_id uuid,
  p_entry_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
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
  WHERE le.id = p_entry_id
    AND app_private.owns_instance(le.instance_id)
  FOR UPDATE;

  IF NOT FOUND OR v_entry.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only your draft entries can be submitted' USING ERRCODE = '42501';
  END IF;

  UPDATE public.logbook_entries
  SET status = 'SUBMITTED', submitted_at = now(), updated_at = now()
  WHERE id = p_entry_id AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry changed before submission; refresh and retry';
  END IF;

  RETURN p_entry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) TO authenticated;
GRANT UPDATE (status, submitted_at, updated_at) ON public.logbook_entries TO authenticated;

DROP POLICY IF EXISTS logbook_entries_update_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_update_own_drafts ON public.logbook_entries
  FOR UPDATE TO authenticated
  USING (status = 'DRAFT' AND app_private.owns_instance(instance_id))
  WITH CHECK (
    status IN ('DRAFT', 'SUBMITTED')
    AND app_private.owns_instance(instance_id)
    AND created_by = (SELECT auth.uid())
    AND ((status = 'DRAFT' AND submitted_at IS NULL) OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL))
  );

CREATE OR REPLACE FUNCTION app_private.audit_entry_submission()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    INSERT INTO public.audit_logs (actor_profile_id, action, entity_type, entity_id)
    VALUES (auth.uid(), 'LOGBOOK_ENTRY_SUBMITTED', 'LOGBOOK_ENTRY', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.audit_entry_submission() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS logbook_entry_submission_audit ON public.logbook_entries;
CREATE TRIGGER logbook_entry_submission_audit
AFTER UPDATE OF status ON public.logbook_entries
FOR EACH ROW
WHEN (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
EXECUTE FUNCTION app_private.audit_entry_submission();

-- Foreign-key-side indexes for joins, scoped access, and deletion/retention checks.
CREATE INDEX IF NOT EXISTS profiles_verified_by_idx ON public.profiles (verified_by);
CREATE INDEX IF NOT EXISTS profile_roles_granted_by_idx ON public.profile_roles (granted_by);
CREATE INDEX IF NOT EXISTS verification_documents_trainee_idx ON public.verification_documents (trainee_profile_id);
CREATE INDEX IF NOT EXISTS verification_documents_reviewed_by_idx ON public.verification_documents (reviewed_by);
CREATE INDEX IF NOT EXISTS logbook_templates_specialty_idx ON public.logbook_templates (specialty_id);
CREATE INDEX IF NOT EXISTS logbook_template_versions_published_by_idx ON public.logbook_template_versions (published_by);
CREATE INDEX IF NOT EXISTS training_offerings_mentor_idx ON public.training_offerings (mentor_profile_id);
CREATE INDEX IF NOT EXISTS training_offerings_specialty_idx ON public.training_offerings (specialty_id);
CREATE INDEX IF NOT EXISTS training_offerings_template_version_idx ON public.training_offerings (template_version_id);
CREATE INDEX IF NOT EXISTS training_slots_offering_fk_idx ON public.training_slots (offering_id);
CREATE INDEX IF NOT EXISTS training_applications_trainee_fk_idx ON public.training_applications (trainee_profile_id);
CREATE INDEX IF NOT EXISTS training_applications_offering_fk_idx ON public.training_applications (offering_id);
CREATE INDEX IF NOT EXISTS training_applications_slot_fk_idx ON public.training_applications (slot_id);
CREATE INDEX IF NOT EXISTS training_applications_mentor_decider_idx ON public.training_applications (mentor_decision_by);
CREATE INDEX IF NOT EXISTS training_applications_admin_decider_idx ON public.training_applications (admin_decision_by);
CREATE INDEX IF NOT EXISTS training_enrollments_specialty_idx ON public.training_enrollments (specialty_id);
CREATE INDEX IF NOT EXISTS training_enrollments_offering_idx ON public.training_enrollments (offering_id);
CREATE INDEX IF NOT EXISTS training_enrollments_slot_idx ON public.training_enrollments (slot_id);
CREATE INDEX IF NOT EXISTS training_enrollments_template_version_idx ON public.training_enrollments (template_version_id);
CREATE INDEX IF NOT EXISTS training_enrollments_confirmed_by_idx ON public.training_enrollments (confirmed_by);
CREATE INDEX IF NOT EXISTS logbook_instances_template_version_idx ON public.logbook_instances (template_version_id);
CREATE INDEX IF NOT EXISTS logbook_entries_created_by_idx ON public.logbook_entries (created_by);
CREATE INDEX IF NOT EXISTS entry_reviews_reviewer_idx ON public.entry_reviews (reviewer_profile_id);
CREATE INDEX IF NOT EXISTS assessments_enrollment_idx ON public.assessments (enrollment_id);
CREATE INDEX IF NOT EXISTS assessments_assessor_idx ON public.assessments (assessor_profile_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_profile_id);

-- Avoid re-evaluating auth.uid() for each row in common RLS predicates.
DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin()));

DROP POLICY IF EXISTS profile_roles_read_own_or_admin ON public.profile_roles;
CREATE POLICY profile_roles_read_own_or_admin ON public.profile_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin()));

DROP POLICY IF EXISTS trainee_profiles_read_own_or_admin ON public.trainee_profiles;
CREATE POLICY trainee_profiles_read_own_or_admin ON public.trainee_profiles
  FOR SELECT TO authenticated
  USING (profile_id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin()));

DROP POLICY IF EXISTS mentor_profiles_public_or_owner_read ON public.mentor_profiles;
CREATE POLICY mentor_profiles_public_or_owner_read ON public.mentor_profiles
  FOR SELECT TO anon, authenticated
  USING (is_public OR profile_id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin()));

DROP POLICY IF EXISTS verification_documents_read_scoped ON public.verification_documents;
CREATE POLICY verification_documents_read_scoped ON public.verification_documents
  FOR SELECT TO authenticated
  USING (trainee_profile_id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin()));

DROP POLICY IF EXISTS training_offerings_read_published ON public.training_offerings;
CREATE POLICY training_offerings_read_published ON public.training_offerings
  FOR SELECT TO anon, authenticated
  USING (
    (status = 'PUBLISHED' AND EXISTS (
      SELECT 1 FROM public.mentor_profiles mp
      WHERE mp.profile_id = mentor_profile_id
        AND mp.is_public = true AND mp.profile_status = 'APPROVED'
    )) OR mentor_profile_id = (SELECT auth.uid()) OR (SELECT app_private.is_platform_admin())
  );

DROP POLICY IF EXISTS training_slots_read_available ON public.training_slots;
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
      WHERE o.id = offering_id AND o.mentor_profile_id = (SELECT auth.uid())
    ) OR (SELECT app_private.is_platform_admin())
  );

DROP POLICY IF EXISTS applications_submit_own ON public.training_applications;
CREATE POLICY applications_submit_own ON public.training_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    trainee_profile_id = (SELECT auth.uid())
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

DROP POLICY IF EXISTS logbook_entries_insert_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_insert_own_drafts ON public.logbook_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'DRAFT' AND submitted_at IS NULL
    AND created_by = (SELECT auth.uid())
    AND app_private.owns_instance(instance_id)
  );

DROP POLICY IF EXISTS logbook_entries_delete_own_drafts ON public.logbook_entries;
CREATE POLICY logbook_entries_delete_own_drafts ON public.logbook_entries
  FOR DELETE TO authenticated
  USING (status = 'DRAFT' AND app_private.owns_instance(instance_id));

DROP POLICY IF EXISTS trainee_verification_upload_own ON storage.objects;
CREATE POLICY trainee_verification_upload_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trainee-verification'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (SELECT app_private.is_trainee())
  );

DROP POLICY IF EXISTS trainee_verification_read_own_or_admin ON storage.objects;
CREATE POLICY trainee_verification_read_own_or_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'trainee-verification'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT app_private.is_platform_admin())
    )
  );

