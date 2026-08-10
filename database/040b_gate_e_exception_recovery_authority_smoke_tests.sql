-- ROLLBACK-ONLY Gate E exception-recovery authority smoke.
BEGIN;

DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'automation_recovery_context(uuid,uuid,uuid)',
    'automation_record_exception_recovery(uuid,uuid,uuid,uuid,text,text,text,text)',
    'automation_retry_exception_matching(uuid,uuid,uuid)'
  ] LOOP
    IF has_function_privilege('anon', 'public.' || v_name, 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.' || v_name, 'EXECUTE')
      OR NOT has_function_privilege('service_role', 'public.' || v_name, 'EXECUTE')
      OR NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.oid = ('public.' || v_name)::regprocedure
          AND n.nspname = 'public'
          AND p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::TEXT[]
          AND pg_get_userbyid(p.proowner) = 'postgres'
      ) THEN
      RAISE EXCEPTION 'SECURITY: recovery RPC privilege drift for %', v_name;
    END IF;
  END LOOP;

  IF has_function_privilege(
    'service_role', 'public.automation_valid_reference_array(jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SECURITY: validation helper is directly executable';
  END IF;

  IF has_table_privilege('anon', 'public.automation_exception_recoveries', 'SELECT')
    OR has_table_privilege('authenticated', 'public.automation_exception_recoveries', 'SELECT')
    OR has_table_privilege('authenticated', 'public.automation_exception_recoveries', 'INSERT')
    OR NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'automation_exception_recoveries'
        AND c.relrowsecurity
    ) THEN
    RAISE EXCEPTION 'SECURITY: recovery table privilege/RLS drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.automation_allocation_decisions'::regclass
      AND conname = 'chk_automation_allocation_evidence_type'
      AND pg_get_constraintdef(oid) LIKE '%human_confirmed_invoice%'
  ) THEN
    RAISE EXCEPTION 'CONFIG: human-confirmed allocation evidence is unavailable';
  END IF;
END;
$$;

ROLLBACK;
