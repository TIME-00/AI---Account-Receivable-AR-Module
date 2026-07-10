-- Batch 9D-C forward corrective migration
-- Runtime fix for fx_record_booking_decision optional RECORD provenance handling.
-- 022 and 023 are already applied on staging; this migration does not mutate data.

BEGIN;

CREATE OR REPLACE FUNCTION public.fx_record_booking_decision(
  p_company_id UUID,
  p_transaction_type TEXT,
  p_transaction_id UUID,
  p_actor_user_id UUID,
  p_explicit_rate_supplied BOOLEAN DEFAULT false,
  p_source_category TEXT DEFAULT NULL,
  p_fx_reference_rate_id UUID DEFAULT NULL,
  p_override_reason TEXT DEFAULT NULL,
  p_import_origin JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_company RECORD;
  v_existing RECORD;
  v_new_id UUID := gen_random_uuid();
  v_root_id UUID;
  v_version INTEGER := 1;
  v_source_category TEXT;
  v_exchange RECORD;
  v_reference RECORD;
  v_source_exchange_rate_id UUID := NULL;
  v_source_fx_reference_rate_id UUID := NULL;
  v_baseline_kind TEXT := 'NONE';
  v_baseline_rate NUMERIC(18,8) := NULL;
  v_baseline_exchange_rate_id UUID := NULL;
  v_baseline_fx_reference_rate_id UUID := NULL;
  v_deviation NUMERIC(18,8) := NULL;
  v_approval_status TEXT;
  v_lifecycle_status TEXT;
  v_event_type TEXT;
  v_stale_reference BOOLEAN := false;
BEGIN
  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  IF p_transaction_type NOT IN ('invoice', 'receipt') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: transaction_type must be invoice or receipt';
  END IF;

  SELECT *
    INTO v_company
  FROM public.companies
  WHERE id = p_company_id;

  IF v_company.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: company % not found', p_company_id;
  END IF;

  IF p_transaction_type = 'invoice' THEN
    SELECT
      i.id,
      i.company_id,
      i.customer_id,
      i.currency::CHAR(3) AS currency,
      i.base_currency::CHAR(3) AS base_currency,
      i.exchange_rate::numeric(18,8) AS exchange_rate,
      i.invoice_date AS transaction_date,
      i.status,
      i.fx_decision_id,
      i.fx_source_category
      INTO v_tx
    FROM public.invoices i
    WHERE i.id = p_transaction_id
    FOR UPDATE;
  ELSE
    SELECT
      r.id,
      r.company_id,
      r.customer_id,
      r.currency::CHAR(3) AS currency,
      r.base_currency::CHAR(3) AS base_currency,
      r.exchange_rate::numeric(18,8) AS exchange_rate,
      r.receipt_date AS transaction_date,
      r.status,
      r.fx_decision_id,
      r.fx_source_category
      INTO v_tx
    FROM public.receipts r
    WHERE r.id = p_transaction_id
    FOR UPDATE;
  END IF;

  IF v_tx.id IS NULL OR v_tx.company_id <> p_company_id THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction not found in company scope';
  END IF;
  IF v_tx.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: booking decision can only be changed while Draft';
  END IF;
  IF v_tx.base_currency <> v_company.base_currency THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: transaction base currency mismatch';
  END IF;

  IF p_source_category IS NOT NULL THEN
    v_source_category := p_source_category;
  ELSIF v_tx.currency = v_tx.base_currency THEN
    IF ROUND(v_tx.exchange_rate, 8) = 1.00000000 THEN
      v_source_category := 'BASE_PARITY';
    ELSE
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: same-currency explicit non-parity rate requires HOLD/anomaly handling';
    END IF;
  ELSIF p_explicit_rate_supplied THEN
    v_source_category := 'MANUAL_OVERRIDE';
  ELSE
    v_source_category := 'CATALOG';
  END IF;

  IF v_source_category NOT IN ('BASE_PARITY', 'CATALOG', 'REFERENCE_SELECTED', 'MANUAL_OVERRIDE') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid new booking source category %', v_source_category;
  END IF;

  IF v_source_category = 'REFERENCE_SELECTED' THEN
    IF p_fx_reference_rate_id IS NULL THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: reference selection requires fx_reference_rate_id';
    END IF;

    SELECT *
      INTO v_reference
    FROM public.fx_reference_rates
    WHERE id = p_fx_reference_rate_id
    FOR UPDATE;

    IF v_reference.id IS NULL
      OR v_reference.company_id <> p_company_id
      OR v_reference.from_currency <> v_tx.currency
      OR v_reference.to_currency <> v_tx.base_currency
      OR v_reference.effective_date > v_tx.transaction_date
      OR v_reference.status <> 'Active' THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid reference selection';
    END IF;

    v_tx.exchange_rate := v_reference.rate::numeric(18,8);
    v_baseline_kind := 'REFERENCE';
    v_baseline_rate := v_reference.rate::numeric(18,8);
    v_baseline_fx_reference_rate_id := v_reference.id;
    v_source_fx_reference_rate_id := v_reference.id;
    v_stale_reference := (v_tx.transaction_date - v_reference.effective_date) > 7;

    IF p_transaction_type = 'invoice' THEN
      UPDATE public.invoices
      SET exchange_rate = v_tx.exchange_rate,
          base_total = ROUND(total_amount * v_tx.exchange_rate, 2)
      WHERE id = p_transaction_id;
    ELSE
      UPDATE public.receipts
      SET exchange_rate = v_tx.exchange_rate,
          base_amount = ROUND(receipt_amount * v_tx.exchange_rate, 2)
      WHERE id = p_transaction_id;
    END IF;
  END IF;

  IF v_source_category = 'BASE_PARITY' THEN
    IF v_tx.currency <> v_tx.base_currency OR ROUND(v_tx.exchange_rate, 8) <> 1.00000000 THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: BASE_PARITY requires same-currency rate 1.0';
    END IF;
    v_baseline_kind := 'BASE_PARITY';
    v_baseline_rate := 1.00000000;
  ELSIF v_source_category IN ('CATALOG', 'MANUAL_OVERRIDE') THEN
    SELECT *
      INTO v_exchange
    FROM public.exchange_rates
    WHERE company_id = p_company_id
      AND from_currency = v_tx.currency
      AND to_currency = v_tx.base_currency
      AND effective_date <= v_tx.transaction_date
    ORDER BY effective_date DESC
    LIMIT 1;

    IF v_source_category = 'CATALOG' THEN
      IF v_exchange.id IS NULL THEN
        RAISE EXCEPTION 'BR-FX-GOVERNANCE: catalog rate missing';
      END IF;
      IF ROUND(v_exchange.rate::numeric, 8) <> ROUND(v_tx.exchange_rate, 8) THEN
        RAISE EXCEPTION 'BR-FX-GOVERNANCE: transaction rate does not match catalog source';
      END IF;
      v_baseline_kind := 'CATALOG';
      v_baseline_rate := v_exchange.rate::numeric(18,8);
      v_baseline_exchange_rate_id := v_exchange.id;
      v_source_exchange_rate_id := v_exchange.id;
    ELSIF v_source_category = 'MANUAL_OVERRIDE' THEN
      IF p_override_reason IS NULL OR length(trim(p_override_reason)) < 5 THEN
        RAISE EXCEPTION 'BR-FX-GOVERNANCE: manual override reason is required';
      END IF;
      IF v_exchange.id IS NOT NULL THEN
        v_baseline_kind := 'CATALOG';
        v_baseline_rate := v_exchange.rate::numeric(18,8);
        v_baseline_exchange_rate_id := v_exchange.id;
      ELSE
        v_baseline_kind := 'MISSING';
      END IF;
    END IF;
  END IF;

  v_deviation := public.fx_booking_deviation_pct(v_tx.exchange_rate, v_baseline_rate);
  v_approval_status := public.fx_booking_approval_status_for_deviation(v_deviation, v_source_category);
  IF v_stale_reference THEN
    v_approval_status := 'Pending';
  END IF;
  v_lifecycle_status := public.fx_booking_lifecycle_for_approval(v_approval_status);

  IF v_approval_status = 'Rejected' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: booked rate deviation exceeds blocked threshold';
  END IF;

  IF p_transaction_type = 'invoice' THEN
    SELECT *
      INTO v_existing
    FROM public.fx_booking_rate_decisions
    WHERE id = v_tx.fx_decision_id
    FOR UPDATE;
  ELSE
    SELECT *
      INTO v_existing
    FROM public.fx_booking_rate_decisions
    WHERE id = v_tx.fx_decision_id
    FOR UPDATE;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.lifecycle_status = 'Posted' THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: posted transaction decision cannot be changed';
    END IF;

    UPDATE public.fx_booking_rate_decisions
    SET lifecycle_status = 'Superseded',
        updated_at = now()
    WHERE id = v_existing.id;

    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      invoice_id,
      receipt_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      prior_approval_status,
      new_approval_status,
      maker_user_id,
      checker_user_id,
      source_category,
      selected_rate,
      final_rate,
      metadata
    )
    VALUES (
      v_existing.company_id,
      v_existing.invoice_id,
      v_existing.receipt_id,
      v_existing.id,
      v_existing.decision_version,
      'DecisionSuperseded',
      p_actor_user_id,
      v_existing.approval_status,
      v_existing.approval_status,
      v_existing.maker_user_id,
      v_existing.checker_user_id,
      v_existing.source_category,
      v_existing.booked_rate,
      v_existing.booked_rate,
      jsonb_build_object('new_decision_id', v_new_id)
    );

    v_root_id := v_existing.root_decision_id;
    v_version := v_existing.decision_version + 1;
  ELSE
    v_root_id := v_new_id;
    v_version := 1;
  END IF;

  INSERT INTO public.fx_booking_rate_decisions (
    id,
    company_id,
    invoice_id,
    receipt_id,
    root_decision_id,
    decision_version,
    supersedes_decision_id,
    source_category,
    exchange_rate_id,
    fx_reference_rate_id,
    baseline_kind,
    baseline_rate,
    baseline_exchange_rate_id,
    baseline_fx_reference_rate_id,
    from_currency,
    to_currency,
    transaction_date,
    booked_rate,
    suggested_rate,
    deviation_pct,
    stale_reference,
    approval_status,
    lifecycle_status,
    maker_user_id,
    selected_by,
    selected_at,
    override_reason,
    import_origin,
    metadata,
    created_by
  )
  VALUES (
    v_new_id,
    p_company_id,
    CASE WHEN p_transaction_type = 'invoice' THEN p_transaction_id ELSE NULL END,
    CASE WHEN p_transaction_type = 'receipt' THEN p_transaction_id ELSE NULL END,
    v_root_id,
    v_version,
    CASE WHEN v_existing.id IS NOT NULL THEN v_existing.id ELSE NULL END,
    v_source_category,
    v_source_exchange_rate_id,
    v_source_fx_reference_rate_id,
    v_baseline_kind,
    v_baseline_rate,
    v_baseline_exchange_rate_id,
    v_baseline_fx_reference_rate_id,
    v_tx.currency,
    v_tx.base_currency,
    v_tx.transaction_date,
    v_tx.exchange_rate,
    v_baseline_rate,
    v_deviation,
    v_stale_reference,
    v_approval_status,
    v_lifecycle_status,
    p_actor_user_id,
    p_actor_user_id,
    now(),
    p_override_reason,
    p_import_origin,
    jsonb_build_object('explicit_rate_supplied', p_explicit_rate_supplied),
    p_actor_user_id
  );

  IF p_transaction_type = 'invoice' THEN
    UPDATE public.invoices
    SET fx_decision_id = v_new_id,
        fx_source_category = v_source_category
    WHERE id = p_transaction_id;
  ELSE
    UPDATE public.receipts
    SET fx_decision_id = v_new_id,
        fx_source_category = v_source_category
    WHERE id = p_transaction_id;
  END IF;

  v_event_type := CASE
    WHEN v_source_category = 'CATALOG' THEN 'CatalogSelected'
    WHEN v_source_category = 'MANUAL_OVERRIDE' THEN 'OverrideSubmitted'
    ELSE 'DecisionCreated'
  END;

  INSERT INTO public.fx_booking_rate_decision_events (
    company_id,
    invoice_id,
    receipt_id,
    decision_id,
    decision_version,
    event_type,
    actor_user_id,
    prior_approval_status,
    new_approval_status,
    reason,
    maker_user_id,
    source_category,
    exchange_rate_id,
    fx_reference_rate_id,
    baseline_kind,
    baseline_exchange_rate_id,
    baseline_fx_reference_rate_id,
    selected_rate,
    final_rate,
    metadata
  )
  VALUES (
    p_company_id,
    CASE WHEN p_transaction_type = 'invoice' THEN p_transaction_id ELSE NULL END,
    CASE WHEN p_transaction_type = 'receipt' THEN p_transaction_id ELSE NULL END,
    v_new_id,
    v_version,
    v_event_type,
    p_actor_user_id,
    NULL,
    v_approval_status,
    p_override_reason,
    p_actor_user_id,
    v_source_category,
    v_source_exchange_rate_id,
    v_source_fx_reference_rate_id,
    v_baseline_kind,
    v_baseline_exchange_rate_id,
    v_baseline_fx_reference_rate_id,
    v_tx.exchange_rate,
    v_tx.exchange_rate,
    jsonb_build_object('explicit_rate_supplied', p_explicit_rate_supplied)
  );

  IF v_baseline_kind NOT IN ('NONE', 'MISSING') THEN
    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      invoice_id,
      receipt_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      maker_user_id,
      source_category,
      baseline_kind,
      baseline_exchange_rate_id,
      baseline_fx_reference_rate_id,
      selected_rate,
      final_rate
    )
    VALUES (
      p_company_id,
      CASE WHEN p_transaction_type = 'invoice' THEN p_transaction_id ELSE NULL END,
      CASE WHEN p_transaction_type = 'receipt' THEN p_transaction_id ELSE NULL END,
      v_new_id,
      v_version,
      'BaselineResolved',
      p_actor_user_id,
      p_actor_user_id,
      v_source_category,
      v_baseline_kind,
      v_baseline_exchange_rate_id,
      v_baseline_fx_reference_rate_id,
      v_baseline_rate,
      v_tx.exchange_rate
    );
  END IF;

  IF v_source_category = 'REFERENCE_SELECTED' THEN
    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      invoice_id,
      receipt_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      maker_user_id,
      source_category,
      fx_reference_rate_id,
      baseline_kind,
      baseline_fx_reference_rate_id,
      selected_rate,
      final_rate,
      metadata
    )
    VALUES (
      p_company_id,
      CASE WHEN p_transaction_type = 'invoice' THEN p_transaction_id ELSE NULL END,
      CASE WHEN p_transaction_type = 'receipt' THEN p_transaction_id ELSE NULL END,
      v_new_id,
      v_version,
      'ReferenceSelected',
      p_actor_user_id,
      p_actor_user_id,
      v_source_category,
      v_source_fx_reference_rate_id,
      v_baseline_kind,
      v_baseline_fx_reference_rate_id,
      v_tx.exchange_rate,
      v_tx.exchange_rate,
      jsonb_build_object('stale_reference', v_stale_reference)
    );
  END IF;

  IF v_approval_status = 'Pending' THEN
    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      invoice_id,
      receipt_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      prior_approval_status,
      new_approval_status,
      reason,
      maker_user_id,
      source_category,
      selected_rate,
      final_rate
    )
    VALUES (
      p_company_id,
      CASE WHEN p_transaction_type = 'invoice' THEN p_transaction_id ELSE NULL END,
      CASE WHEN p_transaction_type = 'receipt' THEN p_transaction_id ELSE NULL END,
      v_new_id,
      v_version,
      'ApprovalRequired',
      p_actor_user_id,
      NULL,
      v_approval_status,
      p_override_reason,
      p_actor_user_id,
      v_source_category,
      v_tx.exchange_rate,
      v_tx.exchange_rate
    );
  END IF;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) IS
  'Batch 9D-C service-role RPC to create/supersede current booking-rate decision rows for Draft invoices/receipts; migration 024 hardens optional source provenance handling.';

COMMIT;
