-- Submission timestamps are assigned by the database trigger during the
-- DRAFT -> SUBMITTED transition. Browser clients should not have direct
-- column-level UPDATE permission on submitted_at.
REVOKE UPDATE (submitted_at)
ON TABLE public.logbook_entries
FROM authenticated;
