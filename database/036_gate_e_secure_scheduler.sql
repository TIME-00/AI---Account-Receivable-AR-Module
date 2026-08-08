-- Gate E activation prerequisite: secure, explicitly installed pg_cron/pg_net
-- scheduler infrastructure. Applying this migration does not provision the
-- worker secret, install a cron job, invoke the worker, or mutate business or
-- financial data.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
    OR to_regprocedure('extensions.hmac(text,text,text)') IS NULL
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
    OR to_regprocedure('cron.unschedule(bigint)') IS NULL THEN
    RAISE EXCEPTION
      'GATE_E_SCHEDULER_PREREQUISITE_UNAVAILABLE: pg_cron, pg_net, and Supabase Vault are required';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS gate_e_internal AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gate_e_internal FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gate_e_internal.automation_worker_lease (
  singleton_key BOOLEAN PRIMARY KEY DEFAULT TRUE,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_outcome TEXT,
  CONSTRAINT chk_automation_worker_lease_singleton CHECK (singleton_key),
  CONSTRAINT chk_automation_worker_lease_pair CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT chk_automation_worker_lease_outcome CHECK (
    last_outcome IS NULL OR last_outcome IN ('running', 'completed', 'failed')
  )
);

CREATE TABLE gate_e_internal.automation_worker_nonces (
  nonce UUID PRIMARY KEY,
  issued_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_automation_worker_nonce_expiry CHECK (expires_at > issued_at)
);

ALTER TABLE gate_e_internal.automation_worker_lease OWNER TO postgres;
ALTER TABLE gate_e_internal.automation_worker_nonces OWNER TO postgres;
REVOKE ALL ON TABLE gate_e_internal.automation_worker_lease
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE gate_e_internal.automation_worker_nonces
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.automation_worker_lease_acquire(
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STRICT
SET search_path = ''
AS $$
DECLARE
  v_acquired BOOLEAN;
BEGIN
  INSERT INTO gate_e_internal.automation_worker_lease (
    singleton_key,
    lease_token,
    lease_expires_at,
    last_started_at,
    last_outcome
  ) VALUES (
    TRUE,
    p_lease_token,
    pg_catalog.clock_timestamp() + INTERVAL '8 minutes',
    pg_catalog.clock_timestamp(),
    'running'
  )
  ON CONFLICT (singleton_key) DO UPDATE
  SET lease_token = EXCLUDED.lease_token,
      lease_expires_at = EXCLUDED.lease_expires_at,
      last_started_at = EXCLUDED.last_started_at,
      last_outcome = EXCLUDED.last_outcome
  WHERE gate_e_internal.automation_worker_lease.lease_token IS NULL
    OR gate_e_internal.automation_worker_lease.lease_expires_at
      <= pg_catalog.clock_timestamp()
  RETURNING TRUE INTO v_acquired;

  RETURN COALESCE(v_acquired, FALSE);
END
$$;

CREATE OR REPLACE FUNCTION public.automation_worker_lease_release(
  p_lease_token UUID,
  p_succeeded BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
STRICT
SET search_path = ''
AS $$
BEGIN
  UPDATE gate_e_internal.automation_worker_lease
  SET lease_token = NULL,
      lease_expires_at = NULL,
      last_completed_at = pg_catalog.clock_timestamp(),
      last_outcome = CASE WHEN p_succeeded THEN 'completed' ELSE 'failed' END
  WHERE singleton_key
    AND lease_token = p_lease_token;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_worker_nonce_claim(
  p_nonce UUID,
  p_issued_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STRICT
SET search_path = ''
AS $$
DECLARE
  v_claimed BOOLEAN;
BEGIN
  IF p_issued_at < pg_catalog.clock_timestamp() - INTERVAL '3 minutes'
    OR p_issued_at > pg_catalog.clock_timestamp() + INTERVAL '30 seconds' THEN
    RETURN FALSE;
  END IF;

  DELETE FROM gate_e_internal.automation_worker_nonces
  WHERE expires_at < pg_catalog.clock_timestamp();

  INSERT INTO gate_e_internal.automation_worker_nonces (
    nonce,
    issued_at,
    expires_at
  ) VALUES (
    p_nonce,
    p_issued_at,
    p_issued_at + INTERVAL '3 minutes'
  )
  ON CONFLICT (nonce) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  RETURN COALESCE(v_claimed, FALSE);
END
$$;

CREATE OR REPLACE FUNCTION public.automation_scheduler_assert_secret()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_count INTEGER;
  v_secret TEXT;
BEGIN
  SELECT COUNT(*)::INTEGER, MIN(secret.decrypted_secret)
    INTO v_secret_count, v_secret
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'AUTOMATION_WORKER_SECRET'
    AND secret.description = 'Gate E Automation worker scheduler secret';

  IF v_secret_count <> 1
    OR v_secret IS NULL
    OR pg_catalog.octet_length(v_secret) < 43
    OR pg_catalog.octet_length(v_secret) > 128
    OR v_secret !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'GATE_E_WORKER_SECRET_UNAVAILABLE';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_scheduler_invoke()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
  v_issued_at BIGINT;
  v_nonce UUID;
  v_signature TEXT;
  v_authorization TEXT;
  v_request_id BIGINT;
BEGIN
  PERFORM public.automation_scheduler_assert_secret();

  SELECT secret.decrypted_secret
    INTO STRICT v_secret
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'AUTOMATION_WORKER_SECRET'
    AND secret.description = 'Gate E Automation worker scheduler secret';

  v_issued_at := pg_catalog.floor(
    EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())
  )::BIGINT;
  v_nonce := gen_random_uuid();
  v_signature := pg_catalog.encode(
    extensions.hmac(
      'gate-e-automation-worker:v1:' || v_issued_at::TEXT || ':' ||
        v_nonce::TEXT,
      v_secret,
      'sha256'
    ),
    'hex'
  );
  v_authorization := 'v1.' || v_issued_at::TEXT || '.' || v_nonce::TEXT ||
    '.' || v_signature;

  SELECT net.http_post(
    url := 'https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/worker/run',
    body := '{}'::JSONB,
    params := '{}'::JSONB,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Automation-Worker-Secret', v_authorization
    ),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  v_secret := NULL;
  v_authorization := NULL;
  RETURN v_request_id;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_scheduler_install()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_job RECORD;
  v_job_id BIGINT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gate-e-automation-worker-scheduler', 0)
  );
  PERFORM public.automation_scheduler_assert_secret();

  FOR v_existing_job IN
    SELECT job.jobid
    FROM cron.job AS job
    WHERE job.jobname = 'gate-e-automation-worker'
    ORDER BY job.jobid
  LOOP
    PERFORM cron.unschedule(v_existing_job.jobid);
  END LOOP;

  SELECT cron.schedule(
    'gate-e-automation-worker',
    '*/10 * * * *',
    $command$SELECT public.automation_scheduler_invoke();$command$
  ) INTO v_job_id;

  IF v_job_id IS NULL OR (
    SELECT COUNT(*)
    FROM cron.job AS job
    WHERE job.jobname = 'gate-e-automation-worker'
      AND job.active
  ) <> 1 THEN
    RAISE EXCEPTION 'GATE_E_SCHEDULER_INSTALL_FAILED';
  END IF;

  RETURN v_job_id;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_scheduler_remove()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_job RECORD;
  v_removed INTEGER := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gate-e-automation-worker-scheduler', 0)
  );

  FOR v_existing_job IN
    SELECT job.jobid
    FROM cron.job AS job
    WHERE job.jobname = 'gate-e-automation-worker'
    ORDER BY job.jobid
  LOOP
    IF cron.unschedule(v_existing_job.jobid) THEN
      v_removed := v_removed + 1;
    END IF;
  END LOOP;

  RETURN v_removed;
END
$$;

REVOKE ALL ON FUNCTION public.automation_worker_lease_acquire(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_worker_lease_release(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_worker_nonce_claim(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_worker_lease_acquire(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_worker_lease_release(UUID, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_worker_nonce_claim(UUID, TIMESTAMPTZ)
  TO service_role;

REVOKE ALL ON FUNCTION public.automation_scheduler_assert_secret()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_scheduler_invoke()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_scheduler_install()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_scheduler_remove()
  FROM PUBLIC, anon, authenticated, service_role;

-- Supabase owns pg_net's unlogged queue and may grant its extension roles SQL
-- access that the normal migration role cannot revoke. The queue therefore
-- receives only a three-minute HMAC token with a one-time nonce, never the root
-- worker secret. Neither net nor cron is exposed by the reviewed Data API
-- schema configuration, and no public RPC exposes their catalogs.

ALTER FUNCTION public.automation_worker_lease_acquire(UUID) OWNER TO postgres;
ALTER FUNCTION public.automation_worker_lease_release(UUID, BOOLEAN)
  OWNER TO postgres;
ALTER FUNCTION public.automation_worker_nonce_claim(UUID, TIMESTAMPTZ)
  OWNER TO postgres;
ALTER FUNCTION public.automation_scheduler_assert_secret() OWNER TO postgres;
ALTER FUNCTION public.automation_scheduler_invoke() OWNER TO postgres;
ALTER FUNCTION public.automation_scheduler_install() OWNER TO postgres;
ALTER FUNCTION public.automation_scheduler_remove() OWNER TO postgres;

COMMENT ON FUNCTION public.automation_worker_lease_acquire(UUID) IS
  'Service-role-only Gate E worker lease; one bounded cycle may run at a time.';
COMMENT ON FUNCTION public.automation_worker_lease_release(UUID, BOOLEAN) IS
  'Service-role-only release of the matching Gate E worker lease.';
COMMENT ON FUNCTION public.automation_worker_nonce_claim(UUID, TIMESTAMPTZ) IS
  'Service-role-only one-time claim for a short-lived Gate E scheduler HMAC token.';
COMMENT ON FUNCTION public.automation_scheduler_invoke() IS
  'Postgres-only fixed Gate E pg_net invocation using a short-lived HMAC token derived from the dedicated Vault secret.';
COMMENT ON FUNCTION public.automation_scheduler_install() IS
  'Postgres-only idempotent installation of the single ten-minute Gate E cron job.';
COMMENT ON FUNCTION public.automation_scheduler_remove() IS
  'Postgres-only removal of Gate E cron jobs without deleting business data or secrets.';

COMMIT;
