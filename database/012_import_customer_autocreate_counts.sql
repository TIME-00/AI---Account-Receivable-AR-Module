-- ============================================================================
-- 012_import_customer_autocreate_counts.sql
-- Sprint F4 Phase C: Smart Invoice Import with Customer Auto-Creation
--
-- Additive audit counters only. Row-level customer resolution evidence remains
-- in import_rows.mapped_data JSONB. No financial tables are changed.
-- ============================================================================

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS matched_customers_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_customers_count INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_import_batches_customer_counts'
      AND conrelid = 'public.import_batches'::regclass
  ) THEN
    ALTER TABLE public.import_batches
      ADD CONSTRAINT chk_import_batches_customer_counts
      CHECK (
        matched_customers_count >= 0
        AND created_customers_count >= 0
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.import_batches.matched_customers_count IS
  'Phase C count of distinct visible existing customers matched while executing an invoice import batch.';

COMMENT ON COLUMN public.import_batches.created_customers_count IS
  'Phase C count of distinct visible customers created through CustomerService while executing an invoice import batch.';

COMMENT ON TABLE public.import_batches IS
  'Sprint F4 import batch metadata. Phase C adds CSV/XLSX smart customer matching and CustomerService-backed auto-creation for draft invoice imports only. No posting, receipt import, or allocation.';
