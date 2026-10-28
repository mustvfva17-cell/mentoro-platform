-- Restrict broad table-level privileges that bypass row-level security.
-- RLS does not protect against TRUNCATE, and REFERENCES/TRIGGER are not
-- required by the browser client. Preserve the row-level DML policies and
-- grant only the browser writes explicitly covered by reviewed RLS policies.

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON ALL TABLES IN SCHEMA public
FROM anon, authenticated;

GRANT INSERT, UPDATE ON TABLE public.logbook_entries TO authenticated;
GRANT INSERT ON TABLE public.training_applications TO authenticated;
GRANT INSERT ON TABLE public.entry_reviews TO authenticated;
