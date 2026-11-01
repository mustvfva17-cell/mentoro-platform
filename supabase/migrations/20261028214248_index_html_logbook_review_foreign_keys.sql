-- Index foreign-key columns used by logbook HTML state ownership and mentor review history.
-- Safe, additive performance improvement; does not alter RLS or browser table privileges.
CREATE INDEX IF NOT EXISTS logbook_html_states_updated_by_idx
  ON public.logbook_html_states (updated_by);

CREATE INDEX IF NOT EXISTS logbook_html_item_reviews_reviewer_profile_id_idx
  ON public.logbook_html_item_reviews (reviewer_profile_id);
