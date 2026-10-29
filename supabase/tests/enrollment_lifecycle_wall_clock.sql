-- Rollback-only source contract for the lifecycle decision clock.
-- Run ONLY on mentoro-platform-test or another disposable database.
BEGIN;

DO $test$
DECLARE
  v_definition text;
  v_lock_position integer;
  v_authorization_position integer;
  v_clock_position integer;
BEGIN
  SELECT pg_get_functiondef(
    'app_private.transition_my_training_enrollment(uuid,text,text)'::regprocedure
  )
  INTO v_definition;

  v_lock_position := position('FOR UPDATE;' IN v_definition);
  v_authorization_position := position(
    'IF NOT v_is_admin AND NOT v_is_assigned_mentor THEN' IN v_definition
  );
  v_clock_position := position(
    'v_transition_at := clock_timestamp();' IN v_definition
  );

  IF v_lock_position = 0 OR v_authorization_position = 0 OR v_clock_position = 0 THEN
    RAISE EXCEPTION 'Lifecycle RPC is missing its row lock, authorization guard, or wall-clock decision timestamp';
  END IF;

  IF v_clock_position <= v_lock_position OR v_clock_position <= v_authorization_position THEN
    RAISE EXCEPTION 'Wall-clock timestamp must be captured after the enrollment lock and authorization';
  END IF;

  IF position('v_transition_at timestamptz := now()' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Lifecycle RPC still initializes its decision time at transaction start';
  END IF;
END;
$test$;

ROLLBACK;
