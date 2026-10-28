CREATE OR REPLACE FUNCTION public.mentor_list_my_applications(p_limit integer DEFAULT 100)
RETURNS TABLE (
  application_id uuid,
  status text,
  created_at timestamptz,
  applicant_note text,
  mentor_decision_reason text,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz,
  offering_title text,
  offering_description text,
  delivery_mode text,
  specialty_name text,
  trainee_name text,
  university_name text,
  faculty_name text,
  year_of_study smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NULL OR NOT app_private.is_mentor() THEN
    RAISE EXCEPTION 'Active mentor session required' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Application page size must be between 1 and 200' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.status,
    a.created_at,
    a.applicant_note,
    a.mentor_decision_reason,
    s.starts_at,
    s.ends_at,
    o.title,
    o.description,
    o.delivery_mode,
    sp.name_en,
    COALESCE(NULLIF(trim(p.full_name), ''), 'Trainee'),
    tp.university_name,
    tp.faculty_name,
    tp.year_of_study
  FROM public.training_applications AS a
  JOIN public.training_offerings AS o ON o.id = a.offering_id
  JOIN public.training_slots AS s ON s.id = a.slot_id AND s.offering_id = o.id
  LEFT JOIN public.specialties AS sp ON sp.id = o.specialty_id
  LEFT JOIN public.trainee_profiles AS tp ON tp.profile_id = a.trainee_profile_id
  LEFT JOIN public.profiles AS p ON p.id = a.trainee_profile_id
  WHERE o.mentor_profile_id = v_actor_id
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.mentor_list_my_applications(integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mentor_list_my_applications(integer) TO authenticated;
