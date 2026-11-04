-- Register the official Ophthalmology course logbook as a private draft.
-- Clinical publication and trainee assignment remain separate, guarded decisions.
INSERT INTO public.logbook_templates (
  specialty_id, slug, title, description, is_active
)
SELECT
  s.id,
  'ophthalmology-html',
  'Ophthalmology Clinical Logbook',
  'Level 5 Semester 9 Ophthalmology course logbook: weekly clinical training, examination checklist, course objectives and end-of-semester OSCE structure.',
  false
FROM public.specialties s
WHERE s.slug = 'ophthalmology'
ON CONFLICT (slug) DO NOTHING;

DO $seed_ophthalmology$
DECLARE
  v_template_id uuid;
BEGIN
  SELECT t.id INTO v_template_id
  FROM public.logbook_templates t
  JOIN public.specialties s ON s.id = t.specialty_id
  WHERE t.slug = 'ophthalmology-html'
    AND s.slug = 'ophthalmology';

  IF v_template_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.logbook_templates WHERE slug = 'ophthalmology-html') THEN
      RAISE EXCEPTION 'The ophthalmology-html slug is already bound to a different specialty';
    END IF;
    RAISE EXCEPTION 'Could not resolve the Ophthalmology specialty row';
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
        'source', 'Ophthalmology LOGBOOK 26-27.pdf — Level 5 Semester 9, Academic Year 2026–2027',
        'sections', jsonb_build_array(
          'Overview',
          'Course Guide',
          'Clinical Roadmap',
          'Ophthalmology Examination Checklist',
          'Clinical Sessions',
          'Clinical Cases',
          'Procedures and Discussions',
          'Reflection',
          'Mentor Review'
        ),
        'clinical_review_required', true,
        'readiness', 'DRAFT: ophthalmologist review of examination techniques, role/supervision levels, repeated source items, patient-consent wording and local clinical policy is required before assignment',
        'versionLabel', 'HTML-v1'
      ),
      'Source: Ophthalmology LOGBOOK 26-27.pdf, Level 5 Semester 9 Academic Year 2026–2027. The source provides course objectives, weekly clinical training blocks, a 17-item clinical examination checklist and an end-of-semester OSCE structure of 3 stations x 5 minutes, 15 marks per station (45 total). The companion Semester 9 personal tracker contains suggested personal targets and is not treated as an official university requirement. Ophthalmologist review is required for the safety and currency of examination techniques, consent, supervision and local scope-of-practice wording before publication.'
    );
  END IF;
END;
$seed_ophthalmology$;
