# Sprint F4 — Import-Driven Automation Engine: Full Technical Plan

**Date**: 2026-05-28 (Revised)  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟡 Revised — Awaiting Codex re-review  
**Revision**: v2.1 — Addresses 2 remaining Codex findings from v2.0

---

> [!IMPORTANT]
> **Revision Summary (v1 → v2)**
> 1. Removed `GET /allocations` from active scope (cross-tenant risk)
> 2. Removed `POST /allocations/auto` from active scope (unverified)
> 3. Split implementation into 6 phases: A (CSV) → B (Excel) → C (Post) → D (Receipt+Alloc) → E (Alloc History) → F (OCR)
> 4. Phase A creates drafts only — no auto-post
> 5. All execution reuses existing verified Edge Functions/RPCs
> 6. Added `import_row_allocations` normalized table (replaces single `allocation_id`)
> 7. Added `Unmatched` status to `import_rows`
> 8. Removed `ON DELETE CASCADE` — append-only audit evidence
> 9. Strengthened RLS with `WITH CHECK` clauses + inactive role rejection
> 10. Added explicit Supabase Storage bucket policy
> 11. Corrected Claude/Codex ownership boundaries
> 12. Added evidence test scripts for each phase
> 13. **(v2.1)** All child-table SELECT policies (`import_rows`, `import_row_allocations`, `import_files`, storage) now filter by `role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')` — System Admin excluded from import data access
> 14. **(v2.1)** `import_row_allocations.allocation_id` changed from comment-only reference to real FK: `REFERENCES allocation_details(id)` (no ON DELETE CASCADE)

---

## 1. Overall Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Next.js)                          │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Import Wizard │  │ Batch Status │  │ Allocation History       │   │
│  │ (Upload +     │  │ Dashboard    │  │ (Phase E only — after    │   │
│  │  Review +     │  │ (Progress +  │  │  GET /allocations is     │   │
│  │  Confirm)     │  │  Errors)     │  │  fixed and verified)     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘   │
│         │                  │                      │                   │
│         ▼                  ▼                      ▼                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  useApi() → Supabase Edge Functions (existing pattern)         │  │
│  └────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
         │                  │                      │
         ▼                  ▼                      ▼
┌───────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Supabase Edge Functions)                 │
│                                                                       │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ imports (NEW — Phase A)  │  │ allocations (EXISTING)           │  │
│  │  POST /imports/upload    │  │  POST /allocations/manual ✅     │  │
│  │  POST /imports/:id/parse │  │  POST /allocations/auto  ❌ BLOCKED│ │
│  │  POST /imports/:id/      │  │  GET  /allocations       ❌ BLOCKED│ │
│  │       validate           │  │  POST /:id/reverse       ❌ BLOCKED│ │
│  │  POST /imports/:id/      │  └──────────────────────────────────┘  │
│  │       execute            │                                        │
│  │  GET  /imports           │  ┌──────────────────────────────────┐  │
│  │  GET  /imports/:id       │  │ invoices / receipts (EXISTING)   │  │
│  │  GET  /imports/:id/rows  │  │  POST /invoices ← create draft  │  │
│  └──────────────────────────┘  │  POST /invoices/:id/post ← Ph C │  │
│                                │  POST /receipts ← Phase D       │  │
│  ┌──────────────────────────┐  │  POST /receipts/:id/post ← Ph D │  │
│  │ ocr-extract (Phase F)   │  └──────────────────────────────────┘  │
│  │  POST /ocr-extract       │                                        │
│  │  ❌ NOT IN EARLY PHASES  │                                        │
│  └──────────────────────────┘                                        │
└───────────────────────────────────────────────────────────────────────┘
         │                                         │
         ▼                                         ▼
┌───────────────────────────────────────────────────────────────────────┐
│              DATABASE (PostgreSQL / Supabase)                         │
│                                                                       │
│  NEW TABLES:                     EXISTING TABLES (unchanged):        │
│  • import_batches                • invoices, invoice_lines           │
│  • import_rows                   • receipts                          │
│  • import_files                  • allocation_details                │
│  • import_row_allocations        • customers                         │
│                                  • journal_entries + lines           │
│  EXISTING RPCs (unchanged):      • All config tables                 │
│  • post_invoice()                                                    │
│  • post_receipt()                                                    │
│  • allocate_receipt()                                                │
└───────────────────────────────────────────────────────────────────────┘
```

### Key Principles

> **1. All imported invoices/receipts MUST go through verified create → post flows.**
> Import is a data-entry accelerator, NOT a bypass mechanism.

> **2. The existing P0/P1 RPCs (`post_invoice`, `post_receipt`, `allocate_receipt`) remain the single source of truth for financial mutations.**
> The import engine NEVER directly inserts into `invoices`, `receipts`, `allocation_details`, `journal_entries`, or any financial table.

> **3. Phase A creates drafts only. Posting requires explicit user confirmation in Phase C.**

> **4. Allocation history UI is blocked until `GET /allocations` is fixed for company/customer scoping (Phase E).**

---

## 2. Backend Edge Functions Required

### 2.1 NEW: `imports` Edge Function (Phase A)

| Route | Method | Phase | Description |
|-------|--------|-------|-------------|
| `/imports/upload` | POST | A | Upload file, create `import_batch`, store in Supabase Storage, return batch ID |
| `/imports/:id/parse` | POST | A | Parse uploaded file → extract rows → populate `import_rows` |
| `/imports/:id/validate` | POST | A | Validate each row (customer match, field validation, duplicate check) |
| `/imports/:id/execute` | POST | A | For each valid row: call `POST /invoices` to create draft. **No posting in Phase A.** |
| `/imports` | GET | A | List import batches with status summary |
| `/imports/:id` | GET | A | Get batch detail (status, counts, errors) |
| `/imports/:id/rows` | GET | A | Get parsed rows with validation status per row |

### 2.2 NEW: `ocr-extract` Edge Function (Phase F only)

| Route | Method | Phase | Description |
|-------|--------|-------|-------------|
| `/ocr-extract` | POST | F | Accept image/PDF binary, call Gemini Vision API, return structured JSON |

> [!CAUTION]
> `ocr-extract` is NOT in Phase A–E. It will only be created after structured CSV/Excel import is stable and tested.

### 2.3 EXISTING: Usage by Phase

| Function | Route | Phase | Usage |
|----------|-------|-------|-------|
| `invoices` | `POST /invoices` | A | Import engine calls this to create draft invoices |
| `invoices` | `POST /invoices/:id/post` | C | Explicit posting after user confirmation |
| `receipts` | `POST /receipts` | D | Import engine calls this to create draft receipts |
| `receipts` | `POST /receipts/:id/post` | D | Explicit posting after user confirmation |
| `allocations` | `POST /allocations/manual` | D | Computed matching → confirmed allocation via verified RPC |

### 2.4 BLOCKED — Not in Sprint F4 Active Scope

| Function | Route | Reason | Remediation |
|----------|-------|--------|-------------|
| `allocations` | `GET /allocations` | ❌ `listAllocations()` uses admin client without company/customer scoping — cross-tenant risk | Phase E: Fix service to scope by `auth.companyId` + customer access, add RLS-safe query, smoke test |
| `allocations` | `POST /allocations/auto` | ❌ Unverified — needs separate backend design + smoke testing | Phase E+: Future phase only after backend review |
| `allocations` | `POST /allocations/:id/reverse` | ❌ Blocked until `GET /allocations` is fixed | Phase E |

---

## 3. Supabase Tables Required

### 3.1 `import_batches` (NEW)

```sql
CREATE TABLE import_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID         NOT NULL REFERENCES companies(id),

    -- Batch metadata
    batch_name      VARCHAR(200) NOT NULL,
    import_type     VARCHAR(20)  NOT NULL,  -- 'invoice' | 'receipt'
    file_type       VARCHAR(10)  NOT NULL,  -- 'csv' | 'xlsx' | 'pdf' | 'image'
    file_name       VARCHAR(300) NOT NULL,  -- Original filename
    file_path       TEXT,                   -- Supabase Storage path
    file_size_bytes BIGINT,

    -- Status tracking
    status          VARCHAR(20)  NOT NULL DEFAULT 'Uploaded',

    -- Row counts
    total_rows      INT          NOT NULL DEFAULT 0,
    valid_rows      INT          NOT NULL DEFAULT 0,
    error_rows      INT          NOT NULL DEFAULT 0,
    created_count   INT          NOT NULL DEFAULT 0,
    posted_count    INT          NOT NULL DEFAULT 0,
    allocated_count INT          NOT NULL DEFAULT 0,
    skipped_count   INT          NOT NULL DEFAULT 0,
    unmatched_count INT          NOT NULL DEFAULT 0,

    -- Error summary
    error_summary   JSONB,

    -- Execution config
    auto_post       BOOLEAN      NOT NULL DEFAULT FALSE,
    auto_allocate   BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Audit (append-only — no deletes)
    created_by      UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID,
    cancel_reason   TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_import_type CHECK (import_type IN ('invoice', 'receipt')),
    CONSTRAINT chk_file_type CHECK (file_type IN ('csv', 'xlsx', 'pdf', 'image')),
    CONSTRAINT chk_batch_status CHECK (
        status IN ('Uploaded', 'Parsing', 'Parsed', 'Validating', 'Validated',
                   'Executing', 'Completed', 'Failed', 'Cancelled')
    )
);

CREATE INDEX idx_import_batches_company ON import_batches(company_id);
CREATE INDEX idx_import_batches_status  ON import_batches(company_id, status);
CREATE INDEX idx_import_batches_type    ON import_batches(company_id, import_type);

CREATE TRIGGER trg_import_batches_updated_at
    BEFORE UPDATE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE import_batches IS
  'Import batch metadata. Append-only audit evidence — no hard deletes. Soft-cancel via status=Cancelled.';
```

> [!IMPORTANT]
> **No `ON DELETE CASCADE`.** Import batches are audit evidence. Use `status = 'Cancelled'` + `cancelled_at/cancelled_by/cancel_reason` for soft-cancel. No hard deletes.

### 3.2 `import_rows` (NEW)

```sql
CREATE TABLE import_rows (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id          UUID         NOT NULL REFERENCES import_batches(id),
    row_number        INT          NOT NULL,

    -- Raw extracted data (from CSV/Excel/OCR)
    raw_data          JSONB        NOT NULL,

    -- Mapped / normalized data
    mapped_data       JSONB,

    -- Validation
    status            VARCHAR(20)  NOT NULL DEFAULT 'Pending',
    validation_errors JSONB,

    -- Result tracking
    invoice_id        UUID         REFERENCES invoices(id),
    receipt_id        UUID         REFERENCES receipts(id),
    je_no             VARCHAR(30),

    -- Duplicate detection
    duplicate_of      UUID,

    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_import_rows UNIQUE (batch_id, row_number),
    CONSTRAINT chk_row_status CHECK (
        status IN ('Pending', 'Valid', 'Error', 'Skipped',
                   'Created', 'Posted', 'Allocated', 'Unmatched')
    )
);

CREATE INDEX idx_import_rows_batch  ON import_rows(batch_id);
CREATE INDEX idx_import_rows_status ON import_rows(batch_id, status);

CREATE TRIGGER trg_import_rows_updated_at
    BEFORE UPDATE ON import_rows
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE import_rows IS
  'Individual import row data and validation state. No ON DELETE CASCADE — audit evidence. '
  'Status includes Unmatched for receipt rows that could not be matched to open invoices.';
```

> [!IMPORTANT]
> **No `ON DELETE CASCADE` on `batch_id` FK.** Rows are audit evidence. If batch is cancelled, rows remain for traceability.
>
> **`Unmatched` status** added for receipt rows where no invoice match was found during computed allocation.

### 3.3 `import_row_allocations` (NEW — normalized)

```sql
CREATE TABLE import_row_allocations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_row_id     UUID         NOT NULL REFERENCES import_rows(id),
    allocation_id     UUID         NOT NULL REFERENCES allocation_details(id),
    invoice_id        UUID         NOT NULL REFERENCES invoices(id),
    allocated_amount  DECIMAL(18,2) NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ira_amount_positive CHECK (allocated_amount > 0)
);

CREATE INDEX idx_ira_import_row  ON import_row_allocations(import_row_id);
CREATE INDEX idx_ira_allocation  ON import_row_allocations(allocation_id);

COMMENT ON TABLE import_row_allocations IS
  'Normalized table linking import rows to allocation_details. '
  'One receipt import row can produce multiple allocations (1:N). '
  'No ON DELETE CASCADE — audit evidence.';
```

> [!IMPORTANT]
> **Replaces the old single `allocation_id` column on `import_rows`.**
> One receipt can allocate to multiple invoices, producing multiple `allocation_details` rows. This normalized table tracks all of them.

### 3.4 `import_files` (NEW — Phase F, for multi-file OCR batches)

```sql
CREATE TABLE import_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        UUID         NOT NULL REFERENCES import_batches(id),
    file_name       VARCHAR(300) NOT NULL,
    file_path       TEXT         NOT NULL,
    file_type       VARCHAR(10)  NOT NULL,
    file_size_bytes BIGINT,
    ocr_result      JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_files_batch ON import_files(batch_id);

COMMENT ON TABLE import_files IS
  'Multi-file storage metadata for OCR batches (Phase F). No ON DELETE CASCADE.';
```

### 3.5 RLS Policies for New Tables

```sql
-- ═══════════════════════════════════════════════════════════════════
-- import_batches: tenant-isolated, operational roles, USING + WITH CHECK
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

-- SELECT: user must have active role in the batch's company
CREATE POLICY import_batches_select ON import_batches
    FOR SELECT
    USING (company_id IN (
        SELECT company_id FROM user_roles
        WHERE user_id = auth.uid()
          AND is_active = TRUE
          AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
    ));

-- INSERT: user must have active operational role; company_id must match
CREATE POLICY import_batches_insert ON import_batches
    FOR INSERT
    WITH CHECK (company_id IN (
        SELECT company_id FROM user_roles
        WHERE user_id = auth.uid()
          AND is_active = TRUE
          AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    ));

-- UPDATE: same company, operational roles only
CREATE POLICY import_batches_update ON import_batches
    FOR UPDATE
    USING (company_id IN (
        SELECT company_id FROM user_roles
        WHERE user_id = auth.uid()
          AND is_active = TRUE
          AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    ))
    WITH CHECK (company_id IN (
        SELECT company_id FROM user_roles
        WHERE user_id = auth.uid()
          AND is_active = TRUE
          AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
    ));

-- DELETE: explicitly denied (append-only audit evidence)
-- No DELETE policy = denied by default with RLS enabled

-- ═══════════════════════════════════════════════════════════════════
-- import_rows: access through batch company scope
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_rows_select ON import_rows
    FOR SELECT
    USING (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
        )
    ));

CREATE POLICY import_rows_insert ON import_rows
    FOR INSERT
    WITH CHECK (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    ));

CREATE POLICY import_rows_update ON import_rows
    FOR UPDATE
    USING (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    ))
    WITH CHECK (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    ));

-- ═══════════════════════════════════════════════════════════════════
-- import_row_allocations: access through import_row → batch → company
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE import_row_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ira_select ON import_row_allocations
    FOR SELECT
    USING (import_row_id IN (
        SELECT ir.id FROM import_rows ir
        JOIN import_batches ib ON ib.id = ir.batch_id
        WHERE ib.company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
        )
    ));

CREATE POLICY ira_insert ON import_row_allocations
    FOR INSERT
    WITH CHECK (import_row_id IN (
        SELECT ir.id FROM import_rows ir
        JOIN import_batches ib ON ib.id = ir.batch_id
        WHERE ib.company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    ));

-- ═══════════════════════════════════════════════════════════════════
-- import_files: access through batch (Phase F only)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE import_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_files_select ON import_files
    FOR SELECT
    USING (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
        )
    ));

CREATE POLICY import_files_insert ON import_files
    FOR INSERT
    WITH CHECK (batch_id IN (
        SELECT id FROM import_batches
        WHERE company_id IN (
            SELECT company_id FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    ));
```

> [!IMPORTANT]
> **All policies use both `USING` and `WITH CHECK`.**
> **Inactive roles are explicitly rejected** (`is_active = TRUE`).
> **No DELETE policies** = deletes denied by default under RLS.
> **Auditor can SELECT but not INSERT/UPDATE.**
> **System Admin has no import access** (not an operational role).

---

## 4. Supabase Storage Policy

### 4.1 Bucket Configuration

```
Bucket name: ar-imports
Public: false (authenticated access only)
File size limit: 20 MB
Allowed MIME types: text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,
                    application/pdf, image/jpeg, image/png, image/heic
```

### 4.2 Storage Path Convention

```
ar-imports/{company_id}/{batch_id}/{original_filename}
```

Example:
```
ar-imports/00000000-0000-0000-0000-000000000001/abc123-def456/invoices_may_2026.csv
```

### 4.3 Storage RLS Policies

```sql
-- SELECT: operational roles + Auditor can read files under their company's prefix
CREATE POLICY storage_imports_select ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'ar-imports'
        AND (storage.foldername(name))[1] IN (
            SELECT company_id::TEXT FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
        )
    );

-- INSERT: operational roles can upload to their company's prefix only
CREATE POLICY storage_imports_insert ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'ar-imports'
        AND (storage.foldername(name))[1] IN (
            SELECT company_id::TEXT FROM user_roles
            WHERE user_id = auth.uid()
              AND is_active = TRUE
              AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
        )
    );

-- No DELETE or UPDATE policies (files are immutable audit evidence)
```

> [!CAUTION]
> **No public bucket.** All access requires authenticated Supabase client with valid JWT.
> **Cross-company access is prevented** by scoping the storage path prefix to `company_id`.
> **No file deletion** — uploaded files are audit evidence.

---

## 5. Frontend Pages Required

### 5.1 New Pages (by Phase)

| # | Route | Page | Phase | Description |
|---|-------|------|-------|-------------|
| F4.1 | `/import` | Import Hub | A | Recent batches list, "New Import" button |
| F4.2 | `/import/new` | Import Wizard | A | Step-by-step: Upload → Preview → Map → Validate → Execute (draft) |
| F4.3 | `/import/[id]` | Batch Detail | A | Row-level status, errors, created invoice/receipt links |
| F4.4 | `/allocations/history` | Allocation History | **E** | **BLOCKED until GET /allocations is fixed** — placeholder until then |

### 5.2 Modified Pages

| Page | Change | Phase |
|------|--------|-------|
| Sidebar | Add "Import" nav item under Main Menu | A |
| `/allocations` | Keep placeholder for history section until Phase E | D |

---

## 6. Import File Handling

### 6.1 CSV (Phase A)

| Aspect | Detail |
|--------|--------|
| **Parser** | `csv-parse` (Deno-compatible) or manual line splitter |
| **Encoding** | UTF-8 with BOM detection |
| **Delimiter** | Auto-detect: comma, semicolon, tab |
| **Header row** | Required — first row = column names |
| **Max rows** | 500 per batch (configurable) |
| **Max file size** | 5 MB |

**Expected Invoice CSV columns**:
```
customer_name, invoice_date, currency, description, quantity, unit_price, tax_rate, reference_no
```

**Expected Receipt CSV columns** (Phase D):
```
customer_name, receipt_date, receipt_amount, payment_method, currency, reference_no
```

### 6.2 Excel / .xlsx (Phase B)

| Aspect | Detail |
|--------|--------|
| **Parser** | `xlsx` / `SheetJS` (Deno-compatible CDN import) |
| **Sheet** | First sheet only (or user-selectable) |
| **Header row** | Row 1 = column headers |
| **Max rows** | 500 per batch |
| **Max file size** | 10 MB |
| **Date handling** | Excel serial dates → ISO date strings |

Same column structure as CSV. Reuses the same validation pipeline from Phase A.

### 6.3 PDF (Phase F)

| Aspect | Detail |
|--------|--------|
| **Strategy** | OCR via Gemini Vision API |
| **Max pages** | 10 pages per PDF |
| **Max file size** | 20 MB |
| **Output** | Structured JSON extracted by AI model |
| **Prerequisite** | Structured CSV/Excel import must be stable first |

### 6.4 Image — JPG, PNG, HEIC (Phase F)

| Aspect | Detail |
|--------|--------|
| **Strategy** | OCR via Gemini Vision API |
| **Max file size** | 10 MB per image |
| **Max files** | 5 images per batch |
| **Output** | Structured JSON extracted by AI model |
| **Prerequisite** | Structured CSV/Excel import must be stable first |

> [!WARNING]
> PDF and Image OCR are Phase F only. They will not be implemented until CSV/Excel import (Phases A–D) is stable and tested. OCR output is always review-only — user must confirm before execution.

---

## 7. OCR / AI Extraction Strategy (Phase F Only)

### 7.1 Architecture

```
Frontend                  ocr-extract EF            Gemini API
  │                            │                        │
  │  POST /ocr-extract         │                        │
  │  (file binary + type hint) │                        │
  │  ─────────────────────────►│                        │
  │                            │  generateContent()     │
  │                            │  (image + prompt)      │
  │                            │  ─────────────────────►│
  │                            │                        │
  │                            │  structured JSON       │
  │                            │  ◄─────────────────────│
  │                            │                        │
  │  structured rows JSON      │                        │
  │  ◄─────────────────────────│                        │
```

### 7.2 Gemini Vision API Integration

| Aspect | Detail |
|--------|--------|
| **Model** | `gemini-2.0-flash` (or latest vision-capable model) |
| **API** | Google AI Generative Language API via REST |
| **Auth** | `GEMINI_API_KEY` stored in Supabase secrets (never exposed to frontend) |
| **Input** | Base64-encoded image/PDF page + structured extraction prompt |
| **Output** | JSON object of extracted fields |
| **Cost** | ~$0.01–0.05 per page |
| **Latency** | 2–8 seconds per page |

### 7.3 Extraction Prompt Design

**Invoice extraction prompt**:
```
Extract all invoice data from this document image.
Return a JSON object with:
{
  "vendor_name": "...",
  "invoice_number": "...",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "currency": "MYR",
  "reference_no": "...",
  "line_items": [
    { "description": "...", "quantity": 1, "unit_price": 100.00, "tax_rate": 0 }
  ],
  "subtotal": 100.00, "tax_total": 0, "total": 100.00
}
If any field is unclear, set it to null. Do not guess.
```

**Receipt extraction prompt**:
```
Extract payment/receipt data from this document image.
Return a JSON object with:
{
  "payer_name": "...",
  "receipt_date": "YYYY-MM-DD",
  "amount": 1000.00,
  "currency": "MYR",
  "payment_method": "TT|CHQ|CASH|CC|GIRO|ONLN",
  "reference_no": "..."
}
If any field is unclear, set it to null. Do not guess.
```

### 7.4 Confidence & Fallback

- Extracted fields shown in an **editable preview** table — user must review.
- Fields the AI couldn't extract are shown as empty with a warning badge.
- **No auto-execution for OCR-extracted data without explicit user confirmation.**

---

## 8. Invoice Import Flow (Phase A: Draft Only)

```
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌────────┐
│  Upload  │───►│  Parse   │───►│ Validate  │───►│ Execute  │───►│ Done   │
│  CSV     │    │ Extract  │    │ Map cols  │    │ Create   │    │ Review │
│  (Ph A)  │    │ rows     │    │ Match     │    │ DRAFTS   │    │ errors │
│          │    │          │    │ customers │    │ ONLY     │    │        │
│          │    │          │    │ Check     │    │ (no post │    │        │
│          │    │          │    │ dupes     │    │  in Ph A)│    │        │
└─────────┘    └──────────┘    └───────────┘    └──────────┘    └────────┘
```

### Step-by-step:

1. **Upload**: User selects CSV file + import type (invoice). File stored in Supabase Storage under `ar-imports/{company_id}/{batch_id}/`. `import_batches` row created with `status=Uploaded`.

2. **Parse**:
   - CSV: Column extraction, type coercion, header mapping.
   - Each row → `import_rows` with `raw_data` JSONB.
   - Status → `Parsed`.

3. **Preview & Map** (Frontend):
   - User sees extracted rows in editable data table.
   - Column mapping: source column → target field.
   - User can edit any cell inline, add/remove rows.

4. **Validate** (Backend — `POST /imports/:id/validate`):
   - For each row:
     - Match `customer_name` → `customers.id` (fuzzy search)
     - Validate date formats
     - Validate currency (valid 3-char ISO)
     - Check for duplicate `reference_no`
     - Validate line item amounts (> 0)
   - `import_rows.status` → `Valid` or `Error`
   - `import_rows.validation_errors` → JSONB array of issues

5. **Review** (Frontend):
   - User sees valid vs error rows.
   - Can fix errors inline and re-validate.
   - **Phase A: No auto-post option.** Drafts only.

6. **Execute** (Backend — `POST /imports/:id/execute`):
   - For each `Valid` row:
     - Call `POST /invoices` (existing Edge Function) → creates draft invoice
     - Record `import_rows.invoice_id`
     - Update `import_rows.status` → `Created`
   - If any row fails: mark row as `Error`, continue with next (partial success).
   - Batch status → `Completed`.

> [!IMPORTANT]
> **Phase A creates draft invoices only.** No auto-post. No posting.
> Posting requires explicit user action in Phase C.

---

## 9. Receipt Import Flow (Phase D)

```
Upload → Parse → Validate → Execute (Create + Post) → Compute Match → Confirm Allocation → Done
```

### Steps:

1–5. Same as invoice import flow (Phase A pipeline, extended for receipt fields).

6. **Execute**: Call `POST /receipts` (create draft). If user opted for posting: Call `POST /receipts/:id/post`.

7. **Compute Match** (Backend): For each posted receipt, compute proposed allocations:
   - Match by `reference_no` → same customer open invoices
   - Match by exact amount → same customer, single match
   - Match by FIFO → oldest open invoices first
   - Return proposed matches as a preview (no side effects).

8. **User Review** (Frontend): Display proposed matches in a confirmation UI. User can accept, modify amounts, or skip.

9. **Confirm Allocation**: For accepted matches, call `POST /allocations/manual` (verified RPC flow). Record each allocation in `import_row_allocations`.

> [!IMPORTANT]
> **No `POST /allocations/auto` in Phase D.** Matching is computed server-side, but the confirmed allocation always uses `POST /allocations/manual`.
> Unmatched receipts get `import_rows.status = 'Unmatched'`.

---

## 10. Auto Matching and Allocation Flow (Phase D)

### 10.1 Matching Strategies (Computed Proposals)

| # | Strategy | Logic | Confidence |
|---|----------|-------|-----------|
| 1 | Reference match | `receipt.reference_no` = `invoice.reference_no` AND same customer | High |
| 2 | Exact amount | `receipt.amount` = `invoice.outstanding` AND same customer, 1 match | High |
| 3 | FIFO | Oldest open invoices first, allocate until receipt exhausted | Medium |
| 4 | Partial match | Split receipt across multiple invoices by FIFO | Medium |

### 10.2 Safeguards

- Computed proposals only — user must confirm before execution
- Same-customer only
- Same-currency only (no cross-currency auto-allocation)
- Maximum allocation = unallocated receipt amount
- Confirmed allocation calls `POST /allocations/manual` → `allocate_receipt()` RPC
- All JEs (forex, discount) handled by existing RPC
- Over-allocation is impossible (RPC constraint)
- Each allocation recorded in `import_row_allocations` for full traceability

### 10.3 Fallback

- If no match found → receipt stays `Posted` with full `unallocated_amount`
- Import row status → `Unmatched`
- User can manually allocate via existing Allocation Wizard

---

## 11. Allocation Wizard Result / History Display

### 11.1 Allocation History Page (`/allocations/history`) — Phase E

> [!CAUTION]
> **BLOCKED until Phase E.** `GET /allocations` currently uses admin client without company/customer scoping. This is a cross-tenant data exposure risk.
>
> **Phase E prerequisites:**
> 1. Fix `AllocationService.listAllocations()` to filter by `auth.companyId`
> 2. Add customer access filtering (AR Clerk sees only assigned customers)
> 3. Remove admin client usage
> 4. Add SQL + curl smoke tests for tenant isolation
> 5. Then build the frontend allocation history page

### 11.2 Phase A–D: Placeholder

- Allocation history section on `/allocations` page remains placeholder
- Label: "Allocation history will be available after backend security review (Phase E)"
- Import batch detail page shows per-row allocation results inline (from `import_row_allocations`)

---

## 12. Row-Level Validation and Error Handling

### 12.1 Validation Rules

| Field | Invoice Rule | Receipt Rule |
|-------|-------------|-------------|
| `customer_name` | Required — fuzzy match to `customers` table | Required — fuzzy match |
| `date` | Required — valid date, not > 7 days future | Required — valid date |
| `currency` | Default `MYR` — must be valid 3-char ISO | Default `MYR` |
| `amount` / `unit_price` | > 0, max 2 decimal places | > 0, max 2 decimal places |
| `quantity` | > 0 | N/A |
| `payment_method` | N/A | Required — `CHQ\|TT\|CASH\|CC\|GIRO\|ONLN` |
| `reference_no` | Optional — duplicate check | Optional — duplicate check |
| `tax_rate` | 0–100% | N/A |

### 12.2 Error Handling Strategy

| Level | Handling |
|-------|---------|
| **File-level** | Invalid format, too large, corrupted → batch `Failed`, user-facing error |
| **Row-level** | Individual rows can fail; valid rows proceed. Partial success. |
| **API-level** | If `POST /invoices` call fails → row marked `Error` with API error message |
| **RPC-level** | If `post_invoice()` raises exception (Phase C) → row marked `Error`, draft remains |
| **Allocation-level** | If allocation fails (Phase D) → receipt stays `Posted`, row → `Unmatched` |

### 12.3 Error Display

- Each `import_row` has `validation_errors` JSONB array
- Frontend shows errors inline per cell (red border + tooltip)
- Batch summary: ✅ 47 valid / ❌ 3 errors / ⏭ 0 skipped / ❓ 2 unmatched
- User can fix errors and re-validate before execution

---

## 13. Import Batch Status Tracking

### 13.1 Status Flow

```
Uploaded → Parsing → Parsed → Validating → Validated → Executing → Completed
                                    │                       │
                                    ▼                       ▼
                                 Failed                  Failed

Any status → Cancelled (soft-cancel, with reason)
```

### 13.2 Import Row Status Flow

```
Pending → Valid → Created → Posted (Phase C) → Allocated (Phase D)
   │        │                    │
   ▼        ▼                    ▼
 Error    Error               Unmatched
   │
   ▼
 Skipped
```

---

## 14. Auditability and Financial Control

### 14.1 Audit Trail

| Event | Audit Record |
|-------|-------------|
| Batch created | `import_batches.created_by`, `created_at` |
| Batch cancelled | `import_batches.cancelled_by`, `cancelled_at`, `cancel_reason` |
| Row validation | `import_rows.validation_errors` (preserved in JSONB) |
| Invoice created (draft) | `invoices.created_by` = import user (via `POST /invoices`) |
| Invoice posted (Phase C) | `invoices.posted_by`, `posted_at` via `post_invoice()` RPC |
| Receipt created (Phase D) | `receipts.created_by` = import user (via `POST /receipts`) |
| Receipt posted (Phase D) | `receipts.posted_by`, `posted_at` via `post_receipt()` RPC |
| Allocation (Phase D) | `allocation_details.allocated_by`, `allocation_method = 'Manual'` via `allocate_receipt()` RPC |
| Allocation traceability | `import_row_allocations` links import row → allocation_details |
| JE generated | `journal_entries.created_by`, `source_doc_id` links to source |

### 14.2 Traceability Chain

```
File (Supabase Storage)
  └─ import_batches (batch metadata)
       └─ import_rows (per-row data + status)
            ├─ invoices (invoice_id FK)
            │    └─ journal_entries (via post_invoice RPC)
            ├─ receipts (receipt_id FK)
            │    └─ journal_entries (via post_receipt RPC)
            └─ import_row_allocations (1:N)
                 └─ allocation_details (via allocate_receipt RPC)
                      └─ journal_entries (forex/discount JEs)
```

### 14.3 Financial Controls

- Import NEVER directly inserts into `invoices`, `receipts`, `allocation_details`, or `journal_entries`
- All financial mutations go through verified Edge Functions → RPCs
- Credit limit checks enforced by `post_invoice()` RPC
- Fiscal period checks enforced by RPCs
- Customer status checks enforced by RPCs
- RLS + RBAC enforced by Edge Functions
- All allocations are reversible via `reverse_allocation` RPC (Phase E)
- Import evidence is append-only — no hard deletes

---

## 15. Security / Tenant Isolation / RLS

| Control | Implementation |
|---------|---------------|
| **Tenant isolation** | `import_batches.company_id` + RLS `USING` + `WITH CHECK` policies |
| **Cross-company write prevention** | `WITH CHECK` ensures `company_id` matches user's active role |
| **Inactive role rejection** | All policies filter `is_active = TRUE` |
| **RBAC** | Only `AR Clerk`, `AR Supervisor`, `Finance Manager` can create imports; `Auditor` can read |
| **System Admin exclusion** | System Admin has no import access (not an operational role) |
| **No hard deletes** | No DELETE RLS policies = denied by default |
| **File storage isolation** | Company-scoped storage paths: `ar-imports/{company_id}/...` |
| **Storage RLS** | Storage policies scope by company_id prefix |
| **No public bucket** | `ar-imports` bucket is private, authenticated access only |
| **OCR API key** | `GEMINI_API_KEY` stored in Supabase secrets (Phase F only) |
| **No frontend bypass** | Frontend → Edge Functions → RPCs → database |
| **Optimistic locking** | Invoice `version` field prevents concurrent modification |

---

## 16. API Testing Strategy

### 16.1 Postman: Optional, NOT Required

> **Postman is NOT required.** All API testing can be done with `curl`/PowerShell scripts and SQL-based smoke tests. Postman adds convenience but no unique capability.

### 16.2 Recommended Testing Approach

| Layer | Tool | Description |
|-------|------|-------------|
| **Database tables & RLS** | SQL smoke tests (`.sql` files) | Verify table constraints, RLS tenant isolation, cross-company rejection |
| **Edge Functions** | `curl` / PowerShell scripts (`.ps1`) | HTTP calls to deployed Edge Functions |
| **Frontend integration** | Browser dev tools + manual testing | Verify end-to-end flow |
| **OCR accuracy** | Sample file tests (Phase F) | Run OCR on known documents, compare output |

### 16.3 Evidence Test Scripts Per Phase

**Phase A evidence scripts:**
```
tests/curl/import-phase-a-upload-csv.ps1           # CSV upload → batch created
tests/curl/import-phase-a-parse.ps1                # Parse → rows extracted
tests/curl/import-phase-a-validate.ps1             # Validate → valid/error rows
tests/curl/import-phase-a-execute-draft.ps1        # Execute → draft invoices created
tests/curl/import-phase-a-validation-failure.ps1   # Row with invalid customer → Error
tests/curl/import-phase-a-tenant-isolation.ps1     # Cross-company read/write rejection
tests/sql/008b_import_rls_smoke_tests.sql          # RLS: cross-tenant isolation verification
```

**Phase C evidence scripts:**
```
tests/curl/import-phase-c-post-confirmation.ps1    # User confirms → post via POST /invoices/:id/post
tests/curl/import-phase-c-partial-failure.ps1      # Some rows fail posting → partial success
```

**Phase D evidence scripts:**
```
tests/curl/import-phase-d-receipt-upload.ps1       # Receipt CSV upload
tests/curl/import-phase-d-computed-match.ps1       # Matching proposals returned
tests/curl/import-phase-d-confirm-allocation.ps1   # Confirmed match → POST /allocations/manual
tests/curl/import-phase-d-unmatched.ps1            # No match → status = Unmatched
```

### 16.4 curl vs Postman

| Postman Feature | curl/Script Equivalent |
|----------------|----------------------|
| Send request | `curl` or `Invoke-RestMethod` |
| Set headers | `-H "Authorization: Bearer ..."` |
| Upload files | `-F "file=@filename"` |
| View response | `\| jq .` or PowerShell JSON parsing |
| Test collections | `.ps1` script with multiple calls |
| Environment variables | `.env` file + shell variable substitution |
| Automated assertions | `jq` + shell conditionals or PowerShell `-match` |

---

## 17. Manual Override and Review/Confirm Controls

### 17.1 User Confirmation Gates

| Gate | Phase | When | User Action |
|------|-------|------|-------------|
| **Preview after parse** | A | After file is parsed → rows displayed | User reviews, edits cells, maps columns |
| **Validation review** | A | After validation → errors highlighted | User fixes errors or skips bad rows |
| **Execute confirmation** | A | Before creating drafts | User clicks "Create Drafts" |
| **Post confirmation** | C | After drafts exist | User explicitly selects drafts to post |
| **Allocation review** | D | After computed matches shown | User confirms, edits amounts, or skips |
| **Allocation reversal** | E | Post-allocation | User can reverse via existing allocation wizard |

### 17.2 Manual Mode

- Manual invoice/receipt creation (`/invoices/new`, `/receipts/new`) remains fully available.
- Allocation Wizard (`/allocations`) remains fully available.
- Import is an accelerator, not a replacement.

### 17.3 Inline Editing

- Parsed rows displayed in an editable data table.
- User can correct customer names, amounts, dates inline.
- Changed cells highlighted with a "modified" badge.
- Re-validation triggered when user clicks "Validate".

---

## 18. Acceptance Criteria

### Phase A: CSV Invoice Import (Draft Only)

- [ ] CSV upload creates a batch and stores file in company-scoped storage
- [ ] Parse extracts rows correctly with header mapping
- [ ] Parsed rows displayed in editable preview table
- [ ] Customer name matching resolves to correct `customer_id`
- [ ] Duplicate invoice detection works (by `reference_no`)
- [ ] Valid rows bulk-created as **draft** invoices via `POST /invoices`
- [ ] Failed rows show clear error messages with field-level detail
- [ ] Partial success: good rows → `Created`, bad rows → `Error`
- [ ] **No posting in Phase A** — drafts only
- [ ] RLS prevents cross-tenant batch/row access
- [ ] Storage policy prevents cross-company file access
- [ ] SQL + curl smoke tests pass

### Phase B: Excel Support

- [ ] .xlsx upload parsed using same validation pipeline as CSV
- [ ] Excel date serial numbers converted correctly

### Phase C: Explicit Posting

- [ ] User can select draft invoices to post
- [ ] Posting calls `POST /invoices/:id/post` (→ `post_invoice()` RPC)
- [ ] Partial failure: some rows fail posting → error shown, others proceed
- [ ] Credit limit, fiscal period, customer status checks enforced by RPC

### Phase D: Receipt Import + Allocation

- [ ] Receipt CSV import creates drafts via `POST /receipts`
- [ ] Receipt posting calls `POST /receipts/:id/post` (→ `post_receipt()` RPC)
- [ ] Computed matching proposals shown for user review
- [ ] Confirmed allocation calls `POST /allocations/manual` (→ `allocate_receipt()` RPC)
- [ ] Each allocation recorded in `import_row_allocations`
- [ ] Unmatched receipts → `import_rows.status = 'Unmatched'`
- [ ] Over-allocation impossible (RPC constraint)
- [ ] **No `POST /allocations/auto` used**

### Phase E: Allocation History

- [ ] `GET /allocations` fixed: company-scoped, customer-access-scoped
- [ ] `listAllocations()` no longer uses admin client
- [ ] SQL + curl smoke tests verify tenant isolation
- [ ] Frontend allocation history page shows allocations with filter/sort
- [ ] Allocation reversal available

### Phase F: OCR

- [ ] `ocr-extract` Edge Function calls Gemini Vision API
- [ ] `GEMINI_API_KEY` never exposed to frontend
- [ ] OCR output shown in editable review table
- [ ] No auto-execution — user must confirm before creating drafts
- [ ] Extraction accuracy acceptable for invoices and receipts

### Cross-Cutting

- [ ] No direct inserts into `invoices`, `receipts`, `allocation_details`, or `journal_entries`
- [ ] All financial mutations go through verified Edge Functions → RPCs
- [ ] Import evidence is append-only (no hard deletes)
- [ ] Build passes with zero errors

---

## 19. Implementation Phases

### Phase A: CSV Invoice Import — Draft Only
> **Backend**: Codex | **Frontend**: Claude

| # | Task | Owner |
|---|------|-------|
| A.1 | Create migration `008_import_tables.sql` (import_batches, import_rows, import_row_allocations, import_files) | Codex |
| A.2 | Add RLS policies with USING + WITH CHECK for all import tables | Codex |
| A.3 | Create Supabase Storage bucket `ar-imports` with company-scoped policies | Codex |
| A.4 | Create `imports` Edge Function: upload, parse CSV, validate, execute (draft only) | Codex |
| A.5 | Create SQL smoke tests: table constraints, RLS tenant isolation | Codex |
| A.6 | Create curl smoke tests: upload, parse, validate, execute, tenant isolation | Codex |
| A.7 | Create Import Hub page (`/import`) | Claude |
| A.8 | Create Import Wizard page (`/import/new`) with CSV upload | Claude |
| A.9 | Create Batch Detail page (`/import/[id]`) | Claude |
| A.10 | Update sidebar navigation | Claude |
| A.11 | Frontend build verification | Claude |

### Phase B: Excel Support
> **Backend**: Codex | **Frontend**: Claude

| # | Task | Owner |
|---|------|-------|
| B.1 | Add `.xlsx` parser to `imports` Edge Function (same validation pipeline) | Codex |
| B.2 | Handle Excel date serial number conversion | Codex |
| B.3 | curl smoke tests for Excel upload | Codex |
| B.4 | Update Import Wizard to accept .xlsx files | Claude |

### Phase C: Explicit Posting Confirmation
> **Backend**: Codex | **Frontend**: Claude

| # | Task | Owner |
|---|------|-------|
| C.1 | Add posting step to `imports` Edge Function execute route | Codex |
| C.2 | Ensure posting calls `POST /invoices/:id/post` (not direct insert) | Codex |
| C.3 | Handle partial failure (some posts fail, others succeed) | Codex |
| C.4 | curl smoke tests: posting confirmation, partial failure | Codex |
| C.5 | Add posting confirmation UI to Import Wizard / Batch Detail | Claude |

### Phase D: Receipt Import + Computed Allocation
> **Backend**: Codex | **Frontend**: Claude

| # | Task | Owner |
|---|------|-------|
| D.1 | Extend `imports` Edge Function for receipt CSV parsing + validation | Codex |
| D.2 | Implement matching strategy computation (reference, exact amount, FIFO) | Codex |
| D.3 | Matching proposals returned as preview (no side effects) | Codex |
| D.4 | Confirmed allocation calls `POST /allocations/manual` only | Codex |
| D.5 | Record allocations in `import_row_allocations` table | Codex |
| D.6 | Mark unmatched receipt rows as `Unmatched` | Codex |
| D.7 | curl smoke tests: receipt import, match proposals, allocation confirmation, unmatched | Codex |
| D.8 | Receipt import UI in Import Wizard | Claude |
| D.9 | Allocation match review/confirm UI | Claude |

### Phase E: Allocation History (Requires Backend Fix First)
> **Backend**: Codex | **Frontend**: Claude

| # | Task | Owner |
|---|------|-------|
| E.1 | Fix `AllocationService.listAllocations()` — scope by company_id + customer access | Codex |
| E.2 | Remove admin client usage from allocation list | Codex |
| E.3 | SQL + curl smoke tests: tenant isolation for GET /allocations | Codex |
| E.4 | Verify POST /allocations/:id/reverse works correctly | Codex |
| E.5 | Create Allocation History page (`/allocations/history`) | Claude |
| E.6 | Update `/allocations` page: remove placeholder, link to history | Claude |

### Phase F: PDF/Image OCR
> **Backend**: Codex (proxy security) | **Frontend/Prompts**: Claude

| # | Task | Owner |
|---|------|-------|
| F.1 | Create `ocr-extract` Edge Function (Gemini proxy) | Codex |
| F.2 | Ensure `GEMINI_API_KEY` is in Supabase secrets only | Codex |
| F.3 | Add RBAC check to OCR endpoint | Codex |
| F.4 | Design invoice extraction prompt | Claude |
| F.5 | Design receipt extraction prompt | Claude |
| F.6 | Test OCR accuracy with sample documents | Claude |
| F.7 | Integrate OCR results into import parse flow | Codex |
| F.8 | OCR preview UI (editable, review-only before confirm) | Claude |

---

## 20. Codex Backend Implementation Checklist

### Database (Phase A)

- [ ] Create migration: `008_import_tables.sql`
  - [ ] `import_batches` table — no ON DELETE CASCADE, soft-cancel fields
  - [ ] `import_rows` table — no ON DELETE CASCADE, `Unmatched` status included
  - [ ] `import_row_allocations` table — normalized 1:N allocation tracking
  - [ ] `import_files` table — for Phase F OCR
  - [ ] RLS: USING + WITH CHECK on all tables
  - [ ] RLS: inactive role rejection
  - [ ] RLS: no DELETE policies (append-only)
  - [ ] RLS: Auditor can SELECT, not INSERT/UPDATE
  - [ ] Indexes and comments
- [ ] Create Supabase Storage bucket `ar-imports`
  - [ ] Private bucket (no public access)
  - [ ] Company-scoped path convention
  - [ ] Storage RLS policies (SELECT + INSERT by company_id prefix)
  - [ ] No DELETE policy on storage
- [ ] Create SQL smoke tests: `008b_import_rls_smoke_tests.sql`
  - [ ] Cross-tenant read rejection
  - [ ] Cross-company write rejection
  - [ ] Inactive role rejection
  - [ ] Auditor read-only verification

### Edge Functions (Phase A)

- [ ] Create `imports` Edge Function
  - [ ] `POST /imports/upload` — file upload + batch creation + storage
  - [ ] `POST /imports/:id/parse` — CSV parsing → `import_rows`
  - [ ] `POST /imports/:id/validate` — row-level validation
  - [ ] `POST /imports/:id/execute` — bulk create drafts via `POST /invoices` (NO posting)
  - [ ] `GET /imports` — list batches (company-scoped)
  - [ ] `GET /imports/:id` — batch detail
  - [ ] `GET /imports/:id/rows` — row listing with pagination
  - [ ] RBAC check: operational roles only
  - [ ] Company-id validation on all routes
- [ ] Create curl test scripts: `tests/curl/import-phase-a-*.ps1`
  - [ ] CSV upload
  - [ ] Draft invoice creation
  - [ ] Row-level validation failure
  - [ ] Tenant isolation (cross-company rejection)

### NOT in Phase A Scope

- [ ] ❌ No `POST /allocations/auto`
- [ ] ❌ No `GET /allocations`
- [ ] ❌ No `ocr-extract` Edge Function
- [ ] ❌ No auto-posting
- [ ] ❌ No direct inserts into financial tables

---

## 21. Responsibility Matrix

### Claude's Responsibilities

| Area | Tasks |
|------|-------|
| **Documentation** | Sprint plans, smoke test summaries, client demo checklists |
| **Frontend UI** | Import Hub, Import Wizard, Batch Detail pages |
| **Frontend Hooks** | `use-import.ts` hook for API calls |
| **Import Preview UX** | Editable data table, column mapping, validation display |
| **OCR Prompt Design** | Invoice/receipt extraction prompts (Phase F) |
| **Build Verification** | `npm run build` passes |
| **Client Demo Docs** | Updated demo checklists and walkthroughs |

### Codex's Responsibilities

| Area | Tasks |
|------|-------|
| **SQL Migrations** | `008_import_tables.sql` with all constraints and RLS |
| **RLS Policies** | USING + WITH CHECK, tenant isolation, inactive role rejection |
| **Storage Policies** | Bucket creation, company-scoped access, no public access |
| **Edge Functions** | `imports` Edge Function (all routes), `ocr-extract` (Phase F) |
| **Financial Service Logic** | Ensure import execution reuses existing verified flows |
| **Matching Algorithms** | Computed allocation proposals (Phase D) |
| **OCR Proxy Security** | GEMINI_API_KEY management, RBAC on OCR endpoint (Phase F) |
| **Backend Tests** | SQL smoke tests, curl/PowerShell API tests |
| **Security Verification** | Cross-tenant isolation, RBAC enforcement |

### Shared Responsibilities

| Area | Tasks |
|------|-------|
| **API Contract** | Agree on request/response shapes before implementation |
| **End-to-End Testing** | Full import → allocate → verify flow |
| **Edge Case Handling** | Error scenarios, partial failures, duplicate detection |

---

## 22. Testing Strategy Summary

| Tool | Purpose | Required? |
|------|---------|----------|
| **Postman** | Interactive API testing | ❌ **Optional** — curl scripts are sufficient |
| **curl / PowerShell** | Automated API smoke tests | ✅ **Recommended** — primary testing tool |
| **SQL scripts** | Database-level RLS and constraint testing | ✅ **Required** — foundational verification |
| **Browser DevTools** | Frontend debugging and network inspection | ✅ **Required** |
| **`npm run build`** | Frontend compilation verification | ✅ **Required** |
| **Gemini AI Studio** | OCR prompt testing and iteration (Phase F) | ✅ **Recommended** for Phase F |

---

*Plan revised: 2026-05-28T15:55:00+08:00*  
*Status: Revised v2.0 — Awaiting Codex re-review*  
*Author: Claude (GenAI-assisted development)*
