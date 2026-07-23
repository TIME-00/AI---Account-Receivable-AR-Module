-- Batch 9D-E1 F3-P2/P3 production test-data reset manifest (DRY RUN ONLY)
--
-- This file is intentionally not a numbered migration. It performs no writes,
-- creates no objects, and always ends with ROLLBACK. It is pinned to the one
-- owner-attested production demo company and ten reviewed principal anchors.
-- Financial values remain PostgreSQL NUMERIC; row-state hashes use canonical
-- jsonb text inside PostgreSQL and never expose row payloads.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

WITH RECURSIVE
constants AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS company_id,
    10::bigint AS principal_count,
    179::bigint AS retained_row_count,
    '36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0'::text AS retained_hash,
    2651::bigint AS deletion_row_count,
    'cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d'::text AS deletion_hash,
    128::bigint AS defective_paid_count,
    2681703.31::numeric(30,2) AS defective_paid_total,
    922::bigint AS header_open_count,
    18235664.61::numeric(30,2) AS header_open_total,
    63::bigint AS delete_storage_object_count,
    'f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094'::text AS delete_storage_object_hash,
    6::bigint AS retain_storage_object_count,
    'b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620'::text AS retain_storage_object_hash
),
expected_scenarios(sequence_no, anchor_id, label, expected_hash) AS (
  VALUES
    (1, 'b7097325-6e14-4288-8171-55b0af187ae8'::uuid, 'paid-allocation-reversal', '1d9c602245c10d006032e6b0721983e1b6975ca126ffca19eeb574269641b149'),
    (2, '6ac68a15-dae9-4d95-ab7c-dc4ab38e650e'::uuid, 'partially-paid-debit-note', '3029237017e110f2c8422fbfd2e24bf87fad954c2df85be97cd0eeacf5b7e6eb'),
    (3, '57273041-908e-442e-8977-1b548665d845'::uuid, 'overdue-receipt-allocation', '41e87859d35576d47d3afa6670408ea091ffd80b3297e7bb68a77ea208d63eb7'),
    (4, '9b33ead3-160c-4733-8bde-65ae204e1142'::uuid, 'paid-sgd-multi-receipt', 'fd72933686cfcf33c1f0b0fa053a3402604c30684c109c796a6824e198977c27'),
    (5, 'fc67fb76-1322-438a-8840-1947b9fde1ed'::uuid, 'open-eur-fx', '6f1098e94abab7b76ad4d16f72748adbec93258003064b59f0376c0968bc34b7'),
    (6, '1540a837-73a3-4b07-9985-899cb003046b'::uuid, 'open-sgd-import', '36b3655f0b3469d269706b6d3a4cc7ce9f5ac3c88e37241d4d5ceabf3c2bc32b'),
    (7, 'b6fe5267-4e30-402f-bdd1-c2220359ab63'::uuid, 'paid-discount-import', '461cad9b2b6b186620072c66b4515bc04befe1269ed7c218ceee655b85741543'),
    (8, 'd4a36e03-0e8f-465a-b0de-192394dbe67f'::uuid, 'partially-paid-import', '461cad9b2b6b186620072c66b4515bc04befe1269ed7c218ceee655b85741543'),
    (9, '0abf3fcf-18c2-4528-8a87-199e663fcf03'::uuid, 'open-usd-fx', '1af6adb59b2325969fe5046fbada98b8a13741331c06294e4fd632fef3ac3fa6'),
    (10, '921dc726-06db-4609-814e-9fba0d93a907'::uuid, 'open-myr-posted', 'd71b3c90f71926f11fea865bdbd8839e412e51a595c348454f227f4caba84138')
),
scenario_graph(anchor_id, kind, id) AS (
  SELECT anchor_id, 'invoices'::text, anchor_id FROM expected_scenarios
  UNION
  SELECT g.anchor_id, e.kind, e.id
  FROM scenario_graph g
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
graph(kind, id) AS (
  SELECT DISTINCT kind, id FROM scenario_graph
),
protected_customer_graph(id) AS (
  SELECT DISTINCT c.id
  FROM public.customers c, constants k
  WHERE c.company_id = k.company_id
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
  SELECT 'customers', c.id, to_jsonb(c), 0::numeric, 0::numeric, 0::numeric FROM public.customers c, constants k WHERE c.company_id = k.company_id
  UNION ALL SELECT 'customer_bank_details', x.id, to_jsonb(x), 0, 0, 0 FROM public.customer_bank_details x JOIN public.customers c ON c.id = x.customer_id JOIN constants k ON c.company_id = k.company_id
  UNION ALL SELECT 'invoices', x.id, to_jsonb(x), x.total_amount, x.outstanding, x.base_total FROM public.invoices x, constants k WHERE x.company_id = k.company_id
  UNION ALL SELECT 'invoice_lines', x.id, to_jsonb(x), x.line_amount, x.tax_amount, x.line_total FROM public.invoice_lines x JOIN public.invoices i ON i.id = x.invoice_id JOIN constants k ON i.company_id = k.company_id
  UNION ALL SELECT 'receipts', x.id, to_jsonb(x), x.receipt_amount, x.allocated_amount, x.unallocated_amount FROM public.receipts x, constants k WHERE x.company_id = k.company_id
  UNION ALL SELECT 'allocation_details', x.id, to_jsonb(x), x.allocated_amount, x.discount_amount, x.base_allocated FROM public.allocation_details x JOIN public.invoices i ON i.id = x.invoice_id JOIN constants k ON i.company_id = k.company_id
  UNION ALL SELECT 'cn_allocations', x.id, to_jsonb(x), x.allocated_amount, 0, 0 FROM public.cn_allocations x JOIN public.invoices i ON i.id = x.invoice_id JOIN constants k ON i.company_id = k.company_id
  UNION ALL SELECT 'journal_entries', x.id, to_jsonb(x), x.total_debit, x.total_credit, 0 FROM public.journal_entries x, constants k WHERE x.company_id = k.company_id
  UNION ALL SELECT 'journal_entry_lines', x.id, to_jsonb(x), x.debit_amount, x.credit_amount, x.original_amount FROM public.journal_entry_lines x JOIN public.journal_entries j ON j.id = x.je_id JOIN constants k ON j.company_id = k.company_id
  UNION ALL SELECT 'import_batches', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_batches x, constants k WHERE x.company_id = k.company_id
  UNION ALL SELECT 'import_files', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_files x JOIN public.import_batches b ON b.id = x.batch_id JOIN constants k ON b.company_id = k.company_id
  UNION ALL SELECT 'import_rows', x.id, to_jsonb(x), 0, 0, 0 FROM public.import_rows x JOIN public.import_batches b ON b.id = x.batch_id JOIN constants k ON b.company_id = k.company_id
  UNION ALL SELECT 'import_row_allocations', x.id, to_jsonb(x), x.allocated_amount, 0, 0 FROM public.import_row_allocations x JOIN public.import_rows r ON r.id = x.import_row_id JOIN public.import_batches b ON b.id = r.batch_id JOIN constants k ON b.company_id = k.company_id
  UNION ALL SELECT 'ocr_review_decisions', x.id, to_jsonb(x), 0, 0, 0 FROM public.ocr_review_decisions x, constants k WHERE x.company_id = k.company_id
),
classified AS (
  SELECT CASE WHEN r.id IS NULL THEN 'delete' ELSE 'retain' END AS disposition, p.*
  FROM payloads p
  LEFT JOIN retained r ON r.kind = p.kind AND r.id = p.id
),
manifest AS (
  SELECT disposition, kind, count(*)::bigint AS row_count,
    coalesce(sum(amount_1), 0)::numeric(30,2) AS amount_1,
    coalesce(sum(amount_2), 0)::numeric(30,2) AS amount_2,
    coalesce(sum(amount_3), 0)::numeric(30,2) AS amount_3,
    encode(extensions.digest(coalesce(string_agg(
      kind || '|' || id::text || '|' || encode(extensions.digest(payload::text, 'sha256'), 'hex'),
      E'\n' ORDER BY kind, id
    ), ''), 'sha256'), 'hex') AS state_hash
  FROM classified
  GROUP BY disposition, kind
  UNION ALL
  SELECT disposition, '__FULL__', count(*)::bigint,
    coalesce(sum(amount_1), 0)::numeric(30,2),
    coalesce(sum(amount_2), 0)::numeric(30,2),
    coalesce(sum(amount_3), 0)::numeric(30,2),
    encode(extensions.digest(coalesce(string_agg(
      kind || '|' || id::text || '|' || encode(extensions.digest(payload::text, 'sha256'), 'hex'),
      E'\n' ORDER BY kind, id
    ), ''), 'sha256'), 'hex')
  FROM classified
  GROUP BY disposition
),
scenario_hashes AS (
  SELECT g.anchor_id,
    encode(extensions.digest(string_agg(
      g.kind || '|' || g.id::text || '|' || encode(extensions.digest(p.payload::text, 'sha256'), 'hex'),
      E'\n' ORDER BY g.kind, g.id
    ), 'sha256'), 'hex') AS actual_hash
  FROM scenario_graph g
  JOIN payloads p ON p.kind = g.kind AND p.id = g.id
  GROUP BY g.anchor_id
),
scenario_kind_details AS (
  SELECT anchor_id, kind, count(*)::bigint AS row_count,
    jsonb_agg(id::text ORDER BY id) AS dependency_ids
  FROM scenario_graph
  GROUP BY anchor_id, kind
),
scenario_manifest AS (
  SELECT e.sequence_no, e.anchor_id, e.label,
    i.company_id, i.doc_type, i.status, i.customer_id, i.currency,
    i.exchange_rate::numeric(30,6) AS exchange_rate,
    i.total_amount::numeric(30,2) AS total_amount,
    i.base_total::numeric(30,2) AS base_total,
    i.outstanding::numeric(30,2) AS outstanding,
    i.version,
    s.actual_hash AS scenario_hash,
    sum(g.row_count)::bigint AS dependency_row_count,
    jsonb_object_agg(g.kind, jsonb_build_object(
      'count', g.row_count,
      'ids', g.dependency_ids
    ) ORDER BY g.kind) AS dependencies
  FROM expected_scenarios e
  JOIN public.invoices i ON i.id = e.anchor_id
  JOIN scenario_hashes s ON s.anchor_id = e.anchor_id
  JOIN scenario_kind_details g ON g.anchor_id = e.anchor_id
  GROUP BY e.sequence_no, e.anchor_id, e.label,
    i.company_id, i.doc_type, i.status, i.customer_id, i.currency,
    i.exchange_rate, i.total_amount, i.base_total, i.outstanding, i.version,
    s.actual_hash
),
defective_paid AS (
  SELECT i.*
  FROM public.invoices i
  JOIN public.customers c ON c.id = i.customer_id
  JOIN constants k ON i.company_id = k.company_id
  WHERE c.customer_id LIKE 'C-MESSY%'
    AND i.doc_type = 'Invoice' AND i.status = 'Paid' AND i.version = 1
    AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)
),
header_open AS (
  SELECT i.*
  FROM public.invoices i
  JOIN public.customers c ON c.id = i.customer_id
  JOIN constants k ON i.company_id = k.company_id
  WHERE i.doc_type = 'Invoice' AND i.status = 'Open' AND i.version = 1
    AND (c.customer_id LIKE 'C-MESSY%' OR c.customer_id LIKE 'C-2026%')
    AND i.created_by IS NULL AND i.posted_by IS NULL AND i.posted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.invoice_lines x WHERE x.invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.allocation_details x WHERE x.invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.cn_allocations x WHERE x.invoice_id = i.id OR x.cn_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries x WHERE x.source_doc_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM public.import_rows x WHERE x.invoice_id = i.id)
),
storage_manifest AS (
  SELECT CASE WHEN r.id IS NULL THEN 'delete' ELSE 'retain' END AS disposition,
    count(*)::bigint AS object_count,
    encode(extensions.digest(string_agg(so.bucket_id || '|' || so.name, E'\n' ORDER BY so.bucket_id, so.name), 'sha256'), 'hex') AS object_hash
  FROM public.import_files f
  JOIN public.import_batches b ON b.id = f.batch_id
  JOIN constants k ON b.company_id = k.company_id
  LEFT JOIN retained r ON r.kind = 'import_files' AND r.id = f.id
  JOIN storage.objects so ON so.name = f.file_path OR so.name = regexp_replace(f.file_path, '^/+', '')
  GROUP BY CASE WHEN r.id IS NULL THEN 'delete' ELSE 'retain' END
),
checks AS (
  SELECT
    (SELECT count(*) FROM expected_scenarios) AS principal_count,
    (SELECT count(*) FROM expected_scenarios e JOIN scenario_hashes a ON a.anchor_id = e.anchor_id WHERE a.actual_hash = e.expected_hash) AS scenario_hash_matches,
    (SELECT row_count FROM manifest WHERE disposition = 'retain' AND kind = '__FULL__') AS retained_count,
    (SELECT state_hash FROM manifest WHERE disposition = 'retain' AND kind = '__FULL__') AS retained_hash,
    coalesce((SELECT row_count FROM manifest WHERE disposition = 'delete' AND kind = '__FULL__'), 0::bigint) AS deletion_count,
    coalesce((SELECT state_hash FROM manifest WHERE disposition = 'delete' AND kind = '__FULL__'),
      encode(extensions.digest(''::text, 'sha256'), 'hex')) AS deletion_hash,
    (SELECT count(*) FROM defective_paid) AS defective_paid_count,
    (SELECT coalesce(sum(total_amount), 0)::numeric(30,2) FROM defective_paid) AS defective_paid_total,
    (SELECT count(*) FROM header_open) AS header_open_count,
    (SELECT coalesce(sum(total_amount), 0)::numeric(30,2) FROM header_open) AS header_open_total,
    (SELECT object_count FROM storage_manifest WHERE disposition = 'delete') AS delete_storage_count,
    (SELECT object_hash FROM storage_manifest WHERE disposition = 'delete') AS delete_storage_hash,
    (SELECT object_count FROM storage_manifest WHERE disposition = 'retain') AS retain_storage_count,
    (SELECT object_hash FROM storage_manifest WHERE disposition = 'retain') AS retain_storage_hash,
    (SELECT count(*)
     FROM public.invoices i
     JOIN retained r ON r.kind = 'invoices' AND r.id = i.id
     WHERE i.status IN ('Open', 'Overdue', 'Partially Paid', 'Paid')
       AND i.total_amount
         - coalesce((SELECT sum(a.allocated_amount + a.discount_amount)
                     FROM public.allocation_details a
                     WHERE a.invoice_id = i.id AND a.status = 'Active'), 0::numeric)
         - coalesce((SELECT sum(ca.allocated_amount)
                     FROM public.cn_allocations ca
                     WHERE ca.invoice_id = i.id AND ca.status = 'Active'), 0::numeric)
         <> i.outstanding) AS retained_settlement_mismatch_count,
    (SELECT count(*)
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_schema = tc.constraint_schema
      AND ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_schema = 'public'
       AND tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name IN ('customers','invoices','receipts','allocation_details','journal_entries','import_batches','import_rows','import_files')
       AND tc.table_name NOT IN (
         'allocation_details','cn_allocations','credit_control_logs','customer_bank_details',
         'customer_change_logs','customers','import_batches','import_files',
         'import_row_allocations','import_rows','invoice_lines','invoices',
         'journal_entries','journal_entry_lines','ocr_review_decisions','receipts',
         'report_audit_logs','user_customer_assignments'
       )) AS unclassified_fk_count,
    (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN (
      'trg_ar_financial_document_lifecycle', 'trg_ar_receipt_lifecycle',
      'trg_ar_allocation_detail_integrity', 'trg_ar_journal_entry_integrity'
    )) AS target_lifecycle_trigger_count
)
SELECT jsonb_build_object(
  'mode', 'DRY_RUN_READ_ONLY',
  'state', CASE
    WHEN c.principal_count = k.principal_count
      AND c.scenario_hash_matches = k.principal_count
      AND c.retained_count = k.retained_row_count AND c.retained_hash = k.retained_hash
      AND c.deletion_count = k.deletion_row_count AND c.deletion_hash = k.deletion_hash
      AND c.defective_paid_count = k.defective_paid_count AND c.defective_paid_total = k.defective_paid_total
      AND c.header_open_count = k.header_open_count AND c.header_open_total = k.header_open_total
      AND c.delete_storage_count = k.delete_storage_object_count AND c.delete_storage_hash = k.delete_storage_object_hash
      AND c.retain_storage_count = k.retain_storage_object_count AND c.retain_storage_hash = k.retain_storage_object_hash
      AND c.retained_settlement_mismatch_count = 0
      AND c.unclassified_fk_count = 0
      AND c.target_lifecycle_trigger_count = 0
    THEN 'READY'
    WHEN c.deletion_count = 0 AND c.retained_count = k.retained_row_count AND c.retained_hash = k.retained_hash
    THEN 'ALREADY_APPLIED'
    ELSE 'DRIFT_STOP'
  END,
  'principal_scenarios', c.principal_count,
  'scenario_hash_matches', c.scenario_hash_matches,
  'scenario_manifest', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sequence_no) FROM scenario_manifest s),
  'retention_manifest', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.kind) FROM manifest m WHERE m.disposition = 'retain'),
  'deletion_manifest', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.kind) FROM manifest m WHERE m.disposition = 'delete'),
  'defective_paid', jsonb_build_object('count', c.defective_paid_count, 'total', c.defective_paid_total),
  'header_open', jsonb_build_object('count', c.header_open_count, 'total', c.header_open_total),
  'storage_objects', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.disposition) FROM storage_manifest s),
  'unclassified_fk_count', c.unclassified_fk_count,
  'target_lifecycle_trigger_count', c.target_lifecycle_trigger_count,
  'retained_settlement_mismatch_count', c.retained_settlement_mismatch_count,
  'expected_after_state', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.kind) FROM manifest m WHERE m.disposition = 'retain')
) AS batch_9d_e1_f3_dry_run
FROM checks c
CROSS JOIN constants k;

ROLLBACK;
