-- Bind an application to a slot belonging to the selected offering.
-- Qualify both outer-row columns so inner table columns cannot shadow them
-- inside the EXISTS subquery used by the RLS policy.
DROP POLICY IF EXISTS applications_submit_own ON public.training_applications;

CREATE POLICY applications_submit_own
  ON public.training_applications
  FOR INSERT TO authenticated
  WITH CHECK (
    trainee_profile_id = (SELECT auth.uid())
    AND status = 'SUBMITTED'
    AND app_private.is_verified_trainee()
    AND EXISTS (
      SELECT 1
      FROM public.training_offerings AS o
      JOIN public.training_slots AS s ON s.offering_id = o.id
      JOIN public.logbook_template_versions AS tv ON tv.id = o.template_version_id
      JOIN public.logbook_templates AS t ON t.id = tv.template_id
      WHERE o.id = training_applications.offering_id
        AND s.id = training_applications.slot_id
        AND o.status = 'PUBLISHED'
        AND s.status = 'OPEN'
        AND s.starts_at > now()
        AND tv.status = 'PUBLISHED'
        AND tv.is_assignable = true
        AND t.is_active = true
        AND t.specialty_id = o.specialty_id
    )
  );
