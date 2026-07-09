-- ============================================================================
-- Batch 9D-C: Booking Rate Provenance and Override Governance
-- Migration 023: Immutability triggers, append-only event protection,
-- governed RPCs, and transactional posting guard.
--
-- This migration does not change posting math. It installs the governance
-- authorization boundary that must pass before the existing posting status
-- transition can complete.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Append-only event protection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_prevent_booking_rate_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'BR-FX-GOVERNANCE: booking-rate decision events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_brde_prevent_update
  ON public.fx_booking_rate_decision_events;
CREATE TRIGGER trg_fx_brde_prevent_update
BEFORE UPDATE ON public.fx_booking_rate_decision_events
FOR EACH ROW
EXECUTE FUNCTION public.fx_prevent_booking_rate_event_mutation();

DROP TRIGGER IF EXISTS trg_fx_brde_prevent_delete
  ON public.fx_booking_rate_decision_events;
CREATE TRIGGER trg_fx_brde_prevent_delete
BEFORE DELETE ON public.fx_booking_rate_decision_events
FOR EACH ROW
EXECUTE FUNCTION public.fx_prevent_booking_rate_event_mutation();

-- ---------------------------------------------------------------------------
-- 2. Posted FX/governance immutability
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_prevent_invoice_booked_fx_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed BOOLEAN;
BEGIN
  v_changed :=
    OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate
    OR OLD.base_currency IS DISTINCT FROM NEW.base_currency
    OR OLD.base_total IS DISTINCT FROM NEW.base_total
    OR OLD.fx_source_category IS DISTINCT FROM NEW.fx_source_category
    OR OLD.fx_decision_id IS DISTINCT FROM NEW.fx_decision_id
    OR OLD.invoice_date IS DISTINCT FROM NEW.invoice_date;

  IF v_changed
    AND OLD.status = 'Draft'
    AND NEW.status = 'Draft'
    AND current_setting('app.fx_governed_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: Draft invoice FX/governance fields may change only through governed mutation RPCs';
  END IF;

  IF v_changed AND (OLD.status <> 'Draft' OR NEW.status <> 'Draft') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: protected invoice FX/governance fields may change only while Draft remains Draft';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_prevent_receipt_booked_fx_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed BOOLEAN;
BEGIN
  v_changed :=
    OLD.currency IS DISTINCT FROM NEW.currency
    OR OLD.exchange_rate IS DISTINCT FROM NEW.exchange_rate
    OR OLD.base_currency IS DISTINCT FROM NEW.base_currency
    OR OLD.base_amount IS DISTINCT FROM NEW.base_amount
    OR OLD.fx_source_category IS DISTINCT FROM NEW.fx_source_category
    OR OLD.fx_decision_id IS DISTINCT FROM NEW.fx_decision_id
    OR OLD.receipt_date IS DISTINCT FROM NEW.receipt_date;

  IF v_changed
    AND OLD.status = 'Draft'
    AND NEW.status = 'Draft'
    AND current_setting('app.fx_governed_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: Draft receipt FX/governance fields may change only through governed mutation RPCs';
  END IF;

  IF v_changed AND (OLD.status <> 'Draft' OR NEW.status <> 'Draft') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: protected receipt FX/governance fields may change only while Draft remains Draft';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_prevent_invoice_booked_fx_mutation
  ON public.invoices;
CREATE TRIGGER trg_fx_prevent_invoice_booked_fx_mutation
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.fx_prevent_invoice_booked_fx_mutation();

DROP TRIGGER IF EXISTS trg_fx_prevent_receipt_booked_fx_mutation
  ON public.receipts;
CREATE TRIGGER trg_fx_prevent_receipt_booked_fx_mutation
BEFORE UPDATE ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.fx_prevent_receipt_booked_fx_mutation();

-- ---------------------------------------------------------------------------
-- 3. Internal utilities
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_booking_deviation_pct(
  p_booked_rate NUMERIC,
  p_baseline_rate NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_baseline_rate IS NULL OR p_baseline_rate = 0 THEN NULL
    ELSE ROUND((ABS(p_booked_rate - p_baseline_rate) / p_baseline_rate) * 100, 8)
  END;
$$;

CREATE OR REPLACE FUNCTION public.fx_booking_approval_status_for_deviation(
  p_deviation_pct NUMERIC,
  p_source_category TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_source_category IN ('BASE_PARITY', 'CATALOG') THEN
    RETURN 'NotRequired';
  END IF;

  IF p_deviation_pct IS NULL THEN
    RETURN 'Pending';
  ELSIF p_deviation_pct <= 0.50 THEN
    RETURN 'NotRequired';
  ELSIF p_deviation_pct <= 5.00 THEN
    RETURN 'Pending';
  ELSE
    RETURN 'Rejected';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_booking_lifecycle_for_approval(
  p_approval_status TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_approval_status
    WHEN 'NotRequired' THEN 'Draft'
    WHEN 'Approved' THEN 'Approved'
    WHEN 'Rejected' THEN 'Rejected'
    ELSE 'Pending'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fx_booking_actor_has_role(
  p_actor_user_id UUID,
  p_company_id UUID,
  p_allowed_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_actor_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = true
      AND ur.role = ANY(p_allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.fx_recalculate_invoice_draft_totals(
  p_company_id UUID,
  p_invoice_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_subtotal NUMERIC(18,2);
  v_tax_total NUMERIC(18,2);
  v_total_amount NUMERIC(18,2);
  v_base_total NUMERIC(18,2);
BEGIN
  SELECT *
    INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: invoice not found';
  END IF;
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice totals can only be recalculated while Draft';
  END IF;

  SELECT COALESCE(SUM(line_amount), 0),
         COALESCE(SUM(tax_amount), 0)
    INTO v_subtotal, v_tax_total
  FROM public.invoice_lines
  WHERE invoice_id = p_invoice_id;

  v_total_amount := v_subtotal + v_tax_total;
  v_base_total := ROUND(v_total_amount * v_invoice.exchange_rate, 2);

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  UPDATE public.invoices
  SET subtotal = v_subtotal,
      tax_total = v_tax_total,
      total_amount = v_total_amount,
      base_total = v_base_total
  WHERE id = p_invoice_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Governance decision creation / versioning RPC
-- ---------------------------------------------------------------------------

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
    CASE WHEN v_source_category = 'CATALOG' THEN v_exchange.id ELSE NULL END,
    CASE WHEN v_source_category = 'REFERENCE_SELECTED' THEN v_reference.id ELSE NULL END,
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
    CASE WHEN v_source_category = 'CATALOG' THEN v_exchange.id ELSE NULL END,
    CASE WHEN v_source_category = 'REFERENCE_SELECTED' THEN v_reference.id ELSE NULL END,
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
      v_reference.id,
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

CREATE OR REPLACE FUNCTION public.fx_submit_override(
  p_company_id UUID,
  p_transaction_type TEXT,
  p_transaction_id UUID,
  p_actor_user_id UUID,
  p_override_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.fx_record_booking_decision(
    p_company_id,
    p_transaction_type,
    p_transaction_id,
    p_actor_user_id,
    true,
    'MANUAL_OVERRIDE',
    NULL,
    p_override_reason,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_select_reference_booking_rate(
  p_company_id UUID,
  p_transaction_type TEXT,
  p_transaction_id UUID,
  p_actor_user_id UUID,
  p_fx_reference_rate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.fx_record_booking_decision(
    p_company_id,
    p_transaction_type,
    p_transaction_id,
    p_actor_user_id,
    false,
    'REFERENCE_SELECTED',
    p_fx_reference_rate_id,
    NULL,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_create_governed_invoice_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_invoice JSONB,
  p_lines JSONB DEFAULT '[]'::jsonb,
  p_explicit_rate_supplied BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID := gen_random_uuid();
  v_line JSONB;
  v_decision_id UUID;
BEGIN
  IF jsonb_typeof(p_invoice) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice payload must be an object';
  END IF;
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice lines payload must be an array';
  END IF;

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  INSERT INTO public.invoices (
    id,
    company_id,
    invoice_no,
    doc_type,
    invoice_date,
    customer_id,
    customer_name,
    currency,
    exchange_rate,
    base_currency,
    subtotal,
    tax_total,
    total_amount,
    base_total,
    status,
    reference_no,
    internal_remarks,
    invoice_remarks,
    ref_invoice_id,
    cn_type,
    reason_code,
    reason_desc,
    created_by,
    version
  )
  VALUES (
    v_invoice_id,
    p_company_id,
    p_invoice->>'invoice_no',
    COALESCE(p_invoice->>'doc_type', 'Invoice'),
    (p_invoice->>'invoice_date')::date,
    (p_invoice->>'customer_id')::uuid,
    p_invoice->>'customer_name',
    (p_invoice->>'currency')::char(3),
    (p_invoice->>'exchange_rate')::numeric,
    (p_invoice->>'base_currency')::char(3),
    COALESCE((p_invoice->>'subtotal')::numeric, 0),
    COALESCE((p_invoice->>'tax_total')::numeric, 0),
    COALESCE((p_invoice->>'total_amount')::numeric, 0),
    COALESCE((p_invoice->>'base_total')::numeric, 0),
    'Draft',
    NULLIF(p_invoice->>'reference_no', ''),
    NULLIF(p_invoice->>'internal_remarks', ''),
    NULLIF(p_invoice->>'invoice_remarks', ''),
    NULLIF(p_invoice->>'ref_invoice_id', '')::uuid,
    NULLIF(p_invoice->>'cn_type', ''),
    NULLIF(p_invoice->>'reason_code', ''),
    NULLIF(p_invoice->>'reason_desc', ''),
    p_actor_user_id,
    1
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    INSERT INTO public.invoice_lines (
      invoice_id,
      line_no,
      description,
      item_code,
      product_id,
      quantity,
      uom,
      unit_price,
      discount_pct,
      discount_amt,
      line_amount,
      tax_code_id,
      tax_rate,
      tax_amount,
      line_total,
      gl_account_id,
      cost_center,
      line_remarks
    )
    VALUES (
      v_invoice_id,
      (v_line->>'line_no')::int,
      v_line->>'description',
      NULLIF(v_line->>'item_code', ''),
      NULLIF(v_line->>'product_id', '')::uuid,
      (v_line->>'quantity')::numeric,
      NULLIF(v_line->>'uom', ''),
      (v_line->>'unit_price')::numeric,
      COALESCE((v_line->>'discount_pct')::numeric, 0),
      COALESCE((v_line->>'discount_amt')::numeric, 0),
      (v_line->>'line_amount')::numeric,
      NULLIF(v_line->>'tax_code_id', '')::uuid,
      COALESCE((v_line->>'tax_rate')::numeric, 0),
      (v_line->>'tax_amount')::numeric,
      (v_line->>'line_total')::numeric,
      NULLIF(v_line->>'gl_account_id', '')::uuid,
      NULLIF(v_line->>'cost_center', ''),
      NULLIF(v_line->>'line_remarks', '')
    );
  END LOOP;

  v_decision_id := public.fx_record_booking_decision(
    p_company_id,
    'invoice',
    v_invoice_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    NULL,
    NULL,
    p_override_reason,
    NULL
  );

  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_create_governed_receipt_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_receipt JSONB,
  p_explicit_rate_supplied BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id UUID := gen_random_uuid();
  v_decision_id UUID;
BEGIN
  IF jsonb_typeof(p_receipt) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt payload must be an object';
  END IF;

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  INSERT INTO public.receipts (
    id,
    company_id,
    receipt_no,
    receipt_date,
    value_date,
    customer_id,
    customer_name,
    payment_method,
    currency,
    exchange_rate,
    base_currency,
    receipt_amount,
    base_amount,
    allocated_amount,
    unallocated_amount,
    bank_account_id,
    bank_account_name,
    reference_no,
    cheque_date,
    status,
    remarks,
    created_by
  )
  VALUES (
    v_receipt_id,
    p_company_id,
    p_receipt->>'receipt_no',
    (p_receipt->>'receipt_date')::date,
    COALESCE(NULLIF(p_receipt->>'value_date', '')::date, (p_receipt->>'receipt_date')::date),
    (p_receipt->>'customer_id')::uuid,
    p_receipt->>'customer_name',
    p_receipt->>'payment_method',
    (p_receipt->>'currency')::char(3),
    (p_receipt->>'exchange_rate')::numeric,
    (p_receipt->>'base_currency')::char(3),
    (p_receipt->>'receipt_amount')::numeric,
    (p_receipt->>'base_amount')::numeric,
    0,
    (p_receipt->>'receipt_amount')::numeric,
    (p_receipt->>'bank_account_id')::uuid,
    p_receipt->>'bank_account_name',
    NULLIF(p_receipt->>'reference_no', ''),
    NULLIF(p_receipt->>'cheque_date', '')::date,
    'Draft',
    NULLIF(p_receipt->>'remarks', ''),
    p_actor_user_id
  );

  v_decision_id := public.fx_record_booking_decision(
    p_company_id,
    'receipt',
    v_receipt_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    NULL,
    NULL,
    p_override_reason,
    NULL
  );

  RETURN v_receipt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_update_governed_invoice_fx(
  p_company_id UUID,
  p_invoice_id UUID,
  p_actor_user_id UUID,
  p_currency CHAR(3) DEFAULT NULL,
  p_invoice_date DATE DEFAULT NULL,
  p_exchange_rate NUMERIC DEFAULT NULL,
  p_explicit_rate_supplied BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_rate NUMERIC(18,8);
  v_currency CHAR(3);
  v_invoice_date DATE;
BEGIN
  SELECT *
    INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: invoice not found';
  END IF;
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice FX can only be changed while Draft';
  END IF;

  v_currency := COALESCE(p_currency, v_invoice.currency)::CHAR(3);
  v_invoice_date := COALESCE(p_invoice_date, v_invoice.invoice_date);
  v_rate := COALESCE(p_exchange_rate, v_invoice.exchange_rate)::numeric(18,8);

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  UPDATE public.invoices
  SET currency = v_currency,
      invoice_date = v_invoice_date,
      exchange_rate = v_rate,
      base_total = ROUND(total_amount * v_rate, 2)
  WHERE id = p_invoice_id;

  RETURN public.fx_record_booking_decision(
    p_company_id,
    'invoice',
    p_invoice_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    NULL,
    NULL,
    p_override_reason,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_update_governed_receipt_fx(
  p_company_id UUID,
  p_receipt_id UUID,
  p_actor_user_id UUID,
  p_currency CHAR(3) DEFAULT NULL,
  p_receipt_date DATE DEFAULT NULL,
  p_exchange_rate NUMERIC DEFAULT NULL,
  p_explicit_rate_supplied BOOLEAN DEFAULT false,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt RECORD;
  v_rate NUMERIC(18,8);
  v_currency CHAR(3);
  v_receipt_date DATE;
BEGIN
  SELECT *
    INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_receipt.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: receipt not found';
  END IF;
  IF v_receipt.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt FX can only be changed while Draft';
  END IF;

  v_currency := COALESCE(p_currency, v_receipt.currency)::CHAR(3);
  v_receipt_date := COALESCE(p_receipt_date, v_receipt.receipt_date);
  v_rate := COALESCE(p_exchange_rate, v_receipt.exchange_rate)::numeric(18,8);

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  UPDATE public.receipts
  SET currency = v_currency,
      receipt_date = v_receipt_date,
      exchange_rate = v_rate,
      base_amount = ROUND(receipt_amount * v_rate, 2)
  WHERE id = p_receipt_id;

  RETURN public.fx_record_booking_decision(
    p_company_id,
    'receipt',
    p_receipt_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    NULL,
    NULL,
    p_override_reason,
    NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Approval / rejection RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_approve_booking_decision(
  p_decision_id UUID,
  p_actor_user_id UUID,
  p_company_id UUID,
  p_actor_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision RECORD;
BEGIN
  SELECT *
    INTO v_decision
  FROM public.fx_booking_rate_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF v_decision.id IS NULL OR v_decision.company_id <> p_company_id THEN
    RAISE EXCEPTION 'NOT_FOUND: booking decision not found';
  END IF;
  IF v_decision.approval_status <> 'Pending' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: decision is not pending approval';
  END IF;
  IF v_decision.maker_user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: maker cannot approve own decision';
  END IF;
  IF v_decision.deviation_pct IS NULL THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: missing deviation baseline cannot be approved';
  END IF;
  IF v_decision.deviation_pct > 2.00
    AND NOT public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['Finance Manager']) THEN
    RAISE EXCEPTION 'AUTH: Finance Manager approval required';
  END IF;
  IF v_decision.deviation_pct <= 2.00
    AND NOT public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['AR Supervisor', 'Finance Manager']) THEN
    RAISE EXCEPTION 'AUTH: AR Supervisor approval required';
  END IF;
  IF public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['System Admin', 'Auditor'])
    AND NOT public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['AR Supervisor', 'Finance Manager']) THEN
    RAISE EXCEPTION 'AUTH: role cannot approve financial booking-rate decisions';
  END IF;

  UPDATE public.fx_booking_rate_decisions
  SET approval_status = 'Approved',
      lifecycle_status = 'Approved',
      checker_user_id = p_actor_user_id,
      approved_by = p_actor_user_id,
      approved_at = now(),
      updated_at = now()
  WHERE id = p_decision_id;

  INSERT INTO public.fx_booking_rate_decision_events (
    company_id,
    invoice_id,
    receipt_id,
    decision_id,
    decision_version,
    event_type,
    actor_user_id,
    actor_role,
    prior_approval_status,
    new_approval_status,
    maker_user_id,
    checker_user_id,
    source_category,
    selected_rate,
    final_rate
  )
  VALUES (
    v_decision.company_id,
    v_decision.invoice_id,
    v_decision.receipt_id,
    v_decision.id,
    v_decision.decision_version,
    'Approved',
    p_actor_user_id,
    p_actor_role,
    v_decision.approval_status,
    'Approved',
    v_decision.maker_user_id,
    p_actor_user_id,
    v_decision.source_category,
    v_decision.booked_rate,
    v_decision.booked_rate
  );

  RETURN p_decision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_reject_booking_decision(
  p_decision_id UUID,
  p_actor_user_id UUID,
  p_company_id UUID,
  p_actor_role TEXT,
  p_rejection_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision RECORD;
BEGIN
  SELECT *
    INTO v_decision
  FROM public.fx_booking_rate_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF v_decision.id IS NULL OR v_decision.company_id <> p_company_id THEN
    RAISE EXCEPTION 'NOT_FOUND: booking decision not found';
  END IF;
  IF NOT public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['AR Supervisor', 'Finance Manager']) THEN
    RAISE EXCEPTION 'AUTH: AR Supervisor or Finance Manager role required to reject financial booking-rate decisions';
  END IF;
  IF public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['System Admin', 'Auditor'])
    AND NOT public.fx_booking_actor_has_role(p_actor_user_id, p_company_id, ARRAY['AR Supervisor', 'Finance Manager']) THEN
    RAISE EXCEPTION 'AUTH: role cannot reject financial booking-rate decisions';
  END IF;

  UPDATE public.fx_booking_rate_decisions
  SET approval_status = 'Rejected',
      lifecycle_status = 'Rejected',
      checker_user_id = p_actor_user_id,
      rejected_by = p_actor_user_id,
      rejected_at = now(),
      rejection_reason = p_rejection_reason,
      updated_at = now()
  WHERE id = p_decision_id;

  INSERT INTO public.fx_booking_rate_decision_events (
    company_id,
    invoice_id,
    receipt_id,
    decision_id,
    decision_version,
    event_type,
    actor_user_id,
    actor_role,
    prior_approval_status,
    new_approval_status,
    reason,
    maker_user_id,
    checker_user_id,
    source_category,
    selected_rate,
    final_rate
  )
  VALUES (
    v_decision.company_id,
    v_decision.invoice_id,
    v_decision.receipt_id,
    v_decision.id,
    v_decision.decision_version,
    'Rejected',
    p_actor_user_id,
    p_actor_role,
    v_decision.approval_status,
    'Rejected',
    p_rejection_reason,
    v_decision.maker_user_id,
    p_actor_user_id,
    v_decision.source_category,
    v_decision.booked_rate,
    v_decision.booked_rate
  );

  RETURN p_decision_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Transaction-safe postability assertion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_assert_booking_decision_postable(
  p_company_id UUID,
  p_invoice_id UUID DEFAULT NULL,
  p_receipt_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_decision RECORD;
  v_current_count INTEGER;
BEGIN
  IF (p_invoice_id IS NULL AND p_receipt_id IS NULL)
    OR (p_invoice_id IS NOT NULL AND p_receipt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: exactly one transaction id is required';
  END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT
      id,
      company_id,
      currency::CHAR(3) AS currency,
      base_currency::CHAR(3) AS base_currency,
      exchange_rate::numeric(18,8) AS exchange_rate,
      invoice_date AS transaction_date,
      fx_source_category,
      fx_decision_id
      INTO v_tx
    FROM public.invoices
    WHERE id = p_invoice_id
    FOR UPDATE;
  ELSE
    SELECT
      id,
      company_id,
      currency::CHAR(3) AS currency,
      base_currency::CHAR(3) AS base_currency,
      exchange_rate::numeric(18,8) AS exchange_rate,
      receipt_date AS transaction_date,
      fx_source_category,
      fx_decision_id
      INTO v_tx
    FROM public.receipts
    WHERE id = p_receipt_id
    FOR UPDATE;
  END IF;

  IF v_tx.id IS NULL OR v_tx.company_id <> p_company_id THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction not found for booking-rate postability';
  END IF;
  IF v_tx.fx_decision_id IS NULL OR v_tx.fx_source_category IS NULL THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: missing booking-rate decision';
  END IF;

  SELECT *
    INTO v_decision
  FROM public.fx_booking_rate_decisions
  WHERE id = v_tx.fx_decision_id
  FOR UPDATE;

  IF v_decision.id IS NULL THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: linked booking-rate decision not found';
  END IF;
  IF v_decision.company_id <> p_company_id THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: decision company mismatch';
  END IF;
  IF p_invoice_id IS NOT NULL AND (v_decision.invoice_id <> p_invoice_id OR v_decision.receipt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: decision transaction mismatch';
  END IF;
  IF p_receipt_id IS NOT NULL AND (v_decision.receipt_id <> p_receipt_id OR v_decision.invoice_id IS NOT NULL) THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: decision transaction mismatch';
  END IF;

  SELECT count(*)
    INTO v_current_count
  FROM public.fx_booking_rate_decisions d
  WHERE d.root_decision_id = v_decision.root_decision_id
    AND d.lifecycle_status <> 'Superseded'
    AND (
      (p_invoice_id IS NOT NULL AND d.invoice_id = p_invoice_id)
      OR (p_receipt_id IS NOT NULL AND d.receipt_id = p_receipt_id)
    );

  IF v_current_count <> 1 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid current decision chain';
  END IF;
  IF v_decision.lifecycle_status = 'Superseded' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: superseded decision cannot post';
  END IF;
  IF v_decision.source_category = 'LEGACY_UNVERIFIED' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: LEGACY_UNVERIFIED decision is not postable';
  END IF;
  IF v_decision.stale_reference THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: stale reference decision is not postable';
  END IF;
  IF v_decision.source_category IN ('MANUAL_OVERRIDE', 'REFERENCE_SELECTED')
    AND v_decision.baseline_kind IN ('NONE', 'MISSING') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: missing governed baseline is not postable';
  END IF;
  IF v_decision.approval_status NOT IN ('NotRequired', 'Approved') THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: booking-rate decision is not approved for posting';
  END IF;
  IF v_decision.approval_status = 'Approved'
    AND (v_decision.checker_user_id IS NULL OR v_decision.checker_user_id = v_decision.maker_user_id) THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: maker-checker approval invalid';
  END IF;
  IF v_decision.source_category <> v_tx.fx_source_category
    OR v_decision.from_currency <> v_tx.currency
    OR v_decision.to_currency <> v_tx.base_currency
    OR v_decision.transaction_date <> v_tx.transaction_date
    OR ROUND(v_decision.booked_rate, 8) <> ROUND(v_tx.exchange_rate, 8) THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: decision snapshot mismatch';
  END IF;

  RETURN v_decision.id;
END;
$$;

-- Status transition guards ensure the postability check happens in the same
-- database transaction as the posting status update, even if a caller attempts
-- to bypass the Edge preflight.
CREATE OR REPLACE FUNCTION public.fx_guard_invoice_posting_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_id UUID;
BEGIN
  IF OLD.status = 'Draft' AND NEW.status <> 'Draft' THEN
    v_decision_id := public.fx_assert_booking_decision_postable(
      NEW.company_id,
      NEW.id,
      NULL
    );

    UPDATE public.fx_booking_rate_decisions
    SET lifecycle_status = 'Posted',
        posted = true,
        posted_at = COALESCE(NEW.posted_at, now()),
        updated_at = now()
    WHERE id = v_decision_id;

    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      invoice_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      prior_approval_status,
      new_approval_status,
      source_category,
      selected_rate,
      final_rate
    )
    SELECT
      d.company_id,
      d.invoice_id,
      d.id,
      d.decision_version,
      'Posted',
      NEW.posted_by,
      d.approval_status,
      d.approval_status,
      d.source_category,
      d.booked_rate,
      d.booked_rate
    FROM public.fx_booking_rate_decisions d
    WHERE d.id = v_decision_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_guard_receipt_posting_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision_id UUID;
BEGIN
  IF OLD.status = 'Draft' AND NEW.status <> 'Draft' THEN
    v_decision_id := public.fx_assert_booking_decision_postable(
      NEW.company_id,
      NULL,
      NEW.id
    );

    UPDATE public.fx_booking_rate_decisions
    SET lifecycle_status = 'Posted',
        posted = true,
        posted_at = COALESCE(NEW.posted_at, now()),
        updated_at = now()
    WHERE id = v_decision_id;

    INSERT INTO public.fx_booking_rate_decision_events (
      company_id,
      receipt_id,
      decision_id,
      decision_version,
      event_type,
      actor_user_id,
      prior_approval_status,
      new_approval_status,
      source_category,
      selected_rate,
      final_rate
    )
    SELECT
      d.company_id,
      d.receipt_id,
      d.id,
      d.decision_version,
      'Posted',
      NEW.posted_by,
      d.approval_status,
      d.approval_status,
      d.source_category,
      d.booked_rate,
      d.booked_rate
    FROM public.fx_booking_rate_decisions d
    WHERE d.id = v_decision_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_guard_invoice_posting_decision
  ON public.invoices;
CREATE TRIGGER trg_fx_guard_invoice_posting_decision
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.fx_guard_invoice_posting_decision();

DROP TRIGGER IF EXISTS trg_fx_guard_receipt_posting_decision
  ON public.receipts;
CREATE TRIGGER trg_fx_guard_receipt_posting_decision
BEFORE UPDATE ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.fx_guard_receipt_posting_decision();


-- ---------------------------------------------------------------------------
-- 7. Forward-safe posting RPC replacements with early governance guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION post_invoice(
  p_invoice_id  UUID,
  p_user_id     UUID,
  p_company_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv           RECORD;
  v_cust          RECORD;
  v_line          RECORD;
  v_term          RECORD;
  v_tc            RECORD;
  v_period        VARCHAR(7);
  v_due_date      DATE;
  v_je_id         UUID;
  v_je_no         VARCHAR(30);
  v_ar_acct_id    UUID;
  v_rev_acct_id   UUID;
  v_tax_acct_id   UUID;
  v_ar_acct_code  VARCHAR(20);
  v_source_type   VARCHAR(3);
  v_subtotal      NUMERIC(18,2) := 0;
  v_tax_total     NUMERIC(18,2) := 0;
  v_total_amount  NUMERIC(18,2) := 0;
  v_base_total    NUMERIC(18,2) := 0;
  v_line_count    INT := 0;
  v_line_no       INT := 0;
  v_total_debit   NUMERIC(18,2) := 0;
  v_total_credit  NUMERIC(18,2) := 0;
  v_failures      TEXT[] := '{}';
  v_future_limit  INT;
  v_inv_date      DATE;
  v_credit_util   NUMERIC(18,2);
  v_credit_limit  NUMERIC(18,2);
  v_config_val    TEXT;
  v_default_code  TEXT;
BEGIN
  -- ── Auth ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Clerk','AR Supervisor','Finance Manager']);

  -- ── 1. Lock invoice ──
  SELECT * INTO v_inv FROM invoices
    WHERE id = p_invoice_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Invoice not found';
  END IF;
  IF v_inv.status != 'Draft' THEN
    RAISE EXCEPTION 'BR-INV-STATUS: Only Draft invoices can be posted. Current: %', v_inv.status;
  END IF;

  -- ── 2. Must have lines ──
  -- Batch 9D-C: authoritative booking-rate governance check occurs
  -- immediately after the invoice row lock and before totals, journal,
  -- status, or balance mutations.
  PERFORM public.fx_assert_booking_decision_postable(
    p_company_id,
    p_invoice_id,
    NULL
  );

  SELECT COUNT(*) INTO v_line_count FROM invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'BR-INV-002: Invoice must have at least 1 line item';
  END IF;

  -- ── 3. Customer validation ──
  SELECT * INTO v_cust FROM customers WHERE id = v_inv.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Customer not found';
  END IF;
  IF v_cust.status = 'Blocked' THEN
    RAISE EXCEPTION 'BR-CUS-002: Customer "%" is Blocked', v_cust.customer_name;
  END IF;
  IF v_cust.status = 'Inactive' AND v_inv.doc_type != 'Credit Note' THEN
    RAISE EXCEPTION 'BR-CUS-001: Customer "%" is Inactive', v_cust.customer_name;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_inv.customer_id);

  -- ── 4. Recalculate totals from lines ──
  SELECT COALESCE(SUM(line_amount), 0),
         COALESCE(SUM(tax_amount), 0)
    INTO v_subtotal, v_tax_total
    FROM invoice_lines WHERE invoice_id = p_invoice_id;
  v_total_amount := v_subtotal + v_tax_total;
  v_base_total   := ROUND(v_total_amount * v_inv.exchange_rate, 2);

  PERFORM set_config('app.fx_governed_mutation', 'on', true);

  UPDATE invoices SET
    subtotal = v_subtotal,
    tax_total = v_tax_total,
    total_amount = v_total_amount,
    base_total = v_base_total
  WHERE id = p_invoice_id;

  -- ── 5. Credit check (Invoice/DN only) ──
  IF v_inv.doc_type != 'Credit Note' THEN
    SELECT credit_limit, credit_utilization
      INTO v_credit_limit, v_credit_util
      FROM v_customer_credit_utilization
      WHERE id = v_inv.customer_id;
    IF FOUND AND v_credit_limit > 0 AND (v_credit_util + v_total_amount) > v_credit_limit THEN
      RAISE EXCEPTION 'BR-CM-001: Credit limit exceeded for "%". Utilization: %, Limit: %',
        v_cust.customer_name, v_credit_util + v_total_amount, v_credit_limit;
    END IF;
  END IF;

  -- ── 6. Fiscal period ──
  v_period := to_char(v_inv.invoice_date, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 7. Future date limit ──
  SELECT config_value INTO v_config_val FROM ar_system_config
    WHERE company_id = p_company_id AND config_key = 'invoice_future_days_limit';
  v_future_limit := COALESCE(v_config_val::INT, 7);
  IF (v_inv.invoice_date - CURRENT_DATE) > v_future_limit THEN
    RAISE EXCEPTION 'BR-INV-002: Invoice date exceeds allowed future days limit (% days)', v_future_limit;
  END IF;

  -- ── 8. Tax code effectiveness ──
  FOR v_line IN SELECT * FROM invoice_lines WHERE invoice_id = p_invoice_id ORDER BY line_no LOOP
    IF v_line.tax_code_id IS NOT NULL THEN
      SELECT is_active, effective_from, effective_to INTO v_tc
        FROM tax_codes WHERE id = v_line.tax_code_id;
      IF NOT FOUND OR NOT v_tc.is_active THEN
        v_failures := array_append(v_failures, format('Line %s: Tax code is inactive', v_line.line_no));
      ELSIF v_inv.invoice_date < v_tc.effective_from
         OR (v_tc.effective_to IS NOT NULL AND v_inv.invoice_date > v_tc.effective_to) THEN
        v_failures := array_append(v_failures,
          format('Line %s: Tax code not effective on %s', v_line.line_no, v_inv.invoice_date));
      END IF;
    END IF;
  END LOOP;
  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION 'BR-INV-002: Tax validation failed: %', array_to_string(v_failures, '; ');
  END IF;

  -- ── 9. Calculate due_date ──
  IF v_cust.payment_term_id IS NOT NULL THEN
    SELECT term_type, days INTO v_term FROM payment_terms WHERE id = v_cust.payment_term_id;
    IF FOUND THEN
      v_due_date := calculate_due_date(v_inv.invoice_date, v_term.term_type, v_term.days);
    END IF;
  END IF;
  IF v_due_date IS NULL AND v_inv.doc_type != 'Credit Note' THEN
    v_due_date := v_inv.invoice_date + 30;  -- NET30 fallback
  END IF;

  -- ── 10. Resolve GL accounts ──
  v_ar_acct_id := v_cust.ar_control_acct_id;
  IF v_ar_acct_id IS NULL THEN
    v_ar_acct_id := rpc_get_config_account(
      p_company_id, 'default_ar_control_acct', '1100-001', 'AR control');
  END IF;

  v_rev_acct_id := v_cust.revenue_acct_id;
  IF v_rev_acct_id IS NULL THEN
    v_rev_acct_id := rpc_get_config_account(
      p_company_id, 'default_revenue_acct', '4000-001', 'revenue');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_ar_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: AR control account is missing or inactive for %', v_inv.invoice_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_rev_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: Revenue account is missing or inactive for %', v_inv.invoice_no;
  END IF;

  -- Tax account from first line with tax
  SELECT tc.gl_account_id INTO v_tax_acct_id
    FROM invoice_lines il
    JOIN tax_codes tc ON tc.id = il.tax_code_id
    WHERE il.invoice_id = p_invoice_id AND il.tax_amount > 0 AND tc.gl_account_id IS NOT NULL
    LIMIT 1;

  IF v_tax_total > 0 AND v_tax_acct_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG: Missing tax GL account for invoice % with tax amount %',
      v_inv.invoice_no, v_tax_total;
  END IF;

  -- AR account code snapshot
  SELECT account_code INTO v_ar_acct_code FROM gl_accounts WHERE id = v_ar_acct_id;

  -- ── 11. Determine source_type ──
  v_source_type := CASE v_inv.doc_type
    WHEN 'Invoice' THEN 'INV'
    WHEN 'Credit Note' THEN 'CN'
    WHEN 'Debit Note' THEN 'DN'
  END;

  -- ── 12. Generate JE ──
  IF TRUE THEN
    SELECT get_next_sequence(p_company_id, 'JE', v_source_type) INTO v_je_no;

    -- JE header
    INSERT INTO journal_entries (
      company_id, je_no, je_date, posting_period, source_type,
      source_doc_no, source_doc_id, description,
      currency, exchange_rate, base_currency,
      total_debit, total_credit, created_by
    ) VALUES (
      p_company_id, v_je_no, v_inv.invoice_date, v_period, v_source_type,
      v_inv.invoice_no, p_invoice_id,
      format('%s posting: %s — %s', v_inv.doc_type, v_inv.invoice_no, v_inv.customer_name),
      v_inv.currency, v_inv.exchange_rate, v_inv.base_currency,
      v_total_amount, v_total_amount, p_user_id
    ) RETURNING id INTO v_je_id;

    v_line_no := 0;

    IF v_inv.doc_type IN ('Invoice', 'Debit Note') THEN
      -- Dr AR Control
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_ar_acct_id,
        format('AR: %s - %s', v_inv.invoice_no, v_inv.customer_name),
        v_total_amount, 0,
        ROUND(v_total_amount * v_inv.exchange_rate, 2), 0,
        v_inv.currency, v_total_amount);
      v_total_debit := v_total_amount;

      -- Cr Revenue per line
      FOR v_line IN
        SELECT il.gl_account_id AS line_gl, il.line_amount, il.line_no AS lno, il.description AS ldesc
        FROM invoice_lines il WHERE il.invoice_id = p_invoice_id AND il.line_amount > 0 ORDER BY il.line_no
      LOOP
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, COALESCE(v_line.line_gl, v_rev_acct_id),
          format('Revenue L%s: %s', v_line.lno, v_line.ldesc),
          0, v_line.line_amount,
          0, ROUND(v_line.line_amount * v_inv.exchange_rate, 2),
          v_inv.currency, v_line.line_amount);
        v_total_credit := v_total_credit + v_line.line_amount;
      END LOOP;

      -- Cr Tax
      IF v_tax_total > 0 AND v_tax_acct_id IS NOT NULL THEN
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, v_tax_acct_id,
          format('Tax: %s', v_inv.invoice_no),
          0, v_tax_total,
          0, ROUND(v_tax_total * v_inv.exchange_rate, 2),
          v_inv.currency, v_tax_total);
        v_total_credit := v_total_credit + v_tax_total;
      END IF;

    ELSE  -- Credit Note: reversed direction
      -- Dr Revenue
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_rev_acct_id,
        format('CN Revenue reversal: %s', v_inv.invoice_no),
        v_subtotal, 0,
        ROUND(v_subtotal * v_inv.exchange_rate, 2), 0,
        v_inv.currency, v_subtotal);
      v_total_debit := v_subtotal;

      -- Dr Tax
      IF v_tax_total > 0 AND v_tax_acct_id IS NOT NULL THEN
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, v_tax_acct_id,
          format('CN Tax reversal: %s', v_inv.invoice_no),
          v_tax_total, 0,
          ROUND(v_tax_total * v_inv.exchange_rate, 2), 0,
          v_inv.currency, v_tax_total);
        v_total_debit := v_total_debit + v_tax_total;
      END IF;

      -- Cr AR Control
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_ar_acct_id,
        format('CN AR: %s - %s', v_inv.invoice_no, v_inv.customer_name),
        0, v_total_amount,
        0, ROUND(v_total_amount * v_inv.exchange_rate, 2),
        v_inv.currency, v_total_amount);
      v_total_credit := v_total_amount;
    END IF;

    -- Update JE totals (chk_je_balanced will enforce)
    UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit
      WHERE id = v_je_id;
  END IF;

  -- ── 13. Update invoice ──
  UPDATE invoices SET
    status = 'Open',
    outstanding = v_total_amount,
    due_date = v_due_date,
    posting_period = v_period,
    ar_acct = v_ar_acct_code,
    posted_by = p_user_id,
    posted_at = NOW(),
    version = v_inv.version + 1
  WHERE id = p_invoice_id AND version = v_inv.version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: Invoice was modified by another user during posting';
  END IF;

  -- ── 14. Linked CN auto-deduction (BR-CN-003) ──
  IF v_inv.doc_type = 'Credit Note' AND v_inv.cn_type = 'Linked' AND v_inv.ref_invoice_id IS NOT NULL THEN
    DECLARE
      v_ref    RECORD;
      v_new_os NUMERIC(18,2);
      v_cum_cn NUMERIC(18,2);
    BEGIN
      SELECT * INTO v_ref FROM invoices WHERE id = v_inv.ref_invoice_id FOR UPDATE;
      IF FOUND THEN
        -- BR-CN-001: CN amount cannot exceed outstanding
        IF v_total_amount > v_ref.outstanding THEN
          RAISE EXCEPTION 'BR-CN-001: CN amount (%) exceeds outstanding (%) of %',
            v_total_amount, v_ref.outstanding, v_ref.invoice_no;
        END IF;
        -- BR-CN-002: cumulative check
        SELECT COALESCE(SUM(total_amount), 0) INTO v_cum_cn
          FROM invoices
          WHERE ref_invoice_id = v_inv.ref_invoice_id
            AND doc_type = 'Credit Note' AND cn_type = 'Linked'
            AND status != 'Cancelled' AND id != p_invoice_id;
        IF (v_cum_cn + v_total_amount) > v_ref.total_amount THEN
          RAISE EXCEPTION 'BR-CN-002: Cumulative CN (%) exceeds original total (%) for %',
            v_cum_cn + v_total_amount, v_ref.total_amount, v_ref.invoice_no;
        END IF;

        v_new_os := ROUND(v_ref.outstanding - v_total_amount, 2);
        UPDATE invoices SET
          outstanding = v_new_os,
          status = CASE
            WHEN v_new_os <= 0 THEN 'Paid'
            WHEN v_new_os < v_ref.total_amount THEN 'Partially Paid'
            ELSE v_ref.status
          END,
          version = v_ref.version + 1
        WHERE id = v_inv.ref_invoice_id AND version = v_ref.version;

        INSERT INTO cn_allocations (cn_id, invoice_id, allocated_amount, allocated_by, status)
        VALUES (p_invoice_id, v_inv.ref_invoice_id, v_total_amount, p_user_id, 'Active');

        UPDATE invoices SET
          outstanding = 0,
          status = 'Paid',
          version = version + 1
        WHERE id = p_invoice_id;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_no', v_inv.invoice_no,
    'je_no', v_je_no,
    'status', CASE WHEN v_inv.doc_type = 'Credit Note' AND v_inv.cn_type = 'Linked' THEN 'Paid' ELSE 'Open' END,
    'due_date', v_due_date,
    'total_amount', v_total_amount
  );
END;
$$;

COMMENT ON FUNCTION post_invoice(UUID, UUID, UUID) IS
  'P1 RPC: Atomic invoice posting. Locks invoice row, validates all business rules, '
  'generates balanced JE, updates status. Handles INV/CN/DN and Linked CN auto-deduction.';

CREATE OR REPLACE FUNCTION post_receipt(
  p_receipt_id  UUID,
  p_user_id     UUID,
  p_company_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rct          RECORD;
  v_cust         RECORD;
  v_bank         RECORD;
  v_period       VARCHAR(7);
  v_je_id        UUID;
  v_je_no        VARCHAR(30);
  v_ar_acct_id   UUID;
  v_debit_acct   UUID;
  v_debit_desc   TEXT;
  v_config_val   TEXT;
  v_default_code TEXT;
BEGIN
  -- ── Auth ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Clerk','AR Supervisor','Finance Manager']);

  -- ── 1. Lock receipt ──
  SELECT * INTO v_rct FROM receipts
    WHERE id = p_receipt_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Receipt not found';
  END IF;
  IF v_rct.status != 'Draft' THEN
    RAISE EXCEPTION 'BR-RCT-STATUS: Only Draft receipts can be posted. Current: %', v_rct.status;
  END IF;

  -- ── 2. Amount ──
  -- Batch 9D-C: authoritative booking-rate governance check occurs
  -- immediately after the receipt row lock and before journal, status,
  -- or balance mutations.
  PERFORM public.fx_assert_booking_decision_postable(
    p_company_id,
    NULL,
    p_receipt_id
  );

  IF v_rct.receipt_amount <= 0 THEN
    RAISE EXCEPTION 'BR-RCT-001: Receipt amount must be greater than 0';
  END IF;

  -- ── 3. Customer ──
  SELECT * INTO v_cust FROM customers WHERE id = v_rct.customer_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Customer not found';
  END IF;
  IF v_cust.status = 'Blocked' THEN
    RAISE EXCEPTION 'BR-CUS-002: Customer "%" is Blocked', v_cust.customer_name;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_rct.customer_id);

  -- ── 4. Bank account ──
  SELECT * INTO v_bank FROM bank_accounts WHERE id = v_rct.bank_account_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Bank account not found';
  END IF;
  IF NOT v_bank.is_active THEN
    RAISE EXCEPTION 'BR-RCT-001: Bank account is inactive';
  END IF;

  -- ── 5. Fiscal period ──
  v_period := to_char(v_rct.receipt_date, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 6. Resolve GL accounts ──
  v_ar_acct_id := v_cust.ar_control_acct_id;
  IF v_ar_acct_id IS NULL THEN
    v_ar_acct_id := rpc_get_config_account(
      p_company_id, 'default_ar_control_acct', '1100-001', 'AR control');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_ar_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: AR control account is missing or inactive for %', v_rct.receipt_no;
  END IF;

  IF v_rct.payment_method = 'CHQ' THEN
    v_debit_acct := rpc_get_config_account(
      p_company_id, 'default_cheque_acct', '1050-001', 'cheques on hand');
    v_debit_desc := format('Cheques on Hand: %s', v_rct.receipt_no);
  ELSE
    v_debit_acct := v_bank.gl_account_id;
    IF v_debit_acct IS NULL OR NOT EXISTS (
      SELECT 1 FROM gl_accounts WHERE id = v_debit_acct AND company_id = p_company_id AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'CONFIG: Bank GL account is missing or inactive for %', v_rct.receipt_no;
    END IF;
    v_debit_desc := format('Bank: %s (%s)', v_rct.receipt_no, v_rct.payment_method);
  END IF;

  -- ── 7. Generate JE ──
  IF TRUE THEN
    SELECT get_next_sequence(p_company_id, 'JE', 'RCT') INTO v_je_no;

    INSERT INTO journal_entries (
      company_id, je_no, je_date, posting_period, source_type,
      source_doc_no, source_doc_id, description,
      currency, exchange_rate, base_currency,
      total_debit, total_credit, created_by
    ) VALUES (
      p_company_id, v_je_no, v_rct.receipt_date, v_period, 'RCT',
      v_rct.receipt_no, p_receipt_id,
      format('Receipt posting: %s — %s (%s)', v_rct.receipt_no, v_rct.customer_name, v_rct.payment_method),
      v_rct.currency, v_rct.exchange_rate, v_rct.base_currency,
      v_rct.receipt_amount, v_rct.receipt_amount, p_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr Bank/Cheques
    INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
      debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
    VALUES (v_je_id, 10, v_debit_acct, v_debit_desc,
      v_rct.receipt_amount, 0,
      ROUND(v_rct.receipt_amount * v_rct.exchange_rate, 2), 0,
      v_rct.currency, v_rct.receipt_amount);

    -- Cr AR Control
    INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
      debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
    VALUES (v_je_id, 20, v_ar_acct_id,
      format('AR receipt: %s - %s', v_rct.receipt_no, v_rct.customer_name),
      0, v_rct.receipt_amount,
      0, ROUND(v_rct.receipt_amount * v_rct.exchange_rate, 2),
      v_rct.currency, v_rct.receipt_amount);
  END IF;

  -- ── 8. Update receipt status (optimistic lock on status=Draft) ──
  UPDATE receipts SET
    status = 'Posted',
    posting_period = v_period,
    posted_by = p_user_id,
    posted_at = NOW()
  WHERE id = p_receipt_id AND status = 'Draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: Receipt has been posted by another user';
  END IF;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'receipt_no', v_rct.receipt_no,
    'je_no', v_je_no,
    'status', 'Posted'
  );
END;
$$;

COMMENT ON FUNCTION post_receipt(UUID, UUID, UUID) IS
  'P1 RPC: Atomic receipt posting. Locks receipt row, validates business rules, '
  'generates JE (CHQ→Cheques on Hand, others→Bank), prevents double-posting.';

-- ---------------------------------------------------------------------------
-- 7. Privilege hardening
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_prevent_invoice_booked_fx_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_prevent_receipt_booked_fx_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_booking_deviation_pct(NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_booking_approval_status_for_deviation(NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_booking_lifecycle_for_approval(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_booking_actor_has_role(UUID, UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_recalculate_invoice_draft_totals(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_submit_override(UUID, TEXT, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_select_reference_booking_rate(UUID, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_update_governed_invoice_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_update_governed_receipt_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_approve_booking_decision(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_reject_booking_decision(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_assert_booking_decision_postable(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_guard_invoice_posting_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_guard_receipt_posting_decision() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.fx_submit_override(UUID, TEXT, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_select_reference_booking_rate(UUID, TEXT, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fx_recalculate_invoice_draft_totals(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_update_governed_invoice_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_update_governed_receipt_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_approve_booking_decision(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_reject_booking_decision(UUID, UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_assert_booking_decision_postable(UUID, UUID, UUID) FROM anon;

REVOKE ALL ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_submit_override(UUID, TEXT, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_select_reference_booking_rate(UUID, TEXT, UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_recalculate_invoice_draft_totals(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, BOOLEAN, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_update_governed_invoice_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_update_governed_receipt_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_approve_booking_decision(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_reject_booking_decision(UUID, UUID, UUID, TEXT, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_assert_booking_decision_postable(UUID, UUID, UUID) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_submit_override(UUID, TEXT, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_select_reference_booking_rate(UUID, TEXT, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_recalculate_invoice_draft_totals(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_invoice_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_receipt_fx(UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_approve_booking_decision(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_reject_booking_decision(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fx_assert_booking_decision_postable(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB) IS
  'Batch 9D-C service-role RPC to create/supersede current booking-rate decision rows for Draft invoices/receipts.';
COMMENT ON FUNCTION public.fx_recalculate_invoice_draft_totals(UUID, UUID) IS
  'Batch 9D-C service-role RPC to recalculate Draft invoice totals under the protected-field guard after line edits.';
COMMENT ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) IS
  'Batch 9D-C service-role RPC that atomically creates a Draft invoice, invoice lines, initial booking-rate decision, and governance events.';
COMMENT ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, BOOLEAN, TEXT) IS
  'Batch 9D-C service-role RPC that atomically creates a Draft receipt, initial booking-rate decision, and governance events.';
COMMENT ON FUNCTION public.fx_assert_booking_decision_postable(UUID, UUID, UUID) IS
  'Batch 9D-C internal transaction-safe postability guard. Must run inside the posting transaction after row lock.';

CREATE OR REPLACE FUNCTION public.fx_guard_journal_entry_booking_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_type IN ('INV', 'CN', 'DN') THEN
    PERFORM public.fx_assert_booking_decision_postable(
      NEW.company_id,
      NEW.source_doc_id,
      NULL
    );
  ELSIF NEW.source_type = 'RCT' THEN
    PERFORM public.fx_assert_booking_decision_postable(
      NEW.company_id,
      NULL,
      NEW.source_doc_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_guard_journal_entry_booking_decision
  ON public.journal_entries;
CREATE TRIGGER trg_fx_guard_journal_entry_booking_decision
BEFORE INSERT ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.fx_guard_journal_entry_booking_decision();

REVOKE ALL ON FUNCTION public.fx_guard_journal_entry_booking_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_guard_journal_entry_booking_decision() FROM anon;
REVOKE ALL ON FUNCTION public.fx_guard_journal_entry_booking_decision() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_guard_journal_entry_booking_decision() TO service_role;

COMMIT;
