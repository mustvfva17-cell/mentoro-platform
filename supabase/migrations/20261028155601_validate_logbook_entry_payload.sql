-- Validate submitted logbook payloads against the immutable schema version attached to each instance.
-- The browser performs the same checks for usability; this trigger makes those checks enforceable
-- even when a client sends REST requests directly instead of using the form.
CREATE OR REPLACE FUNCTION app_private.validate_logbook_entry_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_schema jsonb;
  v_fields jsonb;
  v_field jsonb;
  v_value jsonb;
  v_key text;
  v_type text;
  v_required boolean;
  v_text text;
  v_date date;
  v_number numeric;
  v_min numeric;
  v_max numeric;
  v_max_length integer;
  v_limit_text text;
  v_limit_cap integer;
  v_field_count integer;
BEGIN
  IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF pg_column_size(NEW.payload) > 65536 THEN
    RAISE EXCEPTION 'Logbook payload exceeds the 64 KiB limit' USING ERRCODE = '22023';
  END IF;

  SELECT tv.schema_definition
    INTO v_schema
  FROM public.logbook_instances li
  JOIN public.logbook_template_versions tv ON tv.id = li.template_version_id
  WHERE li.id = NEW.instance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The logbook instance has no attached template version' USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(v_schema) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The attached logbook template schema is invalid' USING ERRCODE = '22023';
  END IF;

  -- Legacy templates without a structured fields array may store only an empty payload.
  IF jsonb_typeof(v_schema -> 'fields') IS DISTINCT FROM 'array' THEN
    IF NEW.payload <> '{}'::jsonb THEN
      RAISE EXCEPTION 'This logbook version does not define structured payload fields' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  v_fields := v_schema -> 'fields';
  v_field_count := jsonb_array_length(v_fields);
  IF v_field_count < 1 OR v_field_count > 100 THEN
    RAISE EXCEPTION 'The attached logbook schema must contain 1 to 100 fields' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(DISTINCT field ->> 'key')
    FROM jsonb_array_elements(v_fields) AS items(field)
  ) <> v_field_count THEN
    RAISE EXCEPTION 'The attached logbook schema contains duplicate or missing field keys' USING ERRCODE = '22023';
  END IF;

  -- Reject fields not present in the exact template version attached to this enrollment.
  FOR v_key IN SELECT jsonb_object_keys(NEW.payload)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_fields) AS items(field)
      WHERE field ->> 'key' = v_key
    ) THEN
      RAISE EXCEPTION 'Payload contains an unknown field key: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_field IN SELECT value FROM jsonb_array_elements(v_fields)
  LOOP
    IF jsonb_typeof(v_field) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'The attached logbook schema contains a non-object field' USING ERRCODE = '22023';
    END IF;

    v_key := v_field ->> 'key';
    v_type := v_field ->> 'type';

    IF coalesce(v_key, '') !~ '^[a-z][a-z0-9_]{0,63}$'
       OR nullif(trim(coalesce(v_field ->> 'label', '')), '') IS NULL
       OR coalesce(v_type, '') NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select') THEN
      RAISE EXCEPTION 'The attached logbook schema contains an invalid field definition' USING ERRCODE = '22023';
    END IF;

    IF v_field ? 'required'
       AND jsonb_typeof(v_field -> 'required') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'The required flag for field % must be boolean', v_key USING ERRCODE = '22023';
    END IF;
    v_required := coalesce((v_field ->> 'required')::boolean, false);

    -- Check schema constraints independently of the submitted value.
    v_min := NULL;
    v_max := NULL;
    IF v_type = 'number' THEN
      IF v_field ? 'min' THEN
        v_text := v_field ->> 'min';
        IF jsonb_typeof(v_field -> 'min') NOT IN ('number', 'string')
           OR coalesce(v_text, '') !~ '^-?[0-9]+([.][0-9]+)?$' THEN
          RAISE EXCEPTION 'The minimum for numeric field % must be a finite number', v_key USING ERRCODE = '22023';
        END IF;
        v_min := v_text::numeric;
      END IF;
      IF v_field ? 'max' THEN
        v_text := v_field ->> 'max';
        IF jsonb_typeof(v_field -> 'max') NOT IN ('number', 'string')
           OR coalesce(v_text, '') !~ '^-?[0-9]+([.][0-9]+)?$' THEN
          RAISE EXCEPTION 'The maximum for numeric field % must be a finite number', v_key USING ERRCODE = '22023';
        END IF;
        v_max := v_text::numeric;
      END IF;
      IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN
        RAISE EXCEPTION 'The minimum exceeds the maximum for numeric field %', v_key USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_type IN ('text', 'textarea') THEN
      v_limit_cap := CASE WHEN v_type = 'textarea' THEN 10000 ELSE 2000 END;
      v_max_length := CASE WHEN v_type = 'textarea' THEN 4000 ELSE 500 END;
      IF v_field ? 'maxLength' THEN
        v_limit_text := v_field ->> 'maxLength';
        IF coalesce(v_limit_text, '') !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'The maximum length for field % must be a positive integer', v_key USING ERRCODE = '22023';
        END IF;
        IF length(v_limit_text) > 9 THEN
          v_max_length := v_limit_cap;
        ELSE
          v_max_length := least(greatest(v_limit_text::integer, 1), v_limit_cap);
        END IF;
      END IF;
    END IF;

    IF v_type = 'select' THEN
      IF jsonb_typeof(v_field -> 'options') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_field -> 'options') < 2
         OR jsonb_array_length(v_field -> 'options') > 50 THEN
        RAISE EXCEPTION 'Select field % needs between 2 and 50 options', v_key USING ERRCODE = '22023';
      END IF;
    END IF;

    v_value := NEW.payload -> v_key;

    IF v_value IS NULL OR v_value = 'null'::jsonb
       OR (jsonb_typeof(v_value) = 'string' AND nullif(trim(v_value #>> '{}'), '') IS NULL) THEN
      IF v_required THEN
        RAISE EXCEPTION 'Required logbook field is missing: %', v_key USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;

    CASE v_type
      WHEN 'text', 'textarea' THEN
        IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'Field % must be text', v_key USING ERRCODE = '22023';
        END IF;
        v_text := v_value #>> '{}';
        IF length(v_text) > v_max_length THEN
          RAISE EXCEPTION 'Field % exceeds its maximum length', v_key USING ERRCODE = '22023';
        END IF;

      WHEN 'date' THEN
        IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'Field % must be an ISO date string', v_key USING ERRCODE = '22023';
        END IF;
        v_text := v_value #>> '{}';
        IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'Field % must use YYYY-MM-DD', v_key USING ERRCODE = '22023';
        END IF;
        BEGIN
          v_date := v_text::date;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Field % must be a valid calendar date', v_key USING ERRCODE = '22023';
        END;
        IF to_char(v_date, 'YYYY-MM-DD') <> v_text THEN
          RAISE EXCEPTION 'Field % must be a valid calendar date', v_key USING ERRCODE = '22023';
        END IF;

      WHEN 'number' THEN
        IF jsonb_typeof(v_value) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Field % must be numeric', v_key USING ERRCODE = '22023';
        END IF;
        v_number := (v_value #>> '{}')::numeric;
        IF v_min IS NOT NULL AND v_number < v_min THEN
          RAISE EXCEPTION 'Field % must be at least %', v_key, v_min USING ERRCODE = '22023';
        END IF;
        IF v_max IS NOT NULL AND v_number > v_max THEN
          RAISE EXCEPTION 'Field % must be at most %', v_key, v_max USING ERRCODE = '22023';
        END IF;

      WHEN 'boolean' THEN
        IF jsonb_typeof(v_value) IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'Field % must be true or false', v_key USING ERRCODE = '22023';
        END IF;

      WHEN 'select' THEN
        IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'Field % must be a string option', v_key USING ERRCODE = '22023';
        END IF;
        v_text := v_value #>> '{}';
        IF NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_field -> 'options') AS options(option_value)
          WHERE jsonb_typeof(option_value) = 'string'
            AND option_value #>> '{}' = v_text
        ) THEN
          RAISE EXCEPTION 'Field % must match one of its configured options', v_key USING ERRCODE = '22023';
        END IF;
    END CASE;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validate_logbook_entry_payload()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS logbook_entries_validate_payload ON public.logbook_entries;
CREATE TRIGGER logbook_entries_validate_payload
BEFORE INSERT OR UPDATE OF payload, instance_id
ON public.logbook_entries
FOR EACH ROW
EXECUTE FUNCTION app_private.validate_logbook_entry_payload();
