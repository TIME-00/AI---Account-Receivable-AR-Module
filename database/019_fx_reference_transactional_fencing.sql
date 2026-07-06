-- Batch 9D-A Fix2: Transactional lease fencing for protected FX reference writes
--
-- This migration replaces the Fix1 fx_upsert_reference_rate RPC with a
-- lifecycle-owner fenced implementation. The function keeps the same signature
-- and remains reference-only: it does not write public.exchange_rates or any
-- financial ledger/protected tables.

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
  -- Lock order is intentionally:
  --   1. lifecycle lease ownership row
  --   2. logical FX rate advisory transaction lock
  --   3. active fx_reference_rates row
  --
  -- The lease row lock is held until this RPC transaction commits/rolls back.
  -- A successor reclaim must update the same fx_sync_leases row and therefore
  -- cannot establish successor ownership while this protected write is in
  -- progress. If a successor has already reclaimed the lease, this SELECT finds
  -- no matching live owner and the old worker fails closed before any rate DML.
  PERFORM 1
  FROM public.fx_sync_leases
  WHERE company_id = p_company_id
    AND provider = p_provider
    AND owner_run_id = p_sync_run_id
    AND lease_token = p_lease_token
    AND lease_expires_at > v_now
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FX_SYNC_LEASE_LOST: current sync run does not own a live fenced FX sync lease';
  END IF;

  v_lock_key := concat_ws(
    '|',
    p_from_currency::TEXT,
    p_to_currency::TEXT,
    p_effective_date::TEXT,
    p_provider,
    COALESCE(p_provider_rate_type, '')
  );

  -- Serialize the critical section for the logical reference-rate key. This
  -- prevents normal concurrent first-insert/correction races from surfacing as
  -- unhandled unique violations while preserving the unique Active-row index as
  -- defense in depth.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_company_id::TEXT),
    hashtext(v_lock_key)
  );

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
  'Batch 9D-A Fix2 transactionally lease-fenced and concurrency-serialized reference FX insert/noop/correct handler. Does not write public.exchange_rates.';

REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID
) TO service_role;
