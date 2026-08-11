-- Post-Gate-E FX reference freshness and new-transaction currency authority.
--
-- Prospective only: retained historical currencies and booked FX snapshots are
-- not rewritten. The production FX cron, when present, gains later idempotent
-- refresh attempts so a pre-publication morning result is not the day's final
-- reference state.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.ar_require_supported_transaction_currency(
  p_currency TEXT
)
RETURNS CHAR(3)
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_currency TEXT := pg_catalog.btrim(p_currency);
BEGIN
  IF v_currency NOT IN ('MYR', 'SGD') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'UNSUPPORTED_TRANSACTION_CURRENCY: supported currencies for new AR documents are MYR and SGD';
  END IF;
  RETURN v_currency::CHAR(3);
END;
$function$;

ALTER FUNCTION public.ar_require_supported_transaction_currency(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ar_require_supported_transaction_currency(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ar_enforce_new_transaction_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.currency IS NOT DISTINCT FROM OLD.currency THEN
    RETURN NEW;
  END IF;
  PERFORM public.ar_require_supported_transaction_currency(NEW.currency::TEXT);
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.ar_enforce_new_transaction_currency() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ar_enforce_new_transaction_currency()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_invoices_supported_new_currency ON public.invoices;
CREATE TRIGGER trg_invoices_supported_new_currency
BEFORE INSERT OR UPDATE OF currency ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.ar_enforce_new_transaction_currency();

DROP TRIGGER IF EXISTS trg_receipts_supported_new_currency ON public.receipts;
CREATE TRIGGER trg_receipts_supported_new_currency
BEFORE INSERT OR UPDATE OF currency ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.ar_enforce_new_transaction_currency();

CREATE OR REPLACE FUNCTION public.fx_reference_business_day_age(
  p_effective_date DATE,
  p_transaction_date DATE
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_effective_date >= p_transaction_date THEN 0
    ELSE pg_catalog.count(*) FILTER (
      WHERE EXTRACT(isodow FROM day_value) BETWEEN 1 AND 5
    )::INTEGER
  END
  FROM pg_catalog.generate_series(
    p_effective_date + 1,
    p_transaction_date,
    '1 day'::INTERVAL
  ) AS day_value;
$function$;

ALTER FUNCTION public.fx_reference_business_day_age(DATE, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_reference_business_day_age(DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fx_require_bookable_reference_rate(
  p_company_id UUID,
  p_from_currency CHAR(3),
  p_to_currency CHAR(3),
  p_transaction_date DATE,
  p_fx_reference_rate_id UUID
)
RETURNS NUMERIC(18,8)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_company_base CHAR(3);
  v_reference public.fx_reference_rates%ROWTYPE;
  v_latest_id UUID;
BEGIN
  IF p_fx_reference_rate_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: reference selection requires fx_reference_rate_id';
  END IF;

  SELECT c.base_currency INTO v_company_base
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NOT_FOUND: company not found';
  END IF;
  IF p_from_currency = p_to_currency THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: BASE_PARITY must not use an FX reference';
  END IF;
  IF p_to_currency IS DISTINCT FROM v_company_base THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: reference direction must target company base currency';
  END IF;

  SELECT r.* INTO v_reference
  FROM public.fx_reference_rates r
  WHERE r.id = p_fx_reference_rate_id
    AND r.company_id = p_company_id
    AND r.from_currency = p_from_currency
    AND r.to_currency = p_to_currency
    AND r.effective_date <= p_transaction_date
    AND r.status = 'Active';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: invalid reference selection';
  END IF;

  SELECT r.id INTO v_latest_id
  FROM public.fx_reference_rates r
  WHERE r.company_id = p_company_id
    AND r.from_currency = p_from_currency
    AND r.to_currency = p_to_currency
    AND r.effective_date <= p_transaction_date
    AND r.status = 'Active'
  ORDER BY r.effective_date DESC, r.fetched_at DESC, r.created_at DESC, r.id DESC
  LIMIT 1;

  IF v_latest_id IS DISTINCT FROM v_reference.id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: selected reference is not the latest active rate for the effective date';
  END IF;

  IF public.fx_reference_business_day_age(
    v_reference.effective_date,
    p_transaction_date
  ) > 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: selected reference rate is stale; use governed manual override';
  END IF;

  RETURN v_reference.rate::NUMERIC(18,8);
END;
$function$;

ALTER FUNCTION public.fx_require_bookable_reference_rate(UUID, CHAR(3), CHAR(3), DATE, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_require_bookable_reference_rate(UUID, CHAR(3), CHAR(3), DATE, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

LOCK TABLE public.automation_exceptions IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.automation_exceptions DROP CONSTRAINT chk_automation_exception_reason;
ALTER TABLE public.automation_exceptions
  ADD CONSTRAINT chk_automation_exception_reason CHECK (
    reason_code IN (
      'mailbox_not_configured', 'mailbox_reconnect_required', 'provider_unavailable',
      'message_duplicate', 'attachment_duplicate', 'unsupported_file', 'unsafe_file',
      'encrypted_document', 'oversized_document', 'ambiguous_classification',
      'unsupported_document', 'low_confidence', 'extraction_schema_invalid',
      'arithmetic_mismatch', 'currency_unsupported', 'fx_reference_unavailable',
      'customer_unresolved', 'customer_ambiguous', 'invoice_conflict',
      'receipt_conflict', 'critical_identifier_unverified', 'missing_salesman',
      'invalid_salesman_email', 'allocation_evidence_insufficient',
      'allocation_currency_mismatch', 'allocation_conflict', 'concurrency_conflict',
      'provider_delivery_failed', 'internal_processing_failure'
    )
  ) NOT VALID;
ALTER TABLE public.automation_exceptions VALIDATE CONSTRAINT chk_automation_exception_reason;

-- Production installs this named job outside the migration ledger. Preserve its
-- command/secret and add two later idempotent attempts only when exactly one
-- canonical job exists. Other environments are unchanged.
DO $cron_refresh$
DECLARE
  v_job_id BIGINT;
  v_count INTEGER;
BEGIN
  IF pg_catalog.to_regclass('cron.job') IS NULL
    OR pg_catalog.to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::INTEGER, pg_catalog.min(jobid)
    INTO v_count, v_job_id
  FROM cron.job
  WHERE jobname = 'batch_9d_e_fx_scheduler_production';

  IF v_count > 1 THEN
    RAISE EXCEPTION 'FX_SCHEDULER_DUPLICATE_CANONICAL_JOB';
  ELSIF v_count = 1 THEN
    PERFORM cron.alter_job(v_job_id, schedule => '30 7,12,17 * * *');
  END IF;
END;
$cron_refresh$;

COMMIT;
