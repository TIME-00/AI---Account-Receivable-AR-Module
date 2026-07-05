-- ============================================================================
-- Batch 9D-A: Provider-Neutral FX Reference Foundation
-- ============================================================================
-- Scope:
--   - Reference/provider FX rates only.
--   - Synchronization observability only.
--   - Existing public.exchange_rates remains the booking-authoritative/manual
--     source used by invoice/receipt creation.
--   - No financial table mutation, no allocation, no journal entry.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Synchronization runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  provider TEXT NOT NULL,
  source_host TEXT NOT NULL,
  effective_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL,
  attempted_pair_count INTEGER NOT NULL DEFAULT 0,
  succeeded_pair_count INTEGER NOT NULL DEFAULT 0,
  failed_pair_count INTEGER NOT NULL DEFAULT 0,
  error_category TEXT NULL,
  error_summary TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_fx_sync_runs_status
    CHECK (status IN ('Running', 'Succeeded', 'PartialFailure', 'Failed')),
  CONSTRAINT chk_fx_sync_runs_pair_counts_nonnegative
    CHECK (
      attempted_pair_count >= 0
      AND succeeded_pair_count >= 0
      AND failed_pair_count >= 0
    ),
  CONSTRAINT chk_fx_sync_runs_error_summary_bounded
    CHECK (error_summary IS NULL OR char_length(error_summary) <= 500),
  CONSTRAINT chk_fx_sync_runs_provider_bounded
    CHECK (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT chk_fx_sync_runs_source_host_bounded
    CHECK (source_host ~ '^[a-z0-9][a-z0-9_.:-]{1,127}$')
);

CREATE INDEX IF NOT EXISTS idx_fx_sync_runs_company_provider_date
  ON public.fx_sync_runs(company_id, provider, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_fx_sync_runs_company_started
  ON public.fx_sync_runs(company_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_fx_sync_runs_running_scope
  ON public.fx_sync_runs(company_id, provider, status)
  WHERE status = 'Running';

COMMENT ON TABLE public.fx_sync_runs IS
  'Batch 9D-A reference FX synchronization observability. Runs do not mutate booking exchange_rates or financial records.';
COMMENT ON COLUMN public.fx_sync_runs.source_host IS
  'Provider source host identifier. 9D-A uses deterministic mock source only; no user-controlled provider URL.';
COMMENT ON COLUMN public.fx_sync_runs.error_summary IS
  'Sanitized bounded summary only. No secrets, tokens, provider raw payloads, or credentials.';

-- ---------------------------------------------------------------------------
-- Reference rates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_reference_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  effective_date DATE NOT NULL,
  provider TEXT NOT NULL,
  provider_rate_type TEXT NULL,
  provider_timestamp TIMESTAMPTZ NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_run_id UUID NULL REFERENCES public.fx_sync_runs(id),
  status TEXT NOT NULL DEFAULT 'Active',
  supersedes_rate_id UUID NULL REFERENCES public.fx_reference_rates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_fx_reference_rates_currency_codes
    CHECK (
      from_currency ~ '^[A-Z]{3}$'
      AND to_currency ~ '^[A-Z]{3}$'
      AND from_currency <> to_currency
    ),
  CONSTRAINT chk_fx_reference_rates_rate_positive
    CHECK (rate > 0),
  CONSTRAINT chk_fx_reference_rates_status
    CHECK (status IN ('Active', 'Superseded')),
  CONSTRAINT chk_fx_reference_rates_provider_bounded
    CHECK (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  CONSTRAINT chk_fx_reference_rates_type_bounded
    CHECK (provider_rate_type IS NULL OR provider_rate_type ~ '^[A-Za-z0-9 _.-]{1,64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_reference_rates_active_logical_key
  ON public.fx_reference_rates(
    company_id,
    from_currency,
    to_currency,
    effective_date,
    provider,
    COALESCE(provider_rate_type, '')
  )
  WHERE status = 'Active';

CREATE INDEX IF NOT EXISTS idx_fx_reference_rates_lookup
  ON public.fx_reference_rates(
    company_id,
    from_currency,
    to_currency,
    provider,
    effective_date DESC
  )
  WHERE status = 'Active';

CREATE INDEX IF NOT EXISTS idx_fx_reference_rates_company_fetched
  ON public.fx_reference_rates(company_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_fx_reference_rates_sync_run
  ON public.fx_reference_rates(sync_run_id);

CREATE INDEX IF NOT EXISTS idx_fx_reference_rates_supersedes
  ON public.fx_reference_rates(supersedes_rate_id);

COMMENT ON TABLE public.fx_reference_rates IS
  'Batch 9D-A provider/reference FX rates. These rates are reference-only and are not booking-authoritative.';
COMMENT ON COLUMN public.fx_reference_rates.from_currency IS
  'Direction: 1 unit of from_currency equals rate units of to_currency.';
COMMENT ON COLUMN public.fx_reference_rates.to_currency IS
  'Company base currency for the company-scoped reference pair.';
COMMENT ON COLUMN public.fx_reference_rates.rate IS
  'Reference rate only. Does not mutate booked invoice/receipt snapshots.';
COMMENT ON COLUMN public.fx_reference_rates.supersedes_rate_id IS
  'Versioned correction link. Superseded rows are preserved for audit.';

-- ---------------------------------------------------------------------------
-- Advisory lock helper for provider-neutral sync overlap protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_try_sync_lock(
  p_company_id UUID,
  p_provider TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_xact_lock(
    hashtext(p_company_id::TEXT),
    hashtext(COALESCE(p_provider, ''))
  );
$$;

COMMENT ON FUNCTION public.fx_try_sync_lock(UUID, TEXT) IS
  'Batch 9D-A scoped transaction advisory lock for provider-neutral FX sync overlap protection.';

REVOKE EXECUTE ON FUNCTION public.fx_try_sync_lock(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_try_sync_lock(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_try_sync_lock(UUID, TEXT) TO service_role;

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
  p_sync_run_id UUID
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
BEGIN
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
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) IS
  'Batch 9D-A transactional insert/noop/correct handler for versioned reference FX rates. Does not write public.exchange_rates.';

REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_upsert_reference_rate(
  UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.fx_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_reference_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_sync_runs_select ON public.fx_sync_runs;
CREATE POLICY fx_sync_runs_select ON public.fx_sync_runs
  FOR SELECT
  USING (public.rls_has_company_access(company_id));

DROP POLICY IF EXISTS fx_reference_rates_select ON public.fx_reference_rates;
CREATE POLICY fx_reference_rates_select ON public.fx_reference_rates
  FOR SELECT
  USING (public.rls_has_company_access(company_id));

-- No authenticated INSERT/UPDATE/DELETE policies are intentionally created.
-- Backend Edge Functions use service-role credentials and explicit tenant/auth
-- checks for controlled provider-neutral sync writes.

GRANT SELECT ON public.fx_sync_runs TO authenticated;
GRANT SELECT ON public.fx_reference_rates TO authenticated;
GRANT ALL ON public.fx_sync_runs TO service_role;
GRANT ALL ON public.fx_reference_rates TO service_role;

COMMIT;
