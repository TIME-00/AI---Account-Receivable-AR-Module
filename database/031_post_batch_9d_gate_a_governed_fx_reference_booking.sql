-- Post-Batch-9D Gate A
-- Governed FX reference booking for Invoice and Receipt create/draft-update.
--
-- This forward-only migration:
--   * preserves the legacy no-reference RPC signatures;
--   * adds exact, non-defaulted reference-aware overloads;
--   * removes the pre-existing create-overload default ambiguity;
--   * validates the selected reference against the same 3-day stale basis used
--     by GET /fx-rates/lookup;
--   * performs no retained-document rewrite or historical FX restatement.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  v_mismatch_count INTEGER;
BEGIN
  IF to_regprocedure(
    'public.fx_record_booking_decision(uuid,text,uuid,uuid,boolean,text,uuid,text,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'GATE_A_FX_REFERENCE: core booking-decision function is missing';
  END IF;

  IF to_regprocedure(
    'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,boolean,text)'
  ) IS NULL
    OR to_regprocedure(
      'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,jsonb,boolean,text)'
    ) IS NULL
    OR to_regprocedure(
      'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,boolean,text)'
    ) IS NULL
    OR to_regprocedure(
      'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,jsonb,boolean,text)'
    ) IS NULL
    OR to_regprocedure(
      'public.fx_update_governed_invoice_fx(uuid,uuid,uuid,character,date,numeric,boolean,text)'
    ) IS NULL
    OR to_regprocedure(
      'public.fx_update_governed_receipt_fx(uuid,uuid,uuid,character,date,numeric,boolean,text)'
    ) IS NULL
    OR to_regprocedure(
      'public.fx_select_reference_booking_rate(uuid,text,uuid,uuid,uuid)'
    ) IS NULL
    OR to_regprocedure(
      'public.update_draft_invoice(uuid,uuid,uuid,jsonb)'
    ) IS NULL THEN
    RAISE EXCEPTION 'GATE_A_FX_REFERENCE: governed RPC baseline signature drift';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_mismatch_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = p.proowner
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'fx_create_governed_invoice_draft',
      'fx_create_governed_receipt_draft',
      'fx_update_governed_invoice_fx',
      'fx_update_governed_receipt_fx',
      'fx_select_reference_booking_rate'
    )
    AND (
      owner_role.rolname <> 'postgres'
      OR p.prosecdef IS DISTINCT FROM true
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::TEXT[]
    );

  IF v_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: owner/security/search_path baseline drift on governed FX RPCs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fx_create_governed_invoice_draft',
        'fx_create_governed_receipt_draft',
        'fx_update_governed_invoice_fx',
        'fx_update_governed_receipt_fx'
      )
      AND 'p_fx_reference_rate_id' = ANY(COALESCE(p.proargnames, ARRAY[]::TEXT[]))
  ) THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: reference-aware governed wrapper already exists or catalog drifted';
  END IF;
END;
$guard$;

CREATE FUNCTION public.fx_require_bookable_reference_rate(
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

  SELECT c.base_currency
    INTO v_company_base
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: company not found';
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

  SELECT r.*
    INTO v_reference
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

  SELECT r.id
    INTO v_latest_id
  FROM public.fx_reference_rates r
  WHERE r.company_id = p_company_id
    AND r.from_currency = p_from_currency
    AND r.to_currency = p_to_currency
    AND r.effective_date <= p_transaction_date
    AND r.status = 'Active'
  ORDER BY
    r.effective_date DESC,
    r.fetched_at DESC,
    r.created_at DESC,
    r.id DESC
  LIMIT 1;

  IF v_latest_id IS DISTINCT FROM v_reference.id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: selected reference is not the latest active rate for the effective date';
  END IF;

  IF (p_transaction_date - v_reference.effective_date) > 3 THEN
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

-- Canonical Invoice create implementation. All eight arguments are required at
-- SQL resolution time; nullable import/reference values preserve optional API
-- behavior without overlapping a legacy defaulted signature.
CREATE FUNCTION public.fx_create_governed_invoice_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_invoice JSONB,
  p_import_origin JSONB,
  p_lines JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_invoice_id UUID := gen_random_uuid();
  v_invoice JSONB := p_invoice;
  v_line JSONB;
  v_reference_rate NUMERIC(18,8);
BEGIN
  IF jsonb_typeof(v_invoice) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice payload must be an object';
  END IF;
  IF p_import_origin IS NOT NULL AND jsonb_typeof(p_import_origin) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: import_origin must be an object';
  END IF;
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice lines payload must be an array';
  END IF;

  IF p_fx_reference_rate_id IS NOT NULL THEN
    IF p_explicit_rate_supplied OR p_override_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'BR-FX-GOVERNANCE: reference selection cannot include a manual rate or override reason';
    END IF;
    v_reference_rate := public.fx_require_bookable_reference_rate(
      p_company_id,
      (v_invoice->>'currency')::CHAR(3),
      (v_invoice->>'base_currency')::CHAR(3),
      (v_invoice->>'invoice_date')::DATE,
      p_fx_reference_rate_id
    );
    v_invoice := jsonb_set(
      v_invoice,
      '{exchange_rate}',
      to_jsonb(v_reference_rate),
      true
    );
  END IF;

  -- The database, not the request, owns the booked-base snapshot.
  v_invoice := jsonb_set(
    v_invoice,
    '{base_total}',
    to_jsonb(ROUND(
      COALESCE((v_invoice->>'total_amount')::NUMERIC, 0)
        * (v_invoice->>'exchange_rate')::NUMERIC,
      2
    )),
    true
  );

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
    v_invoice->>'invoice_no',
    COALESCE(v_invoice->>'doc_type', 'Invoice'),
    (v_invoice->>'invoice_date')::DATE,
    (v_invoice->>'customer_id')::UUID,
    v_invoice->>'customer_name',
    (v_invoice->>'currency')::CHAR(3),
    (v_invoice->>'exchange_rate')::NUMERIC,
    (v_invoice->>'base_currency')::CHAR(3),
    COALESCE((v_invoice->>'subtotal')::NUMERIC, 0),
    COALESCE((v_invoice->>'tax_total')::NUMERIC, 0),
    COALESCE((v_invoice->>'total_amount')::NUMERIC, 0),
    COALESCE((v_invoice->>'base_total')::NUMERIC, 0),
    'Draft',
    NULLIF(v_invoice->>'reference_no', ''),
    NULLIF(v_invoice->>'internal_remarks', ''),
    NULLIF(v_invoice->>'invoice_remarks', ''),
    NULLIF(v_invoice->>'ref_invoice_id', '')::UUID,
    NULLIF(v_invoice->>'cn_type', ''),
    NULLIF(v_invoice->>'reason_code', ''),
    NULLIF(v_invoice->>'reason_desc', ''),
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
      (v_line->>'line_no')::INTEGER,
      v_line->>'description',
      NULLIF(v_line->>'item_code', ''),
      NULLIF(v_line->>'product_id', '')::UUID,
      (v_line->>'quantity')::NUMERIC,
      NULLIF(v_line->>'uom', ''),
      (v_line->>'unit_price')::NUMERIC,
      COALESCE((v_line->>'discount_pct')::NUMERIC, 0),
      COALESCE((v_line->>'discount_amt')::NUMERIC, 0),
      (v_line->>'line_amount')::NUMERIC,
      NULLIF(v_line->>'tax_code_id', '')::UUID,
      COALESCE((v_line->>'tax_rate')::NUMERIC, 0),
      (v_line->>'tax_amount')::NUMERIC,
      (v_line->>'line_total')::NUMERIC,
      NULLIF(v_line->>'gl_account_id', '')::UUID,
      NULLIF(v_line->>'cost_center', ''),
      NULLIF(v_line->>'line_remarks', '')
    );
  END LOOP;

  PERFORM public.fx_record_booking_decision(
    p_company_id,
    'invoice',
    v_invoice_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    CASE
      WHEN p_fx_reference_rate_id IS NOT NULL THEN 'REFERENCE_SELECTED'
      ELSE NULL
    END,
    p_fx_reference_rate_id,
    p_override_reason,
    p_import_origin
  );

  RETURN v_invoice_id;
END;
$function$;

ALTER FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID
) TO service_role;

-- Legacy no-import caller compatibility. Defaults remain only on this shortest
-- signature, so each accepted positional arity resolves to exactly one function.
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
AS $function$
BEGIN
  RETURN public.fx_create_governed_invoice_draft(
    p_company_id,
    p_actor_user_id,
    p_invoice,
    NULL,
    p_lines,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

-- Legacy import-aware caller compatibility. No defaults are retained here,
-- removing the old four-argument ambiguity with the shortest overload.
DROP FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT
);

CREATE FUNCTION public.fx_create_governed_invoice_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_invoice JSONB,
  p_import_origin JSONB,
  p_lines JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN public.fx_create_governed_invoice_draft(
    p_company_id,
    p_actor_user_id,
    p_invoice,
    p_import_origin,
    p_lines,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

ALTER FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT
) OWNER TO postgres;

CREATE FUNCTION public.fx_create_governed_receipt_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_receipt JSONB,
  p_import_origin JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_receipt_id UUID := gen_random_uuid();
  v_receipt JSONB := p_receipt;
  v_reference_rate NUMERIC(18,8);
BEGIN
  IF jsonb_typeof(v_receipt) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt payload must be an object';
  END IF;
  IF p_import_origin IS NOT NULL AND jsonb_typeof(p_import_origin) <> 'object' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: import_origin must be an object';
  END IF;

  IF p_fx_reference_rate_id IS NOT NULL THEN
    IF p_explicit_rate_supplied OR p_override_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'BR-FX-GOVERNANCE: reference selection cannot include a manual rate or override reason';
    END IF;
    v_reference_rate := public.fx_require_bookable_reference_rate(
      p_company_id,
      (v_receipt->>'currency')::CHAR(3),
      (v_receipt->>'base_currency')::CHAR(3),
      (v_receipt->>'receipt_date')::DATE,
      p_fx_reference_rate_id
    );
    v_receipt := jsonb_set(
      v_receipt,
      '{exchange_rate}',
      to_jsonb(v_reference_rate),
      true
    );
  END IF;

  v_receipt := jsonb_set(
    v_receipt,
    '{base_amount}',
    to_jsonb(ROUND(
      (v_receipt->>'receipt_amount')::NUMERIC
        * (v_receipt->>'exchange_rate')::NUMERIC,
      2
    )),
    true
  );

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
    v_receipt->>'receipt_no',
    (v_receipt->>'receipt_date')::DATE,
    COALESCE(
      NULLIF(v_receipt->>'value_date', '')::DATE,
      (v_receipt->>'receipt_date')::DATE
    ),
    (v_receipt->>'customer_id')::UUID,
    v_receipt->>'customer_name',
    v_receipt->>'payment_method',
    (v_receipt->>'currency')::CHAR(3),
    (v_receipt->>'exchange_rate')::NUMERIC,
    (v_receipt->>'base_currency')::CHAR(3),
    (v_receipt->>'receipt_amount')::NUMERIC,
    (v_receipt->>'base_amount')::NUMERIC,
    0,
    (v_receipt->>'receipt_amount')::NUMERIC,
    (v_receipt->>'bank_account_id')::UUID,
    v_receipt->>'bank_account_name',
    NULLIF(v_receipt->>'reference_no', ''),
    NULLIF(v_receipt->>'cheque_date', '')::DATE,
    'Draft',
    NULLIF(v_receipt->>'remarks', ''),
    p_actor_user_id
  );

  PERFORM public.fx_record_booking_decision(
    p_company_id,
    'receipt',
    v_receipt_id,
    p_actor_user_id,
    p_explicit_rate_supplied,
    CASE
      WHEN p_fx_reference_rate_id IS NOT NULL THEN 'REFERENCE_SELECTED'
      ELSE NULL
    END,
    p_fx_reference_rate_id,
    p_override_reason,
    p_import_origin
  );

  RETURN v_receipt_id;
END;
$function$;

ALTER FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID
) TO service_role;

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
AS $function$
BEGIN
  RETURN public.fx_create_governed_receipt_draft(
    p_company_id,
    p_actor_user_id,
    p_receipt,
    NULL,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

DROP FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
);

CREATE FUNCTION public.fx_create_governed_receipt_draft(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_receipt JSONB,
  p_import_origin JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN public.fx_create_governed_receipt_draft(
    p_company_id,
    p_actor_user_id,
    p_receipt,
    p_import_origin,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

ALTER FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
) OWNER TO postgres;

CREATE FUNCTION public.fx_update_governed_invoice_fx(
  p_company_id UUID,
  p_invoice_id UUID,
  p_actor_user_id UUID,
  p_currency CHAR(3),
  p_invoice_date DATE,
  p_exchange_rate NUMERIC,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
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
    RAISE EXCEPTION 'NOT_FOUND: invoice not found in company scope';
  END IF;
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: booking rate can only be changed while invoice is Draft';
  END IF;

  v_currency := COALESCE(p_currency, v_invoice.currency)::CHAR(3);
  v_invoice_date := COALESCE(p_invoice_date, v_invoice.invoice_date);

  IF p_fx_reference_rate_id IS NOT NULL THEN
    IF p_explicit_rate_supplied OR p_override_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'BR-FX-GOVERNANCE: reference selection cannot include a manual rate or override reason';
    END IF;
    v_rate := public.fx_require_bookable_reference_rate(
      p_company_id,
      v_currency,
      v_invoice.base_currency,
      v_invoice_date,
      p_fx_reference_rate_id
    );
  ELSE
    v_rate := COALESCE(p_exchange_rate, v_invoice.exchange_rate)::NUMERIC(18,8);
  END IF;

  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: exchange rate must be positive';
  END IF;

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
    CASE
      WHEN p_fx_reference_rate_id IS NOT NULL THEN 'REFERENCE_SELECTED'
      ELSE NULL
    END,
    p_fx_reference_rate_id,
    p_override_reason,
    NULL
  );
END;
$function$;

ALTER FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) TO service_role;

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
AS $function$
BEGIN
  RETURN public.fx_update_governed_invoice_fx(
    p_company_id,
    p_invoice_id,
    p_actor_user_id,
    p_currency,
    p_invoice_date,
    p_exchange_rate,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

CREATE FUNCTION public.fx_update_governed_receipt_fx(
  p_company_id UUID,
  p_receipt_id UUID,
  p_actor_user_id UUID,
  p_currency CHAR(3),
  p_receipt_date DATE,
  p_exchange_rate NUMERIC,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_receipt public.receipts%ROWTYPE;
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
    RAISE EXCEPTION 'NOT_FOUND: receipt not found in company scope';
  END IF;
  IF v_receipt.status <> 'Draft' THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: booking rate can only be changed while receipt is Draft';
  END IF;

  v_currency := COALESCE(p_currency, v_receipt.currency)::CHAR(3);
  v_receipt_date := COALESCE(p_receipt_date, v_receipt.receipt_date);

  IF p_fx_reference_rate_id IS NOT NULL THEN
    IF p_explicit_rate_supplied OR p_override_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'BR-FX-GOVERNANCE: reference selection cannot include a manual rate or override reason';
    END IF;
    v_rate := public.fx_require_bookable_reference_rate(
      p_company_id,
      v_currency,
      v_receipt.base_currency,
      v_receipt_date,
      p_fx_reference_rate_id
    );
  ELSE
    v_rate := COALESCE(p_exchange_rate, v_receipt.exchange_rate)::NUMERIC(18,8);
  END IF;

  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: exchange rate must be positive';
  END IF;

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
    CASE
      WHEN p_fx_reference_rate_id IS NOT NULL THEN 'REFERENCE_SELECTED'
      ELSE NULL
    END,
    p_fx_reference_rate_id,
    p_override_reason,
    NULL
  );
END;
$function$;

ALTER FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) TO service_role;

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
AS $function$
BEGIN
  RETURN public.fx_update_governed_receipt_fx(
    p_company_id,
    p_receipt_id,
    p_actor_user_id,
    p_currency,
    p_receipt_date,
    p_exchange_rate,
    p_explicit_rate_supplied,
    p_override_reason,
    NULL
  );
END;
$function$;

-- Direct reference-selection RPC remains service-only and now shares the same
-- current/latest/active/stale validation used by create and draft update.
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
AS $function$
DECLARE
  v_currency CHAR(3);
  v_base_currency CHAR(3);
  v_transaction_date DATE;
BEGIN
  IF p_transaction_type = 'invoice' THEN
    SELECT i.currency, i.base_currency, i.invoice_date
      INTO v_currency, v_base_currency, v_transaction_date
    FROM public.invoices i
    WHERE i.id = p_transaction_id
      AND i.company_id = p_company_id;
  ELSIF p_transaction_type = 'receipt' THEN
    SELECT r.currency, r.base_currency, r.receipt_date
      INTO v_currency, v_base_currency, v_transaction_date
    FROM public.receipts r
    WHERE r.id = p_transaction_id
      AND r.company_id = p_company_id;
  ELSE
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: transaction_type must be invoice or receipt';
  END IF;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: transaction not found in company scope';
  END IF;

  PERFORM public.fx_require_bookable_reference_rate(
    p_company_id,
    v_currency,
    v_base_currency,
    v_transaction_date,
    p_fx_reference_rate_id
  );

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
$function$;

-- Invoice PATCH remains one atomic governed RPC. The reference id is an
-- orchestration field, not a column update and never a client base total.
CREATE OR REPLACE FUNCTION public.update_draft_invoice(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_changes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_updated public.invoices%ROWTYPE;
  v_currency CHAR(3);
  v_invoice_date DATE;
  v_exchange_rate NUMERIC(18,8);
  v_fx_reference_rate_id UUID;
  v_fx_material_change BOOLEAN;
BEGIN
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Draft Invoice changes must be an object';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_changes) AS keys(key_name)
    WHERE key_name NOT IN (
      'invoice_date',
      'reference_no',
      'internal_remarks',
      'invoice_remarks',
      'currency',
      'exchange_rate',
      'reason_code',
      'reason_desc',
      'fx_override_reason',
      'fx_explicit_rate_supplied',
      'fx_reference_rate_id'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Draft Invoice changes contain an unsupported field';
  END IF;

  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
  );

  SELECT i.*
    INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Financial document not found';
  END IF;
  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_invoice.customer_id
  );
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-001: Posted financial documents are immutable';
  END IF;

  IF p_changes ? 'invoice_date' AND p_changes->>'invoice_date' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: invoice_date cannot be null';
  END IF;
  IF p_changes ? 'currency' AND p_changes->>'currency' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: currency cannot be null';
  END IF;
  IF p_changes ? 'exchange_rate' AND p_changes->>'exchange_rate' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: exchange_rate cannot be null';
  END IF;
  IF p_changes ? 'fx_reference_rate_id'
    AND p_changes->>'fx_reference_rate_id' IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: fx_reference_rate_id cannot be null when supplied';
  END IF;

  v_currency := COALESCE(p_changes->>'currency', v_invoice.currency)::CHAR(3);
  v_invoice_date := COALESCE(
    (p_changes->>'invoice_date')::DATE,
    v_invoice.invoice_date
  );
  v_exchange_rate := COALESCE(
    (p_changes->>'exchange_rate')::NUMERIC,
    v_invoice.exchange_rate
  )::NUMERIC(18,8);
  v_fx_reference_rate_id := NULLIF(
    p_changes->>'fx_reference_rate_id',
    ''
  )::UUID;
  v_fx_material_change := p_changes ? 'currency'
    OR p_changes ? 'invoice_date'
    OR p_changes ? 'exchange_rate'
    OR p_changes ? 'fx_reference_rate_id';

  IF v_exchange_rate <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: exchange_rate must be greater than zero';
  END IF;

  IF v_fx_reference_rate_id IS NOT NULL
    AND (
      p_changes ? 'exchange_rate'
      OR COALESCE((p_changes->>'fx_explicit_rate_supplied')::BOOLEAN, FALSE)
      OR NULLIF(p_changes->>'fx_override_reason', '') IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-GOVERNANCE: reference selection cannot include a manual rate or override reason';
  END IF;

  IF v_fx_material_change THEN
    PERFORM public.fx_update_governed_invoice_fx(
      p_company_id,
      p_invoice_id,
      p_user_id,
      v_currency,
      v_invoice_date,
      v_exchange_rate,
      COALESCE((p_changes->>'fx_explicit_rate_supplied')::BOOLEAN, FALSE),
      NULLIF(p_changes->>'fx_override_reason', ''),
      v_fx_reference_rate_id
    );
  END IF;

  UPDATE public.invoices i
  SET reference_no = CASE
        WHEN p_changes ? 'reference_no' THEN p_changes->>'reference_no'
        ELSE i.reference_no
      END,
      internal_remarks = CASE
        WHEN p_changes ? 'internal_remarks' THEN p_changes->>'internal_remarks'
        ELSE i.internal_remarks
      END,
      invoice_remarks = CASE
        WHEN p_changes ? 'invoice_remarks' THEN p_changes->>'invoice_remarks'
        ELSE i.invoice_remarks
      END,
      reason_code = CASE
        WHEN p_changes ? 'reason_code' THEN p_changes->>'reason_code'
        ELSE i.reason_code
      END,
      reason_desc = CASE
        WHEN p_changes ? 'reason_desc' THEN p_changes->>'reason_desc'
        ELSE i.reason_desc
      END
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id
    AND i.status = 'Draft'
  RETURNING i.* INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Financial document changed during Draft update';
  END IF;
  RETURN pg_catalog.to_jsonb(v_updated);
END;
$function$;

-- Explicit privilege boundaries for new overloads; CREATE OR REPLACE keeps
-- owner/ACL for existing compatibility signatures.
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, BOOLEAN, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.fx_select_reference_booking_rate(
  UUID, TEXT, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_select_reference_booking_rate(
  UUID, TEXT, UUID, UUID, UUID
) TO service_role;

DO $postconditions$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER
    INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fx_create_governed_invoice_draft';
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: expected exactly three unambiguous Invoice create signatures';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fx_create_governed_receipt_draft';
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: expected exactly three unambiguous Receipt create signatures';
  END IF;

  IF (
    SELECT p.pronargdefaults
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,boolean,text)'::regprocedure
  ) <> 3
    OR (
      SELECT p.pronargdefaults
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,jsonb,boolean,text)'::regprocedure
    ) <> 0
    OR (
      SELECT p.pronargdefaults
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,jsonb,boolean,text,uuid)'::regprocedure
    ) <> 0 THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: Invoice overload defaults would permit ambiguous resolution';
  END IF;

  IF (
    SELECT p.pronargdefaults
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,boolean,text)'::regprocedure
  ) <> 2
    OR (
      SELECT p.pronargdefaults
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,jsonb,boolean,text)'::regprocedure
    ) <> 0
    OR (
      SELECT p.pronargdefaults
      FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,jsonb,boolean,text,uuid)'::regprocedure
    ) <> 0 THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: Receipt overload defaults would permit ambiguous resolution';
  END IF;

  IF to_regprocedure(
    'public.fx_update_governed_invoice_fx(uuid,uuid,uuid,character,date,numeric,boolean,text,uuid)'
  ) IS NULL
    OR to_regprocedure(
      'public.fx_update_governed_receipt_fx(uuid,uuid,uuid,character,date,numeric,boolean,text,uuid)'
    ) IS NULL THEN
    RAISE EXCEPTION 'GATE_A_FX_REFERENCE: reference-aware draft-update signature is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fx_create_governed_invoice_draft',
        'fx_create_governed_receipt_draft',
        'fx_update_governed_invoice_fx',
        'fx_update_governed_receipt_fx'
      )
      AND (
        p.prosecdef IS DISTINCT FROM true
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION
      'GATE_A_FX_REFERENCE: governed wrapper security/search_path postcondition failed';
  END IF;
END;
$postconditions$;

COMMENT ON FUNCTION public.fx_require_bookable_reference_rate(
  UUID, CHAR(3), CHAR(3), DATE, UUID
) IS
  'Gate A internal validator for company/pair/direction/latest-active/effective-date/3-day-stale FX reference selection.';
COMMENT ON FUNCTION public.fx_create_governed_invoice_draft(
  UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID
) IS
  'Gate A canonical atomic Invoice create accepting nullable import provenance and nullable validated FX reference id.';
COMMENT ON FUNCTION public.fx_create_governed_receipt_draft(
  UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID
) IS
  'Gate A canonical atomic Receipt create accepting nullable import provenance and nullable validated FX reference id.';
COMMENT ON FUNCTION public.fx_update_governed_invoice_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) IS
  'Gate A governed Draft Invoice FX update with optional reference-selected booking through an exact overload.';
COMMENT ON FUNCTION public.fx_update_governed_receipt_fx(
  UUID, UUID, UUID, CHAR(3), DATE, NUMERIC, BOOLEAN, TEXT, UUID
) IS
  'Gate A governed Draft Receipt FX update with optional reference-selected booking through an exact overload.';

COMMIT;
