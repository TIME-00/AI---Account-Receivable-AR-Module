-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Database Migration: 016_import_ocr_intake_extensions.sql
-- Batch 9B-I1: Safe PDF/Image OCR Intake Backend Foundation
-- ============================================================================
-- Scope:
--   - Reuse existing public.import_batches/import_files/import_rows structures.
--   - Add minimal OCR/file-safety metadata to public.import_files.
--   - Add append-only field review audit table for OCR/manual review decisions.
--   - Extend private ar-imports bucket MIME allowlist for PDF/raster images only.
--
-- Explicitly NOT included:
--   - Production OCR provider enablement.
--   - Financial posting/allocation.
--   - Direct protected financial-table mutation.
--   - ar.* schema.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend existing import file metadata.
-- ---------------------------------------------------------------------------

ALTER TABLE public.import_files
  ADD COLUMN IF NOT EXISTS content_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS detected_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER,
  ADD COLUMN IF NOT EXISTS scan_status TEXT,
  ADD COLUMN IF NOT EXISTS scan_result JSONB,
  ADD COLUMN IF NOT EXISTS ocr_status TEXT,
  ADD COLUMN IF NOT EXISTS ocr_provider TEXT,
  ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_error JSONB,
  ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_import_files_page_count'
      AND conrelid = 'public.import_files'::regclass
  ) THEN
    ALTER TABLE public.import_files
      ADD CONSTRAINT chk_import_files_page_count
      CHECK (page_count IS NULL OR page_count > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_import_files_scan_status'
      AND conrelid = 'public.import_files'::regclass
  ) THEN
    ALTER TABLE public.import_files
      ADD CONSTRAINT chk_import_files_scan_status
      CHECK (
        scan_status IS NULL
        OR scan_status IN ('pending', 'passed', 'rejected', 'quarantined', 'unavailable')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_import_files_ocr_status'
      AND conrelid = 'public.import_files'::regclass
  ) THEN
    ALTER TABLE public.import_files
      ADD CONSTRAINT chk_import_files_ocr_status
      CHECK (
        ocr_status IS NULL
        OR ocr_status IN ('disabled', 'pending', 'processing', 'completed', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_import_files_sha256
  ON public.import_files(file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_files_ocr_status
  ON public.import_files(batch_id, ocr_status)
  WHERE ocr_status IS NOT NULL;

COMMENT ON COLUMN public.import_files.content_mime_type IS
  'Browser/client-supplied MIME type captured for audit. Not trusted as authoritative.';
COMMENT ON COLUMN public.import_files.detected_mime_type IS
  'Backend-detected MIME type from magic-number validation.';
COMMENT ON COLUMN public.import_files.file_sha256 IS
  'SHA-256 digest of uploaded import/OCR intake file.';
COMMENT ON COLUMN public.import_files.scan_status IS
  'File safety validation result. Malware scanner unavailable in v1 uses conservative validation fallback.';
COMMENT ON COLUMN public.import_files.ocr_status IS
  'OCR provider lifecycle status. Production defaults to disabled/manual fallback.';
COMMENT ON COLUMN public.import_files.retention_expires_at IS
  'Retention target for uploaded original file/raw OCR material.';

-- ---------------------------------------------------------------------------
-- 2. Extend import lifecycle statuses minimally for OCR/manual review.
-- ---------------------------------------------------------------------------

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS chk_import_batches_status;

ALTER TABLE public.import_batches
  ADD CONSTRAINT chk_import_batches_status CHECK (
    status IN (
      'Uploaded', 'Parsing', 'Parsed', 'Validating', 'Validated',
      'Executing', 'Completed', 'Failed', 'Cancelled',
      'PendingScan', 'Rejected', 'Quarantined', 'PendingOCR',
      'OCRFailed', 'OCRCompleted', 'NeedsReview', 'ApprovedDraft'
    )
  );

ALTER TABLE public.import_rows
  DROP CONSTRAINT IF EXISTS chk_import_rows_status;

ALTER TABLE public.import_rows
  ADD CONSTRAINT chk_import_rows_status CHECK (
    status IN (
      'Pending', 'Valid', 'Error', 'Skipped', 'Created', 'Posted',
      'Allocated', 'Unmatched', 'NeedsReview', 'ApprovedDraft', 'Rejected'
    )
  );

COMMENT ON CONSTRAINT chk_import_batches_status ON public.import_batches IS
  'Batch 9B-I1 extends import lifecycle for OCR/manual review only. ApprovedDraft is not a posted financial mutation.';
COMMENT ON CONSTRAINT chk_import_rows_status ON public.import_rows IS
  'Batch 9B-I1 extends import row lifecycle for OCR/manual review only. ApprovedDraft is not executable posting/allocation.';

-- ---------------------------------------------------------------------------
-- 3. Append-only OCR review decision audit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ocr_review_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id),
  batch_id        UUID NOT NULL REFERENCES public.import_batches(id),
  file_id         UUID REFERENCES public.import_files(id),
  row_id          UUID NOT NULL REFERENCES public.import_rows(id),
  field_key       TEXT NOT NULL,
  raw_value       JSONB,
  reviewed_value  JSONB,
  confidence      NUMERIC(5,4),
  decision        TEXT NOT NULL,
  decided_by      UUID,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT,

  CONSTRAINT chk_ocr_review_decisions_confidence CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT chk_ocr_review_decisions_decision CHECK (
    decision IN ('reviewed', 'approved_draft', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_ocr_review_decisions_company
  ON public.ocr_review_decisions(company_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_review_decisions_batch
  ON public.ocr_review_decisions(batch_id, row_id, decided_at DESC);

ALTER TABLE public.ocr_review_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ocr_review_decisions_select ON public.ocr_review_decisions;
DROP POLICY IF EXISTS ocr_review_decisions_insert ON public.ocr_review_decisions;
DROP POLICY IF EXISTS ocr_review_decisions_update ON public.ocr_review_decisions;
DROP POLICY IF EXISTS ocr_review_decisions_delete ON public.ocr_review_decisions;

CREATE POLICY ocr_review_decisions_select ON public.ocr_review_decisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = ocr_review_decisions.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY ocr_review_decisions_insert ON public.ocr_review_decisions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = ocr_review_decisions.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

-- No UPDATE or DELETE policies. Review decisions are append-only audit evidence.

GRANT SELECT, INSERT ON TABLE public.ocr_review_decisions TO authenticated;
GRANT ALL ON TABLE public.ocr_review_decisions TO service_role;

COMMENT ON TABLE public.ocr_review_decisions IS
  'Batch 9B-I1 append-only field-level OCR/manual review audit. No financial posting/allocation occurs here.';

-- ---------------------------------------------------------------------------
-- 4. Keep private ar-imports bucket, extend MIME allowlist for PDF/raster image.
-- ---------------------------------------------------------------------------

UPDATE storage.buckets
SET
  public = FALSE,
  allowed_mime_types = ARRAY[
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
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

  IF 'image/svg+xml' = ANY(v_mimes) THEN
    RAISE EXCEPTION 'SVG MIME must not be allowed for Batch 9B-I1.';
  END IF;

  IF NOT (
    'application/pdf' = ANY(v_mimes)
    AND 'image/png' = ANY(v_mimes)
    AND 'image/jpeg' = ANY(v_mimes)
    AND 'image/webp' = ANY(v_mimes)
  ) THEN
    RAISE EXCEPTION 'Bucket ar-imports OCR MIME whitelist is incomplete: %', v_mimes;
  END IF;
END $$;

COMMIT;
