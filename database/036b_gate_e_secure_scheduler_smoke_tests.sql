-- Gate E secure scheduler rollback smoke. Never execute in Production.
-- The transaction never commits, so neither pg_cron nor pg_net can execute the
-- synthetic scheduled/request rows created below.
BEGIN;

DO $$
DECLARE
  v_signature TEXT;
  v_function RECORD;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'automation_worker_lease_acquire(uuid)',
    'automation_worker_lease_release(uuid,boolean)',
    'automation_worker_nonce_claim(uuid,timestamp with time zone)',
    'automation_scheduler_assert_secret()',
    'automation_scheduler_invoke()',
    'automation_scheduler_install()',
    'automation_scheduler_remove()'
  ]
  LOOP
    IF to_regprocedure('public.' || v_signature) IS NULL THEN
      RAISE EXCEPTION 'Missing Gate E scheduler function: %', v_signature;
    END IF;
    SELECT p.prosecdef, p.proconfig, owner_role.rolname AS owner_name
      INTO v_function
    FROM pg_proc AS p
    JOIN pg_roles AS owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.' || v_signature);
    IF NOT v_function.prosecdef
      OR v_function.owner_name <> 'postgres'
      OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', 'public.' || v_signature, 'EXECUTE')
      OR has_function_privilege(
        'authenticated', 'public.' || v_signature, 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'Unsafe Gate E scheduler function: %', v_signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'service_role',
    'public.automation_worker_lease_acquire(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.automation_worker_lease_release(uuid,boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.automation_worker_nonce_claim(uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.automation_scheduler_invoke()',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.automation_scheduler_install()',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.automation_scheduler_remove()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Unsafe Gate E scheduler service-role grants';
  END IF;

  IF has_table_privilege(
    'anon',
    'gate_e_internal.automation_worker_nonces',
    'SELECT'
  ) OR has_table_privilege(
    'authenticated',
    'gate_e_internal.automation_worker_nonces',
    'SELECT'
  ) OR has_table_privilege(
    'service_role',
    'gate_e_internal.automation_worker_nonces',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'API role can read scheduler nonce state';
  END IF;
END
$$;

DO $$
DECLARE
  v_first UUID := gen_random_uuid();
  v_second UUID := gen_random_uuid();
BEGIN
  IF NOT public.automation_worker_lease_acquire(v_first) THEN
    RAISE EXCEPTION 'Initial worker lease was not acquired';
  END IF;
  IF public.automation_worker_lease_acquire(v_second) THEN
    RAISE EXCEPTION 'Overlapping worker lease was acquired';
  END IF;
  PERFORM public.automation_worker_lease_release(v_first, TRUE);
  IF NOT public.automation_worker_lease_acquire(v_second) THEN
    RAISE EXCEPTION 'Released worker lease could not be reacquired';
  END IF;
  PERFORM public.automation_worker_lease_release(v_second, FALSE);
END
$$;

DO $$
DECLARE
  v_secret_id UUID;
  v_job_id BIGINT;
  v_second_job_id BIGINT;
  v_request_id BIGINT;
  v_request RECORD;
  v_authorization TEXT;
  v_issued_at BIGINT;
  v_nonce UUID;
  v_expected_signature TEXT;
  v_unrelated_job_id BIGINT;
  v_removed INTEGER;
  v_fixture_secret TEXT :=
    'scheduler_smoke_fixture_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
BEGIN
  BEGIN
    PERFORM public.automation_scheduler_install();
    RAISE EXCEPTION 'Scheduler installed without its Vault secret';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'GATE_E_WORKER_SECRET_UNAVAILABLE' THEN RAISE; END IF;
  END;

  SELECT vault.create_secret(
    v_fixture_secret,
    'AUTOMATION_WORKER_SECRET',
    'Gate E Automation worker scheduler secret'
  ) INTO v_secret_id;

  v_unrelated_job_id := cron.schedule(
    'gate-e-scheduler-smoke-unrelated',
    '0 0 1 1 *',
    'SELECT 1;'
  );
  v_job_id := public.automation_scheduler_install();
  v_second_job_id := public.automation_scheduler_install();
  IF v_job_id IS NULL OR v_second_job_id IS NULL OR (
    SELECT COUNT(*)
    FROM cron.job
    WHERE jobname = 'gate-e-automation-worker'
      AND active
  ) <> 1 THEN
    RAISE EXCEPTION 'Scheduler install was not idempotent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'gate-e-automation-worker'
      AND (
        schedule <> '*/10 * * * *'
        OR command <> 'SELECT public.automation_scheduler_invoke();'
        OR command LIKE '%' || v_fixture_secret || '%'
      )
  ) THEN
    RAISE EXCEPTION 'Scheduler job contract or secret boundary is invalid';
  END IF;

  v_request_id := public.automation_scheduler_invoke();
  SELECT request.method, request.url, request.headers,
         pg_catalog.convert_from(request.body, 'UTF8') AS body_text,
         request.timeout_milliseconds
    INTO v_request
  FROM net.http_request_queue AS request
  WHERE request.id = v_request_id;
  v_authorization := v_request.headers->>'X-Automation-Worker-Secret';
  IF v_authorization !~
    '^v1\.[0-9]{10}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Scheduler authorization token is malformed';
  END IF;
  v_issued_at := pg_catalog.split_part(v_authorization, '.', 2)::BIGINT;
  v_nonce := pg_catalog.split_part(v_authorization, '.', 3)::UUID;
  v_expected_signature := pg_catalog.encode(
    extensions.hmac(
      'gate-e-automation-worker:v1:' || v_issued_at::TEXT || ':' ||
        v_nonce::TEXT,
      v_fixture_secret,
      'sha256'
    ),
    'hex'
  );
  IF v_request.method <> 'POST'
    OR v_request.url <>
      'https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/worker/run'
    OR v_request.headers->>'Content-Type' <> 'application/json'
    OR v_authorization = v_fixture_secret
    OR pg_catalog.split_part(v_authorization, '.', 4)
      <> v_expected_signature
    OR v_request.body_text <> '{}'
    OR v_request.timeout_milliseconds <> 120000 THEN
    RAISE EXCEPTION 'Scheduler pg_net request contract is invalid';
  END IF;

  IF NOT public.automation_worker_nonce_claim(
    v_nonce,
    pg_catalog.to_timestamp(v_issued_at)
  ) OR public.automation_worker_nonce_claim(
    v_nonce,
    pg_catalog.to_timestamp(v_issued_at)
  ) THEN
    RAISE EXCEPTION 'Scheduler invocation nonce was not one-time';
  END IF;

  v_removed := public.automation_scheduler_remove();
  IF v_removed <> 1 OR EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'gate-e-automation-worker'
  ) OR NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobid = v_unrelated_job_id
  ) THEN
    RAISE EXCEPTION 'Scheduler removal exceeded the Gate E job boundary';
  END IF;

  PERFORM cron.unschedule(v_unrelated_job_id);
  DELETE FROM vault.secrets WHERE id = v_secret_id;
END
$$;

ROLLBACK;
