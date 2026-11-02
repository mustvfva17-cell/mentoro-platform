-- Register the existing Medical Oncology HTML asset as a draft template version.
-- Resolve the specialty by its stable slug; specialty UUIDs are database-local.
-- This does not publish the clinical content or make the template assignable.

INSERT INTO public.logbook_templates (
  specialty_id, slug, title, description, is_active
)
SELECT
  s.id,
  'medical-oncology-html',
  'Medical Oncology Clinical Logbook',
  'Existing MENTORO Medical Oncology interactive HTML logbook. Uses its original roadmap, sessions, cases, procedures, emergency, and reflection views.',
  true
FROM public.specialties s
WHERE s.slug = 'medical-oncology'
ON CONFLICT (slug) DO NOTHING;

DO $seed$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.logbook_templates t
    JOIN public.specialties s ON s.id = t.specialty_id
    WHERE t.slug = 'medical-oncology-html'
      AND s.slug = 'medical-oncology'
  ) THEN
    RAISE EXCEPTION 'Could not resolve the Medical Oncology HTML template after seed; verify the Medical Oncology specialty row exists';
  END IF;
END;
$seed$;

INSERT INTO public.logbook_template_versions (
  template_id, version_number, status, is_assignable,
  schema_definition, template_definition, source_notes
)
SELECT
  t.id,
  1,
  'DRAFT',
  false,
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
  '{"renderer":"HTML","html_path":"/logbooks/medical-oncology/index.html","source":"Existing MENTORO Medical Oncology HTML logbook supplied by the platform owner","sections":["Roadmap","Sessions","Clinical Cases","Procedures","Emergency","Reflection","Progress"],"readiness":"DRAFT: verify integration and complete clinical review before making assignable","versionLabel":"HTML-v1"}'::jsonb,
  'Source: existing MENTORO Medical Oncology HTML logbook. The current row is an integration draft; clinical publication requires an explicit authorized review.'
FROM public.logbook_templates t
JOIN public.specialties s ON s.id = t.specialty_id
WHERE t.slug = 'medical-oncology-html'
  AND s.slug = 'medical-oncology'
ON CONFLICT (template_id, version_number) DO NOTHING;
