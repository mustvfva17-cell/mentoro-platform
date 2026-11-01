-- Seed Neurology as a private HTML template draft for the central admin review queue.
-- This does not publish the clinical content or make the template assignable.
-- The trusted HTML allowlist is registered in 20261102040000_register_neurology_html_logbook.sql.

INSERT INTO public.logbook_templates (
  specialty_id, slug, title, description, is_active
)
SELECT
  s.id,
  'neurology-html',
  'Neurology Clinical Logbook',
  'MENTORO Neurology runtime with 115 roadmap items, five emergency templates, session/case/procedure records, reflection, and mentor review.',
  false
FROM public.specialties s
WHERE s.slug = 'neurology'
ON CONFLICT (slug) DO NOTHING;

DO $seed$
DECLARE
  v_template_id uuid;
BEGIN
  SELECT t.id INTO v_template_id
  FROM public.logbook_templates t
  JOIN public.specialties sp ON sp.id = t.specialty_id
  WHERE t.slug = 'neurology-html'
    AND sp.slug = 'neurology';

  IF v_template_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.logbook_templates WHERE slug = 'neurology-html') THEN
      RAISE EXCEPTION 'The neurology-html slug is already bound to a different specialty';
    END IF;
    RAISE EXCEPTION 'Could not resolve the Neurology HTML template after seed; verify the Neurology specialty row exists';
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
        'html_path', '/logbooks/neurology/index.html',
        'source', 'Owner-provided MENTORO Neurology Logbook V1 clinical source',
        'sections', jsonb_build_array(
          'Overview','Clinical Roadmap','Sessions','Clinical Cases',
          'Procedures & Discussions','Emergency','Reflection','Mentor Review'
        ),
        'clinical_review_required', true,
        'readiness', 'DRAFT: neurologist review of Tier, Depth, Frequency, and clinical prompts is required before assignment',
        'versionLabel', 'HTML-v1'
      ),
      'Source: owner-provided MENTORO Neurology Logbook V1. The source README requires review of Tier, Depth, and Frequency by a neurologist; the clinical team must also approve the examination consent/chaperone guidance and emergency learning prompts before publication.'
    );
  END IF;
END
$seed$;
