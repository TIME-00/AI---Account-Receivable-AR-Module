-- Batch 9D-C forward corrective migration
-- Narrow validation fix for lifecycle-only decision supersession after Draft FX edits.
-- 022, 023, and 024 are already applied on staging; this migration does not mutate data.

BEGIN;

CREATE OR REPLACE FUNCTION public.fx_validate_booking_rate_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_base CHAR(3);
  v_invoice RECORD;
  v_receipt RECORD;
  v_exchange RECORD;
  v_ref RECORD;
  v_base_exchange RECORD;
  v_base_ref RECORD;
  v_prior RECORD;
  v_lifecycle_only_supersession BOOLEAN := false;
BEGIN
  SELECT base_currency::CHAR(3)
    INTO v_company_base
  FROM public.companies
  WHERE id = NEW.company_id;

  IF v_company_base IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: company % not found for booking-rate decision', NEW.company_id;
  END IF;

  IF NEW.to_currency <> v_company_base THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: to_currency must equal company base currency';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status
    AND NEW.lifecycle_status = 'Superseded' THEN
    IF OLD.lifecycle_status NOT IN ('Draft', 'Pending', 'Approved', 'Rejected') THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid lifecycle transition to Superseded from %', OLD.lifecycle_status;
    END IF;

    IF OLD.id IS DISTINCT FROM NEW.id
      OR OLD.company_id IS DISTINCT FROM NEW.company_id
      OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
      OR OLD.receipt_id IS DISTINCT FROM NEW.receipt_id
      OR OLD.root_decision_id IS DISTINCT FROM NEW.root_decision_id
      OR OLD.decision_version IS DISTINCT FROM NEW.decision_version
      OR OLD.supersedes_decision_id IS DISTINCT FROM NEW.supersedes_decision_id
      OR OLD.source_category IS DISTINCT FROM NEW.source_category
      OR OLD.exchange_rate_id IS DISTINCT FROM NEW.exchange_rate_id
      OR OLD.fx_reference_rate_id IS DISTINCT FROM NEW.fx_reference_rate_id
      OR OLD.baseline_kind IS DISTINCT FROM NEW.baseline_kind
      OR OLD.baseline_rate IS DISTINCT FROM NEW.baseline_rate
      OR OLD.baseline_exchange_rate_id IS DISTINCT FROM NEW.baseline_exchange_rate_id
      OR OLD.baseline_fx_reference_rate_id IS DISTINCT FROM NEW.baseline_fx_reference_rate_id
      OR OLD.from_currency IS DISTINCT FROM NEW.from_currency
      OR OLD.to_currency IS DISTINCT FROM NEW.to_currency
      OR OLD.transaction_date IS DISTINCT FROM NEW.transaction_date
      OR OLD.booked_rate IS DISTINCT FROM NEW.booked_rate
      OR OLD.suggested_rate IS DISTINCT FROM NEW.suggested_rate
      OR OLD.deviation_pct IS DISTINCT FROM NEW.deviation_pct
      OR OLD.stale_reference IS DISTINCT FROM NEW.stale_reference
      OR OLD.provider IS DISTINCT FROM NEW.provider
      OR OLD.provider_effective_date IS DISTINCT FROM NEW.provider_effective_date
      OR OLD.reference_fetched_at IS DISTINCT FROM NEW.reference_fetched_at
      OR OLD.approval_status IS DISTINCT FROM NEW.approval_status
      OR OLD.maker_user_id IS DISTINCT FROM NEW.maker_user_id
      OR OLD.checker_user_id IS DISTINCT FROM NEW.checker_user_id
      OR OLD.selected_by IS DISTINCT FROM NEW.selected_by
      OR OLD.selected_at IS DISTINCT FROM NEW.selected_at
      OR OLD.override_reason IS DISTINCT FROM NEW.override_reason
      OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
      OR OLD.approved_at IS DISTINCT FROM NEW.approved_at
      OR OLD.rejected_by IS DISTINCT FROM NEW.rejected_by
      OR OLD.rejected_at IS DISTINCT FROM NEW.rejected_at
      OR OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason
      OR OLD.posted IS DISTINCT FROM NEW.posted
      OR OLD.posted_at IS DISTINCT FROM NEW.posted_at
      OR OLD.anomaly_marker IS DISTINCT FROM NEW.anomaly_marker
      OR OLD.import_origin IS DISTINCT FROM NEW.import_origin
      OR OLD.metadata IS DISTINCT FROM NEW.metadata
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: Superseded transition may only change lifecycle_status and updated_at';
    END IF;

    v_lifecycle_only_supersession := true;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT *
      INTO v_invoice
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    IF v_invoice.id IS NULL OR v_invoice.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice decision company mismatch';
    END IF;
    IF NOT v_lifecycle_only_supersession
      AND (v_invoice.currency <> NEW.from_currency OR v_invoice.base_currency <> NEW.to_currency) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice decision currency mismatch';
    END IF;
  END IF;

  IF NEW.receipt_id IS NOT NULL THEN
    SELECT *
      INTO v_receipt
    FROM public.receipts
    WHERE id = NEW.receipt_id;

    IF v_receipt.id IS NULL OR v_receipt.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt decision company mismatch';
    END IF;
    IF NOT v_lifecycle_only_supersession
      AND (v_receipt.currency <> NEW.from_currency OR v_receipt.base_currency <> NEW.to_currency) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt decision currency mismatch';
    END IF;
  END IF;

  IF NEW.decision_version = 1 THEN
    IF NEW.root_decision_id <> NEW.id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: root decision must self-reference root_decision_id';
    END IF;
    IF NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: root decision must not supersede another row';
    END IF;
  ELSE
    SELECT *
      INTO v_prior
    FROM public.fx_booking_rate_decisions
    WHERE id = NEW.supersedes_decision_id;

    IF v_prior.id IS NULL THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: superseded decision not found';
    END IF;
    IF v_prior.root_decision_id <> NEW.root_decision_id
      OR v_prior.company_id <> NEW.company_id
      OR COALESCE(v_prior.invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> COALESCE(NEW.invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR COALESCE(v_prior.receipt_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> COALESCE(NEW.receipt_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR v_prior.decision_version <> NEW.decision_version - 1 THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid supersession lineage';
    END IF;
  END IF;

  IF NEW.source_category = 'CATALOG' THEN
    SELECT *
      INTO v_exchange
    FROM public.exchange_rates
    WHERE id = NEW.exchange_rate_id;

    IF v_exchange.id IS NULL
      OR v_exchange.company_id <> NEW.company_id
      OR v_exchange.from_currency <> NEW.from_currency
      OR v_exchange.to_currency <> NEW.to_currency
      OR v_exchange.effective_date > NEW.transaction_date THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid catalog source';
    END IF;
  ELSIF NEW.source_category = 'REFERENCE_SELECTED' THEN
    SELECT *
      INTO v_ref
    FROM public.fx_reference_rates
    WHERE id = NEW.fx_reference_rate_id;

    IF v_ref.id IS NULL
      OR v_ref.company_id <> NEW.company_id
      OR v_ref.from_currency <> NEW.from_currency
      OR v_ref.to_currency <> NEW.to_currency
      OR v_ref.effective_date > NEW.transaction_date
      OR v_ref.status <> 'Active' THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid reference source';
    END IF;
  END IF;

  IF NEW.baseline_kind = 'CATALOG' THEN
    SELECT *
      INTO v_base_exchange
    FROM public.exchange_rates
    WHERE id = NEW.baseline_exchange_rate_id;

    IF v_base_exchange.id IS NULL
      OR v_base_exchange.company_id <> NEW.company_id
      OR v_base_exchange.from_currency <> NEW.from_currency
      OR v_base_exchange.to_currency <> NEW.to_currency
      OR v_base_exchange.effective_date > NEW.transaction_date
      OR ROUND(v_base_exchange.rate::numeric, 8) <> ROUND(NEW.baseline_rate, 8) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid catalog baseline';
    END IF;
  ELSIF NEW.baseline_kind = 'REFERENCE' THEN
    SELECT *
      INTO v_base_ref
    FROM public.fx_reference_rates
    WHERE id = NEW.baseline_fx_reference_rate_id;

    IF v_base_ref.id IS NULL
      OR v_base_ref.company_id <> NEW.company_id
      OR v_base_ref.from_currency <> NEW.from_currency
      OR v_base_ref.to_currency <> NEW.to_currency
      OR v_base_ref.effective_date > NEW.transaction_date
      OR v_base_ref.status <> 'Active'
      OR ROUND(v_base_ref.rate::numeric, 8) <> ROUND(NEW.baseline_rate, 8) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid reference baseline';
    END IF;
  END IF;

  IF NEW.source_category = 'BASE_PARITY' AND ROUND(NEW.booked_rate, 8) <> 1.00000000 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: BASE_PARITY requires booked_rate = 1.0';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM anon;
REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_validate_booking_rate_decision() TO service_role;

COMMENT ON FUNCTION public.fx_validate_booking_rate_decision() IS
  'Batch 9D-C trigger function validating booking-rate decisions; migration 025 permits only material-field-immutable lifecycle transitions to Superseded for historical decision versions.';

COMMIT;
