-- The registered General Surgery HTML runtime is the supported trainee-facing logbook.
-- Keep the older structured JSON pilot for audit/history, but remove it from new offering selection.
-- Do not modify template versions or any existing enrollment/logbook history.
UPDATE public.logbook_templates
SET is_active = false,
    description = 'Legacy structured JSON pilot retained for audit/history. The supported General Surgery trainee runtime is the registered HTML logbook at /logbooks/general-surgery/index.html. This legacy draft is not available for new training offerings.'
WHERE slug = 'general-surgery'
  AND is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.logbook_template_versions v
    WHERE v.template_id = public.logbook_templates.id
      AND (v.status = 'PUBLISHED' OR v.is_assignable = true)
  );
