-- ROLLBACK-ONLY smoke for Migration 043. Never register as a migration.
BEGIN;

DO $smoke$
DECLARE
  v_before_invoices BIGINT;
  v_before_receipts BIGINT;
  v_rejected BOOLEAN := false;
BEGIN
  SELECT pg_catalog.count(*) INTO v_before_invoices FROM public.invoices;
  SELECT pg_catalog.count(*) INTO v_before_receipts FROM public.receipts;

  IF public.ar_require_supported_transaction_currency('MYR') <> 'MYR'
    OR public.ar_require_supported_transaction_currency('SGD') <> 'SGD' THEN
    RAISE EXCEPTION 'FX043_SMOKE: MYR/SGD policy failed';
  END IF;

  BEGIN
    PERFORM public.ar_require_supported_transaction_currency('USD');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FX043_SMOKE: USD was not refused';
  END IF;

  IF public.fx_reference_business_day_age('2026-08-07', '2026-08-11') <> 2
    OR public.fx_reference_business_day_age('2026-08-07', '2026-08-12') <> 3
    OR public.fx_reference_business_day_age('2026-08-07', '2026-08-13') <> 4 THEN
    RAISE EXCEPTION 'FX043_SMOKE: business-day freshness boundary failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_invoices_supported_new_currency' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_receipts_supported_new_currency' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FX043_SMOKE: prospective currency triggers missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.ar_enforce_new_transaction_currency()'::pg_catalog.regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.fx_require_bookable_reference_rate(uuid,character,character,date,uuid)'::pg_catalog.regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'FX043_SMOKE: owner/security/search_path contract drift';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.ar_require_supported_transaction_currency(text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'public.ar_require_supported_transaction_currency(text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', 'public.ar_require_supported_transaction_currency(text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', 'public.fx_reference_business_day_age(date,date)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'public.fx_reference_business_day_age(date,date)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', 'public.fx_reference_business_day_age(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FX043_SMOKE: private helper privilege drift';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.invoices) <> v_before_invoices
    OR (SELECT pg_catalog.count(*) FROM public.receipts) <> v_before_receipts THEN
    RAISE EXCEPTION 'FX043_SMOKE: financial row count changed';
  END IF;
END;
$smoke$;

ROLLBACK;
