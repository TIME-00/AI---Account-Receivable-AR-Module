-- Batch 9D-D consolidated financial lifecycle integrity closure
-- Authoritative Linked Credit Note reference integrity, financial-document
-- lifecycle/immutability boundaries, atomic Invoice/Receipt cancellation,
-- atomic cheque clearance, and protected financial child/audit evidence.
--
-- Applying this migration does not rewrite, relink, delete, post, or otherwise
-- mutate existing financial records. The governed mutation functions added
-- below perform financial mutation only when explicitly invoked after install.
--
-- QUIESCENT INSTALLATION CONTRACT (required for every future environment):
--   1. Stop Invoice, Receipt, allocation, journal, FX-decision, and related
--      financial writes before starting this migration.
--   2. Confirm that no related financial transaction remains active.
--   3. Apply this migration and resume writes only after COMMIT succeeds.
-- The bounded lock timeout below is a fail-fast safety net, not a substitute
-- for quiescence. A barrier-acquisition failure aborts this transaction and
-- therefore leaves no partially installed schema, trigger, or function state.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Acquire the strongest lock required anywhere in this migration before the
-- first preflight read. ACCESS EXCLUSIVE is also required by the Receipt ALTER
-- TABLE below, so acquiring it up front avoids a later lock upgrade. PostgreSQL
-- acquires a multi-table LOCK list one-by-one; this deterministic order is the
-- sole installation order and every lock remains held through COMMIT.
LOCK TABLE
  public.invoices,
  public.invoice_lines,
  public.receipts,
  public.allocation_details,
  public.cn_allocations,
  public.journal_entries,
  public.journal_entry_lines,
  public.fx_booking_rate_decisions,
  public.fx_booking_rate_decision_events
IN ACCESS EXCLUSIVE MODE;

-- Receipt cancellation previously had no durable actor/reason/version fields.
-- Add them prospectively without rewriting historical status or financial data.
ALTER TABLE public.receipts
  ADD COLUMN cancelled_by UUID,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.receipts
  ADD CONSTRAINT chk_receipt_version_positive CHECK (version > 0);

-- Fail closed before installing enforcement if existing rows violate the
-- structural Linked Credit Note contract. Draft links must also still point
-- to a reference in a status accepted for new Linked Credit Notes. Posted
-- history may legitimately reference an invoice that the posting operation
-- subsequently moved to Paid.
DO $$
DECLARE
  v_invalid_count BIGINT;
  v_sample_ids UUID[];
BEGIN
  SELECT
    COUNT(*),
    (array_agg(cn.id ORDER BY cn.id))[1:10]
  INTO v_invalid_count, v_sample_ids
  FROM public.invoices cn
  LEFT JOIN public.invoices ref
    ON ref.id = cn.ref_invoice_id
  WHERE (
    cn.doc_type = 'Credit Note'
    AND cn.cn_type = 'Linked'
    AND (
      cn.ref_invoice_id IS NULL
      OR cn.ref_invoice_id = cn.id
      OR ref.id IS NULL
      OR ref.doc_type <> 'Invoice'
      OR ref.company_id <> cn.company_id
      OR ref.customer_id <> cn.customer_id
      OR ref.currency <> cn.currency
      OR (
        cn.status = 'Draft'
        AND ref.status NOT IN ('Open', 'Overdue', 'Partially Paid')
      )
      OR (
        cn.status <> 'Cancelled'
        AND ref.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
      )
    )
  )
  OR (
    cn.doc_type = 'Credit Note'
    AND cn.cn_type IS DISTINCT FROM 'Linked'
    AND cn.ref_invoice_id IS NOT NULL
  )
  OR (
    cn.doc_type <> 'Credit Note'
    AND cn.cn_type = 'Linked'
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'BR-CN-INTEGRITY-PREFLIGHT: %s invalid Linked Credit Note row(s); sample credit_note_ids=%s',
        v_invalid_count,
        COALESCE(v_sample_ids::text, '{}')
      ),
      HINT = 'Stop and use a separately reviewed data-remediation gate; do not rewrite financial history in this migration.';
  END IF;
END;
$$;

-- Debit Note references remain optional and separate from Linked Credit Note
-- semantics, but any supplied reference must preserve tenant/customer/currency
-- ownership and point to posted Invoice-family evidence.
DO $$
DECLARE
  v_invalid_count BIGINT;
  v_sample_ids UUID[];
BEGIN
  SELECT COUNT(*), (array_agg(dn.id ORDER BY dn.id))[1:10]
  INTO v_invalid_count, v_sample_ids
  FROM public.invoices dn
  LEFT JOIN public.invoices ref ON ref.id = dn.ref_invoice_id
  WHERE (
    dn.doc_type = 'Debit Note'
    AND dn.ref_invoice_id IS NOT NULL
    AND (
      dn.ref_invoice_id = dn.id
      OR ref.id IS NULL
      OR ref.doc_type NOT IN ('Invoice', 'Credit Note')
      OR ref.company_id <> dn.company_id
      OR ref.customer_id <> dn.customer_id
      OR ref.currency <> dn.currency
      OR (
        dn.status NOT IN ('Cancelled', 'Written Off')
        AND ref.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
      )
    )
  ) OR (
    dn.doc_type = 'Invoice'
    AND dn.ref_invoice_id IS NOT NULL
  ) OR (
    dn.doc_type <> 'Credit Note'
    AND dn.cn_type IS NOT NULL
  );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'BR-DN-INTEGRITY-PREFLIGHT: %s invalid document reference row(s); sample document_ids=%s',
        v_invalid_count,
        COALESCE(v_sample_ids::text, '{}')
      ),
      HINT = 'Stop and use a separately reviewed data-remediation gate; do not rewrite financial history in this migration.';
  END IF;
END;
$$;

-- Migration 027 and earlier allocation logic did not exclude Credit Notes from
-- Receipt allocation_details. Do not reinterpret or delete that history here:
-- any still-Active row requires a separately reviewed data-resolution decision
-- before BR-CN-004 can be installed without reopening a posted Credit Note.
DO $$
DECLARE
  v_invalid_count BIGINT;
  v_sample_ids UUID[];
BEGIN
  SELECT
    COUNT(*),
    (array_agg(ad.id ORDER BY ad.id))[1:10]
  INTO v_invalid_count, v_sample_ids
  FROM public.allocation_details ad
  JOIN public.invoices target ON target.id = ad.invoice_id
  WHERE ad.status = 'Active'
    AND target.doc_type = 'Credit Note';

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'BR-CN-ALLOCATION-PREFLIGHT: %s Active Receipt allocation(s) target a Credit Note; sample allocation_ids=%s',
        v_invalid_count,
        COALESCE(v_sample_ids::text, '{}')
      ),
      HINT = 'Stop and use a separately reviewed data-resolution gate; do not rewrite or delete allocation history in this migration.';
  END IF;
END;
$$;

-- Reversal creation already locks the original journal entry, but a partial
-- trusted/direct path must not be able to create a second reversal relationship.
DO $$
DECLARE
  v_duplicate_count BIGINT;
  v_sample_ids UUID[];
BEGIN
  SELECT COUNT(*), (array_agg(d.original_je_id ORDER BY d.original_je_id))[1:10]
  INTO v_duplicate_count, v_sample_ids
  FROM (
    SELECT je.original_je_id
    FROM public.journal_entries je
    WHERE je.is_reversal = TRUE
      AND je.original_je_id IS NOT NULL
    GROUP BY je.original_je_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'BR-JE-INTEGRITY-PREFLIGHT: %s duplicate reversal relationship(s); sample original_je_ids=%s',
        v_duplicate_count,
        COALESCE(v_sample_ids::text, '{}')
      ),
      HINT = 'Stop and use a separately reviewed data-remediation gate; do not rewrite journal history in this migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX uq_journal_entries_one_reversal
  ON public.journal_entries(original_je_id)
  WHERE is_reversal = TRUE AND original_je_id IS NOT NULL;

-- Keep tenant/customer visibility inside every governed financial mutation,
-- including legacy posting/allocation/bounce RPCs that call this helper.
CREATE OR REPLACE FUNCTION public.rpc_check_customer_access(
  p_user_id UUID,
  p_company_id UUID,
  p_customer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.company_id = p_company_id
      AND c.is_deleted = FALSE
      AND c.is_hidden = FALSE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Customer not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role IN ('AR Supervisor', 'Finance Manager')
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.user_customer_assignments uca
      ON uca.user_id = ur.user_id
     AND uca.company_id = ur.company_id
     AND uca.customer_id = p_customer_id
     AND uca.is_active = TRUE
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role = 'AR Clerk'
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'AUTH: User does not have access to this customer';
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reference RECORD;
  v_require_open_reference BOOLEAN;
BEGIN
  -- Debit Note references are optional and retain their separate semantics.
  IF NEW.doc_type = 'Debit Note' THEN
    IF NEW.cn_type IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DN-REF: Debit Note reference is invalid or unavailable';
    END IF;

    IF NEW.ref_invoice_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.ref_invoice_id = NEW.id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DN-REF: Debit Note reference is invalid or unavailable';
    END IF;

    SELECT i.id, i.company_id, i.customer_id, i.currency, i.doc_type, i.status
    INTO v_reference
    FROM public.invoices i
    WHERE i.id = NEW.ref_invoice_id
    FOR SHARE;

    IF NOT FOUND
      OR v_reference.doc_type NOT IN ('Invoice', 'Credit Note')
      OR v_reference.company_id <> NEW.company_id
      OR v_reference.customer_id <> NEW.customer_id
      OR v_reference.currency <> NEW.currency
      OR v_reference.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DN-REF: Debit Note reference is invalid or unavailable';
    END IF;
    RETURN NEW;
  END IF;

  -- Normal Invoices cannot carry Credit/Debit Note reference semantics.
  IF NEW.doc_type <> 'Credit Note' THEN
    IF NEW.cn_type IS NOT NULL OR NEW.ref_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-REF: Financial document reference is invalid or unavailable';
    END IF;
    RETURN NEW;
  END IF;

  -- A reference is meaningful only for a Linked Credit Note. Standalone and
  -- legacy/untyped Credit Notes must not carry ref_invoice_id.
  IF NEW.cn_type IS DISTINCT FROM 'Linked' THEN
    IF NEW.ref_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-REF: ref_invoice_id is only permitted for Linked Credit Notes';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.ref_invoice_id IS NULL OR NEW.ref_invoice_id = NEW.id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-REF: linked credit note reference is invalid or unavailable';
  END IF;

  SELECT
    i.id,
    i.company_id,
    i.customer_id,
    i.currency,
    i.doc_type,
    i.status
  INTO v_reference
  FROM public.invoices i
  WHERE i.id = NEW.ref_invoice_id
  FOR SHARE;

  IF v_reference.id IS NULL
    OR v_reference.doc_type <> 'Invoice'
    OR v_reference.company_id <> NEW.company_id
    OR v_reference.customer_id <> NEW.customer_id
    OR v_reference.currency <> NEW.currency
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-REF: linked credit note reference is invalid or unavailable';
  END IF;

  -- New links and structural edits to Draft links retain the established
  -- Open/Overdue/Partially Paid creation rule. Immutable posted history may
  -- point to a reference moved to Paid by the Linked Credit Note posting.
  v_require_open_reference := TG_OP = 'INSERT'
    OR NEW.status = 'Draft'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'Draft');

  IF v_require_open_reference
    AND v_reference.status NOT IN ('Open', 'Overdue', 'Partially Paid')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-REF: linked credit note reference is invalid or unavailable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference_reverse()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invalid_dependency_exists BOOLEAN;
  v_invalid_debit_note_dependency_exists BOOLEAN;
BEGIN
  -- UPDATE already owns the referenced Invoice row lock. Forward link writers
  -- acquire FOR SHARE on that same row before validation. The reverse path
  -- deliberately does not lock dependent Credit Note rows: every competing
  -- writer serializes on the reference row, while avoiding a CN-row ->
  -- reference-row / reference-row -> CN-row deadlock cycle.
  IF OLD.company_id IS NOT DISTINCT FROM NEW.company_id
    AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id
    AND OLD.currency IS NOT DISTINCT FROM NEW.currency
    AND OLD.doc_type IS NOT DISTINCT FROM NEW.doc_type
    AND OLD.status IS NOT DISTINCT FROM NEW.status
  THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.invoices cn
    WHERE cn.ref_invoice_id = OLD.id
      AND cn.doc_type = 'Credit Note'
      AND cn.cn_type = 'Linked'
      AND cn.status <> 'Cancelled'
      AND (
        NEW.doc_type <> 'Invoice'
        OR NEW.company_id IS DISTINCT FROM cn.company_id
        OR NEW.customer_id IS DISTINCT FROM cn.customer_id
        OR NEW.currency IS DISTINCT FROM cn.currency
        OR NEW.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
        OR (
          cn.status = 'Draft'
          AND NEW.status NOT IN ('Open', 'Overdue', 'Partially Paid')
        )
      )
  )
  INTO v_invalid_dependency_exists;

  IF v_invalid_dependency_exists THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-REF: linked credit note reference is invalid or unavailable';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.invoices dn
    WHERE dn.ref_invoice_id = OLD.id
      AND dn.doc_type = 'Debit Note'
      AND dn.status NOT IN ('Cancelled', 'Written Off')
      AND (
        NEW.doc_type NOT IN ('Invoice', 'Credit Note')
        OR NEW.company_id IS DISTINCT FROM dn.company_id
        OR NEW.customer_id IS DISTINCT FROM dn.customer_id
        OR NEW.currency IS DISTINCT FROM dn.currency
        OR NEW.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
      )
  )
  INTO v_invalid_debit_note_dependency_exists;

  IF v_invalid_debit_note_dependency_exists THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-DN-REF: Debit Note reference is invalid or unavailable';
  END IF;

  RETURN NEW;
END;
$$;

-- Cancelled is an authoritative terminal state for every financial document in
-- public.invoices (PRD Part 2 section 3.3). The decision depends only on the
-- immutable OLD status, never mutable document classification. Keep this
-- boundary separate from reference validation so ordinary Draft/Open/Paid
-- posting transitions never acquire a shared reference lock.
CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_system_change BOOLEAN := FALSE;
  v_structural_change BOOLEAN := FALSE;
  v_direct_overdue_transition BOOLEAN := FALSE;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized
  FROM pg_catalog.pg_class c
  WHERE c.oid = TG_RELID;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_owner_authorized THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-AUTHORITY: Financial document creation requires a governed mutation';
    END IF;

    IF NEW.status <> 'Draft'
      OR NEW.outstanding <> 0
      OR NEW.created_by IS NULL
      OR NEW.posted_by IS NOT NULL
      OR NEW.posted_at IS NOT NULL
      OR NEW.cancelled_by IS NOT NULL
      OR NEW.cancelled_at IS NOT NULL
      OR NEW.cancel_reason IS NOT NULL
      OR NEW.version <> 1
      OR NEW.subtotal < 0
      OR NEW.tax_total < 0
      OR NEW.total_amount < 0
      OR NEW.base_total < 0
      OR ROUND(NEW.subtotal + NEW.tax_total, 2) <> ROUND(NEW.total_amount, 2)
      OR ROUND(NEW.total_amount * NEW.exchange_rate, 2) <> ROUND(NEW.base_total, 2)
      OR NOT EXISTS (
        SELECT 1
        FROM public.customers c
        JOIN public.companies co ON co.id = c.company_id
        WHERE c.id = NEW.customer_id
          AND c.company_id = NEW.company_id
          AND c.is_deleted = FALSE
          AND c.is_hidden = FALSE
          AND c.status <> 'Blocked'
          AND (
            NEW.doc_type = 'Credit Note'
            OR (c.status <> 'Inactive' AND c.credit_rating IS DISTINCT FROM 'D')
          )
          AND NEW.customer_name IS NOT DISTINCT FROM c.customer_name
          AND NEW.base_currency IS NOT DISTINCT FROM co.base_currency
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-INITIAL: Financial documents must begin as an unposted Draft';
    END IF;

    PERFORM public.rpc_check_role(
      NEW.created_by,
      NEW.company_id,
      ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
    );
    PERFORM public.rpc_check_customer_access(
      NEW.created_by,
      NEW.company_id,
      NEW.customer_id
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT v_owner_authorized
      OR pg_catalog.current_setting('app.ar_draft_delete', TRUE) IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-AUTHORITY: Draft deletion requires the governed deletion operation';
    END IF;
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-DELETE: Only Draft financial documents may be deleted';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE je.source_doc_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.allocation_details ad
      WHERE ad.invoice_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.cn_allocations ca
      WHERE ca.cn_id = OLD.id OR ca.invoice_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.invoices cn
      WHERE cn.ref_invoice_id = OLD.id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-DELETE: Financial evidence or relationships prevent document deletion';
    END IF;
    RETURN OLD;
  END IF;

  v_structural_change := NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
    OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
    OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
    OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
    OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
    OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.base_total IS DISTINCT FROM OLD.base_total
    OR NEW.posting_period IS DISTINCT FROM OLD.posting_period
    OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
    OR NEW.ref_invoice_id IS DISTINCT FROM OLD.ref_invoice_id
    OR NEW.cn_type IS DISTINCT FROM OLD.cn_type
    OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
    OR NEW.reason_desc IS DISTINCT FROM OLD.reason_desc
    OR NEW.ar_acct IS DISTINCT FROM OLD.ar_acct;

  IF v_structural_change AND NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-AUTHORITY: Financial structure requires a governed mutation';
  END IF;

  IF (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = NEW.customer_id
        AND c.company_id = NEW.company_id
        AND c.is_deleted = FALSE
        AND c.is_hidden = FALSE
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-PARENT: Customer ownership or visibility is invalid';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-AUDIT: Creation audit evidence is immutable';
  END IF;

  IF NEW.subtotal < 0
    OR NEW.tax_total < 0
    OR NEW.total_amount < 0
    OR NEW.base_total < 0
    OR NEW.outstanding < 0
    OR NEW.outstanding > NEW.total_amount
    OR ROUND(NEW.subtotal + NEW.tax_total, 2) <> ROUND(NEW.total_amount, 2)
    OR ROUND(NEW.total_amount * NEW.exchange_rate, 2) <> ROUND(NEW.base_total, 2)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-BALANCE: Financial document amounts are inconsistent';
  END IF;

  -- Cancelled is terminal. Only narrative remarks and the automatic updated_at
  -- timestamp remain outside this fail-closed comparison.
  IF OLD.status IN ('Cancelled', 'Written Off')
    AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
      OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
      OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
      OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
      OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
      OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
      OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
      OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
      OR NEW.base_total IS DISTINCT FROM OLD.base_total
      OR NEW.outstanding IS DISTINCT FROM OLD.outstanding
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.posting_period IS DISTINCT FROM OLD.posting_period
      OR NEW.ref_invoice_id IS DISTINCT FROM OLD.ref_invoice_id
      OR NEW.cn_type IS DISTINCT FROM OLD.cn_type
      OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
      OR NEW.reason_desc IS DISTINCT FROM OLD.reason_desc
      OR NEW.ar_acct IS DISTINCT FROM OLD.ar_acct
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
      OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
      OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
      OR NEW.version IS DISTINCT FROM OLD.version
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-TERMINAL: Terminal financial documents are immutable';
  END IF;

  -- BR-INV-001: posted identity, valuation, and booking evidence is immutable.
  IF OLD.status <> 'Draft'
    AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
      OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
      OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
      OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
      OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
      OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
      OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
      OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
      OR NEW.base_total IS DISTINCT FROM OLD.base_total
      OR NEW.posting_period IS DISTINCT FROM OLD.posting_period
      OR NEW.ref_invoice_id IS DISTINCT FROM OLD.ref_invoice_id
      OR NEW.cn_type IS DISTINCT FROM OLD.cn_type
      OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
      OR NEW.reason_desc IS DISTINCT FROM OLD.reason_desc
      OR NEW.ar_acct IS DISTINCT FROM OLD.ar_acct
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-IMMUTABLE: Posted financial document fields are immutable';
  END IF;

  v_system_change := NEW.status IS DISTINCT FROM OLD.status
    OR NEW.outstanding IS DISTINCT FROM OLD.outstanding
    OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
    OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
    OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
    OR NEW.version IS DISTINCT FROM OLD.version;

  v_direct_overdue_transition := OLD.doc_type IN ('Invoice', 'Debit Note')
    AND OLD.status IN ('Open', 'Partially Paid')
    AND NEW.status = 'Overdue'
    AND OLD.due_date IS NOT NULL
    AND OLD.due_date < CURRENT_DATE
    AND OLD.outstanding > 0
    AND NEW.outstanding IS NOT DISTINCT FROM OLD.outstanding
    AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
    AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
    AND NEW.cancelled_by IS NOT DISTINCT FROM OLD.cancelled_by
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND NEW.cancel_reason IS NOT DISTINCT FROM OLD.cancel_reason;

  IF v_system_change AND NOT v_owner_authorized AND NOT v_direct_overdue_transition THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-AUTHORITY: Lifecycle balances and audit fields require a governed mutation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- BR-CN-004 permits normal consumption of a standalone Credit Note from
    -- Open/Partially Paid to Paid, but a fully consumed or Linked Credit Note
    -- can never be reopened. Credit Notes also never enter overdue aging.
    IF OLD.doc_type = 'Credit Note' AND OLD.status = 'Paid' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-004: Posted Credit Notes are irreversible; issue a Debit Note instead';
    ELSIF OLD.doc_type = 'Credit Note' AND NEW.status = 'Overdue' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-004: Credit Notes cannot enter the Overdue lifecycle';
    ELSIF OLD.status = 'Draft' AND NEW.status <> 'Open' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-STATUS: Draft documents may only be posted to Open';
    ELSIF OLD.status = 'Open' AND NEW.status NOT IN ('Partially Paid', 'Paid', 'Overdue', 'Cancelled', 'Written Off') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-STATUS: Invalid Open document lifecycle transition';
    ELSIF OLD.status = 'Overdue' AND NEW.status NOT IN ('Partially Paid', 'Paid', 'Cancelled', 'Written Off') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-STATUS: Invalid Overdue document lifecycle transition';
    ELSIF OLD.status = 'Partially Paid' AND NEW.status NOT IN ('Open', 'Overdue', 'Paid', 'Written Off') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-STATUS: Invalid Partially Paid document lifecycle transition';
    ELSIF OLD.status = 'Paid' AND NEW.status NOT IN ('Open', 'Overdue', 'Partially Paid') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-STATUS: Paid documents change only through governed allocation reversal';
    ELSIF OLD.status IN ('Cancelled', 'Written Off') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-TERMINAL: Terminal financial document status cannot change';
    END IF;

    IF OLD.doc_type = 'Credit Note'
      AND NEW.status IN ('Cancelled', 'Written Off')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-004: Posted Credit Notes are irreversible; issue a Debit Note instead';
    END IF;
  END IF;

  IF (NEW.posted_by IS DISTINCT FROM OLD.posted_by OR NEW.posted_at IS DISTINCT FROM OLD.posted_at)
    AND NOT (v_owner_authorized AND OLD.status = 'Draft' AND NEW.status = 'Open')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-AUDIT: Posting audit evidence is immutable outside governed posting';
  END IF;

  IF (
    NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
  ) AND NOT (
    v_owner_authorized
    AND OLD.status IN ('Open', 'Overdue')
    AND NEW.status = 'Cancelled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-AUDIT: Cancellation audit evidence is immutable outside governed cancellation';
  END IF;

  IF v_system_change THEN
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    ELSIF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'CONFLICT: Financial document version must advance exactly once';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_system_change BOOLEAN := FALSE;
  v_structural_change BOOLEAN := FALSE;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized
  FROM pg_catalog.pg_class c
  WHERE c.oid = TG_RELID;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_owner_authorized THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-AUTHORITY: Receipt creation requires a governed mutation';
    END IF;

    IF NEW.status <> 'Draft'
      OR NEW.allocated_amount <> 0
      OR NEW.unallocated_amount IS DISTINCT FROM NEW.receipt_amount
      OR NEW.created_by IS NULL
      OR NEW.posted_by IS NOT NULL
      OR NEW.posted_at IS NOT NULL
      OR NEW.cancelled_by IS NOT NULL
      OR NEW.cancelled_at IS NOT NULL
      OR NEW.cancel_reason IS NOT NULL
      OR NEW.version <> 1
      OR ROUND(NEW.receipt_amount * NEW.exchange_rate, 2) <> ROUND(NEW.base_amount, 2)
      OR NOT EXISTS (
        SELECT 1
        FROM public.customers c
        JOIN public.companies co ON co.id = c.company_id
        WHERE c.id = NEW.customer_id
          AND c.company_id = NEW.company_id
          AND c.is_deleted = FALSE
          AND c.is_hidden = FALSE
          AND c.status <> 'Blocked'
          AND NEW.customer_name IS NOT DISTINCT FROM c.customer_name
          AND NEW.base_currency IS NOT DISTINCT FROM co.base_currency
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.bank_accounts b
        WHERE b.id = NEW.bank_account_id
          AND b.company_id = NEW.company_id
          AND b.is_active = TRUE
          AND NEW.bank_account_name IS NOT DISTINCT FROM (b.bank_name || ' - ' || b.account_no)
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-INITIAL: Receipts must begin as an unposted, unallocated Draft';
    END IF;

    PERFORM public.rpc_check_role(
      NEW.created_by,
      NEW.company_id,
      ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
    );
    PERFORM public.rpc_check_customer_access(
      NEW.created_by,
      NEW.company_id,
      NEW.customer_id
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT v_owner_authorized
      OR pg_catalog.current_setting('app.ar_draft_delete', TRUE) IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-AUTHORITY: Draft deletion requires the governed deletion operation';
    END IF;
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-DELETE: Only Draft receipts may be deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.source_doc_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.allocation_details ad WHERE ad.receipt_id = OLD.id)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-DELETE: Financial evidence or allocations prevent receipt deletion';
    END IF;
    RETURN OLD;
  END IF;

  v_structural_change := NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
    OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
    OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
    OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
    OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
    OR NEW.receipt_amount IS DISTINCT FROM OLD.receipt_amount
    OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
    OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
    OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
    OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
    OR NEW.cheque_date IS DISTINCT FROM OLD.cheque_date
    OR NEW.posting_period IS DISTINCT FROM OLD.posting_period;

  IF v_structural_change AND NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-AUTHORITY: Receipt structure requires a governed mutation';
  END IF;

  IF (
    NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
  ) AND (
    NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = NEW.customer_id
        AND c.company_id = NEW.company_id
        AND c.is_deleted = FALSE
        AND c.is_hidden = FALSE
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.bank_accounts b
      WHERE b.id = NEW.bank_account_id
        AND b.company_id = NEW.company_id
        AND b.is_active = TRUE
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-PARENT: Customer or bank ownership is invalid';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-AUDIT: Creation audit evidence is immutable';
  END IF;

  IF NEW.receipt_amount <= 0
    OR NEW.base_amount < 0
    OR ROUND(NEW.receipt_amount * NEW.exchange_rate, 2) <> ROUND(NEW.base_amount, 2)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-BALANCE: Receipt amount and booked base snapshot are inconsistent';
  END IF;

  IF OLD.status IN ('Cancelled', 'Bounced')
    AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
      OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
      OR NEW.value_date IS DISTINCT FROM OLD.value_date
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
      OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
      OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
      OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
      OR NEW.receipt_amount IS DISTINCT FROM OLD.receipt_amount
      OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
      OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
      OR NEW.unallocated_amount IS DISTINCT FROM OLD.unallocated_amount
      OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
      OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
      OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
      OR NEW.cheque_date IS DISTINCT FROM OLD.cheque_date
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.posting_period IS DISTINCT FROM OLD.posting_period
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
      OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
      OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
      OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
      OR NEW.version IS DISTINCT FROM OLD.version
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-TERMINAL: Cancelled and Bounced receipts are immutable';
  END IF;

  IF OLD.status <> 'Draft'
    AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
      OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
      OR NEW.base_currency IS DISTINCT FROM OLD.base_currency
      OR NEW.fx_source_category IS DISTINCT FROM OLD.fx_source_category
      OR NEW.fx_decision_id IS DISTINCT FROM OLD.fx_decision_id
      OR NEW.receipt_amount IS DISTINCT FROM OLD.receipt_amount
      OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
      OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
      OR NEW.bank_account_name IS DISTINCT FROM OLD.bank_account_name
      OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
      OR NEW.cheque_date IS DISTINCT FROM OLD.cheque_date
      OR NEW.posting_period IS DISTINCT FROM OLD.posting_period
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-IMMUTABLE: Posted receipt identity and valuation fields are immutable';
  END IF;

  v_system_change := NEW.value_date IS DISTINCT FROM OLD.value_date
    OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
    OR NEW.unallocated_amount IS DISTINCT FROM OLD.unallocated_amount
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
    OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
    OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
    OR NEW.version IS DISTINCT FROM OLD.version;

  IF v_system_change AND NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-AUTHORITY: Receipt lifecycle balances and audit fields require a governed mutation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'Draft' AND NEW.status <> 'Posted' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-STATUS: Draft receipts may only be posted';
    ELSIF OLD.status = 'Posted' AND NEW.status NOT IN ('Fully Allocated', 'Cancelled', 'Bounced') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-STATUS: Invalid Posted receipt lifecycle transition';
    ELSIF OLD.status = 'Fully Allocated' AND NEW.status NOT IN ('Posted', 'Bounced') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-STATUS: Invalid Fully Allocated receipt lifecycle transition';
    ELSIF OLD.status IN ('Cancelled', 'Bounced') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-RCT-TERMINAL: Terminal receipt status cannot change';
    END IF;
  END IF;

  IF NEW.allocated_amount < 0
    OR NEW.unallocated_amount < 0
    OR (
      NEW.status NOT IN ('Cancelled', 'Bounced')
      AND ROUND(NEW.allocated_amount + NEW.unallocated_amount, 2) <> ROUND(NEW.receipt_amount, 2)
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-BALANCE: Receipt allocation balances are inconsistent';
  END IF;

  IF NEW.status = 'Fully Allocated' AND NEW.unallocated_amount <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-BALANCE: Fully Allocated receipt must have zero unallocated amount';
  END IF;

  IF (NEW.posted_by IS DISTINCT FROM OLD.posted_by OR NEW.posted_at IS DISTINCT FROM OLD.posted_at)
    AND NOT (v_owner_authorized AND OLD.status = 'Draft' AND NEW.status = 'Posted')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-AUDIT: Posting audit evidence is immutable outside governed posting';
  END IF;

  IF (
    NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
  ) AND NOT (
    v_owner_authorized AND OLD.status = 'Posted' AND NEW.status = 'Cancelled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-AUDIT: Cancellation audit evidence is immutable outside governed cancellation';
  END IF;

  IF v_system_change THEN
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    ELSIF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'CONFLICT: Receipt version must advance exactly once';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_enforce_invoice_line_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_invoice_id UUID;
  v_parent_status TEXT;
  v_parent_company_id UUID;
  v_parent_invoice_date DATE;
  v_tax_rate NUMERIC(5,2);
  v_gross NUMERIC;
  v_discount NUMERIC;
  v_expected_line_amount NUMERIC(18,2);
  v_expected_tax_amount NUMERIC(18,2);
  v_expected_line_total NUMERIC(18,2);
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized
  FROM pg_catalog.pg_class c
  WHERE c.oid = TG_RELID;

  IF NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-AUTHORITY: Invoice lines require a governed mutation';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-PARENT: Invoice lines cannot be moved between documents';
  END IF;

  v_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;

  SELECT i.status, i.company_id, i.invoice_date
  INTO v_parent_status, v_parent_company_id, v_parent_invoice_date
  FROM public.invoices i
  WHERE i.id = v_invoice_id
  FOR SHARE;

  IF v_parent_status IS NULL THEN
    -- A parent DELETE that already passed the Draft-only header guard may invoke
    -- the FK cascade after the parent tuple is no longer visible to this query.
    IF TG_OP = 'DELETE' AND pg_catalog.pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-PARENT: Parent financial document is unavailable';
  END IF;

  IF v_parent_status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-IMMUTABLE: Invoice lines may change only while the parent is Draft';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.product_id IS NOT NULL THEN
      PERFORM 1
      FROM public.products p
      WHERE p.id = NEW.product_id
        AND p.company_id = v_parent_company_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'BR-LINE-PARENT: Product ownership is invalid or unavailable';
      END IF;
    END IF;

    IF NEW.tax_code_id IS NULL THEN
      IF NEW.tax_rate <> 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'BR-LINE-TAX: Tax rate requires a valid same-company tax code';
      END IF;
    ELSE
      SELECT tc.rate
      INTO v_tax_rate
      FROM public.tax_codes tc
      WHERE tc.id = NEW.tax_code_id
        AND tc.company_id = v_parent_company_id
        AND tc.is_active = TRUE
        AND tc.effective_from <= v_parent_invoice_date
        AND (tc.effective_to IS NULL OR tc.effective_to >= v_parent_invoice_date)
      FOR SHARE;
      IF NOT FOUND OR NEW.tax_rate IS DISTINCT FROM v_tax_rate THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'BR-LINE-TAX: Tax code or stored tax-rate snapshot is invalid';
      END IF;
    END IF;

    IF NEW.gl_account_id IS NOT NULL THEN
      PERFORM 1
      FROM public.gl_accounts ga
      WHERE ga.id = NEW.gl_account_id
        AND ga.company_id = v_parent_company_id
        AND ga.is_active = TRUE
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'BR-LINE-GL: Revenue account ownership or lifecycle is invalid';
      END IF;
    END IF;

    v_gross := NEW.quantity * NEW.unit_price;
    v_discount := CASE
      WHEN NEW.discount_pct > 0 THEN v_gross * NEW.discount_pct / 100
      ELSE NEW.discount_amt
    END;
    v_expected_line_amount := ROUND(v_gross - v_discount, 2);
    v_expected_tax_amount := ROUND(v_expected_line_amount * NEW.tax_rate / 100, 2);
    v_expected_line_total := ROUND(v_expected_line_amount + v_expected_tax_amount, 2);

    IF NEW.tax_rate < 0
      OR v_discount > v_gross
      OR NEW.line_amount IS DISTINCT FROM v_expected_line_amount
      OR NEW.tax_amount IS DISTINCT FROM v_expected_tax_amount
      OR NEW.line_total IS DISTINCT FROM v_expected_line_total
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-LINE-CALC: Stored Invoice line amounts do not match authoritative calculation';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_recalculate_invoice_after_line_change()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_invoice_id UUID;
  v_company_id UUID;
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_catalog.current_setting('app.ar_draft_delete', TRUE) = 'on'
  THEN
    RETURN NULL;
  END IF;

  v_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT i.company_id
  INTO v_company_id
  FROM public.invoices i
  WHERE i.id = v_invoice_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-PARENT: Parent financial document is unavailable';
  END IF;

  PERFORM public.fx_recalculate_invoice_draft_totals(v_company_id, v_invoice_id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_protect_allocation_detail()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_receipt_company UUID;
  v_receipt_customer UUID;
  v_receipt_currency TEXT;
  v_receipt_status TEXT;
  v_receipt_unallocated NUMERIC(18,2);
  v_receipt_rate NUMERIC(18,8);
  v_invoice_company UUID;
  v_invoice_customer UUID;
  v_invoice_currency TEXT;
  v_invoice_doc_type TEXT;
  v_invoice_status TEXT;
  v_invoice_outstanding NUMERIC(18,2);
  v_invoice_rate NUMERIC(18,8);
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;

  IF NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-ALLOC-AUTHORITY: Allocation evidence requires a governed mutation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-ALLOC-IMMUTABLE: Allocation evidence cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Active'
      OR NEW.reversed_by IS NOT NULL
      OR NEW.reversed_at IS NOT NULL
      OR NEW.reverse_reason IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-ALLOC-INITIAL: Allocation evidence must begin Active and unreversed';
    END IF;

    SELECT r.company_id, r.customer_id, r.currency, r.status, r.unallocated_amount, r.exchange_rate
    INTO v_receipt_company, v_receipt_customer, v_receipt_currency, v_receipt_status,
      v_receipt_unallocated, v_receipt_rate
    FROM public.receipts r
    WHERE r.id = NEW.receipt_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-ALLOC-PARENT: Allocation parent is unavailable';
    END IF;

    SELECT i.company_id, i.customer_id, i.currency, i.doc_type, i.status, i.outstanding, i.exchange_rate
    INTO v_invoice_company, v_invoice_customer, v_invoice_currency, v_invoice_doc_type, v_invoice_status,
      v_invoice_outstanding, v_invoice_rate
    FROM public.invoices i
    WHERE i.id = NEW.invoice_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-ALLOC-PARENT: Allocation parent is unavailable';
    END IF;

    IF v_receipt_company IS DISTINCT FROM v_invoice_company
      OR v_receipt_customer IS DISTINCT FROM v_invoice_customer
      OR v_receipt_currency IS DISTINCT FROM v_invoice_currency
      OR NEW.doc_type IS DISTINCT FROM v_invoice_doc_type
      OR v_invoice_doc_type NOT IN ('Invoice', 'Debit Note')
      OR v_receipt_status <> 'Posted'
      OR v_invoice_status NOT IN ('Open', 'Overdue', 'Partially Paid')
      OR NEW.allocated_amount > v_receipt_unallocated + 0.01
      OR NEW.allocated_amount + NEW.discount_amount > v_invoice_outstanding + 0.01
      OR NEW.receipt_rate IS DISTINCT FROM v_receipt_rate
      OR NEW.invoice_rate IS DISTINCT FROM v_invoice_rate
      OR NEW.base_allocated IS DISTINCT FROM ROUND(NEW.allocated_amount * v_receipt_rate, 2)
      OR NEW.forex_gain_loss IS DISTINCT FROM ROUND(
        NEW.allocated_amount * (v_receipt_rate - v_invoice_rate),
        2
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-ALLOC-PARENT: Allocation parent lifecycle or ownership is invalid';
    END IF;
    PERFORM public.rpc_check_role(
      NEW.allocated_by,
      v_receipt_company,
      ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
    );
    PERFORM public.rpc_check_customer_access(
      NEW.allocated_by,
      v_receipt_company,
      v_receipt_customer
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
    OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
    OR NEW.base_allocated IS DISTINCT FROM OLD.base_allocated
    OR NEW.invoice_rate IS DISTINCT FROM OLD.invoice_rate
    OR NEW.receipt_rate IS DISTINCT FROM OLD.receipt_rate
    OR NEW.forex_gain_loss IS DISTINCT FROM OLD.forex_gain_loss
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.allocation_date IS DISTINCT FROM OLD.allocation_date
    OR NEW.allocated_by IS DISTINCT FROM OLD.allocated_by
    OR NEW.allocation_method IS DISTINCT FROM OLD.allocation_method
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status <> 'Active'
    OR NEW.status <> 'Reversed'
    OR OLD.reversed_by IS NOT NULL
    OR OLD.reversed_at IS NOT NULL
    OR OLD.reverse_reason IS NOT NULL
    OR NEW.reversed_by IS NULL
    OR NEW.reversed_at IS NULL
    OR char_length(btrim(COALESCE(NEW.reverse_reason, ''))) < 10
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-ALLOC-IMMUTABLE: Allocation financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_protect_cn_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_cn_company UUID;
  v_cn_customer UUID;
  v_cn_currency TEXT;
  v_cn_doc_type TEXT;
  v_cn_status TEXT;
  v_cn_total NUMERIC(18,2);
  v_invoice_company UUID;
  v_invoice_customer UUID;
  v_invoice_currency TEXT;
  v_invoice_doc_type TEXT;
  v_invoice_status TEXT;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-ALLOC-AUTHORITY: Credit Note allocation evidence requires a governed mutation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-ALLOC-IMMUTABLE: Credit Note allocation evidence cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Active'
      OR NEW.reversed_by IS NOT NULL
      OR NEW.reversed_at IS NOT NULL
      OR NEW.reverse_reason IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-ALLOC-INITIAL: Credit Note allocation evidence must begin Active and unreversed';
    END IF;

    SELECT cn.company_id, cn.customer_id, cn.currency, cn.doc_type, cn.status, cn.total_amount
    INTO v_cn_company, v_cn_customer, v_cn_currency, v_cn_doc_type, v_cn_status, v_cn_total
    FROM public.invoices cn
    WHERE cn.id = NEW.cn_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-ALLOC-PARENT: Credit Note allocation parent is unavailable';
    END IF;

    SELECT i.company_id, i.customer_id, i.currency, i.doc_type, i.status
    INTO v_invoice_company, v_invoice_customer, v_invoice_currency, v_invoice_doc_type, v_invoice_status
    FROM public.invoices i
    WHERE i.id = NEW.invoice_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-ALLOC-PARENT: Credit Note allocation parent is unavailable';
    END IF;

    IF v_cn_doc_type <> 'Credit Note'
      OR v_invoice_doc_type <> 'Invoice'
      OR v_cn_company IS DISTINCT FROM v_invoice_company
      OR v_cn_customer IS DISTINCT FROM v_invoice_customer
      OR v_cn_currency IS DISTINCT FROM v_invoice_currency
      OR v_cn_status NOT IN ('Open', 'Partially Paid', 'Paid')
      OR v_invoice_status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
      OR NEW.allocated_amount > v_cn_total + 0.01
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-CN-ALLOC-PARENT: Credit Note allocation ownership or currency is invalid';
    END IF;
    PERFORM public.rpc_check_role(
      NEW.allocated_by,
      v_cn_company,
      ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
    );
    PERFORM public.rpc_check_customer_access(
      NEW.allocated_by,
      v_cn_company,
      v_cn_customer
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.cn_id IS DISTINCT FROM OLD.cn_id
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
    OR NEW.allocation_date IS DISTINCT FROM OLD.allocation_date
    OR NEW.allocated_by IS DISTINCT FROM OLD.allocated_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status <> 'Active'
    OR NEW.status <> 'Reversed'
    OR OLD.reversed_by IS NOT NULL
    OR OLD.reversed_at IS NOT NULL
    OR OLD.reverse_reason IS NOT NULL
    OR NEW.reversed_by IS NULL
    OR NEW.reversed_at IS NULL
    OR char_length(btrim(COALESCE(NEW.reverse_reason, ''))) < 10
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-ALLOC-IMMUTABLE: Credit Note allocation financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_header_stable BOOLEAN := FALSE;
  v_total_finalize BOOLEAN := FALSE;
  v_reversal_link BOOLEAN := FALSE;
  v_header_noop BOOLEAN := FALSE;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-AUTHORITY: Journal evidence requires a governed mutation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-IMMUTABLE: Journal entries cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_reversed = TRUE
      OR NEW.reversal_je_id IS NOT NULL
      OR (NEW.is_reversal = TRUE AND NEW.original_je_id IS NULL)
      OR (NEW.is_reversal = FALSE AND NEW.original_je_id IS NOT NULL)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-JE-INITIAL: Journal reversal evidence is inconsistent';
    END IF;
    RETURN NEW;
  END IF;

  v_header_stable := NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
    AND NEW.je_no IS NOT DISTINCT FROM OLD.je_no
    AND NEW.je_date IS NOT DISTINCT FROM OLD.je_date
    AND NEW.posting_period IS NOT DISTINCT FROM OLD.posting_period
    AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
    AND NEW.source_doc_no IS NOT DISTINCT FROM OLD.source_doc_no
    AND NEW.source_doc_id IS NOT DISTINCT FROM OLD.source_doc_id
    AND NEW.description IS NOT DISTINCT FROM OLD.description
    AND NEW.currency IS NOT DISTINCT FROM OLD.currency
    AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate
    AND NEW.base_currency IS NOT DISTINCT FROM OLD.base_currency
    AND NEW.is_reversal IS NOT DISTINCT FROM OLD.is_reversal
    AND NEW.original_je_id IS NOT DISTINCT FROM OLD.original_je_id
    AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at;

  -- post_invoice creates a governed header before its lines and then finalizes
  -- the balanced totals in the same transaction. Preserve only that exact
  -- zero-to-balanced owner transition.
  v_total_finalize := v_header_stable
    AND OLD.total_debit = 0
    AND OLD.total_credit = 0
    AND NEW.total_debit >= 0
    AND NEW.total_credit >= 0
    AND NEW.total_debit = NEW.total_credit
    AND NEW.is_reversed IS NOT DISTINCT FROM OLD.is_reversed
    AND NEW.reversal_je_id IS NOT DISTINCT FROM OLD.reversal_je_id;

  v_reversal_link := v_header_stable
    AND NEW.total_debit IS NOT DISTINCT FROM OLD.total_debit
    AND NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit
    AND OLD.is_reversed = FALSE
    AND NEW.is_reversed = TRUE
    AND OLD.reversal_je_id IS NULL
    AND NEW.reversal_je_id IS NOT NULL;

  -- The authoritative invoice posting RPC performs one redundant totals UPDATE
  -- after inserting an already-balanced header. Preserve that exact no-op,
  -- without permitting any financial or reversal evidence to change.
  v_header_noop := v_header_stable
    AND NEW.total_debit IS NOT DISTINCT FROM OLD.total_debit
    AND NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit
    AND NEW.is_reversed IS NOT DISTINCT FROM OLD.is_reversed
    AND NEW.reversal_je_id IS NOT DISTINCT FROM OLD.reversal_je_id;

  IF NOT v_total_finalize AND NOT v_reversal_link AND NOT v_header_noop THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-IMMUTABLE: Journal financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry_line()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_journal_company_id UUID;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID;
  IF TG_OP <> 'INSERT' OR NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-LINE-IMMUTABLE: Journal lines require governed creation and cannot be changed';
  END IF;

  SELECT je.company_id
  INTO v_journal_company_id
  FROM public.journal_entries je
  WHERE je.id = NEW.je_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-LINE-PARENT: Journal header is unavailable';
  END IF;

  PERFORM 1
  FROM public.gl_accounts ga
  WHERE ga.id = NEW.gl_account_id
    AND ga.company_id = v_journal_company_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-JE-LINE-PARENT: GL account ownership is invalid';
  END IF;
  RETURN NEW;
END;
$$;

-- FX booking decisions and their events are financial provenance evidence.
-- Existing governed owner-executed functions retain mutation authority, but
-- routine service-role table DML must not forge, rewrite, or delete that audit
-- trail. New decision versions also bind their maker to the transaction's
-- active company/customer scope before the existing FX validator runs.
CREATE OR REPLACE FUNCTION public.ar_protect_fx_booking_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
  v_customer_id UUID;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized
  FROM pg_catalog.pg_class c
  WHERE c.oid = TG_RELID;

  IF NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-AUTHORITY: FX booking evidence requires a governed mutation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_catalog.current_setting('app.ar_draft_delete', TRUE) = 'on'
      AND (
        (
          OLD.invoice_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.invoices i
            WHERE i.id = OLD.invoice_id AND i.status = 'Draft'
          )
        )
        OR (
          OLD.receipt_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.receipts r
            WHERE r.id = OLD.receipt_id AND r.status = 'Draft'
          )
        )
      )
    THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-IMMUTABLE: FX booking decisions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.maker_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-ACTOR: FX booking decision actor is required';
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT i.customer_id
    INTO v_customer_id
    FROM public.invoices i
    WHERE i.id = NEW.invoice_id
      AND i.company_id = NEW.company_id;
  ELSE
    SELECT r.customer_id
    INTO v_customer_id
    FROM public.receipts r
    WHERE r.id = NEW.receipt_id
      AND r.company_id = NEW.company_id;
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: FX booking transaction not found';
  END IF;

  PERFORM public.rpc_check_role(
    NEW.maker_user_id,
    NEW.company_id,
    ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
  );
  PERFORM public.rpc_check_customer_access(
    NEW.maker_user_id,
    NEW.company_id,
    v_customer_id
  );
  RETURN NEW;
END;
$$;

-- Preserve the established append-only trigger identity while permitting only
-- the two governed Draft-delete functions to remove never-posted provenance.
CREATE OR REPLACE FUNCTION public.fx_prevent_booking_rate_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_catalog.current_setting('app.ar_draft_delete', TRUE) = 'on'
    AND (
      (
        OLD.invoice_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = OLD.invoice_id AND i.status = 'Draft'
        )
      )
      OR (
        OLD.receipt_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.receipts r
          WHERE r.id = OLD.receipt_id AND r.status = 'Draft'
        )
      )
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'BR-FX-GOVERNANCE: Booking-rate decision events are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.ar_protect_fx_booking_decision_event()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_owner_authorized BOOLEAN := FALSE;
BEGIN
  SELECT current_user = pg_catalog.pg_get_userbyid(c.relowner)
  INTO v_owner_authorized
  FROM pg_catalog.pg_class c
  WHERE c.oid = TG_RELID;

  IF TG_OP = 'DELETE'
    AND v_owner_authorized
    AND pg_catalog.current_setting('app.ar_draft_delete', TRUE) = 'on'
    AND (
      (
        OLD.invoice_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.invoices i
          WHERE i.id = OLD.invoice_id AND i.status = 'Draft'
        )
      )
      OR (
        OLD.receipt_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.receipts r
          WHERE r.id = OLD.receipt_id AND r.status = 'Draft'
        )
      )
    )
  THEN
    RETURN OLD;
  END IF;

  IF TG_OP <> 'INSERT' OR NOT v_owner_authorized THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-FX-EVENT-IMMUTABLE: FX booking decision events are append-only governed evidence';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_linked_credit_note_reference_forward
  ON public.invoices;
CREATE TRIGGER trg_ar_linked_credit_note_reference_forward
BEFORE INSERT OR UPDATE OF
  doc_type,
  cn_type,
  ref_invoice_id,
  company_id,
  customer_id,
  currency
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.ar_validate_linked_credit_note_reference();

DROP TRIGGER IF EXISTS trg_ar_linked_credit_note_reference_reverse
  ON public.invoices;
CREATE TRIGGER trg_ar_linked_credit_note_reference_reverse
BEFORE UPDATE OF
  company_id,
  customer_id,
  currency,
  doc_type,
  status
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.ar_validate_linked_credit_note_reference_reverse();

DROP TRIGGER IF EXISTS trg_ar_cancelled_document_terminal
  ON public.invoices;
DROP TRIGGER IF EXISTS trg_ar_financial_document_lifecycle
  ON public.invoices;
CREATE TRIGGER trg_ar_financial_document_lifecycle
BEFORE INSERT OR UPDATE OR DELETE
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.ar_prevent_cancelled_document_mutation();

DROP TRIGGER IF EXISTS trg_ar_receipt_lifecycle
  ON public.receipts;
CREATE TRIGGER trg_ar_receipt_lifecycle
BEFORE INSERT OR UPDATE OR DELETE
ON public.receipts
FOR EACH ROW
EXECUTE FUNCTION public.ar_enforce_receipt_lifecycle();

DROP TRIGGER IF EXISTS trg_ar_invoice_line_lifecycle
  ON public.invoice_lines;
CREATE TRIGGER trg_ar_invoice_line_lifecycle
BEFORE INSERT OR UPDATE OR DELETE
ON public.invoice_lines
FOR EACH ROW
EXECUTE FUNCTION public.ar_enforce_invoice_line_lifecycle();

DROP TRIGGER IF EXISTS trg_ar_invoice_line_recalculate
  ON public.invoice_lines;
CREATE TRIGGER trg_ar_invoice_line_recalculate
AFTER INSERT OR UPDATE OR DELETE
ON public.invoice_lines
FOR EACH ROW
EXECUTE FUNCTION public.ar_recalculate_invoice_after_line_change();

DROP TRIGGER IF EXISTS trg_ar_allocation_detail_integrity
  ON public.allocation_details;
CREATE TRIGGER trg_ar_allocation_detail_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.allocation_details
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_allocation_detail();

DROP TRIGGER IF EXISTS trg_ar_cn_allocation_integrity
  ON public.cn_allocations;
CREATE TRIGGER trg_ar_cn_allocation_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.cn_allocations
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_cn_allocation();

DROP TRIGGER IF EXISTS trg_ar_journal_entry_integrity
  ON public.journal_entries;
CREATE TRIGGER trg_ar_journal_entry_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_journal_entry();

DROP TRIGGER IF EXISTS trg_ar_journal_entry_line_integrity
  ON public.journal_entry_lines;
CREATE TRIGGER trg_ar_journal_entry_line_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.journal_entry_lines
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_journal_entry_line();

DROP TRIGGER IF EXISTS trg_ar_fx_booking_decision_integrity
  ON public.fx_booking_rate_decisions;
CREATE TRIGGER trg_ar_fx_booking_decision_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.fx_booking_rate_decisions
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_fx_booking_decision();

DROP TRIGGER IF EXISTS trg_ar_fx_booking_decision_event_integrity
  ON public.fx_booking_rate_decision_events;
CREATE TRIGGER trg_ar_fx_booking_decision_event_integrity
BEFORE INSERT OR UPDATE OR DELETE
ON public.fx_booking_rate_decision_events
FOR EACH ROW
EXECUTE FUNCTION public.ar_protect_fx_booking_decision_event();

-- Draft header edits are one governed transaction. FX-material changes retain
-- the established booking-decision authority, while the remaining editable
-- header fields commit or roll back with that FX decision. This replaces the
-- former service-role PostgREST update that the lifecycle trigger correctly
-- rejects as an ungoverned structural write.
DROP FUNCTION IF EXISTS public.update_draft_invoice(UUID, UUID, UUID, JSONB);
CREATE FUNCTION public.update_draft_invoice(
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
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_updated public.invoices%ROWTYPE;
  v_currency CHAR(3);
  v_invoice_date DATE;
  v_exchange_rate NUMERIC(18,8);
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
      'fx_explicit_rate_supplied'
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

  v_currency := COALESCE(p_changes->>'currency', v_invoice.currency)::CHAR(3);
  v_invoice_date := COALESCE((p_changes->>'invoice_date')::DATE, v_invoice.invoice_date);
  v_exchange_rate := COALESCE((p_changes->>'exchange_rate')::NUMERIC, v_invoice.exchange_rate)::NUMERIC(18,8);
  v_fx_material_change := p_changes ? 'currency'
    OR p_changes ? 'invoice_date'
    OR p_changes ? 'exchange_rate';

  IF v_exchange_rate <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: exchange_rate must be greater than zero';
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
      NULLIF(p_changes->>'fx_override_reason', '')
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
  RETURN to_jsonb(v_updated);
END;
$$;

-- Keep receipt-allocation lifecycle mutations on one parent-first lock order.
-- The former implementation locked allocation_details before receipts, while
-- bounced-cheque handling locks receipts before allocation_details. Replacing
-- it here closes that allocation-reversal/bounce deadlock cycle.
CREATE OR REPLACE FUNCTION public.reverse_allocation(
  p_allocation_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allocation_receipt_id UUID;
  v_alloc public.allocation_details%ROWTYPE;
  v_inv public.invoices%ROWTYPE;
  v_rct public.receipts%ROWTYPE;
  v_je RECORD;
  v_new_os NUMERIC(18,2);
  v_new_stat TEXT;
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );

  IF char_length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-REC-005: Reversal reason must be at least 10 characters';
  END IF;

  -- Read only the immutable parent key before taking locks. The integrity
  -- trigger forbids moving or deleting allocation evidence; status is
  -- revalidated after the parent Receipt lock is held.
  SELECT ad.receipt_id
  INTO v_allocation_receipt_id
  FROM public.allocation_details ad
  WHERE ad.id = p_allocation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Allocation not found';
  END IF;

  SELECT r.*
  INTO v_rct
  FROM public.receipts r
  WHERE r.id = v_allocation_receipt_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Allocation not found in this company';
  END IF;

  SELECT ad.*
  INTO v_alloc
  FROM public.allocation_details ad
  WHERE ad.id = p_allocation_id
    AND ad.receipt_id = v_rct.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Allocation not found';
  END IF;
  IF v_alloc.status <> 'Active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-REC-REV: Only Active allocations can be reversed';
  END IF;

  SELECT i.*
  INTO v_inv
  FROM public.invoices i
  WHERE i.id = v_alloc.invoice_id
    AND i.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_inv.customer_id IS DISTINCT FROM v_rct.customer_id
    OR v_inv.currency IS DISTINCT FROM v_rct.currency
    OR v_alloc.doc_type IS DISTINCT FROM v_inv.doc_type
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Allocation not found in this company';
  END IF;

  IF v_inv.doc_type = 'Credit Note' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-004: Receipt allocation reversal cannot reopen a posted Credit Note; issue a Debit Note instead';
  ELSIF v_inv.doc_type NOT IN ('Invoice', 'Debit Note') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-REC-REV: Allocation target document type does not support reversal';
  END IF;

  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_rct.customer_id
  );

  UPDATE public.allocation_details
  SET status = 'Reversed',
      reversed_by = p_user_id,
      reversed_at = now(),
      reverse_reason = p_reason
  WHERE id = p_allocation_id;

  v_new_os := ROUND(
    v_inv.outstanding + v_alloc.allocated_amount + v_alloc.discount_amount,
    2
  );
  IF v_new_os >= v_inv.total_amount THEN
    IF v_inv.due_date IS NOT NULL AND v_inv.due_date < CURRENT_DATE THEN
      v_new_stat := 'Overdue';
    ELSE
      v_new_stat := 'Open';
    END IF;
  ELSE
    v_new_stat := 'Partially Paid';
  END IF;

  UPDATE public.invoices
  SET outstanding = v_new_os,
      status = v_new_stat,
      version = v_inv.version + 1
  WHERE id = v_inv.id
    AND version = v_inv.version;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Invoice was modified during allocation reversal';
  END IF;

  UPDATE public.receipts
  SET allocated_amount = GREATEST(allocated_amount - v_alloc.allocated_amount, 0),
      unallocated_amount = unallocated_amount + v_alloc.allocated_amount,
      status = CASE WHEN status = 'Fully Allocated' THEN 'Posted' ELSE status END
  WHERE id = v_rct.id;

  FOR v_je IN
    SELECT je.id
    FROM public.journal_entries je
    WHERE je.source_doc_id = p_allocation_id
      AND je.source_type = 'ADJ'
      AND je.is_reversal = FALSE
      AND je.is_reversed = FALSE
    ORDER BY je.created_at, je.id
    FOR UPDATE
  LOOP
    PERFORM public.reverse_journal_entry(
      v_je.id,
      p_user_id,
      p_company_id,
      format('Allocation reversal: %s', p_reason)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'reversed', TRUE,
    'allocation_id', p_allocation_id,
    'invoice_no', v_inv.invoice_no,
    'receipt_no', v_rct.receipt_no,
    'restored_outstanding', v_new_os
  );
END;
$$;

-- Authoritative Invoice/Debit Note cancellation. This function holds the
-- target document lock while checking allocations and dependent Linked Credit
-- Notes, invokes the existing reversal routine in the same transaction, and
-- updates the document only after every precondition succeeds.
-- Draft line edits use the same parent-row-first lock order as posting and
-- cancellation. The AFTER trigger recalculates header totals in this same
-- transaction, so neither a child-only commit nor a stale header is possible.
DROP FUNCTION IF EXISTS public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB);
CREATE FUNCTION public.add_draft_invoice_lines(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_line JSONB;
  v_created_line JSONB;
  v_created JSONB := '[]'::jsonb;
  v_next_line_no INTEGER;
BEGIN
  IF p_lines IS NULL
    OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
    OR pg_catalog.jsonb_array_length(p_lines) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: At least one Invoice line is required';
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
  PERFORM public.rpc_check_customer_access(p_user_id, p_company_id, v_invoice.customer_id);
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-IMMUTABLE: Invoice lines may change only while the parent is Draft';
  END IF;

  SELECT COALESCE(MAX(il.line_no), 0) + 10
  INTO v_next_line_no
  FROM public.invoice_lines il
  WHERE il.invoice_id = p_invoice_id;

  FOR v_line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lines)
  LOOP
    IF pg_catalog.jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'VALIDATION: Each Invoice line must be an object';
    END IF;

    INSERT INTO public.invoice_lines AS il (
      invoice_id, line_no, description, item_code, product_id, quantity, uom,
      unit_price, discount_pct, discount_amt, line_amount, tax_code_id,
      tax_rate, tax_amount, line_total, gl_account_id, cost_center, line_remarks
    ) VALUES (
      p_invoice_id,
      v_next_line_no,
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
    )
    RETURNING pg_catalog.to_jsonb(il) INTO v_created_line;

    v_created := v_created || pg_catalog.jsonb_build_array(v_created_line);
    v_next_line_no := v_next_line_no + 10;
  END LOOP;

  RETURN v_created;
END;
$$;

DROP FUNCTION IF EXISTS public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB);
CREATE FUNCTION public.update_draft_invoice_line(
  p_invoice_id UUID,
  p_line_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_changes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_line public.invoice_lines%ROWTYPE;
  v_updated public.invoice_lines%ROWTYPE;
BEGIN
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Invoice line changes must be an object';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_changes) AS keys(key_name)
    WHERE key_name <> ALL (ARRAY[
      'description', 'item_code', 'product_id', 'quantity', 'uom',
      'unit_price', 'discount_pct', 'discount_amt', 'line_amount',
      'tax_code_id', 'tax_rate', 'tax_amount', 'line_total',
      'gl_account_id', 'cost_center', 'line_remarks'
    ]::text[])
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Invoice line changes contain unsupported fields';
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
  PERFORM public.rpc_check_customer_access(p_user_id, p_company_id, v_invoice.customer_id);
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-IMMUTABLE: Invoice lines may change only while the parent is Draft';
  END IF;

  SELECT il.*
  INTO v_line
  FROM public.invoice_lines il
  WHERE il.id = p_line_id
    AND il.invoice_id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Invoice line not found';
  END IF;

  UPDATE public.invoice_lines il
  SET description = CASE WHEN p_changes ? 'description' THEN p_changes->>'description' ELSE v_line.description END,
      item_code = CASE WHEN p_changes ? 'item_code' THEN NULLIF(p_changes->>'item_code', '') ELSE v_line.item_code END,
      product_id = CASE WHEN p_changes ? 'product_id' THEN NULLIF(p_changes->>'product_id', '')::uuid ELSE v_line.product_id END,
      quantity = CASE WHEN p_changes ? 'quantity' THEN (p_changes->>'quantity')::numeric ELSE v_line.quantity END,
      uom = CASE WHEN p_changes ? 'uom' THEN NULLIF(p_changes->>'uom', '') ELSE v_line.uom END,
      unit_price = CASE WHEN p_changes ? 'unit_price' THEN (p_changes->>'unit_price')::numeric ELSE v_line.unit_price END,
      discount_pct = CASE WHEN p_changes ? 'discount_pct' THEN (p_changes->>'discount_pct')::numeric ELSE v_line.discount_pct END,
      discount_amt = CASE WHEN p_changes ? 'discount_amt' THEN (p_changes->>'discount_amt')::numeric ELSE v_line.discount_amt END,
      line_amount = CASE WHEN p_changes ? 'line_amount' THEN (p_changes->>'line_amount')::numeric ELSE v_line.line_amount END,
      tax_code_id = CASE WHEN p_changes ? 'tax_code_id' THEN NULLIF(p_changes->>'tax_code_id', '')::uuid ELSE v_line.tax_code_id END,
      tax_rate = CASE WHEN p_changes ? 'tax_rate' THEN (p_changes->>'tax_rate')::numeric ELSE v_line.tax_rate END,
      tax_amount = CASE WHEN p_changes ? 'tax_amount' THEN (p_changes->>'tax_amount')::numeric ELSE v_line.tax_amount END,
      line_total = CASE WHEN p_changes ? 'line_total' THEN (p_changes->>'line_total')::numeric ELSE v_line.line_total END,
      gl_account_id = CASE WHEN p_changes ? 'gl_account_id' THEN NULLIF(p_changes->>'gl_account_id', '')::uuid ELSE v_line.gl_account_id END,
      cost_center = CASE WHEN p_changes ? 'cost_center' THEN NULLIF(p_changes->>'cost_center', '') ELSE v_line.cost_center END,
      line_remarks = CASE WHEN p_changes ? 'line_remarks' THEN NULLIF(p_changes->>'line_remarks', '') ELSE v_line.line_remarks END
  WHERE il.id = p_line_id
    AND il.invoice_id = p_invoice_id
  RETURNING il.* INTO v_updated;

  RETURN pg_catalog.to_jsonb(v_updated);
END;
$$;

DROP FUNCTION IF EXISTS public.delete_draft_invoice_line(UUID, UUID, UUID, UUID);
CREATE FUNCTION public.delete_draft_invoice_line(
  p_invoice_id UUID,
  p_line_id UUID,
  p_user_id UUID,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
BEGIN
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
  PERFORM public.rpc_check_customer_access(p_user_id, p_company_id, v_invoice.customer_id);
  IF v_invoice.status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-LINE-IMMUTABLE: Invoice lines may change only while the parent is Draft';
  END IF;

  DELETE FROM public.invoice_lines il
  WHERE il.id = p_line_id
    AND il.invoice_id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Invoice line not found';
  END IF;

  RETURN pg_catalog.jsonb_build_object('deleted', TRUE, 'id', p_line_id);
END;
$$;

CREATE FUNCTION public.cancel_invoice(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_cancel_reason TEXT,
  p_expected_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_cancelled public.invoices%ROWTYPE;
  v_original_je_id UUID;
  v_source_type TEXT;
  v_reversal JSONB;
  v_primary_je_count INTEGER;
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );

  IF char_length(btrim(COALESCE(p_cancel_reason, ''))) < 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Cancel reason must be at least 10 characters';
  END IF;

  SELECT i.*
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Invoice not found';
  END IF;

  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_invoice.customer_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_invoice.customer_id
      AND c.company_id = p_company_id
      AND c.is_hidden = FALSE
      AND c.is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Customer not found';
  END IF;

  IF p_expected_version IS NULL OR v_invoice.version <> p_expected_version THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Invoice was modified by another user during cancellation';
  END IF;

  IF v_invoice.doc_type = 'Credit Note' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-004: Posted Credit Notes are irreversible; issue a Debit Note instead';
  END IF;

  IF v_invoice.doc_type NOT IN ('Invoice', 'Debit Note') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Document type cannot be cancelled';
  END IF;

  IF v_invoice.status = 'Partially Paid' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-004: Partially Paid invoices cannot be cancelled directly';
  END IF;

  IF v_invoice.status NOT IN ('Open', 'Overdue') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'BR-INV-003: Only Open or Overdue invoices can be cancelled; current status is %s',
        v_invoice.status
      );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.allocation_details ad
    WHERE ad.invoice_id = p_invoice_id
      AND ad.status = 'Active'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Invoice cannot be cancelled while active allocations exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices cn
    WHERE cn.ref_invoice_id = p_invoice_id
      AND cn.doc_type = 'Credit Note'
      AND cn.cn_type = 'Linked'
      AND cn.status <> 'Cancelled'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-CN-REF: Linked Credit Note reference integrity prevents this Invoice cancellation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices dn
    WHERE dn.ref_invoice_id = p_invoice_id
      AND dn.doc_type = 'Debit Note'
      AND dn.status NOT IN ('Cancelled', 'Written Off')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-DN-REF: Debit Note reference integrity prevents this document cancellation';
  END IF;

  IF v_invoice.outstanding IS DISTINCT FROM v_invoice.total_amount THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Invoice cannot be cancelled after allocation or partial settlement';
  END IF;

  v_source_type := CASE v_invoice.doc_type
    WHEN 'Invoice' THEN 'INV'
    WHEN 'Debit Note' THEN 'DN'
  END;

  SELECT COUNT(*)
  INTO v_primary_je_count
  FROM public.journal_entries je
  WHERE je.company_id = p_company_id
    AND je.source_doc_id = p_invoice_id
    AND je.source_type = v_source_type
    AND je.is_reversal = FALSE
    AND je.is_reversed = FALSE;

  IF v_primary_je_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Exactly one active original journal entry is required for cancellation';
  END IF;

  SELECT je.id
  INTO v_original_je_id
  FROM public.journal_entries je
  WHERE je.company_id = p_company_id
    AND je.source_doc_id = p_invoice_id
    AND je.source_type = v_source_type
    AND je.is_reversal = FALSE
    AND je.is_reversed = FALSE
  ORDER BY je.created_at, je.id
  LIMIT 1
  FOR UPDATE;

  IF v_original_je_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-INV-003: Original journal entry is unavailable for cancellation';
  END IF;

  -- Nested PostgreSQL function calls participate in this function's transaction;
  -- any later error rolls back the reversal header, lines, and cross-reference.
  v_reversal := public.reverse_journal_entry(
    v_original_je_id,
    p_user_id,
    p_company_id,
    p_cancel_reason
  );

  UPDATE public.invoices
  SET status = 'Cancelled',
      outstanding = 0,
      cancelled_by = p_user_id,
      cancelled_at = now(),
      cancel_reason = p_cancel_reason,
      version = v_invoice.version + 1
  WHERE id = p_invoice_id
    AND company_id = p_company_id
    AND version = p_expected_version
  RETURNING * INTO v_cancelled;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Invoice was modified by another user during cancellation';
  END IF;

  RETURN to_jsonb(v_cancelled);
END;
$$;

-- Authoritative Receipt cancellation. Receipt, allocation, journal reversal,
-- and terminal audit mutations all participate in this one PostgreSQL call.
CREATE FUNCTION public.cancel_receipt(
  p_receipt_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_cancel_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_cancelled public.receipts%ROWTYPE;
  v_je RECORD;
  v_reversal_count INTEGER := 0;
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );

  IF char_length(btrim(COALESCE(p_cancel_reason, ''))) < 10 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CANCEL: Cancel reason must be at least 10 characters';
  END IF;

  SELECT r.*
  INTO v_receipt
  FROM public.receipts r
  WHERE r.id = p_receipt_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Receipt not found';
  END IF;

  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_receipt.customer_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_receipt.customer_id
      AND c.company_id = p_company_id
      AND c.is_hidden = FALSE
      AND c.is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Customer not found';
  END IF;

  IF v_receipt.status <> 'Posted' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CANCEL: Only unallocated Posted receipts can be cancelled';
  END IF;

  IF v_receipt.allocated_amount <> 0
    OR v_receipt.unallocated_amount IS DISTINCT FROM v_receipt.receipt_amount
    OR EXISTS (
      SELECT 1
      FROM public.allocation_details ad
      WHERE ad.receipt_id = p_receipt_id
        AND ad.status = 'Active'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CANCEL-ALLOC: Receipt cannot be cancelled while active or unreversed allocations exist';
  END IF;

  -- A partially reversed Receipt journal set is an integrity failure, not a
  -- reason to commit a second partial cancellation.
  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    WHERE je.company_id = p_company_id
      AND je.source_doc_id = p_receipt_id
      AND je.source_type = 'RCT'
      AND je.is_reversal = FALSE
      AND je.is_reversed = TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CANCEL: Receipt journal evidence is already partially or fully reversed';
  END IF;

  -- A cleared cheque has both its posting and clearance RCT entries. Reverse
  -- every active original entry under lock before terminally cancelling it.
  FOR v_je IN
    SELECT je.id
    FROM public.journal_entries je
    WHERE je.company_id = p_company_id
      AND je.source_doc_id = p_receipt_id
      AND je.source_type = 'RCT'
      AND je.is_reversal = FALSE
      AND je.is_reversed = FALSE
    ORDER BY je.created_at, je.id
    FOR UPDATE
  LOOP
    PERFORM public.reverse_journal_entry(
      v_je.id,
      p_user_id,
      p_company_id,
      p_cancel_reason
    );
    v_reversal_count := v_reversal_count + 1;
  END LOOP;

  IF v_reversal_count = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CANCEL: Original receipt journal entry is unavailable for cancellation';
  END IF;

  UPDATE public.receipts
  SET status = 'Cancelled',
      allocated_amount = 0,
      unallocated_amount = 0,
      cancelled_by = p_user_id,
      cancelled_at = now(),
      cancel_reason = p_cancel_reason,
      version = v_receipt.version + 1
  WHERE id = p_receipt_id
    AND company_id = p_company_id
    AND status = 'Posted'
    AND version = v_receipt.version
  RETURNING * INTO v_cancelled;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Receipt was modified by another user during cancellation';
  END IF;

  RETURN to_jsonb(v_cancelled)
    || jsonb_build_object('reversals_created', v_reversal_count);
END;
$$;

-- Authoritative cheque clearance. The stage-two journal and value-date update
-- either commit together or roll back together under the Receipt row lock.
CREATE FUNCTION public.clear_receipt_cheque(
  p_receipt_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_clearance_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_updated public.receipts%ROWTYPE;
  v_bank public.bank_accounts%ROWTYPE;
  v_date DATE;
  v_period TEXT;
  v_cheque_account_id UUID;
  v_bank_account_id UUID;
  v_je_id UUID;
  v_original_je_id UUID;
  v_je_no TEXT;
  v_base_amount NUMERIC(18,2);
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );

  SELECT r.*
  INTO v_receipt
  FROM public.receipts r
  WHERE r.id = p_receipt_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Receipt not found';
  END IF;

  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_receipt.customer_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_receipt.customer_id
      AND c.company_id = p_company_id
      AND c.is_hidden = FALSE
      AND c.is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Customer not found';
  END IF;

  IF v_receipt.payment_method <> 'CHQ' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CHQ: Cheque clearance applies only to CHQ receipts';
  END IF;
  IF v_receipt.status NOT IN ('Posted', 'Fully Allocated') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CHQ: Cheque clearance requires an active posted receipt';
  END IF;

  SELECT je.id
  INTO v_original_je_id
  FROM public.journal_entries je
    WHERE je.company_id = p_company_id
      AND je.source_doc_id = p_receipt_id
      AND je.source_type = 'RCT'
      AND je.is_reversal = FALSE
      AND je.is_reversed = FALSE
      AND je.description NOT LIKE 'Cheque clearance:%'
  ORDER BY je.created_at, je.id
  LIMIT 1
  FOR UPDATE;

  IF v_original_je_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CHQ: Active receipt posting journal is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_entries je
    WHERE je.company_id = p_company_id
      AND je.source_doc_id = p_receipt_id
      AND je.source_type = 'RCT'
      AND je.is_reversal = FALSE
      AND je.description LIKE 'Cheque clearance:%'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-CHQ: Cheque clearance has already been recorded';
  END IF;

  SELECT b.*
  INTO v_bank
  FROM public.bank_accounts b
  WHERE b.id = v_receipt.bank_account_id
    AND b.company_id = p_company_id;

  IF NOT FOUND OR NOT v_bank.is_active OR v_bank.gl_account_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Bank account is missing or inactive for cheque clearance';
  END IF;

  v_date := COALESCE(p_clearance_date, CURRENT_DATE);
  v_period := to_char(v_date, 'YYYY-MM');

  IF NOT EXISTS (
    SELECT 1
    FROM public.fiscal_periods fp
    WHERE fp.company_id = p_company_id
      AND fp.period_code = v_period
      AND fp.status = 'Open'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format('BR-JE-007: Fiscal period %s is not open', v_period);
  END IF;

  v_cheque_account_id := public.rpc_get_config_account(
    p_company_id,
    'default_cheque_acct',
    '1050-001',
    'cheques on hand'
  );
  v_bank_account_id := v_bank.gl_account_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.gl_accounts ga
    WHERE ga.id = v_bank_account_id
      AND ga.company_id = p_company_id
      AND ga.is_active = TRUE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Bank GL account is missing or inactive for cheque clearance';
  END IF;

  v_je_no := public.get_next_sequence(p_company_id, 'JE', 'RCT');
  v_base_amount := ROUND(v_receipt.receipt_amount * v_receipt.exchange_rate, 2);

  INSERT INTO public.journal_entries (
    company_id,
    je_no,
    je_date,
    posting_period,
    source_type,
    source_doc_no,
    source_doc_id,
    description,
    currency,
    exchange_rate,
    base_currency,
    total_debit,
    total_credit,
    created_by
  ) VALUES (
    p_company_id,
    v_je_no,
    v_date,
    v_period,
    'RCT',
    v_receipt.receipt_no,
    p_receipt_id,
    format('Cheque clearance: %s - %s', v_receipt.receipt_no, v_receipt.customer_name),
    v_receipt.currency,
    v_receipt.exchange_rate,
    v_receipt.base_currency,
    v_receipt.receipt_amount,
    v_receipt.receipt_amount,
    p_user_id
  )
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (
    je_id,
    line_no,
    gl_account_id,
    description,
    debit_amount,
    credit_amount,
    base_debit,
    base_credit,
    currency,
    original_amount
  ) VALUES
    (
      v_je_id,
      10,
      v_bank_account_id,
      format('Bank cleared: %s', v_receipt.receipt_no),
      v_receipt.receipt_amount,
      0,
      v_base_amount,
      0,
      v_receipt.currency,
      v_receipt.receipt_amount
    ),
    (
      v_je_id,
      20,
      v_cheque_account_id,
      format('Cheques on Hand cleared: %s', v_receipt.receipt_no),
      0,
      v_receipt.receipt_amount,
      0,
      v_base_amount,
      v_receipt.currency,
      v_receipt.receipt_amount
    );

  UPDATE public.receipts
  SET value_date = v_date,
      version = v_receipt.version + 1
  WHERE id = p_receipt_id
    AND company_id = p_company_id
    AND status IN ('Posted', 'Fully Allocated')
    AND version = v_receipt.version
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Receipt was modified by another user during cheque clearance';
  END IF;

  RETURN to_jsonb(v_updated) || jsonb_build_object('je_no', v_je_no);
END;
$$;

-- BR-INV-001 permits a posted document's external reference to be corrected,
-- but the correction remains a governed and audited operation. Direct
-- service-role UPDATE is still rejected by the lifecycle trigger because
-- reference_no remains part of v_structural_change.
CREATE FUNCTION public.correct_posted_invoice_reference(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_reference_no TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_updated public.invoices%ROWTYPE;
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

  RETURN to_jsonb(v_updated);
END;
$$;

-- Draft deletion is a governed financial operation because every governed
-- Draft owns FX provenance rows whose restrictive foreign keys intentionally
-- prevent an application-level header DELETE. These functions lock and
-- revalidate the parent first, delete only Draft provenance, and then delete
-- the parent (and Invoice lines by the existing FK cascade) in one transaction.
CREATE FUNCTION public.delete_draft_invoice(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_prior_draft_delete TEXT;
  v_prior_fx_governed_mutation TEXT;
  v_bypass_enabled BOOLEAN := FALSE;
BEGIN
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
      MESSAGE = 'BR-DOC-DELETE: Only Draft financial documents may be deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.source_doc_id = p_invoice_id
  ) OR EXISTS (
    SELECT 1 FROM public.allocation_details ad
    WHERE ad.invoice_id = p_invoice_id
  ) OR EXISTS (
    SELECT 1 FROM public.cn_allocations ca
    WHERE ca.cn_id = p_invoice_id OR ca.invoice_id = p_invoice_id
  ) OR EXISTS (
    SELECT 1 FROM public.invoices linked
    WHERE linked.ref_invoice_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-DOC-DELETE: Financial evidence or relationships prevent document deletion';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.import_rows ir
    WHERE ir.invoice_id = p_invoice_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Imported Draft financial documents are retained as import audit evidence';
  END IF;

  v_prior_draft_delete := pg_catalog.current_setting('app.ar_draft_delete', TRUE);
  v_prior_fx_governed_mutation := pg_catalog.current_setting('app.fx_governed_mutation', TRUE);
  v_bypass_enabled := TRUE;
  PERFORM pg_catalog.set_config('app.ar_draft_delete', 'on', TRUE);
  PERFORM pg_catalog.set_config('app.fx_governed_mutation', 'on', TRUE);
  DELETE FROM public.fx_booking_rate_decision_events e
  WHERE e.invoice_id = p_invoice_id;
  UPDATE public.invoices
  SET fx_decision_id = NULL
  WHERE id = p_invoice_id;
  DELETE FROM public.fx_booking_rate_decisions d
  WHERE d.invoice_id = p_invoice_id;
  DELETE FROM public.invoices
  WHERE id = p_invoice_id
    AND company_id = p_company_id
    AND status = 'Draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Financial document changed during Draft deletion';
  END IF;

  PERFORM pg_catalog.set_config(
    'app.ar_draft_delete',
    COALESCE(NULLIF(v_prior_draft_delete, ''), 'off'),
    TRUE
  );
  PERFORM pg_catalog.set_config(
    'app.fx_governed_mutation',
    COALESCE(NULLIF(v_prior_fx_governed_mutation, ''), 'off'),
    TRUE
  );
  v_bypass_enabled := FALSE;
  RETURN jsonb_build_object('deleted', TRUE, 'id', p_invoice_id);
EXCEPTION
  WHEN OTHERS THEN
    IF v_bypass_enabled THEN
      PERFORM pg_catalog.set_config(
        'app.ar_draft_delete',
        COALESCE(NULLIF(v_prior_draft_delete, ''), 'off'),
        TRUE
      );
      PERFORM pg_catalog.set_config(
        'app.fx_governed_mutation',
        COALESCE(NULLIF(v_prior_fx_governed_mutation, ''), 'off'),
        TRUE
      );
    END IF;
    RAISE;
END;
$$;

CREATE FUNCTION public.delete_draft_receipt(
  p_receipt_id UUID,
  p_user_id UUID,
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_prior_draft_delete TEXT;
  v_prior_fx_governed_mutation TEXT;
  v_bypass_enabled BOOLEAN := FALSE;
BEGIN
  PERFORM public.rpc_check_role(
    p_user_id,
    p_company_id,
    ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
  );

  SELECT r.*
  INTO v_receipt
  FROM public.receipts r
  WHERE r.id = p_receipt_id
    AND r.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Receipt not found';
  END IF;
  PERFORM public.rpc_check_customer_access(
    p_user_id,
    p_company_id,
    v_receipt.customer_id
  );
  IF v_receipt.status <> 'Draft' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-DELETE: Only Draft receipts may be deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE je.source_doc_id = p_receipt_id
  ) OR EXISTS (
    SELECT 1 FROM public.allocation_details ad
    WHERE ad.receipt_id = p_receipt_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-RCT-DELETE: Financial evidence or allocations prevent receipt deletion';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.import_rows ir
    WHERE ir.receipt_id = p_receipt_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Imported Draft receipts are retained as import audit evidence';
  END IF;

  v_prior_draft_delete := pg_catalog.current_setting('app.ar_draft_delete', TRUE);
  v_prior_fx_governed_mutation := pg_catalog.current_setting('app.fx_governed_mutation', TRUE);
  v_bypass_enabled := TRUE;
  PERFORM pg_catalog.set_config('app.ar_draft_delete', 'on', TRUE);
  PERFORM pg_catalog.set_config('app.fx_governed_mutation', 'on', TRUE);
  DELETE FROM public.fx_booking_rate_decision_events e
  WHERE e.receipt_id = p_receipt_id;
  UPDATE public.receipts
  SET fx_decision_id = NULL
  WHERE id = p_receipt_id;
  DELETE FROM public.fx_booking_rate_decisions d
  WHERE d.receipt_id = p_receipt_id;
  DELETE FROM public.receipts
  WHERE id = p_receipt_id
    AND company_id = p_company_id
    AND status = 'Draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Receipt changed during Draft deletion';
  END IF;

  PERFORM pg_catalog.set_config(
    'app.ar_draft_delete',
    COALESCE(NULLIF(v_prior_draft_delete, ''), 'off'),
    TRUE
  );
  PERFORM pg_catalog.set_config(
    'app.fx_governed_mutation',
    COALESCE(NULLIF(v_prior_fx_governed_mutation, ''), 'off'),
    TRUE
  );
  v_bypass_enabled := FALSE;
  RETURN jsonb_build_object('deleted', TRUE, 'id', p_receipt_id);
EXCEPTION
  WHEN OTHERS THEN
    IF v_bypass_enabled THEN
      PERFORM pg_catalog.set_config(
        'app.ar_draft_delete',
        COALESCE(NULLIF(v_prior_draft_delete, ''), 'off'),
        TRUE
      );
      PERFORM pg_catalog.set_config(
        'app.fx_governed_mutation',
        COALESCE(NULLIF(v_prior_fx_governed_mutation, ''), 'off'),
        TRUE
      );
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference() FROM anon;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference() FROM service_role;

REVOKE ALL ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) FROM service_role;

REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference_reverse() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference_reverse() FROM anon;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference_reverse() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference_reverse() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_prevent_cancelled_document_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_prevent_cancelled_document_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.ar_prevent_cancelled_document_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_prevent_cancelled_document_mutation() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_enforce_receipt_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_enforce_receipt_lifecycle() FROM anon;
REVOKE ALL ON FUNCTION public.ar_enforce_receipt_lifecycle() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_enforce_receipt_lifecycle() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_enforce_invoice_line_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_enforce_invoice_line_lifecycle() FROM anon;
REVOKE ALL ON FUNCTION public.ar_enforce_invoice_line_lifecycle() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_enforce_invoice_line_lifecycle() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_recalculate_invoice_after_line_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_recalculate_invoice_after_line_change() FROM anon;
REVOKE ALL ON FUNCTION public.ar_recalculate_invoice_after_line_change() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_recalculate_invoice_after_line_change() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_allocation_detail() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_allocation_detail() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_allocation_detail() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_allocation_detail() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_cn_allocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_cn_allocation() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_cn_allocation() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_cn_allocation() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_journal_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_journal_entry_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry_line() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry_line() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_journal_entry_line() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision() FROM service_role;

REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision_event() FROM anon;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision_event() FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_protect_fx_booking_decision_event() FROM service_role;

REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM service_role;

REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) FROM authenticated;
REVOKE ALL ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) FROM service_role;
GRANT EXECUTE ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) FROM service_role;
GRANT EXECUTE ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.ar_validate_linked_credit_note_reference() IS
  'Batch 9D-D internal SECURITY INVOKER forward trigger. Locks the referenced Invoice FOR SHARE before enforcing type, tenant, customer, currency, status-at-link, and self-reference integrity.';

COMMENT ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) IS
  'Batch 9D-D internal governed-mutation helper. Enforces visible same-company customer scope plus active role/assignment without exposing hidden or cross-tenant customer existence.';

COMMENT ON FUNCTION public.ar_validate_linked_credit_note_reference_reverse() IS
  'Batch 9D-D internal SECURITY INVOKER reverse trigger. Rejects referenced-Invoice structural or lifecycle updates that would invalidate a non-cancelled Linked Credit Note.';

COMMENT ON FUNCTION public.ar_prevent_cancelled_document_mutation() IS
  'Batch 9D-D internal SECURITY INVOKER invoice-family lifecycle trigger. Enforces Draft-only creation/deletion, posted identity and valuation immutability, governed lifecycle/balance/audit mutation, and classification-independent terminal states.';

COMMENT ON FUNCTION public.ar_enforce_receipt_lifecycle() IS
  'Batch 9D-D internal SECURITY INVOKER Receipt lifecycle trigger. Enforces Draft-only creation/deletion, posted identity and valuation immutability, governed balances/audit transitions, and Cancelled/Bounced terminality.';

COMMENT ON FUNCTION public.ar_enforce_invoice_line_lifecycle() IS
  'Batch 9D-D internal SECURITY INVOKER line trigger. Requires an owner-executed governed mutation, locks the parent financial document FOR SHARE, and permits line mutation only while the parent is Draft.';

COMMENT ON FUNCTION public.ar_recalculate_invoice_after_line_change() IS
  'Batch 9D-D internal SECURITY INVOKER aggregate trigger. Recalculates the Draft Invoice header in the same transaction as every governed line mutation.';

COMMENT ON FUNCTION public.ar_protect_allocation_detail() IS
  'Batch 9D-D internal SECURITY INVOKER allocation-evidence trigger. Allows governed creation and Active-to-Reversed audit transition only; rejects direct mutation and deletion.';

COMMENT ON FUNCTION public.ar_protect_cn_allocation() IS
  'Batch 9D-D internal SECURITY INVOKER Credit Note allocation-evidence trigger. Allows governed creation and Active-to-Reversed audit transition only; rejects direct mutation and deletion.';

COMMENT ON FUNCTION public.ar_protect_journal_entry() IS
  'Batch 9D-D internal SECURITY INVOKER journal-evidence trigger. Allows governed creation and one reversal cross-reference update only; rejects direct mutation and deletion.';

COMMENT ON FUNCTION public.ar_protect_journal_entry_line() IS
  'Batch 9D-D internal SECURITY INVOKER journal-line trigger. Allows governed creation only and makes posted journal lines immutable.';

COMMENT ON FUNCTION public.ar_protect_fx_booking_decision() IS
  'Batch 9D-D internal SECURITY INVOKER FX-provenance trigger. Restricts decision mutation to governed owner-executed functions and binds new decision makers to active company/customer scope.';

COMMENT ON FUNCTION public.ar_protect_fx_booking_decision_event() IS
  'Batch 9D-D internal SECURITY INVOKER FX-event trigger. Allows governed append-only event creation and rejects routine direct mutation or deletion.';

COMMENT ON FUNCTION public.fx_prevent_booking_rate_event_mutation() IS
  'Batch 9D-D hardened existing append-only FX-event trigger. It permits deletion only inside a governed Draft aggregate deletion transaction and rejects every update or posted-event deletion.';

COMMENT ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) IS
  'Batch 9D-D governed service-role-only cancellation boundary. Atomically validates, reverses the original journal entry, and cancels an Invoice or Debit Note under one target-row lock.';

COMMENT ON FUNCTION public.cancel_receipt(UUID, UUID, UUID, TEXT) IS
  'Batch 9D-D governed service-role-only cancellation boundary. Atomically validates an unallocated Posted Receipt, reverses every active Receipt journal entry, and records terminal cancellation audit evidence.';

COMMENT ON FUNCTION public.clear_receipt_cheque(UUID, UUID, UUID, DATE) IS
  'Batch 9D-D governed service-role-only cheque-clearance boundary. Atomically creates the stage-two Bank/Cheques-on-Hand journal and records the Receipt value date.';

COMMENT ON FUNCTION public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT) IS
  'Batch 9D-D governed service-role-only BR-INV-001 posted reference_no correction with role, tenant, customer, row-lock, and immutable audit-log enforcement.';

COMMENT ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) IS
  'Batch 9D-D governed service-role-only Draft header update. Atomically applies established FX booking governance and the remaining editable Invoice-family header fields.';

COMMENT ON FUNCTION public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB) IS
  'Batch 9D-D governed service-role-only Draft line insertion boundary. Locks and authorizes the parent before atomically inserting lines and recalculating header totals.';

COMMENT ON FUNCTION public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB) IS
  'Batch 9D-D governed service-role-only Draft line update boundary. Locks and authorizes the parent before atomically updating one line and recalculating header totals.';

COMMENT ON FUNCTION public.delete_draft_invoice_line(UUID, UUID, UUID, UUID) IS
  'Batch 9D-D governed service-role-only Draft line deletion boundary. Locks and authorizes the parent before atomically deleting one line and recalculating header totals.';

COMMENT ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) IS
  'Batch 9D-D governed allocation reversal. Locks Receipt, allocation evidence, and Invoice in parent-first order before atomically restoring balances and reversing related adjustment journals.';

COMMENT ON FUNCTION public.delete_draft_invoice(UUID, UUID, UUID) IS
  'Batch 9D-D governed service-role-only Draft deletion. Atomically removes Draft-only FX provenance and the Invoice-family header/line aggregate after role, customer, lifecycle, and relationship checks.';

COMMENT ON FUNCTION public.delete_draft_receipt(UUID, UUID, UUID) IS
  'Batch 9D-D governed service-role-only Draft deletion. Atomically removes Draft-only FX provenance and the Receipt after role, customer, lifecycle, and relationship checks.';

COMMENT ON TRIGGER trg_ar_linked_credit_note_reference_forward ON public.invoices IS
  'Batch 9D-D authoritative forward validation for all trusted and future invoice-table write paths; performs no financial mutation.';

COMMENT ON TRIGGER trg_ar_linked_credit_note_reference_reverse ON public.invoices IS
  'Batch 9D-D authoritative reverse validation for referenced-Invoice structural and lifecycle updates; performs no financial mutation.';

COMMENT ON TRIGGER trg_ar_financial_document_lifecycle ON public.invoices IS
  'Batch 9D-D authoritative Invoice, Credit Note, and Debit Note lifecycle, immutability, insertion, and deletion boundary.';

COMMENT ON TRIGGER trg_ar_receipt_lifecycle ON public.receipts IS
  'Batch 9D-D authoritative Receipt lifecycle, immutability, insertion, and deletion boundary.';

COMMENT ON TRIGGER trg_ar_invoice_line_lifecycle ON public.invoice_lines IS
  'Batch 9D-D authoritative Draft-parent-only Invoice-line mutation boundary.';

COMMENT ON TRIGGER trg_ar_invoice_line_recalculate ON public.invoice_lines IS
  'Batch 9D-D authoritative same-transaction Invoice line-to-header aggregate consistency boundary.';

COMMENT ON TRIGGER trg_ar_allocation_detail_integrity ON public.allocation_details IS
  'Batch 9D-D authoritative Receipt allocation evidence boundary.';

COMMENT ON TRIGGER trg_ar_cn_allocation_integrity ON public.cn_allocations IS
  'Batch 9D-D authoritative Credit Note allocation evidence boundary.';

COMMENT ON TRIGGER trg_ar_journal_entry_integrity ON public.journal_entries IS
  'Batch 9D-D authoritative journal-header creation, reversal-link, and deletion boundary.';

COMMENT ON TRIGGER trg_ar_journal_entry_line_integrity ON public.journal_entry_lines IS
  'Batch 9D-D authoritative immutable journal-line boundary.';

COMMENT ON TRIGGER trg_ar_fx_booking_decision_integrity ON public.fx_booking_rate_decisions IS
  'Batch 9D-D authoritative governed-mutation and actor/customer boundary for FX booking decisions.';

COMMENT ON TRIGGER trg_ar_fx_booking_decision_event_integrity ON public.fx_booking_rate_decision_events IS
  'Batch 9D-D authoritative append-only governed-mutation boundary for FX booking decision events.';

COMMIT;
