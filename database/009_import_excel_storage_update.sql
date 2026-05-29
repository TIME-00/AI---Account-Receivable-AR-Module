-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Database Migration: 009_import_excel_storage_update.sql
-- Sprint F4 Phase B: Excel Invoice Import, Draft Only
-- ============================================================================
-- Run AFTER:
--   database/008_import_tables.sql
--
-- Scope:
--   - Preserve existing CSV MIME types for the private ar-imports bucket.
--   - Add XLSX MIME type for Phase B Excel invoice imports.
--
-- Explicitly NOT included:
--   - New tables
--   - New RLS policies
--   - Public bucket access
--   - Receipt import
--   - Posting
--   - Allocation
-- ============================================================================

UPDATE storage.buckets
SET
  public = FALSE,
  allowed_mime_types = ARRAY[
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
WHERE id = 'ar-imports';

DO $$
DECLARE
  v_public BOOLEAN;
  v_mimes TEXT[];
BEGIN
  SELECT public, allowed_mime_types
  INTO v_public, v_mimes
  FROM storage.buckets
  WHERE id = 'ar-imports';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bucket ar-imports does not exist. Run 008_import_tables.sql first.';
  END IF;

  IF v_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Bucket ar-imports must remain private.';
  END IF;

  IF NOT (
    'text/csv' = ANY(v_mimes)
    AND 'application/csv' = ANY(v_mimes)
    AND 'text/plain' = ANY(v_mimes)
    AND 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' = ANY(v_mimes)
  ) THEN
    RAISE EXCEPTION 'Bucket ar-imports MIME whitelist is incomplete: %', v_mimes;
  END IF;
END $$;

COMMENT ON TABLE import_batches IS
  'Sprint F4 import batch metadata. Phase A supports CSV invoice draft import; Phase B adds XLSX invoice draft import. No posting, receipt import, or allocation.';
