-- Add the trusted Ophthalmology HTML route without changing any authorization,
-- enrollment ownership, revision checking, or mentor-review logic.
-- Reuse the existing function definitions and append one fixed path to each allowlist.
DO $register_ophthalmology$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_updated_definition text;
  v_old_path text := quote_literal('/logbooks/pediatrics/index.html');
  v_new_path text := quote_literal('/logbooks/pediatrics/index.html')
    || ', ' || quote_literal('/logbooks/ophthalmology/index.html');
  v_functions regprocedure[] := ARRAY[
    'app_private.admin_assign_trainee_enrollment_logbook(uuid,uuid,text,uuid)'::regprocedure,
    'app_private.admin_publish_logbook_template_version(uuid,text)'::regprocedure,
    'app_private.get_my_logbook_html_item_reviews(uuid)'::regprocedure,
    'app_private.get_my_logbook_html_state(uuid)'::regprocedure,
    'app_private.guard_logbook_template_version_schema()'::regprocedure,
    'app_private.mentor_review_html_logbook_item(uuid,text,text,text,text)'::regprocedure,
    'app_private.save_my_logbook_html_state(uuid,jsonb,bigint)'::regprocedure
  ];
BEGIN
  FOREACH v_function IN ARRAY v_functions
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function);

    IF pg_catalog.strpos(v_definition, v_old_path) = 0 THEN
      RAISE EXCEPTION 'Ophthalmology registration expected the Pediatrics route in %', v_function;
    END IF;

    v_updated_definition := pg_catalog.replace(v_definition, v_old_path, v_new_path);

    IF v_updated_definition = v_definition
       OR pg_catalog.strpos(v_updated_definition, quote_literal('/logbooks/ophthalmology/index.html')) = 0 THEN
      RAISE EXCEPTION 'Could not extend the HTML route allowlist in %', v_function;
    END IF;

    EXECUTE v_updated_definition;
  END LOOP;
END;
$register_ophthalmology$;
