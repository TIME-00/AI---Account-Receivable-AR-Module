-- ============================================================================
-- Batch 9D-A Fix1: Lifecycle-Wide Sync Lease and Concurrent Upsert Hardening
-- ============================================================================
-- Scope:
--   - Replace standalone transaction-scoped lifecycle advisory lock with a
--     persistent DB-backed lease that survives across Edge Function DB calls.
--   - Harden reference-rate upsert against normal concurrent insert/correction
--     races through an in-RPC transaction-scoped critical section.
--   - Preserve reference-only semantics. No exchange_rates writes. No financial
--     mutations.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Persistent sync lease table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_sync_leases (
  company_id UUID NOT NULL REFERENCES public.companies(id),
  provider TEXT NOT NULL,
  owner_run_id UUID NULL REFERENCES public.fx_sync_runs(id) ON DELETE SET NULL,
  lease_token UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_fx_sync_leases PRIMARY KEY (company_id, provider),
  CONSTRAINT chk_fx_sync_leases_provider_bounded
    CHECK (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$')
);

CREATE INDEX IF NOT EXISTS idx_fx_sync_leases_expiry
  ON public.fx_sync_leases(lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_fx_sync_leases_owner
  ON public.fx_sync_leases(owner_run_id);

COMMENT ON TABLE public.fx_sync_leases IS
  'Batch 9D-A Fix1 persistent lifecycle lease for provider-neutral FX sync. Scope is company_id + provider.';
COMMENT ON COLUMN public.fx_sync_leases.lease_token IS
  'Opaque owner token. Release/renew/complete operations must match both owner_run_id and lease_token.';
COMMENT ON COLUMN public.fx_sync_leases.lease_expires_at IS
  'Bounded recovery point for abandoned Running syncs. Stale owners cannot persist protected writes after expiry.';

ALTER TABLE public.fx_sync_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_sync_leases_select ON public.fx_sync_leases;
CREATE POLICY fx_sync_leases_select ON public.fx_sync_leases
  FOR SELECT
  USING (public.rls_has_company_access(company_id));

GRANT SELECT ON public.fx_sync_leases TO authenticated;
GRANT ALL ON public.fx_sync_leases TO service_role;

-- ---------------------------------------------------------------------------
-- Remove access to the ineffective lifecycle lock helper from 017.
-- Transaction-scoped advisory locks remain appropriate inside a single DB RPC
-- critical section, but not as a lifecycle guard across Edge Function calls.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fx_try_sync_lock(UUID, TEXT);

DROP FUNCTION IF EXISTS public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
);

-- ---------------------------------------------------------------------------
-- Atomic acquire + start-run
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_acquire_sync_lease(
  p_company_id UUID,
  p_provider TEXT,
  p_source_host TEXT,
  p_effective_date DATE,
  p_attempted_pair_count INTEGER,
  p_created_by UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_lease_until TIMESTAMPTZ;
  v_lease_token UUID := gen_random_uuid();
  v_run_id UUID := gen_random_uuid();
  v_previous_owner_run_id UUID;
  v_active_owner_run_id UUID;
  v_active_expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'FX_SYNC_INVALID_LEASE_SECONDS: lease_seconds must be between 30 and 3600';
  END IF;

  v_lease_until := v_now + make_interval(secs => p_lease_seconds);

  INSERT INTO public.fx_sync_leases (
    company_id,
    provider,
    owner_run_id,
    lease_token,
    lease_expires_at,
    acquired_at,
    renewed_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_provider,
    NULL,
    v_lease_token,
    v_lease_until,
    v_now,
    v_now,
    v_now
  )
  ON CONFLICT (company_id, provider) DO UPDATE
    SET lease_token = EXCLUDED.lease_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        acquired_at = EXCLUDED.acquired_at,
        renewed_at = EXCLUDED.renewed_at,
        updated_at = EXCLUDED.updated_at
    WHERE public.fx_sync_leases.lease_expires_at <= v_now
  RETURNING owner_run_id
  INTO v_previous_owner_run_id;

  IF NOT FOUND THEN
    SELECT owner_run_id, lease_expires_at
    INTO v_active_owner_run_id, v_active_expires_at
    FROM public.fx_sync_leases
    WHERE company_id = p_company_id
      AND provider = p_provider;

    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'FX_SYNC_ALREADY_RUNNING',
      'active_owner_run_id', v_active_owner_run_id,
      'lease_expires_at', v_active_expires_at
    );
  END IF;

  IF v_previous_owner_run_id IS NOT NULL THEN
    UPDATE public.fx_sync_runs
    SET status = 'Failed',
        completed_at = v_now,
        failed_pair_count = attempted_pair_count,
        error_category = 'FX_SYNC_LEASE_EXPIRED',
        error_summary = 'Previous FX sync lease expired and was recovered by a successor run.'
    WHERE id = v_previous_owner_run_id
      AND company_id = p_company_id
      AND provider = p_provider
      AND status = 'Running';
  END IF;

  INSERT INTO public.fx_sync_runs (
    id,
    company_id,
    provider,
    source_host,
    effective_date,
    started_at,
    status,
    attempted_pair_count,
    created_by
  )
  VALUES (
    v_run_id,
    p_company_id,
    p_provider,
    p_source_host,
    p_effective_date,
    v_now,
    'Running',
    p_attempted_pair_count,
    p_created_by
  );

  UPDATE public.fx_sync_leases
  SET owner_run_id = v_run_id,
      updated_at = v_now
  WHERE company_id = p_company_id
    AND provider = p_provider
    AND lease_token = v_lease_token;

  RETURN jsonb_build_object(
    'acquired', true,
    'run_id', v_run_id,
    'lease_token', v_lease_token,
    'lease_expires_at', v_lease_until,
    'recovered_run_id', v_previous_owner_run_id
  );
END;
$$;

COMMENT ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) IS
  'Batch 9D-A Fix1 atomic acquire-and-start lifecycle lease. Reclaims expired owner and terminalizes stale Running run.';

REVOKE EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_acquire_sync_lease(
  UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER
) TO service_role;

-- ---------------------------------------------------------------------------
-- Owner-checked renew
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_renew_sync_lease(
  p_company_id UUID,
  p_provider TEXT,
  p_owner_run_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_lease_until TIMESTAMPTZ;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'FX_SYNC_INVALID_LEASE_SECONDS: lease_seconds must be between 30 and 3600';
  END IF;

  v_lease_until := v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.fx_sync_leases
  SET lease_expires_at = v_lease_until,
      renewed_at = v_now,
      updated_at = v_now
  WHERE company_id = p_company_id
    AND provider = p_provider
    AND owner_run_id = p_owner_run_id
    AND lease_token = p_lease_token
    AND lease_expires_at > v_now;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'renewed', false,
      'reason', 'FX_SYNC_LEASE_LOST'
    );
  END IF;

  RETURN jsonb_build_object(
    'renewed', true,
    'lease_expires_at', v_lease_until
  );
END;
$$;

COMMENT ON FUNCTION public.fx_renew_sync_lease(UUID, TEXT, UUID, UUID, INTEGER) IS
  'Batch 9D-A Fix1 owner-checked FX sync lease renewal.';

REVOKE EXECUTE ON FUNCTION public.fx_renew_sync_lease(UUID, TEXT, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_renew_sync_lease(UUID, TEXT, UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_renew_sync_lease(UUID, TEXT, UUID, UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Owner-checked terminal completion + release
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_complete_sync_run(
  p_company_id UUID,
  p_provider TEXT,
  p_owner_run_id UUID,
  p_lease_token UUID,
  p_status TEXT,
  p_succeeded_pair_count INTEGER,
  p_failed_pair_count INTEGER,
  p_error_category TEXT,
  p_error_summary TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_status NOT IN ('Succeeded', 'PartialFailure', 'Failed') THEN
    RAISE EXCEPTION 'FX_SYNC_INVALID_STATUS: terminal status is invalid';
  END IF;

  IF p_error_summary IS NOT NULL AND char_length(p_error_summary) > 500 THEN
    RAISE EXCEPTION 'FX_SYNC_ERROR_SUMMARY_TOO_LONG: error summary must be <= 500 characters';
  END IF;

  PERFORM 1
  FROM public.fx_sync_leases
  WHERE company_id = p_company_id
    AND provider = p_provider
    AND owner_run_id = p_owner_run_id
    AND lease_token = p_lease_token
    AND lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'completed', false,
      'reason', 'FX_SYNC_LEASE_LOST'
    );
  END IF;

  UPDATE public.fx_sync_runs
  SET status = p_status,
      completed_at = v_now,
      succeeded_pair_count = p_succeeded_pair_count,
      failed_pair_count = p_failed_pair_count,
      error_category = p_error_category,
      error_summary = p_error_summary
  WHERE id = p_owner_run_id
    AND company_id = p_company_id
    AND provider = p_provider
    AND status = 'Running';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'completed', false,
      'reason', 'FX_SYNC_RUN_NOT_RUNNING'
    );
  END IF;

  DELETE FROM public.fx_sync_leases
  WHERE company_id = p_company_id
    AND provider = p_provider
    AND owner_run_id = p_owner_run_id
    AND lease_token = p_lease_token;

  RETURN jsonb_build_object(
    'completed', true,
    'run_id', p_owner_run_id
  );
END;
$$;

COMMENT ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) IS
  'Batch 9D-A Fix1 owner-checked terminal run completion and lease release.';

REVOKE EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_complete_sync_run(
  UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- Concurrent-safe rate upsert with owner fencing and in-RPC serialization
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_upsert_reference_rate(
  p_company_id UUID,
  p_from_currency CHAR(3),
  p_to_currency CHAR(3),
  p_rate NUMERIC,
  p_effective_date DATE,
  p_provider TEXT,
  p_provider_rate_type TEXT,
  p_provider_timestamp TIMESTAMPTZ,
  p_fetched_at TIMESTAMPTZ,
  p_sync_run_id UUID,
  p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing fx_reference_rates%ROWTYPE;
  v_new_id UUID;
  v_had_existing BOOLEAN;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_lock_key TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.fx_sync_leases
    WHERE company_id = p_company_id
      AND provider = p_provider
      AND owner_run_id = p_sync_run_id
      AND lease_token = p_lease_token
      AND lease_expires_at > v_now
  ) THEN
    RAISE EXCEPTION 'FX_SYNC_LEASE_LOST: current sync run no longer owns the FX sync lease';
  END IF;

  v_lock_key := concat_ws(
    '|',
    p_from_currency::TEXT,
    p_to_currency::TEXT,
    p_effective_date::TEXT,
    p_provider,
    COALESCE(p_provider_rate_type, '')
  );

  PERFORM pg_advisory_xact_lock(
    hashtext(p_company_id::TEXT),
    hashtext(v_lock_key)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.fx_sync_leases
    WHERE company_id = p_company_id
      AND provider = p_provider
      AND owner_run_id = p_sync_run_id
      AND lease_token = p_lease_token
      AND lease_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'FX_SYNC_LEASE_LOST: current sync run lost ownership before FX reference upsert';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.fx_reference_rates
  WHERE company_id = p_company_id
    AND from_currency = p_from_currency
    AND to_currency = p_to_currency
    AND effective_date = p_effective_date
    AND provider = p_provider
    AND provider_rate_type IS NOT DISTINCT FROM p_provider_rate_type
    AND status = 'Active'
  FOR UPDATE;

  v_had_existing := FOUND;

  IF v_had_existing AND v_existing.rate = p_rate THEN
    RETURN jsonb_build_object(
      'action', 'noop',
      'rate_id', v_existing.id,
      'superseded_id', NULL
    );
  END IF;

  IF v_had_existing THEN
    UPDATE public.fx_reference_rates
    SET status = 'Superseded'
    WHERE id = v_existing.id
      AND status = 'Active';
  END IF;

  INSERT INTO public.fx_reference_rates (
    company_id,
    from_currency,
    to_currency,
    rate,
    effective_date,
    provider,
    provider_rate_type,
    provider_timestamp,
    fetched_at,
    sync_run_id,
    status,
    supersedes_rate_id
  )
  VALUES (
    p_company_id,
    p_from_currency,
    p_to_currency,
    p_rate,
    p_effective_date,
    p_provider,
    p_provider_rate_type,
    p_provider_timestamp,
    p_fetched_at,
    p_sync_run_id,
    'Active',
    CASE WHEN v_had_existing THEN v_existing.id ELSE NULL END
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'action', CASE WHEN v_had_existing THEN 'correct' ELSE 'insert' END,
    'rate_id', v_new_id,
    'superseded_id', CASE WHEN v_had_existing THEN v_existing.id ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) IS
  'Batch 9D-A Fix1 owner-fenced and concurrency-serialized reference FX insert/noop/correct handler. Does not write public.exchange_rates.';

REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) TO service_role;

COMMIT;
