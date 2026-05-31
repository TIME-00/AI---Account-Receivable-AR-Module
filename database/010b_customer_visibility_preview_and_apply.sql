-- ============================================================================
-- PREVIEW-FIRST operator SQL: hide historical test/smoke-test customers
-- ============================================================================
-- Run database/010_customer_visibility_flags.sql first.
--
-- IMPORTANT:
-- 1. Run the SELECT preview first.
-- 2. Review every returned customer before applying an update.
-- 3. Narrow the candidate_patterns CTE if any legitimate customer matches.
-- 4. The UPDATE block is intentionally commented out. Uncomment it only after
--    reviewing the preview in the target environment.
-- 5. This script never deletes records and never modifies financial records.

WITH candidate_patterns(pattern) AS (
  VALUES
    ('C-FYP%'),
    ('C-MESSY%'),
    ('C-2026%'),
    ('PROD-SMOKE%')
),
candidate_customers AS (
  SELECT c.*
  FROM public.customers c
  WHERE c.company_id = '00000000-0000-0000-0000-000000000001'::UUID
    AND c.is_hidden = FALSE
    AND EXISTS (
      SELECT 1
      FROM candidate_patterns p
      WHERE c.customer_id LIKE p.pattern
    )
)
SELECT
  c.id,
  c.customer_id,
  c.customer_name,
  c.company_id,
  COALESCE(i.invoice_count, 0) AS invoice_count,
  COALESCE(r.receipt_count, 0) AS receipt_count,
  COALESCE(i.total_invoice_amount, 0.00) AS total_invoice_amount,
  COALESCE(r.total_receipt_amount, 0.00) AS total_receipt_amount
FROM candidate_customers c
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS invoice_count,
    COALESCE(SUM(i.total_amount), 0.00) AS total_invoice_amount
  FROM public.invoices i
  WHERE i.customer_id = c.id
) i ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS receipt_count,
    COALESCE(SUM(r.receipt_amount), 0.00) AS total_receipt_amount
  FROM public.receipts r
  WHERE r.customer_id = c.id
) r ON TRUE
ORDER BY c.customer_id;

-- ============================================================================
-- APPLY ONLY AFTER REVIEWING THE PREVIEW ABOVE.
-- Keep the company ID and reviewed patterns explicit.
-- ============================================================================
/*
WITH candidate_patterns(pattern) AS (
  VALUES
    ('C-FYP%'),
    ('C-MESSY%'),
    ('C-2026%'),
    ('PROD-SMOKE%')
)
UPDATE public.customers c
SET
  is_hidden = TRUE,
  hidden_reason = 'Hidden from client prototype because this is historical test/smoke-test data',
  hidden_at = NOW()
WHERE c.company_id = '00000000-0000-0000-0000-000000000001'::UUID
  AND c.is_hidden = FALSE
  AND EXISTS (
    SELECT 1
    FROM candidate_patterns p
    WHERE c.customer_id LIKE p.pattern
  )
RETURNING c.id, c.customer_id, c.customer_name, c.company_id, c.hidden_at;
*/
