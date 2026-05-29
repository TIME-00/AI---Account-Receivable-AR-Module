-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Database Schema: 008_import_tables.sql
-- Sprint F4 Phase A: CSV Invoice Import, Draft Only
-- ============================================================================
-- Run AFTER:
--   001_create_tables.sql
--   004_auth_tables.sql
--   006_rls_policies.sql
--
-- Scope:
--   - Import audit tables
--   - RLS for import tables
--   - Supabase Storage bucket/policies for import files
--
-- Explicitly NOT included:
--   - Invoice posting
--   - Receipt import
--   - Allocation / allocation history
--   - Excel/PDF/Image/OCR
--   - ar.* schema
-- ============================================================================

-- ============================================================================
-- SECTION 1: IMPORT TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS import_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID         NOT NULL REFERENCES companies(id),

    batch_name      VARCHAR(200) NOT NULL,
    import_type     VARCHAR(20)  NOT NULL,
    file_type       VARCHAR(10)  NOT NULL,
    file_name       VARCHAR(300) NOT NULL,
    file_path       TEXT,
    file_size_bytes BIGINT,

    status          VARCHAR(20)  NOT NULL DEFAULT 'Uploaded',

    total_rows      INT          NOT NULL DEFAULT 0,
    valid_rows      INT          NOT NULL DEFAULT 0,
    error_rows      INT          NOT NULL DEFAULT 0,
    created_count   INT          NOT NULL DEFAULT 0,
    posted_count    INT          NOT NULL DEFAULT 0,
    allocated_count INT          NOT NULL DEFAULT 0,
    skipped_count   INT          NOT NULL DEFAULT 0,
    unmatched_count INT          NOT NULL DEFAULT 0,

    error_summary   JSONB,

    auto_post       BOOLEAN      NOT NULL DEFAULT FALSE,
    auto_allocate   BOOLEAN      NOT NULL DEFAULT FALSE,

    created_by      UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID,
    cancel_reason   TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_import_batches_type CHECK (import_type IN ('invoice', 'receipt')),
    CONSTRAINT chk_import_batches_file_type CHECK (file_type IN ('csv', 'xlsx', 'pdf', 'image')),
    CONSTRAINT chk_import_batches_status CHECK (
        status IN ('Uploaded', 'Parsing', 'Parsed', 'Validating', 'Validated',
                   'Executing', 'Completed', 'Failed', 'Cancelled')
    ),
    CONSTRAINT chk_import_batches_counts CHECK (
        total_rows >= 0 AND valid_rows >= 0 AND error_rows >= 0
        AND created_count >= 0 AND posted_count >= 0 AND allocated_count >= 0
        AND skipped_count >= 0 AND unmatched_count >= 0
    ),
    CONSTRAINT chk_import_batches_phase_a_no_auto CHECK (
        auto_post = FALSE AND auto_allocate = FALSE
    )
);

CREATE INDEX IF NOT EXISTS idx_import_batches_company ON import_batches(company_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status  ON import_batches(company_id, status);
CREATE INDEX IF NOT EXISTS idx_import_batches_type    ON import_batches(company_id, import_type);
CREATE INDEX IF NOT EXISTS idx_import_batches_created ON import_batches(company_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON import_batches;
CREATE TRIGGER trg_import_batches_updated_at
    BEFORE UPDATE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE import_batches IS
  'Sprint F4 import batch metadata. Append-only audit evidence; no hard deletes. Phase A supports CSV invoice draft import only.';

CREATE TABLE IF NOT EXISTS import_rows (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id          UUID         NOT NULL REFERENCES import_batches(id),
    row_number        INT          NOT NULL,

    raw_data          JSONB        NOT NULL,
    mapped_data       JSONB,

    status            VARCHAR(20)  NOT NULL DEFAULT 'Pending',
    validation_errors JSONB,

    invoice_id        UUID         REFERENCES invoices(id),
    receipt_id        UUID         REFERENCES receipts(id),
    je_no             VARCHAR(30),

    duplicate_of      UUID,

    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_import_rows_batch_row UNIQUE (batch_id, row_number),
    CONSTRAINT chk_import_rows_status CHECK (
        status IN ('Pending', 'Valid', 'Error', 'Skipped',
                   'Created', 'Posted', 'Allocated', 'Unmatched')
    ),
    CONSTRAINT chk_import_rows_row_number CHECK (row_number > 0)
);

CREATE INDEX IF NOT EXISTS idx_import_rows_batch  ON import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON import_rows(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_import_rows_invoice ON import_rows(invoice_id) WHERE invoice_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_import_rows_updated_at ON import_rows;
CREATE TRIGGER trg_import_rows_updated_at
    BEFORE UPDATE ON import_rows
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE import_rows IS
  'Sprint F4 import row data and validation state. No ON DELETE CASCADE; import rows are audit evidence.';

CREATE TABLE IF NOT EXISTS import_row_allocations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_row_id     UUID          NOT NULL REFERENCES import_rows(id),
    allocation_id     UUID          NOT NULL REFERENCES allocation_details(id),
    invoice_id        UUID          NOT NULL REFERENCES invoices(id),
    allocated_amount  DECIMAL(18,2) NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ira_amount_positive CHECK (allocated_amount > 0),
    CONSTRAINT uq_ira_import_row_allocation UNIQUE (import_row_id, allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_ira_import_row ON import_row_allocations(import_row_id);
CREATE INDEX IF NOT EXISTS idx_ira_allocation ON import_row_allocations(allocation_id);

COMMENT ON TABLE import_row_allocations IS
  'Normalized link between import rows and allocation_details for later phases. No ON DELETE CASCADE.';

CREATE TABLE IF NOT EXISTS import_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        UUID         NOT NULL REFERENCES import_batches(id),
    file_name       VARCHAR(300) NOT NULL,
    file_path       TEXT         NOT NULL,
    file_type       VARCHAR(10)  NOT NULL,
    file_size_bytes BIGINT,
    ocr_result      JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_import_files_file_type CHECK (file_type IN ('csv', 'xlsx', 'pdf', 'image'))
);

CREATE INDEX IF NOT EXISTS idx_import_files_batch ON import_files(batch_id);

COMMENT ON TABLE import_files IS
  'Import file metadata. Phase A uses a single CSV file per batch; OCR fields are reserved for later phases.';

-- ============================================================================
-- SECTION 2: RLS POLICIES
-- ============================================================================

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_row_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batches_select ON import_batches;
DROP POLICY IF EXISTS import_batches_insert ON import_batches;
DROP POLICY IF EXISTS import_batches_update ON import_batches;

CREATE POLICY import_batches_select ON import_batches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = import_batches.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY import_batches_insert ON import_batches
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = import_batches.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

CREATE POLICY import_batches_update ON import_batches
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = import_batches.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = import_batches.company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

DROP POLICY IF EXISTS import_rows_select ON import_rows;
DROP POLICY IF EXISTS import_rows_insert ON import_rows;
DROP POLICY IF EXISTS import_rows_update ON import_rows;

CREATE POLICY import_rows_select ON import_rows
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_rows.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY import_rows_insert ON import_rows
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_rows.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

CREATE POLICY import_rows_update ON import_rows
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_rows.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_rows.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

DROP POLICY IF EXISTS ira_select ON import_row_allocations;
DROP POLICY IF EXISTS ira_insert ON import_row_allocations;

CREATE POLICY ira_select ON import_row_allocations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM import_rows ir
      JOIN import_batches ib ON ib.id = ir.batch_id
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ir.id = import_row_allocations.import_row_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY ira_insert ON import_row_allocations
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_rows ir
      JOIN import_batches ib ON ib.id = ir.batch_id
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ir.id = import_row_allocations.import_row_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

DROP POLICY IF EXISTS import_files_select ON import_files;
DROP POLICY IF EXISTS import_files_insert ON import_files;

CREATE POLICY import_files_select ON import_files
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_files.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY import_files_insert ON import_files
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM import_batches ib
      JOIN user_roles ur ON ur.company_id = ib.company_id
      WHERE ib.id = import_files.batch_id
        AND ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

-- No DELETE policies are created for import tables. Under RLS, deletes are denied
-- to authenticated users by default. Service-role backend should soft-cancel batches.

-- ============================================================================
-- SECTION 3: SUPABASE STORAGE BUCKET AND POLICIES
-- ============================================================================

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'ar-imports',
  'ar-imports',
  FALSE,
  20971520,
  ARRAY[
    'text/csv',
    'application/csv',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS storage_imports_select ON storage.objects;
DROP POLICY IF EXISTS storage_imports_insert ON storage.objects;

CREATE POLICY storage_imports_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'ar-imports'
    AND (storage.foldername(name))[1] IN (
      SELECT ur.company_id::TEXT
      FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    )
  );

CREATE POLICY storage_imports_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'ar-imports'
    AND (storage.foldername(name))[1] IN (
      SELECT ur.company_id::TEXT
      FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    )
  );

-- No UPDATE or DELETE storage policies. Import files are audit evidence.

