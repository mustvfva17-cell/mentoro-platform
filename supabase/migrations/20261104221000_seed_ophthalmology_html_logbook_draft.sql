-- Register Ophthalmology as a private HTML template draft.
-- The official 2026-2027 clinical logbook and the existing Semester 9 roadmap
-- are preserved as source references. Tier/depth/frequency are provisional
-- curriculum-organizing labels and require review by an ophthalmologist.
-- No emergency-management templates are included pending specialist review.

INSERT INTO public.logbook_templates (
  specialty_id, slug, title, description, is_active
)
SELECT
  s.id,
  'ophthalmology-html',
  'Ophthalmology Clinical Logbook',
  'MENTORO Ophthalmology runtime with the 18 official lecture topics, 29 clinical training items adapted from the official schedule, course aims, weekly clinical schedule, patient journey, clinical interpretation, case/session/procedure records, and mentor review.',
  false
FROM public.specialties s
WHERE s.slug = 'ophthalmology'
ON CONFLICT (slug) DO NOTHING;

DO $seed$
DECLARE
  v_template_id uuid;
BEGIN
  SELECT t.id INTO v_template_id
  FROM public.logbook_templates t
  JOIN public.specialties sp ON sp.id = t.specialty_id
  WHERE t.slug = 'ophthalmology-html'
    AND sp.slug = 'ophthalmology';

  IF v_template_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.logbook_templates WHERE slug = 'ophthalmology-html') THEN
      RAISE EXCEPTION 'The ophthalmology-html slug is already bound to a different specialty';
    END IF;
    RAISE EXCEPTION 'Could not resolve the Ophthalmology HTML template after seed; verify the Ophthalmology specialty row exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.logbook_template_versions
    WHERE template_id = v_template_id AND version_number = 1
  ) THEN
    INSERT INTO public.logbook_template_versions (
      template_id, version_number, status, is_assignable, schema_definition,
      template_definition, source_notes
    ) VALUES (
      v_template_id,
      1,
      'DRAFT',
      false,
      '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
      jsonb_build_object(
        'renderer', 'HTML',
        'html_path', '/logbooks/ophthalmology/index.html',
        'source', 'Ophthalmology LOGBOOK 26-27.pdf and MENTORO Semester 9 tracker',
        'sections', jsonb_build_array(
          'Overview','Lectures & Theory','Course Learning Aims','Weekly Clinical Training Schedule','Clinical Roadmap','Patient Journey','Clinical Interpretation',
          'Sessions','Clinical Cases','Procedures & Discussions','Emergency',
          'Reflection','Mentor Review'
        ),
        'clinical_review_required', true,
        'readiness', 'DRAFT: ophthalmologist review of all clinical content, procedural depth, consent/chaperone wording, referral criteria, and any emergency content is required before assignment. All practical examination skills remain supervised.',
        'versionLabel', 'HTML-v1'
      ),
      'Source: Mansoura Faculty of Medicine Ophthalmology Clinical Logbook 2026-2027 (18 lecture topics, course aims, clinical training schedule, and examination checklists) and the user''s MENTORO Semester 9 tracker roadmap. Lecture completion is tracked in the existing roadmap state object using stable OPH-01–OPH-18 identifiers; no database schema change is required. Tier, depth, and frequency labels are provisional curriculum-organizing choices, not official competency requirements. The runtime deliberately contains no emergency management templates until reviewed and approved by an ophthalmologist. Clinical examinations require patient explanation and consent, privacy, appropriate chaperoning under local policy, and direct supervision within the trainee''s scope.'
    );
  END IF;
END
$seed$;
