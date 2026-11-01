-- Keep the scoped submission RPC compatible with least-privilege column grants.
-- Timestamp and updated_at are assigned by BEFORE triggers; clients only need
-- UPDATE(status) for this workflow.
CREATE OR REPLACE FUNCTION public.set_logbook_entry_submitted(
  p_actor_id uuid,
  p_entry_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entry public.logbook_entries%ROWTYPE;
BEGIN
  IF p_actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Actor identity mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT le.* INTO v_entry
  FROM public.logbook_entries le
  WHERE le.id = p_entry_id
    AND app_private.owns_instance(le.instance_id)
  FOR UPDATE;

  IF NOT FOUND OR v_entry.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only your draft entries can be submitted' USING ERRCODE = '42501';
  END IF;

  UPDATE public.logbook_entries
  SET status = 'SUBMITTED'
  WHERE id = p_entry_id AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry changed before submission; refresh and retry';
  END IF;

  RETURN p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_logbook_entry_submitted(uuid, uuid) TO authenticated;
