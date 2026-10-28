-- Enforce server-side submission timestamps even if a client bypasses the UI
-- and attempts to write an arbitrary submitted_at value directly.
CREATE OR REPLACE FUNCTION app_private.enforce_entry_submission_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    NEW.submitted_at := statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enforce_entry_submission_timestamp()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS logbook_entry_submission_timestamp ON public.logbook_entries;
CREATE TRIGGER logbook_entry_submission_timestamp
BEFORE UPDATE OF status ON public.logbook_entries
FOR EACH ROW
WHEN (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED')
EXECUTE FUNCTION app_private.enforce_entry_submission_timestamp();
