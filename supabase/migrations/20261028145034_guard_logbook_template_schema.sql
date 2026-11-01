-- Validate structured logbook schema definitions at the database boundary.
-- Legacy drafts without a "fields" member remain readable, but cannot be published/assigned.
CREATE OR REPLACE FUNCTION app_private.guard_logbook_template_version_schema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_field jsonb;
  v_option jsonb;
  v_field_count integer;
  v_distinct_option_count integer;
  v_type text;
BEGIN
  IF jsonb_typeof(NEW.schema_definition) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Logbook schema definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF NEW.schema_definition ? 'fields' THEN
    IF jsonb_typeof(NEW.schema_definition -> 'fields') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Logbook schema fields must be an array' USING ERRCODE = '22023';
    END IF;

    v_field_count := jsonb_array_length(NEW.schema_definition -> 'fields');
    IF v_field_count < 1 OR v_field_count > 100 THEN
      RAISE EXCEPTION 'A structured logbook schema must contain between 1 and 100 fields' USING ERRCODE = '22023';
    END IF;

    FOR v_field IN SELECT value FROM jsonb_array_elements(NEW.schema_definition -> 'fields')
    LOOP
      v_type := v_field ->> 'type';
      IF jsonb_typeof(v_field) IS DISTINCT FROM 'object'
         OR coalesce(v_field ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
         OR length(trim(coalesce(v_field ->> 'label', ''))) < 1
         OR length(coalesce(v_field ->> 'label', '')) > 160
         OR coalesce(v_type, '') NOT IN ('text', 'textarea', 'date', 'number', 'boolean', 'select') THEN
        RAISE EXCEPTION 'Each schema field needs a unique valid key, label, and supported type' USING ERRCODE = '22023';
      END IF;

      IF v_type = 'select' THEN
        IF jsonb_typeof(v_field -> 'options') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_field -> 'options') < 2
           OR jsonb_array_length(v_field -> 'options') > 50 THEN
          RAISE EXCEPTION 'Select fields need between 2 and 50 options' USING ERRCODE = '22023';
        END IF;

        FOR v_option IN SELECT value FROM jsonb_array_elements(v_field -> 'options')
        LOOP
          IF jsonb_typeof(v_option) IS DISTINCT FROM 'string'
             OR nullif(trim(v_option #>> '{}'), '') IS NULL
             OR length(v_option #>> '{}') > 120 THEN
            RAISE EXCEPTION 'Select options must be non-empty strings of at most 120 characters' USING ERRCODE = '22023';
          END IF;
        END LOOP;

        SELECT count(DISTINCT lower(trim(option_value #>> '{}')))::integer
        INTO v_distinct_option_count
        FROM jsonb_array_elements(v_field -> 'options') AS options(option_value);
        IF v_distinct_option_count <> jsonb_array_length(v_field -> 'options') THEN
          RAISE EXCEPTION 'Select options must be unique, ignoring case' USING ERRCODE = '22023';
        END IF;
      END IF;
    END LOOP;

    IF (
      SELECT count(DISTINCT field ->> 'key')
      FROM jsonb_array_elements(NEW.schema_definition -> 'fields') AS items(field)
    ) <> v_field_count THEN
      RAISE EXCEPTION 'Logbook schema field keys must be unique' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.status = 'PUBLISHED' OR NEW.is_assignable THEN
    IF jsonb_typeof(NEW.schema_definition -> 'fields') IS DISTINCT FROM 'array'
       OR jsonb_array_length(NEW.schema_definition -> 'fields') < 1 THEN
      RAISE EXCEPTION 'A published/assignable template requires structured fields' USING ERRCODE = '22023';
    END IF;
    IF length(trim(coalesce(NEW.source_notes, ''))) < 20 THEN
      RAISE EXCEPTION 'A published/assignable template requires source and clinical review notes' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.guard_logbook_template_version_schema() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_logbook_template_version_schema ON public.logbook_template_versions;
CREATE TRIGGER guard_logbook_template_version_schema
BEFORE INSERT OR UPDATE OF schema_definition, status, is_assignable, source_notes
ON public.logbook_template_versions
FOR EACH ROW
EXECUTE FUNCTION app_private.guard_logbook_template_version_schema();
