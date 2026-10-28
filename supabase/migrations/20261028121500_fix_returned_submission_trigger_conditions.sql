-- The review/return workflow allows a returned entry to be resubmitted.
-- The trigger functions already handle OLD.status = RETURNED, but the original
-- trigger WHEN clauses only allowed DRAFT -> SUBMITTED. Recreate the triggers
-- so the condition and function logic agree for both initial and renewed
-- submissions.

DROP TRIGGER IF EXISTS logbook_entry_submission_timestamp ON public.logbook_entries;
CREATE TRIGGER logbook_entry_submission_timestamp
BEFORE UPDATE OF status ON public.logbook_entries
FOR EACH ROW
WHEN (OLD.status IN ('DRAFT', 'RETURNED') AND NEW.status = 'SUBMITTED')
EXECUTE FUNCTION app_private.enforce_entry_submission_timestamp();

DROP TRIGGER IF EXISTS logbook_entry_submission_audit ON public.logbook_entries;
CREATE TRIGGER logbook_entry_submission_audit
AFTER UPDATE OF status ON public.logbook_entries
FOR EACH ROW
WHEN (OLD.status IN ('DRAFT', 'RETURNED') AND NEW.status = 'SUBMITTED')
EXECUTE FUNCTION app_private.audit_entry_submission();
