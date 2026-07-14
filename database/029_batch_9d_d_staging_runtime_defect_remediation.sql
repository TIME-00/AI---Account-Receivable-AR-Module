-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Migration 029: Batch 9D-D staging runtime defect remediation
--
-- Forward-only remediation after Migration 028:
--   F-01: make get_next_sequence safe under an empty caller search_path;
--   F-02: make hidden and nonexistent posted-reference targets indistinguishable.
-- ============================================================================

BEGIN;

-- Fail before replacing anything if the exact Migration 028 contract is not
-- installed. These checks deliberately do not create alternate overloads.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.get_next_sequence(uuid,character varying,character varying)'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 029 requires public.get_next_sequence(UUID, VARCHAR, VARCHAR)';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.clear_receipt_cheque(uuid,uuid,uuid,date)'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 029 requires Migration 028 clear_receipt_cheque';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.correct_posted_invoice_reference(uuid,uuid,uuid,text)'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 029 requires Migration 028 correct_posted_invoice_reference';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.rpc_check_role(uuid,uuid,text[])'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.rpc_check_customer_access(uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 029 requires Migration 028 authorization helpers';
  END IF;
END;
$$;

-- F-01
--
-- get_next_sequence is intentionally SECURITY INVOKER, matching the existing
-- utility contract. CREATE OR REPLACE preserves its owner and existing ACL.
-- Every object reference is explicitly qualified because governed callers such
-- as clear_receipt_cheque execute with SET search_path = ''.
--
-- The transaction advisory lock serializes one company/document sequence key.
-- The unique-row UPSERT then acquires the document_sequences row lock and makes
-- initialization/increment atomic. CUST retains its global, non-monthly display
-- number while the stored current-period row advances beyond every prior period.
CREATE OR REPLACE FUNCTION public.get_next_sequence(
  p_company_id pg_catalog.uuid,
  p_doc_type pg_catalog.varchar(10),
  p_source_type pg_catalog.varchar(3) DEFAULT NULL
)
RETURNS pg_catalog.varchar(30)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_year pg_catalog.int4 := pg_catalog.date_part('year', CURRENT_DATE)::pg_catalog.int4;
  v_month pg_catalog.int4 := pg_catalog.date_part('month', CURRENT_DATE)::pg_catalog.int4;
  v_seq pg_catalog.int4;
  v_prefix pg_catalog.varchar(10);
  v_result pg_catalog.varchar(30);
BEGIN
  -- A stable key order prevents concurrent initialization from producing the
  -- same committed number. Hash collisions only serialize unrelated keys.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat(
        p_company_id::pg_catalog.text,
        ':',
        p_doc_type::pg_catalog.text
      ),
      0
    )
  );

  v_prefix := CASE p_doc_type
    WHEN 'CUST' THEN 'CUST-'
    WHEN 'INV' THEN 'INV-'
    WHEN 'CN' THEN 'CN-'
    WHEN 'DN' THEN 'DN-'
    WHEN 'RCT' THEN 'RCT-'
    WHEN 'JE' THEN 'JE-'
    ELSE p_doc_type || '-'
  END;

  IF p_doc_type = 'CUST' THEN
    -- Lock every existing CUST sequence row in deterministic period/id order,
    -- then advance the current-period row beyond the global committed maximum.
    PERFORM ds.id
    FROM public.document_sequences AS ds
    WHERE ds.company_id = p_company_id
      AND ds.doc_type = 'CUST'
    ORDER BY ds.current_year, ds.current_month, ds.id
    FOR UPDATE;

    SELECT COALESCE(pg_catalog.max(ds.last_sequence), 0) + 1
    INTO v_seq
    FROM public.document_sequences AS ds
    WHERE ds.company_id = p_company_id
      AND ds.doc_type = 'CUST';

    INSERT INTO public.document_sequences AS sequence_row (
      company_id,
      doc_type,
      prefix,
      current_year,
      current_month,
      last_sequence
    ) VALUES (
      p_company_id,
      p_doc_type,
      v_prefix,
      v_year,
      v_month,
      v_seq
    )
    ON CONFLICT (company_id, doc_type, current_year, current_month)
    DO UPDATE SET
      last_sequence = EXCLUDED.last_sequence,
      updated_at = pg_catalog.now();

    v_result := 'CUST-' || pg_catalog.lpad(v_seq::pg_catalog.text, 5, '0');
  ELSE
    INSERT INTO public.document_sequences AS sequence_row (
      company_id,
      doc_type,
      prefix,
      current_year,
      current_month,
      last_sequence
    ) VALUES (
      p_company_id,
      p_doc_type,
      v_prefix,
      v_year,
      v_month,
      1
    )
    ON CONFLICT (company_id, doc_type, current_year, current_month)
    DO UPDATE SET
      last_sequence = sequence_row.last_sequence + 1,
      updated_at = pg_catalog.now()
    RETURNING
      sequence_row.last_sequence,
      sequence_row.prefix
    INTO v_seq, v_prefix;

    IF p_doc_type = 'JE' AND p_source_type IS NOT NULL THEN
      v_result := 'JE-' || p_source_type || '-'
        || v_year::pg_catalog.text
        || pg_catalog.lpad(v_month::pg_catalog.text, 2, '0') || '-'
        || pg_catalog.lpad(v_seq::pg_catalog.text, 5, '0');
    ELSE
      v_result := v_prefix
        || v_year::pg_catalog.text
        || pg_catalog.lpad(v_month::pg_catalog.text, 2, '0') || '-'
        || pg_catalog.lpad(v_seq::pg_catalog.text, 5, '0');
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_next_sequence(
  pg_catalog.uuid,
  pg_catalog.varchar,
  pg_catalog.varchar
) IS
  'Migration 029 SECURITY INVOKER document-number generator. Explicit schema qualification is mandatory because governed callers use an empty search_path; advisory-key serialization plus document_sequences row locks prevent duplicate committed numbers.';

-- F-02
--
-- Keep the Migration 028 row-lock-first design and the shared customer-access
-- authority. Only the helper's two deliberate target-scope outcomes are hidden:
-- an unassigned customer and an unavailable/hidden customer both become the
-- same document NOT_FOUND used when the target row does not exist. Role,
-- company, caller-identity, validation, and unrelated SQL errors retain their
-- existing classifications.
CREATE OR REPLACE FUNCTION public.correct_posted_invoice_reference(
  p_invoice_id pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_company_id pg_catalog.uuid,
  p_reference_no pg_catalog.text
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_updated public.invoices%ROWTYPE;
  v_access_message pg_catalog.text;
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
  );

  IF p_reference_no IS NOT NULL AND pg_catalog.btrim(p_reference_no) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: reference_no must be non-blank or null';
  END IF;
  IF p_reference_no IS NOT NULL AND pg_catalog.char_length(p_reference_no) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: reference_no must not exceed 50 characters';
  END IF;

  SELECT i.*
  INTO v_invoice
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Financial document not found';
  END IF;

  BEGIN
    PERFORM public.rpc_check_customer_access(
      p_user_id,
      p_company_id,
      v_invoice.customer_id
    );
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_access_message = MESSAGE_TEXT;
      IF v_access_message IN (
        'AUTH: User does not have access to this customer',
        'NOT_FOUND: Customer not found'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'NOT_FOUND: Financial document not found';
      END IF;
      RAISE;
  END;

  IF v_invoice.doc_type NOT IN ('Invoice', 'Debit Note', 'Credit Note') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-REFERENCE: Document type does not support posted reference correction';
  END IF;
  IF v_invoice.status = 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-REFERENCE: Draft reference changes must use update_draft_invoice';
  END IF;
  IF p_reference_no IS NOT DISTINCT FROM v_invoice.reference_no THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: reference_no is unchanged';
  END IF;

  UPDATE public.invoices
  SET reference_no = p_reference_no
  WHERE id = p_invoice_id
    AND company_id = p_company_id
    AND status <> 'Draft'
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Financial document changed during reference correction';
  END IF;

  INSERT INTO public.credit_control_logs (
    company_id,
    customer_id,
    action,
    details,
    created_by
  ) VALUES (
    p_company_id,
    v_invoice.customer_id,
    'Reference Correction',
    pg_catalog.format(
      'Document %s (%s) reference_no changed from %s to %s',
      v_invoice.invoice_no,
      v_invoice.doc_type,
      COALESCE(v_invoice.reference_no, '[null]'),
      COALESCE(p_reference_no, '[null]')
    ),
    p_user_id
  );

  RETURN pg_catalog.to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) FROM anon;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) FROM authenticated;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) TO service_role;

COMMENT ON FUNCTION public.correct_posted_invoice_reference(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.text
) IS
  'Migration 029 service-role-only posted reference correction. Authorized targets remain row-locked and audited; hidden customer scope and nonexistent documents return the same NOT_FOUND contract.';

COMMIT;
