-- Register the existing Medical Oncology HTML asset as a draft template version.
-- This does not publish the clinical content or make the template assignable.
INSERT INTO public.logbook_templates (
  id, specialty_id, slug, title, description, is_active
) VALUES (
  'd6237f81-4e5c-4a38-8e71-f900ea6268d4',
  '5545aff6-e2d4-4fa8-85b6-1a2468112a86',
  'medical-oncology-html',
  'Medical Oncology Clinical Logbook',
  'Existing MENTORO Medical Oncology interactive HTML logbook. Uses its original roadmap, sessions, cases, procedures, emergency, and reflection views.',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.logbook_template_versions (
  id, template_id, version_number, status, is_assignable,
  schema_definition, template_definition, source_notes
) VALUES (
  '4b0e896e-973c-4025-85bb-13d47176860e',
  'd6237f81-4e5c-4a38-8e71-f900ea6268d4',
  1,
  'DRAFT',
  false,
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","additionalProperties":false}'::jsonb,
  '{"renderer":"HTML","html_path":"/logbooks/medical-oncology/index.html","source":"Existing MENTORO Medical Oncology HTML logbook supplied by the platform owner","sections":["Roadmap","Sessions","Clinical Cases","Procedures","Emergency","Reflection","Progress"],"readiness":"DRAFT: verify integration and complete clinical review before making assignable","versionLabel":"HTML-v1"}'::jsonb,
  'Source: existing MENTORO Medical Oncology HTML logbook. The current row is an integration draft; clinical publication requires an explicit authorized review.'
)
ON CONFLICT (id) DO NOTHING;
