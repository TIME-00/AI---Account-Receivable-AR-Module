-- Batch 9D-E1 F3-P4 production test-data reset operator (DO NOT RUN YET)
--
-- NOT A MIGRATION. This script is local implementation evidence only until a
-- separately authorized F3-P4 production data-mutation gate. It is deliberately
-- unusable through anon/authenticated/service_role and installs no function.
-- The future postgres session must set this non-secret authorization binding:
--   SET app.batch_9d_e1_f3_authorization =
--     'F3-P4:cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d';
-- before running the file. This file never disables triggers.

BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Reject an unapproved caller before acquiring any business-table lock.
DO $f3_authorization_guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'F3_RESET_ROLE: postgres-only execution required';
  END IF;
  IF current_setting('app.batch_9d_e1_f3_authorization', true) IS DISTINCT FROM
    'F3-P4:cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d' THEN
    RAISE EXCEPTION 'F3_RESET_AUTH: exact separately authorized manifest binding is absent';
  END IF;
END
$f3_authorization_guard$;

-- Fence application writers in one documented order before row locks/hashing.
LOCK TABLE public.allocation_details IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.cn_allocations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.customer_bank_details IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.customers IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.import_batches IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.import_files IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.import_row_allocations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.import_rows IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.invoice_lines IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.invoices IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.journal_entries IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.journal_entry_lines IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.ocr_review_decisions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.receipts IN SHARE ROW EXCLUSIVE MODE;

DO $f3_reset$
DECLARE
  c_company constant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  c_delete_hash constant text := 'cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d';
  c_retain_hash constant text := '36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0';
  c_authorization constant text := 'F3-P4:' || c_delete_hash;

  v_delete_hash text;
  v_retain_hash text;
  v_delete_count bigint;
  v_retain_count bigint;
  v_protected_before text;
  v_protected_after text;
  v_after_hash text;
  v_after_count bigint;
  v_storage_delete_hash text;
  v_rows bigint;

  v_del_allocations uuid[];
  v_del_cn_allocations uuid[];
  v_del_customer_bank_details uuid[];
  v_del_customers uuid[];
  v_del_import_batches uuid[];
  v_del_import_files uuid[];
  v_del_import_row_allocations uuid[];
  v_del_import_rows uuid[];
  v_del_invoice_lines uuid[];
  v_del_invoices uuid[];
  v_del_journal_entries uuid[];
  v_del_journal_entry_lines uuid[];
  v_del_ocr_decisions uuid[];
  v_del_receipts uuid[];
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'F3_RESET_ROLE: postgres-only execution required';
  END IF;
  IF current_setting('app.batch_9d_e1_f3_authorization', true) IS DISTINCT FROM c_authorization THEN
    RAISE EXCEPTION 'F3_RESET_AUTH: exact separately authorized manifest binding is absent';
  END IF;
  IF (SELECT count(*) FROM public.companies WHERE id = c_company) <> 1 THEN
    RAISE EXCEPTION 'F3_RESET_COMPANY: exact company precondition failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname IN (
        'trg_ar_financial_document_lifecycle', 'trg_ar_receipt_lifecycle',
        'trg_ar_allocation_detail_integrity', 'trg_ar_journal_entry_integrity'
      )
  ) THEN
    RAISE EXCEPTION 'F3_RESET_LIFECYCLE: target lifecycle is installed; STOP and request F3-P3S review';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name IN (
        'customers', 'invoices', 'receipts', 'allocation_details',
        'journal_entries', 'import_batches', 'import_rows', 'import_files'
      )
      AND tc.table_name NOT IN (
        'allocation_details', 'cn_allocations', 'credit_control_logs',
        'customer_bank_details', 'customer_change_logs', 'customers',
        'import_batches', 'import_files', 'import_row_allocations', 'import_rows',
        'invoice_lines', 'invoices', 'journal_entries', 'journal_entry_lines',
        'ocr_review_decisions', 'receipts', 'report_audit_logs',
        'user_customer_assignments'
      )
  ) THEN
    RAISE EXCEPTION 'F3_RESET_UNCLASSIFIED: unknown dependent relation requires review';
  END IF;

  -- Deterministic row locking supplements the table writer fence and keeps the
  -- exact manifest stable throughout the short transaction.
  PERFORM id FROM public.customers WHERE company_id = c_company ORDER BY id FOR UPDATE;
  PERFORM id FROM public.invoices WHERE company_id = c_company ORDER BY id FOR UPDATE;
  PERFORM id FROM public.receipts WHERE company_id = c_company ORDER BY id FOR UPDATE;
  PERFORM a.id FROM public.allocation_details a JOIN public.invoices i ON i.id = a.invoice_id WHERE i.company_id = c_company ORDER BY a.id FOR UPDATE OF a;
  PERFORM j.id FROM public.journal_entries j WHERE j.company_id = c_company ORDER BY j.id FOR UPDATE;
  PERFORM b.id FROM public.import_batches b WHERE b.company_id = c_company ORDER BY b.id FOR UPDATE;

  SELECT encode(extensions.digest(string_agg(kind || '|' || id::text || '|' || row_hash, E'\n' ORDER BY kind, id), 'sha256'), 'hex')
  INTO v_protected_before
  FROM (
    SELECT 'companies'::text kind, c.id, encode(extensions.digest(to_jsonb(c)::text, 'sha256'), 'hex') row_hash FROM public.companies c WHERE c.id = c_company
    UNION ALL SELECT 'user_roles', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.user_roles x WHERE x.company_id = c_company
    UNION ALL SELECT 'user_customer_assignments', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.user_customer_assignments x WHERE x.company_id = c_company
    UNION ALL SELECT 'customer_change_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.customer_change_logs x JOIN public.customers c ON c.id = x.customer_id WHERE c.company_id = c_company
    UNION ALL SELECT 'credit_control_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.credit_control_logs x WHERE x.company_id = c_company
    UNION ALL SELECT 'report_audit_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.report_audit_logs x WHERE x.company_id = c_company
  ) protected;

  WITH RECURSIVE
  anchors(id) AS (
    VALUES
      ('b7097325-6e14-4288-8171-55b0af187ae8'::uuid), ('6ac68a15-dae9-4d95-ab7c-dc4ab38e650e'::uuid),
      ('57273041-908e-442e-8977-1b548665d845'::uuid), ('9b33ead3-160c-4733-8bde-65ae204e1142'::uuid),
      ('fc67fb76-1322-438a-8840-1947b9fde1ed'::uuid), ('1540a837-73a3-4b07-9985-899cb003046b'::uuid),
      ('b6fe5267-4e30-402f-bdd1-c2220359ab63'::uuid), ('d4a36e03-0e8f-465a-b0de-192394dbe67f'::uuid),
      ('0abf3fcf-18c2-4528-8a87-199e663fcf03'::uuid), ('921dc726-06db-4609-814e-9fba0d93a907'::uuid)
  ),
  graph(kind, id) AS (
    SELECT 'invoices'::text, id FROM anchors
    UNION
    SELECT e.kind, e.id
    FROM graph g
    CROSS JOIN LATERAL (
      SELECT 'customers'::text kind, i.customer_id id FROM public.invoices i WHERE g.kind = 'invoices' AND i.id = g.id
      UNION ALL SELECT 'invoices', i.ref_invoice_id FROM public.invoices i WHERE g.kind = 'invoices' AND i.id = g.id AND i.ref_invoice_id IS NOT NULL
      UNION ALL SELECT 'invoices', i.id FROM public.invoices i WHERE g.kind = 'invoices' AND i.ref_invoice_id = g.id
      UNION ALL SELECT 'invoice_lines', x.id FROM public.invoice_lines x WHERE g.kind = 'invoices' AND x.invoice_id = g.id
      UNION ALL SELECT 'allocation_details', x.id FROM public.allocation_details x WHERE g.kind = 'invoices' AND x.invoice_id = g.id
      UNION ALL SELECT 'cn_allocations', x.id FROM public.cn_allocations x WHERE g.kind = 'invoices' AND (x.invoice_id = g.id OR x.cn_id = g.id)
      UNION ALL SELECT 'journal_entries', x.id FROM public.journal_entries x WHERE g.kind = 'invoices' AND x.source_doc_id = g.id
      UNION ALL SELECT 'import_rows', x.id FROM public.import_rows x WHERE g.kind = 'invoices' AND x.invoice_id = g.id
      UNION ALL SELECT 'customers', x.customer_id FROM public.receipts x WHERE g.kind = 'receipts' AND x.id = g.id
      UNION ALL SELECT 'allocation_details', x.id FROM public.allocation_details x WHERE g.kind = 'receipts' AND x.receipt_id = g.id
      UNION ALL SELECT 'journal_entries', x.id FROM public.journal_entries x WHERE g.kind = 'receipts' AND x.source_doc_id = g.id
      UNION ALL SELECT 'import_rows', x.id FROM public.import_rows x WHERE g.kind = 'receipts' AND x.receipt_id = g.id
      UNION ALL SELECT 'invoices', x.invoice_id FROM public.allocation_details x WHERE g.kind = 'allocation_details' AND x.id = g.id
      UNION ALL SELECT 'receipts', x.receipt_id FROM public.allocation_details x WHERE g.kind = 'allocation_details' AND x.id = g.id
      UNION ALL SELECT 'import_row_allocations', x.id FROM public.import_row_allocations x WHERE g.kind = 'allocation_details' AND x.allocation_id = g.id
      UNION ALL SELECT 'invoices', x.invoice_id FROM public.cn_allocations x WHERE g.kind = 'cn_allocations' AND x.id = g.id
      UNION ALL SELECT 'invoices', x.cn_id FROM public.cn_allocations x WHERE g.kind = 'cn_allocations' AND x.id = g.id
      UNION ALL SELECT 'journal_entry_lines', x.id FROM public.journal_entry_lines x WHERE g.kind = 'journal_entries' AND x.je_id = g.id
      UNION ALL SELECT 'journal_entries', x.original_je_id FROM public.journal_entries x WHERE g.kind = 'journal_entries' AND x.id = g.id AND x.original_je_id IS NOT NULL
      UNION ALL SELECT 'journal_entries', x.reversal_je_id FROM public.journal_entries x WHERE g.kind = 'journal_entries' AND x.id = g.id AND x.reversal_je_id IS NOT NULL
      UNION ALL SELECT 'journal_entries', x.id FROM public.journal_entries x WHERE g.kind = 'journal_entries' AND (x.original_je_id = g.id OR x.reversal_je_id = g.id)
      UNION ALL SELECT 'invoices', i.id FROM public.journal_entries j JOIN public.invoices i ON i.id = j.source_doc_id WHERE g.kind = 'journal_entries' AND j.id = g.id
      UNION ALL SELECT 'receipts', r.id FROM public.journal_entries j JOIN public.receipts r ON r.id = j.source_doc_id WHERE g.kind = 'journal_entries' AND j.id = g.id
      UNION ALL SELECT 'import_batches', x.batch_id FROM public.import_rows x WHERE g.kind = 'import_rows' AND x.id = g.id
      UNION ALL SELECT 'import_rows', x.duplicate_of FROM public.import_rows x WHERE g.kind = 'import_rows' AND x.id = g.id AND x.duplicate_of IS NOT NULL
      UNION ALL SELECT 'import_rows', x.id FROM public.import_rows x WHERE g.kind = 'import_rows' AND x.duplicate_of = g.id
      UNION ALL SELECT 'invoices', x.invoice_id FROM public.import_rows x WHERE g.kind = 'import_rows' AND x.id = g.id AND x.invoice_id IS NOT NULL
      UNION ALL SELECT 'receipts', x.receipt_id FROM public.import_rows x WHERE g.kind = 'import_rows' AND x.id = g.id AND x.receipt_id IS NOT NULL
      UNION ALL SELECT 'import_row_allocations', x.id FROM public.import_row_allocations x WHERE g.kind = 'import_rows' AND x.import_row_id = g.id
      UNION ALL SELECT 'ocr_review_decisions', x.id FROM public.ocr_review_decisions x WHERE g.kind = 'import_rows' AND x.row_id = g.id
      UNION ALL SELECT 'import_rows', x.id FROM public.import_rows x WHERE g.kind = 'import_batches' AND x.batch_id = g.id
      UNION ALL SELECT 'import_files', x.id FROM public.import_files x WHERE g.kind = 'import_batches' AND x.batch_id = g.id
      UNION ALL SELECT 'ocr_review_decisions', x.id FROM public.ocr_review_decisions x WHERE g.kind = 'import_batches' AND x.batch_id = g.id
      UNION ALL SELECT 'import_batches', x.batch_id FROM public.import_files x WHERE g.kind = 'import_files' AND x.id = g.id
      UNION ALL SELECT 'ocr_review_decisions', x.id FROM public.ocr_review_decisions x WHERE g.kind = 'import_files' AND x.file_id = g.id
      UNION ALL SELECT 'import_rows', x.import_row_id FROM public.import_row_allocations x WHERE g.kind = 'import_row_allocations' AND x.id = g.id
      UNION ALL SELECT 'allocation_details', x.allocation_id FROM public.import_row_allocations x WHERE g.kind = 'import_row_allocations' AND x.id = g.id
      UNION ALL SELECT 'invoices', x.invoice_id FROM public.import_row_allocations x WHERE g.kind = 'import_row_allocations' AND x.id = g.id
      UNION ALL SELECT 'import_batches', x.batch_id FROM public.ocr_review_decisions x WHERE g.kind = 'ocr_review_decisions' AND x.id = g.id
      UNION ALL SELECT 'import_rows', x.row_id FROM public.ocr_review_decisions x WHERE g.kind = 'ocr_review_decisions' AND x.id = g.id
      UNION ALL SELECT 'import_files', x.file_id FROM public.ocr_review_decisions x WHERE g.kind = 'ocr_review_decisions' AND x.id = g.id AND x.file_id IS NOT NULL
      UNION ALL SELECT 'customers', x.parent_id FROM public.customers x WHERE g.kind = 'customers' AND x.id = g.id AND x.parent_id IS NOT NULL
      UNION ALL SELECT 'customer_bank_details', x.id FROM public.customer_bank_details x WHERE g.kind = 'customers' AND x.customer_id = g.id
    ) e
    WHERE e.id IS NOT NULL
  ),
  protected_customer_graph(id) AS (
    SELECT DISTINCT c.id FROM public.customers c
    WHERE c.company_id = c_company
      AND (
        EXISTS (SELECT 1 FROM public.user_customer_assignments x WHERE x.customer_id = c.id)
        OR EXISTS (SELECT 1 FROM public.customer_change_logs x WHERE x.customer_id = c.id)
        OR EXISTS (SELECT 1 FROM public.credit_control_logs x WHERE x.customer_id = c.id)
      )
    UNION
    SELECT c.parent_id
    FROM public.customers c
    JOIN protected_customer_graph p ON p.id = c.id
    WHERE c.parent_id IS NOT NULL
  ),
  protected_customers AS (
    SELECT DISTINCT id FROM protected_customer_graph
  ),
  retained(kind, id) AS (
    SELECT kind, id FROM graph
    UNION SELECT 'customers', id FROM protected_customers
    UNION SELECT 'customer_bank_details', x.id FROM public.customer_bank_details x JOIN protected_customers c ON c.id = x.customer_id
  ),
  payloads(kind, id, payload, amount_1, amount_2, amount_3) AS (
    SELECT 'customers', x.id, to_jsonb(x), 0::numeric, 0::numeric, 0::numeric FROM public.customers x WHERE x.company_id = c_company
    UNION ALL SELECT 'customer_bank_details', x.id, to_jsonb(x), 0, 0, 0 FROM public.customer_bank_details x JOIN public.customers c ON c.id = x.customer_id WHERE c.company_id = c_company
    UNION ALL SELECT 'invoices', x.id, to_jsonb(x), x.total_amount, x.outstanding, x.base_total FROM public.invoices x WHERE x.company_id = c_company
    UNION ALL SELECT 'invoice_lines', x.id, to_jsonb(x), x.line_amount, x.tax_amount, x.line_total FROM public.invoice_lines x JOIN public.invoices i ON i.id = x.invoice_id WHERE i.company_id = c_company
    UNION ALL SELECT 'receipts', x.id, to_jsonb(x), x.receipt_amount, x.allocated_amount, x.unallocated_amount FROM public.receipts x WHERE x.company_id = c_company
    UNION ALL SELECT 'allocation_details', x.id, to_jsonb(x), x.allocated_amount, x.discount_amount, x.base_allocated FROM public.allocation_details x JOIN public.invoices i ON i.id = x.invoice_id WHERE i.company_id = c_company
    UNION ALL SELECT 'cn_allocations', x.id, to_jsonb(x), x.allocated_amount, 0, 0 FROM public.cn_allocations x JOIN public.invoices i ON i.id = x.invoice_id WHERE i.company_id = c_company
    UNION ALL SELECT 'journal_entries', x.id, to_jsonb(x), x.total_debit, x.total_credit, 0 FROM public.journal_entries x WHERE x.company_id = c_company
    UNION ALL SELECT 'journal_entry_lines', x.id, to_jsonb(x), x.debit_amount, x.credit_amount, x.original_amount FROM public.journal_entry_lines x JOIN public.journal_entries j ON j.id = x.je_id WHERE j.company_id = c_company
    UNION ALL SELECT 'import_batches', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_batches x WHERE x.company_id = c_company
    UNION ALL SELECT 'import_files', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_files x JOIN public.import_batches b ON b.id = x.batch_id WHERE b.company_id = c_company
    UNION ALL SELECT 'import_rows', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_rows x JOIN public.import_batches b ON b.id = x.batch_id WHERE b.company_id = c_company
    UNION ALL SELECT 'import_row_allocations', x.id, to_jsonb(x), x.allocated_amount, 0, 0 FROM public.import_row_allocations x JOIN public.import_rows r ON r.id = x.import_row_id JOIN public.import_batches b ON b.id = r.batch_id WHERE b.company_id = c_company
    UNION ALL SELECT 'ocr_review_decisions', x.id, to_jsonb(x), 0, 0, 0 FROM public.ocr_review_decisions x WHERE x.company_id = c_company
  ),
  classified AS (
    SELECT CASE WHEN r.id IS NULL THEN 'delete' ELSE 'retain' END disposition, p.*
    FROM payloads p LEFT JOIN retained r ON r.kind = p.kind AND r.id = p.id
  )
  SELECT
    (SELECT encode(extensions.digest(string_agg(kind || '|' || id::text || '|' || encode(extensions.digest(payload::text, 'sha256'), 'hex'), E'\n' ORDER BY kind, id), 'sha256'), 'hex') FROM classified WHERE disposition = 'delete'),
    (SELECT encode(extensions.digest(string_agg(kind || '|' || id::text || '|' || encode(extensions.digest(payload::text, 'sha256'), 'hex'), E'\n' ORDER BY kind, id), 'sha256'), 'hex') FROM classified WHERE disposition = 'retain'),
    count(*) FILTER (WHERE disposition = 'delete'),
    count(*) FILTER (WHERE disposition = 'retain'),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'allocation_details'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'cn_allocations'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'customer_bank_details'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'customers'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'import_batches'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'import_files'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'import_row_allocations'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'import_rows'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'invoice_lines'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'invoices'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'journal_entries'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'journal_entry_lines'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'ocr_review_decisions'), '{}'::uuid[]),
    coalesce(array_agg(id ORDER BY id) FILTER (WHERE disposition = 'delete' AND kind = 'receipts'), '{}'::uuid[])
  INTO
    v_delete_hash, v_retain_hash, v_delete_count, v_retain_count,
    v_del_allocations, v_del_cn_allocations, v_del_customer_bank_details, v_del_customers,
    v_del_import_batches, v_del_import_files, v_del_import_row_allocations, v_del_import_rows,
    v_del_invoice_lines, v_del_invoices, v_del_journal_entries, v_del_journal_entry_lines,
    v_del_ocr_decisions, v_del_receipts
  FROM classified;

  IF v_delete_count = 0 AND v_retain_count = 179 AND v_retain_hash = c_retain_hash THEN
    RAISE NOTICE 'F3_RESET_ALREADY_APPLIED retention_hash=%', c_retain_hash;
    RETURN;
  END IF;
  IF v_delete_count <> 2651 OR v_retain_count <> 179 OR v_delete_hash <> c_delete_hash OR v_retain_hash <> c_retain_hash THEN
    RAISE EXCEPTION 'F3_RESET_DRIFT: full manifest mismatch';
  END IF;
  IF cardinality(v_del_allocations) <> 13 OR cardinality(v_del_cn_allocations) <> 0
    OR cardinality(v_del_customer_bank_details) <> 0 OR cardinality(v_del_customers) <> 897
    OR cardinality(v_del_import_batches) <> 63 OR cardinality(v_del_import_files) <> 63
    OR cardinality(v_del_import_row_allocations) <> 3 OR cardinality(v_del_import_rows) <> 139
    OR cardinality(v_del_invoice_lines) <> 61 OR cardinality(v_del_invoices) <> 1112
    OR cardinality(v_del_journal_entries) <> 87 OR cardinality(v_del_journal_entry_lines) <> 174
    OR cardinality(v_del_ocr_decisions) <> 10 OR cardinality(v_del_receipts) <> 29 THEN
    RAISE EXCEPTION 'F3_RESET_DRIFT: per-table count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
      WHERE i.id = ANY(v_del_invoices) AND c.customer_id LIKE 'C-MESSY%'
        AND i.doc_type = 'Invoice' AND i.status = 'Paid' AND i.version = 1
        AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)) <> 128
    OR (SELECT coalesce(sum(i.total_amount), 0)::numeric(30,2)
        FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
        WHERE i.id = ANY(v_del_invoices) AND c.customer_id LIKE 'C-MESSY%'
          AND i.doc_type = 'Invoice' AND i.status = 'Paid' AND i.version = 1
          AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)) <> 2681703.31::numeric(30,2)
    OR (SELECT coalesce(sum(i.outstanding), 0)::numeric(30,2)
        FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
        WHERE i.id = ANY(v_del_invoices) AND c.customer_id LIKE 'C-MESSY%'
          AND i.doc_type = 'Invoice' AND i.status = 'Paid' AND i.version = 1
          AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)) <> 0.00::numeric(30,2) THEN
    RAISE EXCEPTION 'F3_RESET_TARGET: defective Paid cohort mismatch';
  END IF;
  IF (SELECT count(*) FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
      WHERE i.id = ANY(v_del_invoices)
        AND i.doc_type = 'Invoice' AND i.status = 'Open' AND i.version = 1
        AND (c.customer_id LIKE 'C-MESSY%' OR c.customer_id LIKE 'C-2026%')
        AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)) <> 922
    OR (SELECT coalesce(sum(i.total_amount), 0)::numeric(30,2)
        FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
        WHERE i.id = ANY(v_del_invoices)
          AND i.doc_type = 'Invoice' AND i.status = 'Open' AND i.version = 1
          AND (c.customer_id LIKE 'C-MESSY%' OR c.customer_id LIKE 'C-2026%')
          AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
          AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)) <> 18235664.61::numeric(30,2) THEN
    RAISE EXCEPTION 'F3_RESET_TARGET: header-only Open cohort mismatch';
  END IF;

  SELECT encode(extensions.digest(
      string_agg(so.bucket_id || '|' || so.name, E'\n' ORDER BY so.bucket_id, so.name),
      'sha256'), 'hex')
  INTO v_storage_delete_hash
  FROM public.import_files f
  JOIN storage.objects so
    ON so.name = f.file_path OR so.name = regexp_replace(f.file_path, '^/+', '')
  WHERE f.id = ANY(v_del_import_files);
  IF (SELECT count(*) FROM public.import_files f
      JOIN storage.objects so
        ON so.name = f.file_path OR so.name = regexp_replace(f.file_path, '^/+', '')
      WHERE f.id = ANY(v_del_import_files)) <> 63
    OR v_storage_delete_hash <> 'f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094' THEN
    RAISE EXCEPTION 'F3_RESET_STORAGE: exact object manifest drift';
  END IF;

  -- Exact-ID deletion only. No status/prefix/date predicate controls mutation.
  DELETE FROM public.ocr_review_decisions WHERE id = ANY(v_del_ocr_decisions);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_ocr_decisions) THEN RAISE EXCEPTION 'F3_RESET_COUNT: ocr_review_decisions'; END IF;
  DELETE FROM public.import_row_allocations WHERE id = ANY(v_del_import_row_allocations);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_import_row_allocations) THEN RAISE EXCEPTION 'F3_RESET_COUNT: import_row_allocations'; END IF;
  DELETE FROM public.import_rows WHERE id = ANY(v_del_import_rows);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_import_rows) THEN RAISE EXCEPTION 'F3_RESET_COUNT: import_rows'; END IF;
  DELETE FROM public.import_files WHERE id = ANY(v_del_import_files);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_import_files) THEN RAISE EXCEPTION 'F3_RESET_COUNT: import_files'; END IF;
  DELETE FROM public.import_batches WHERE id = ANY(v_del_import_batches);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_import_batches) THEN RAISE EXCEPTION 'F3_RESET_COUNT: import_batches'; END IF;
  DELETE FROM public.allocation_details WHERE id = ANY(v_del_allocations);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_allocations) THEN RAISE EXCEPTION 'F3_RESET_COUNT: allocation_details'; END IF;
  DELETE FROM public.cn_allocations WHERE id = ANY(v_del_cn_allocations);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_cn_allocations) THEN RAISE EXCEPTION 'F3_RESET_COUNT: cn_allocations'; END IF;
  DELETE FROM public.journal_entry_lines WHERE id = ANY(v_del_journal_entry_lines);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_journal_entry_lines) THEN RAISE EXCEPTION 'F3_RESET_COUNT: journal_entry_lines'; END IF;
  DELETE FROM public.journal_entries WHERE id = ANY(v_del_journal_entries);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_journal_entries) THEN RAISE EXCEPTION 'F3_RESET_COUNT: journal_entries'; END IF;
  DELETE FROM public.invoice_lines WHERE id = ANY(v_del_invoice_lines);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_invoice_lines) THEN RAISE EXCEPTION 'F3_RESET_COUNT: invoice_lines'; END IF;
  DELETE FROM public.receipts WHERE id = ANY(v_del_receipts);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_receipts) THEN RAISE EXCEPTION 'F3_RESET_COUNT: receipts'; END IF;
  DELETE FROM public.invoices WHERE id = ANY(v_del_invoices);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_invoices) THEN RAISE EXCEPTION 'F3_RESET_COUNT: invoices'; END IF;
  DELETE FROM public.customer_bank_details WHERE id = ANY(v_del_customer_bank_details);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_customer_bank_details) THEN RAISE EXCEPTION 'F3_RESET_COUNT: customer_bank_details'; END IF;
  DELETE FROM public.customers WHERE id = ANY(v_del_customers);
  GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows <> cardinality(v_del_customers) THEN RAISE EXCEPTION 'F3_RESET_COUNT: customers'; END IF;

  -- No retained financial row may violate its lifecycle-applicable equation.
  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.company_id = c_company AND i.status IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
      AND i.total_amount
        - coalesce((SELECT sum(a.allocated_amount + a.discount_amount) FROM public.allocation_details a WHERE a.invoice_id = i.id AND a.status = 'Active'), 0::numeric)
        - coalesce((SELECT sum(ca.allocated_amount) FROM public.cn_allocations ca WHERE ca.invoice_id = i.id AND ca.status = 'Active'), 0::numeric)
        <> i.outstanding
  ) THEN
    RAISE EXCEPTION 'F3_RESET_POSTCONDITION: retained settlement equation mismatch';
  END IF;
  IF (SELECT count(*) FROM public.invoices WHERE company_id = c_company) <> 16
    OR (SELECT count(*) FROM public.receipts WHERE company_id = c_company) <> 11
    OR (SELECT count(*) FROM public.customers WHERE company_id = c_company) <> 11 THEN
    RAISE EXCEPTION 'F3_RESET_POSTCONDITION: expected after-state counts failed';
  END IF;

  SELECT encode(extensions.digest(string_agg(kind || '|' || id::text || '|' || row_hash, E'\n' ORDER BY kind, id), 'sha256'), 'hex'), count(*)
  INTO v_after_hash, v_after_count
  FROM (
    SELECT 'customers'::text kind, x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') row_hash FROM public.customers x WHERE x.company_id = c_company
    UNION ALL SELECT 'invoices', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.invoices x WHERE x.company_id = c_company
    UNION ALL SELECT 'invoice_lines', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.invoice_lines x JOIN public.invoices i ON i.id = x.invoice_id WHERE i.company_id = c_company
    UNION ALL SELECT 'receipts', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.receipts x WHERE x.company_id = c_company
    UNION ALL SELECT 'allocation_details', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.allocation_details x JOIN public.invoices i ON i.id = x.invoice_id WHERE i.company_id = c_company
    UNION ALL SELECT 'journal_entries', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.journal_entries x WHERE x.company_id = c_company
    UNION ALL SELECT 'journal_entry_lines', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.journal_entry_lines x JOIN public.journal_entries j ON j.id = x.je_id WHERE j.company_id = c_company
    UNION ALL SELECT 'import_batches', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.import_batches x WHERE x.company_id = c_company
    UNION ALL SELECT 'import_files', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.import_files x JOIN public.import_batches b ON b.id = x.batch_id WHERE b.company_id = c_company
    UNION ALL SELECT 'import_rows', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.import_rows x JOIN public.import_batches b ON b.id = x.batch_id WHERE b.company_id = c_company
    UNION ALL SELECT 'import_row_allocations', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.import_row_allocations x JOIN public.import_rows r ON r.id = x.import_row_id JOIN public.import_batches b ON b.id = r.batch_id WHERE b.company_id = c_company
  ) after_rows;
  IF v_after_count <> 179 OR v_after_hash <> c_retain_hash THEN
    RAISE EXCEPTION 'F3_RESET_POSTCONDITION: retained manifest hash mismatch';
  END IF;

  SELECT encode(extensions.digest(string_agg(kind || '|' || id::text || '|' || row_hash, E'\n' ORDER BY kind, id), 'sha256'), 'hex')
  INTO v_protected_after
  FROM (
    SELECT 'companies'::text kind, c.id, encode(extensions.digest(to_jsonb(c)::text, 'sha256'), 'hex') row_hash FROM public.companies c WHERE c.id = c_company
    UNION ALL SELECT 'user_roles', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.user_roles x WHERE x.company_id = c_company
    UNION ALL SELECT 'user_customer_assignments', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.user_customer_assignments x WHERE x.company_id = c_company
    UNION ALL SELECT 'customer_change_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.customer_change_logs x JOIN public.customers c ON c.id = x.customer_id WHERE c.company_id = c_company
    UNION ALL SELECT 'credit_control_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.credit_control_logs x WHERE x.company_id = c_company
    UNION ALL SELECT 'report_audit_logs', x.id, encode(extensions.digest(to_jsonb(x)::text, 'sha256'), 'hex') FROM public.report_audit_logs x WHERE x.company_id = c_company
  ) protected;
  IF v_protected_after IS DISTINCT FROM v_protected_before THEN
    RAISE EXCEPTION 'F3_RESET_PROTECTED: identity/company/audit fingerprint changed';
  END IF;

  RAISE NOTICE 'F3_RESET_DATABASE_PHASE_OK delete_hash=% retain_hash=%', c_delete_hash, c_retain_hash;
  RAISE NOTICE 'F3_RESET_STORAGE_PHASE_REQUIRED count=63 object_hash=f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094';
END
$f3_reset$;

-- COMMIT is intentionally explicit. A future authorized executor must capture
-- the notices and run the separately bounded, exact-hash Storage object phase.
COMMIT;
