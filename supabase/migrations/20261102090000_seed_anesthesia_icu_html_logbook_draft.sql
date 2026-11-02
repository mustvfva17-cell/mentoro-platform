-- Seed Anesthesia & Critical Care as a private HTML template draft for the central admin review queue.
-- This does not publish the clinical content or make the template assignable.
-- The trusted HTML allowlist is registered in 20261102080000_register_anesthesia_icu_html_logbook.sql.

INSERT INTO public.logbook_templates (
  specialty_id, slug, title, description, is_active
)
SELECT
  s.id,
  'anaesthesia-critical-care-html',
  'Anesthesia & Critical Care Clinical Logbook',
  'MENTORO Anesthesia & Critical Care runtime with 157 roadmap items, 17 groups, perioperative and ICU learning prompts, five emergency templates, and mentor review.',
  false
FROM public.specialties s
WHERE s.slug = 'anaesthesia-critical-care'
ON CONFLICT (slug) DO NOTHING;

DO $seed$
DECLARE
  v_template_id uuid;
BEGIN
  SELECT t.id INTO v_template_id
  FROM public.logbook_templates t
  JOIN public.specialties sp ON sp.id = t.specialty_id
  WHERE t.slug = 'anaesthesia-critical-care-html'
    AND sp.slug = 'anaesthesia-critical-care';

  IF v_template_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.logbook_templates WHERE slug = 'anaesthesia-critical-care-html') THEN
      RAISE EXCEPTION 'The anaesthesia-critical-care-html slug is already bound to a different specialty';
    END IF;
    RAISE EXCEPTION 'Could not resolve the Anesthesia & Critical Care HTML template after seed; verify the specialty row exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.logbook_template_versions
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
        'html_path', '/logbooks/anesthesia-icu/index.html',
        'source', 'Owner-provided MENTORO Anesthesia & Critical Care Logbook V1 clinical source',
        'sections', jsonb_build_array(
          'Overview','Clinical Roadmap','Patient Journey','Clinical Interpretation',
          'Sessions','Clinical Cases','Procedures & Discussions','Emergency',
          'Reflection','Mentor Review'
        ),
        'clinical_review_required', true,
        'readiness', 'DRAFT: anesthesiologist or intensivist review of Tier, Depth, Frequency, and clinical prompts is required before assignment. Exposure records do not certify competence or authorize unsupervised practice.',
        'versionLabel', 'HTML-v1'
      ),
      'Source: owner-provided MENTORO Anesthesia & Critical Care Logbook V1. The source content includes 157 roadmap rows in 17 groups, nine patient-journey prompts, five clinical-interpretation prompts, and five emergency templates. The source README leaves Tier, Depth, and Frequency classifications subject to review by an anesthesiologist / intensivist. The clinical team must review procedures, emergency learning prompts, scope-of-practice wording, and all content before publication.'
    );
  END IF;
END
$seed$;
