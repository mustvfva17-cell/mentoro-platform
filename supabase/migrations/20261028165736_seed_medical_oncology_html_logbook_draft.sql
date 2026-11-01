-- Register the existing Medical Oncology HTML logbook as a non-assignable draft.
-- The UI lives at public/logbooks/medical-oncology/index.html; this does not copy or recreate its content.
INSERT INTO public.logbook_templates (specialty_id, slug, title, description, is_active)
SELECT s.id,
       'medical-oncology-html',
       'Medical Oncology Clinical Logbook',
       'Existing MENTORO Medical Oncology interactive HTML logbook. Uses its original roadmap, sessions, cases, procedures, emergency, and reflection views.',
       true
FROM public.specialties s
WHERE s.name_en = 'Medical Oncology'
  AND s.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.logbook_templates t WHERE t.slug = 'medical-oncology-html'
  );

INSERT INTO public.logbook_template_versions (
  template_id, version_number, status, is_assignable, schema_definition,
  template_definition, source_notes
)
SELECT t.id,
       1,
       'DRAFT',
       false,
       '{"type":"object","$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":false}'::jsonb,
       jsonb_build_object(
         'renderer', 'HTML',
         'html_path', '/logbooks/medical-oncology/index.html',
         'source', 'Existing MENTORO Medical Oncology HTML logbook supplied by the platform owner',
         'sections', jsonb_build_array('Roadmap','Sessions','Clinical Cases','Procedures','Emergency','Reflection','Progress'),
         'versionLabel', 'HTML-v1',
         'readiness', 'DRAFT: verify integration and complete clinical review before making assignable'
       ),
       'Source: existing MENTORO Medical Oncology HTML logbook. The current row is an integration draft; clinical publication requires an explicit authorized review.'
FROM public.logbook_templates t
WHERE t.slug = 'medical-oncology-html'
  AND NOT EXISTS (
    SELECT 1 FROM public.logbook_template_versions v
    WHERE v.template_id = t.id AND v.version_number = 1
  );
