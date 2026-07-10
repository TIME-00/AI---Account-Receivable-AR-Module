-- Batch 9D-C targeted import-origin provenance fix.
--
-- 022-025 are already applied to staging. This forward migration preserves
-- trusted CSV/XLSX import-origin metadata in booking-rate decisions without
-- changing existing non-import create callers.

BEGIN;

CREATE OR REPLACE FUNCTION public.fx_preserve_import_origin_on_supersession()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prior_import_origin JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.import_origin IS NULL AND NEW.supersedes_decision_id IS NOT NULL THEN
    SELECT d.import_origin
      INTO v_prior_import_origin
    FROM public.fx_booking_rate_decisions d
    WHERE d.id = NEW.supersedes_decision_id
      AND d.company_id = NEW.company_id
      AND d.root_decision_id = NEW.root_decision_id;

    IF v_prior_import_origin IS NOT NULL THEN
      NEW.import_origin := v_prior_import_origin;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_brd_preserve_import_origin
  ON public.fx_booking_rate_decisions;
CREATE TRIGGER trg_fx_brd_preserve_import_origin
BEFORE INSERT ON public.fx_booking_rate_decisions
FOR EACH ROW
EXECUTE FUNCTION public.fx_preserve_import_origin_on_supersession();

CREATE OR REPLACE FUNCTION public.fx_create_governed_invoice_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_invoice JSONB,
  p_import_origin JSONB,
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
  IF p_import_origin IS NOT NULL AND jsonb_typeof(p_import_origin) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: import_origin must be an object';
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
    p_import_origin
  );

  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fx_create_governed_receipt_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_receipt JSONB,
  p_import_origin JSONB,
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
  IF p_import_origin IS NOT NULL AND jsonb_typeof(p_import_origin) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: import_origin must be an object';
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
    p_import_origin
  );

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_preserve_import_origin_on_supersession() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_preserve_import_origin_on_supersession() FROM anon;
REVOKE ALL ON FUNCTION public.fx_preserve_import_origin_on_supersession() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_preserve_import_origin_on_supersession() TO service_role;

REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) TO service_role;

COMMENT ON FUNCTION public.fx_preserve_import_origin_on_supersession() IS
  'Batch 9D-C trigger helper preserving import_origin on superseded booking decision versions when later Draft FX edits create v2 decisions.';

COMMENT ON FUNCTION public.fx_create_governed_invoice_draft(UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT) IS
  'Batch 9D-C import-aware service-role overload for atomic governed Draft invoice creation with trusted import_origin provenance.';

COMMENT ON FUNCTION public.fx_create_governed_receipt_draft(UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT) IS
  'Batch 9D-C import-aware service-role overload for atomic governed Draft receipt creation with trusted import_origin provenance.';

COMMIT;
