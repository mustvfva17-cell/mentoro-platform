-- Rollback-only source contract ensuring HTML logbook saves serialize with closure.
-- Run ONLY on mentoro-platform-test or another disposable database.
BEGIN;

DO $test$
DECLARE
  v_definition text;
  v_lock_position integer;
  v_read_only_guard_position integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.save_my_logbook_html_state(uuid,jsonb,bigint)'::regprocedure
  )
  INTO v_definition;

  v_lock_position := position('FOR SHARE OF e, li;' IN v_definition);
  v_read_only_guard_position := position(
    'IF v_archived_at IS NOT NULL OR v_enrollment_status NOT IN (''CONFIRMED'', ''ACTIVE'') THEN'
    IN v_definition
  );

  IF v_lock_position = 0 OR v_read_only_guard_position = 0 THEN
    RAISE EXCEPTION 'HTML state saver is missing its enrollment/instance lock or read-only status guard';
  END IF;

  IF v_lock_position >= v_read_only_guard_position THEN
    RAISE EXCEPTION 'HTML state saver must lock the enrollment and instance before checking open status';
  END IF;

  IF position('/logbooks/medical-oncology/index.html' IN v_definition) = 0
     OR position('/logbooks/general-surgery/index.html' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'HTML state saver no longer covers both registered HTML logbook assets';
  END IF;
END;
$test$;

ROLLBACK;
