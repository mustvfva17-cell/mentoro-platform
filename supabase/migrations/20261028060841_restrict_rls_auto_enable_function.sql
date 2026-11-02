DO $$
BEGIN
  -- This helper may exist in databases where the original hardening work was
  -- first developed, but it is not part of a clean Supabase project.
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
