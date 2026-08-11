-- ROLLBACK-ONLY Gate E retry-matching runtime/security smoke.
BEGIN;

DO $$
DECLARE
  v_retry_definition TEXT;
  v_reminder_definition TEXT;
  v_probe TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.automation_retry_exception_matching(uuid,uuid,uuid)'::regprocedure
  ) INTO v_retry_definition;
  SELECT pg_get_functiondef(
    'public.automation_evaluate_invoice_reminders(uuid,date,uuid)'::regprocedure
  ) INTO v_reminder_definition;

  -- Exact Production regression: both functions run with search_path='', so
  -- the pgcrypto call must remain schema-qualified and resolvable there.
  PERFORM set_config('search_path', '', true);
  SELECT encode(extensions.digest('gate-e-runtime-probe', 'sha256'), 'hex')
    INTO v_probe;
  IF length(v_probe) <> 64
    OR v_retry_definition NOT LIKE '%extensions.digest(%'
    OR v_retry_definition LIKE '%encode(digest(%'
    OR v_reminder_definition NOT LIKE '%extensions.digest(%'
    OR v_reminder_definition LIKE '%encode(digest(%' THEN
    RAISE EXCEPTION 'RUNTIME: empty-search-path pgcrypto qualification drift';
  END IF;

  IF has_function_privilege(
      'anon', 'public.allocate_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated', 'public.allocate_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role', 'public.allocate_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'SECURITY: allocate_receipt direct-execution boundary drift';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.automation_retry_exception_matching(uuid,uuid,uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.automation_retry_exception_matching(uuid,uuid,uuid)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.automation_retry_exception_matching(uuid,uuid,uuid)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'SECURITY: Retry Matching execution boundary drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid =
      'public.automation_retry_exception_matching(uuid,uuid,uuid)'::regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'SECURITY: Retry Matching owner/search_path drift';
  END IF;
END;
$$;

ROLLBACK;
