-- Limit browser writes to columns the trainee/mentor workflow owns.
-- This prevents clients from supplying decision metadata or overriding audit
-- timestamps when inserting an application, entry, or review.

REVOKE INSERT, UPDATE ON TABLE public.logbook_entries FROM authenticated;
GRANT INSERT (instance_id, entry_type, title, entry_date, payload, status, created_by)
ON TABLE public.logbook_entries TO authenticated;
GRANT UPDATE (title, entry_date, payload, status, submitted_at)
ON TABLE public.logbook_entries TO authenticated;

REVOKE INSERT ON TABLE public.training_applications FROM authenticated;
GRANT INSERT (trainee_profile_id, offering_id, slot_id, applicant_note, status)
ON TABLE public.training_applications TO authenticated;

REVOKE INSERT ON TABLE public.entry_reviews FROM authenticated;
GRANT INSERT (entry_id, reviewer_profile_id, decision, feedback)
ON TABLE public.entry_reviews TO authenticated;
