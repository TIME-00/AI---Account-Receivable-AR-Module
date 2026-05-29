# Sprint F4 Phase B — Excel Invoice Import (Draft Only): Technical Plan

**Date**: 2026-05-30 (Revised)  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟡 Revised — Awaiting Codex re-review  
**Revision**: v1.2 — Addresses 2 additional Codex findings from v1.1  
**Prerequisite**: Phase A production verified ✅

---

> [!IMPORTANT]
> **Revision Summary (v1.1 → v1.2)**
> 1. `009_import_excel_storage_update.sql` now preserves `application/csv` MIME type — prevents CSV upload regression from browser MIME variance
> 2. Validator wording corrected — `validateCreateInvoice()` and `validateInvoiceLines()` are standalone validators, not `InvoiceService` methods
>
> **Previous revisions (v1.0 → v1.1)**: Added 009 migration, upload/guard updates, pinned XLSX dependency, removed unverified validation rules, expanded testing, corrected implementation order

---

## 1. Goal

Add `.xlsx` (Excel) file support to the existing `imports` Edge Function. Excel files are parsed into the same `import_rows.raw_data` JSONB structure as CSV. All downstream processing (validation, draft creation, batch tracking) is reused from Phase A without modification.

### What Changes

| Component | Change | Owner |
|-----------|--------|-------|
| Storage MIME whitelist | New migration `009_import_excel_storage_update.sql` | Codex |
| `imports` Edge Function — upload route | Accept `file_type IN ('csv', 'xlsx')` | Codex |
| `imports` Edge Function — parse handler | Add XLSX parser branch | Codex |
| `imports` Edge Function — parse/validate/execute guards | Allow `file_type IN ('csv', 'xlsx')` | Codex |
| `imports` Edge Function — `deno.json` | Add pinned SheetJS dependency | Codex |
| Frontend Import Wizard | Accept `.csv` + `.xlsx`, detect `file_type` | Claude |
| Frontend labels | Update to "CSV/Excel Invoice Import — Draft Only" | Claude |

### What Does NOT Change

| Component | Status |
|-----------|--------|
| `import_batches` table schema | No change — `chk_file_type` already includes `'xlsx'` |
| `import_rows` table schema | No change |
| `import_row_allocations` table schema | No change |
| `import_files` table schema | No change |
| RLS policies on import tables | No change — format-agnostic |
| Validation pipeline logic | No change — operates on `raw_data` JSONB |
| Draft execution logic | No change — calls `InvoiceService.createInvoice()` per valid row |
| Other Edge Functions (invoices, receipts, allocations, etc.) | No change |

---

## 2. Database Migration (Codex)

### 2.1 `009_import_excel_storage_update.sql`

A small migration to update the Supabase Storage bucket MIME whitelist to allow Excel files.

```sql
-- ============================================================================
-- 009_import_excel_storage_update.sql
-- Sprint F4 Phase B: Allow .xlsx uploads to ar-imports bucket
-- ============================================================================

-- Update ar-imports bucket to allow Excel MIME type
-- IMPORTANT: Preserve application/csv alongside text/csv.
-- Browsers may send either MIME type for .csv files.
-- Removing application/csv could regress Phase A CSV uploads.
-- Bucket remains private (no public access)
-- Company-scoped storage path unchanged: ar-imports/{company_id}/{batch_id}/
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
WHERE id = 'ar-imports';

-- Verify update
-- SELECT id, allowed_mime_types, public FROM storage.buckets WHERE id = 'ar-imports';
-- Expected: public = false, allowed_mime_types includes all 4 MIME types
```

> [!WARNING]
> **CSV upload must not regress.** Browsers may send `.csv` files as `text/csv` or `application/csv` depending on OS/browser. Both MIME types must remain in the allowed list. Phase A CSV smoke test must still pass after running this migration.

> [!CAUTION]
> **Bucket must remain private.** No `public = true`. No weakening of existing storage RLS policies. Company-scoped path convention unchanged. No removal of existing CSV MIME types.

### 2.2 No Other Schema Changes

- `import_batches.file_type` CHECK constraint already includes `'xlsx'`.
- RLS policies are format-agnostic (they scope by company/batch, not file type).
- No new tables required.

---

## 3. Backend Changes (Codex)

### 3.1 Upload Route — Accept CSV and XLSX

**File**: `imports` Edge Function — upload handler

**Current behavior**: Upload route only accepts `file_type = 'csv'`. All other file types are rejected.

**Required change**: Accept `file_type IN ('csv', 'xlsx')`. Reject all other values.

```
// Pseudocode
const allowedFileTypes = ['csv', 'xlsx'];
if (!allowedFileTypes.includes(file_type)) {
  return error(400, 'Unsupported file type. Allowed: csv, xlsx');
}

// import_type must still be 'invoice' only
if (import_type !== 'invoice') {
  return error(400, 'Only invoice import is supported');
}
```

### 3.2 Parse Handler — Add XLSX Branch

**Current flow**: Parse handler only handles CSV.

**Required change**: Add an XLSX branch alongside the existing CSV parser. Both branches produce the same `raw_data` JSONB shape.

```
if (batch.file_type === 'csv') {
  rows = csvParser.parse(fileContent);
} else if (batch.file_type === 'xlsx') {
  rows = xlsxParser.parse(fileContent);  // NEW
} else {
  return error(400, 'Unsupported file type for parsing');
}
// Downstream: insert into import_rows with raw_data JSONB — same for both
```

### 3.3 Parse/Validate/Execute Guards

**Current behavior**: Guards may check for CSV-only.

**Required change**: All three route guards (`parse`, `validate`, `execute`) must allow:
- `import_type = 'invoice'` (reject `'receipt'` — Phase D)
- `file_type IN ('csv', 'xlsx')` (reject `'pdf'`, `'image'` — Phase G)

No posting guard change needed — Phase A already blocks posting.

### 3.4 XLSX Parser Implementation

| Aspect | Detail |
|--------|--------|
| **Library** | SheetJS — pinned version (see §3.5) |
| **Sheet selection** | First sheet only (index 0) |
| **Header row** | Row 1 = column headers (same names as CSV) |
| **Date handling** | Excel serial date numbers → ISO `YYYY-MM-DD` strings |
| **Number handling** | Preserve numeric precision, max 2 decimal places for amounts |
| **Empty rows** | Skip rows where all cells are empty |
| **Max rows** | 500 per batch (same as CSV limit) |
| **Max file size** | 10 MB (Excel files are larger than CSV due to XML/zip packaging) |

#### Date Conversion

Excel stores dates as serial numbers (e.g., `46174` = `2026-05-28`). The parser must detect and convert these. SheetJS provides utility functions for this — use `XLSX.SSF.parse_date_code()` or the `cellDates: true` read option.

If dates are stored as text strings (`YYYY-MM-DD`), pass them through unchanged.

#### Output Format

The XLSX parser must produce the exact same `raw_data` JSONB shape as the CSV parser:

```json
{
  "customer_code": "CUST-001",
  "invoice_date": "2026-05-28",
  "currency": "MYR",
  "description": "Consulting Services",
  "quantity": 1,
  "unit_price": 5000.00,
  "tax_rate": 0,
  "reference_no": "REF-001"
}
```

### 3.5 XLSX Dependency — Pinned Version

> [!WARNING]
> **Do not use floating `latest`.** Do not use `npm xlsx 0.18.x`. Use a pinned, Deno-compatible SheetJS version.

**Recommended approach**: Add the dependency to the `imports` Edge Function's `deno.json` (or `import_map.json`) following Supabase Edge Function dependency guidance.

```jsonc
// backend/supabase/functions/imports/deno.json
{
  "imports": {
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs"
  }
}
```

**Codex must verify**:
- The pinned version is Deno-compatible (ESM import, no Node.js polyfills needed).
- Bundle size is acceptable for Edge Function cold-start.
- Runtime compatibility test passes (read `.xlsx` file, extract rows, convert dates).
- If `xlsx-0.20.3` has compatibility issues, select the most recent stable pinned version that works.

### 3.6 Draft Execution — Correct Wording

> [!IMPORTANT]
> **Draft execution does NOT call `POST /invoices` HTTP endpoint internally.**
> It reuses `InvoiceService.createInvoice()` for draft creation, and the standalone `validateCreateInvoice()` and `validateInvoiceLines()` validator functions for pre-validation — all within the Edge Function runtime.
> No HTTP self-call. No direct insert into `invoices` or `invoice_lines` tables.

The execution step for each valid import row:
1. Calls `validateCreateInvoice(mappedData)` — field validation (standalone validator)
2. Calls `validateInvoiceLines(lines)` — line item validation (standalone validator)
3. Calls `InvoiceService.createInvoice(data)` — creates draft invoice (service method)
4. Records `import_rows.invoice_id` = created invoice ID
5. Updates `import_rows.status` = `'Created'`

This is the same flow used by Phase A CSV import. No change for Phase B.

### 3.7 Validation Pipeline — No New Rules

Phase B reuses the existing Phase A validation pipeline without modification. The validation step operates on `import_rows.raw_data` JSONB and is format-agnostic.

**Do not add new business validation rules for Phase B** (e.g., date range checks, credit limit pre-checks) unless separately approved. Phase B scope is strictly: add Excel parsing → feed into existing pipeline.

---

## 4. Frontend Changes (Claude)

### 4.1 Import Wizard — File Acceptance

**File**: `frontend/src/app/(dashboard)/invoices/import/page.tsx`

| Change | Detail |
|--------|--------|
| File input `accept` attribute | Change from `.csv` to `.csv,.xlsx` |
| File type validation | Accept `.csv` and `.xlsx` extensions; reject all others |
| File size limit | `.csv` → 5 MB; `.xlsx` → 10 MB |
| Upload `file_type` param | Detect from extension: `.csv` → `'csv'`, `.xlsx` → `'xlsx'` |
| Drop zone label | "Drag & drop CSV or Excel file here" |
| Browse label | "or click to browse · .csv / .xlsx" |

### 4.2 Template Guide Update

Rename section from "CSV template & column guide" to "Import template & column guide".

Add Excel-specific notes:
- Same column headers as CSV, in Row 1
- Dates can be Excel date cells or `YYYY-MM-DD` text — both work
- Numbers should be plain numeric cells (no currency symbol formatting)
- First sheet only — additional sheets are ignored
- Merged cells not supported — unmerge before import
- Formulas are evaluated (result value used, not formula text)

### 4.3 Phase Label Update

**Current**: "Phase A: CSV Invoice Import — Draft Only"  
**Updated**: "CSV & Excel Invoice Import — Draft Only"

Draft-only warning banner remains unchanged.

### 4.4 Hook Changes

**File**: `frontend/src/hooks/use-import.ts`

| Change | Detail |
|--------|--------|
| `uploadCsv` method | Update to detect file extension and send correct `file_type` (`'csv'` or `'xlsx'`) |
| `formData.append('file_type', ...)` | Set based on file extension, not hardcoded `'csv'` |
| No other changes | All response handling, batch/row state management remains identical |

---

## 5. Excel Template Format

### 5.1 Column Headers (Row 1)

| Column | Required | Cell Type | Description |
|--------|----------|-----------|-------------|
| `customer_code` | ✅ Yes | Text | Must match existing `customers.customer_id` (e.g. `CUST-001`) |
| `invoice_date` | ✅ Yes | Date or Text | Excel date cell or `YYYY-MM-DD` string |
| `currency` | Optional | Text | 3-letter ISO code (default: `MYR`) |
| `description` | ✅ Yes | Text | Line item description |
| `quantity` | ✅ Yes | Number | Positive integer or decimal |
| `unit_price` | ✅ Yes | Number | Positive number, max 2 decimal places |
| `tax_rate` | Optional | Number | 0–100 (default: `0`) |
| `reference_no` | Optional | Text | External reference number |

### 5.2 Excel-Specific Rules

| Rule | Detail |
|------|--------|
| First sheet only | Parser reads sheet at index 0; additional sheets ignored |
| Header row | Row 1 must contain column names exactly as listed above |
| Date cells | Excel date serial numbers auto-converted to `YYYY-MM-DD` |
| Text dates | `YYYY-MM-DD` strings passed through unchanged |
| Number cells | Currency-formatted cells (`$1,000.00`) read as raw number (`1000`) |
| Empty rows | Rows with all empty cells are skipped |
| Merged cells | Not supported — unmerge before import |
| Formulas | Cell values evaluated (result used, not formula text) |
| Max rows | 500 data rows (excluding header) |
| Max file size | 10 MB |

---

## 6. Data Mapping

```
┌─────────────────────────────────────┐
│          Excel File (.xlsx)         │
│                                     │
│  Row 1: Headers                     │
│  Row 2+: Data rows                  │
└──────────────┬──────────────────────┘
               │
               ▼  XLSX parser (SheetJS, pinned)
               │  - Reads first sheet (index 0)
               │  - Maps Row 1 headers to keys
               │  - Converts date serials → YYYY-MM-DD
               │  - Converts numbers → plain values
               │  - Skips empty rows
               │
┌──────────────┴──────────────────────┐
│      import_rows.raw_data (JSONB)   │
│                                     │
│  IDENTICAL shape to CSV parser:     │
│  {                                  │
│    "customer_code": "CUST-001",     │
│    "invoice_date": "2026-05-28",    │
│    "currency": "MYR",              │
│    "description": "...",            │
│    "quantity": 1,                   │
│    "unit_price": 5000.00,           │
│    "tax_rate": 0,                   │
│    "reference_no": "REF-001"        │
│  }                                  │
└──────────────┬──────────────────────┘
               │
               ▼  (UNCHANGED from Phase A)
               │
    ┌──────────┴──────────────────┐
    │  Validation step            │ ← No change — same validators
    │  Draft execution            │ ← No change — InvoiceService.createInvoice()
    │  Batch tracking             │ ← No change — same status flow
    └─────────────────────────────┘
```

---

## 7. Security and Tenant Isolation

### 7.1 Changes Required

| Aspect | Change |
|--------|--------|
| Storage MIME whitelist | Add `.xlsx` MIME type via `009_import_excel_storage_update.sql` |
| Upload route guard | Accept `file_type IN ('csv', 'xlsx')` — reject all others |
| Parse/validate/execute guards | Allow `file_type IN ('csv', 'xlsx')`, `import_type = 'invoice'` |

### 7.2 No Changes Required

| Aspect | Status |
|--------|--------|
| RLS on `import_batches` | ✅ Format-agnostic — scopes by `company_id` |
| RLS on `import_rows` | ✅ Scoped through `batch_id` → company — format-agnostic |
| RLS on `import_row_allocations` | ✅ Scoped through `import_row_id` → batch → company |
| RLS on `import_files` | ✅ Scoped through `batch_id` → company |
| Storage RLS policies | ✅ Scoped by company_id prefix — format-agnostic |
| Storage bucket visibility | ✅ Remains private |
| Storage path convention | ✅ `ar-imports/{company_id}/{batch_id}/{filename.xlsx}` |
| RBAC | ✅ Same roles: AR Clerk, AR Supervisor, Finance Manager |
| System Admin exclusion | ✅ Already excluded from import data |

### 7.3 Verification Required

| Check | How |
|-------|-----|
| Upload `.xlsx` to wrong company prefix rejected | curl test with cross-company token |
| Parse `.xlsx` for another company's batch rejected | curl test with cross-company token |
| Imported draft invoices scoped to correct company | SQL query after import |
| Non-allowed MIME types still rejected | curl test with `.pdf` upload |
| Bucket still private after migration | SQL query: `SELECT public FROM storage.buckets WHERE id = 'ar-imports'` |

---

## 8. Testing Strategy

### 8.1 CSV Regression (Codex)

| Test | Script | Expected |
|------|--------|----------|
| Phase A CSV import still works | `tests/curl/import-phase-a-smoke.ps1` | All steps pass — upload, parse, validate, execute |
| CSV drafts remain Draft | Same script | `posted_count = 0`, `allocated_count = 0` |

> [!IMPORTANT]
> **CSV regression must pass before Phase B is considered complete.** Phase A functionality must not be broken.

### 8.2 Excel Tests (Codex)

| Test | Script | Description |
|------|--------|-------------|
| Excel valid upload | `tests/curl/import-phase-b-xlsx-valid.ps1` | Upload valid `.xlsx` → batch created with `file_type = 'xlsx'` |
| Excel parse | Same script | Parse → rows extracted, `raw_data` shape matches CSV output |
| Excel validate | Same script | Validate → valid rows identified |
| Excel execute draft | Same script | Execute → draft invoices created |
| Excel result check | Same script | `posted_count = 0`, `allocated_count = 0`, `receipt_id = null` |
| Excel no journal entries | SQL query in script | No `journal_entries` rows created by import |
| Excel invalid fixture | `tests/curl/import-phase-b-xlsx-invalid.ps1` | Invalid customer, bad date → row errors |
| Excel date serial | `tests/curl/import-phase-b-xlsx-date-serial.ps1` | Date serial `46174` → `2026-05-28` verified |
| Excel numeric cells | `tests/curl/import-phase-b-xlsx-numeric.ps1` | Currency-formatted cells → correct plain numbers |
| Excel tenant isolation | `tests/curl/import-phase-b-xlsx-tenant.ps1` | Cross-company upload/parse rejection |
| Non-xlsx rejection | Include in valid test | Upload `.pdf` → rejected by upload route |

### 8.3 Test Fixtures (Codex)

| Fixture | Location | Contents |
|---------|----------|----------|
| Valid Excel | `tests/fixtures/phase-b-valid-invoice.xlsx` | 2 valid rows, correct headers, date cells, numeric cells |
| Invalid Excel | `tests/fixtures/phase-b-invalid-invoice.xlsx` | 1 valid row, 1 row with bad customer, 1 row with bad date |
| Date serial Excel | `tests/fixtures/phase-b-date-serial.xlsx` | Rows with Excel date serial numbers (not text dates) |
| Numeric Excel | `tests/fixtures/phase-b-numeric-cells.xlsx` | Rows with currency-formatted and plain numeric cells |

### 8.4 Frontend Tests (Claude)

| Test | Description |
|------|-------------|
| Upload `.xlsx` via drag-and-drop | File accepted, batch created with `file_type = 'xlsx'` |
| Upload `.xlsx` via click-to-browse | File accepted, batch created |
| Upload `.csv` still works | Regression — same flow as before |
| Reject non-CSV/XLSX file (e.g. `.pdf`) | Error toast shown |
| Reject >10 MB `.xlsx` file | Error toast shown |
| Reject >5 MB `.csv` file | Error toast still works |
| Parse → preview shows correct row data | Dates converted, numbers correct |
| Validate → same error display as CSV | Field-level errors shown |
| Execute → drafts created | Result summary shows `created_count`, `posted_count = 0` |
| Template guide shows Excel notes | Excel-specific rules visible |
| Phase label updated | "CSV & Excel Invoice Import — Draft Only" |

### 8.5 Production Verification Checks

After production deployment, verify:

| Check | Method | Expected |
|-------|--------|----------|
| `posted_count` | SQL / batch detail API | `= 0` |
| `allocated_count` | SQL / batch detail API | `= 0` |
| `receipt_id` on all import rows | SQL | `= null` |
| No `journal_entries` from import | SQL: `SELECT * FROM journal_entries WHERE source_doc_id IN (imported invoice IDs)` | 0 rows |
| Bucket still private | SQL: `SELECT public FROM storage.buckets WHERE id = 'ar-imports'` | `false` |
| CSV import still works | Phase A smoke test | All steps pass |

---

## 9. Implementation Order

### Step 1: Codex Backend (before frontend)

| # | Task | Description |
|---|------|-------------|
| 1.1 | Add pinned XLSX dependency | Add SheetJS to `imports` function `deno.json` — pinned version, verify Deno compatibility |
| 1.2 | Create `009_import_excel_storage_update.sql` | Add `.xlsx` MIME type to `ar-imports` bucket |
| 1.3 | Update upload route | Accept `file_type IN ('csv', 'xlsx')` — reject all others |
| 1.4 | Update parse/validate/execute guards | Allow `file_type IN ('csv', 'xlsx')`, `import_type = 'invoice'` |
| 1.5 | Add XLSX parser | Parse `.xlsx` first sheet → same `raw_data` JSONB shape as CSV |
| 1.6 | Handle date serial conversion | Excel date serials → `YYYY-MM-DD` ISO strings |
| 1.7 | Handle empty row skipping | Skip rows with all empty cells |
| 1.8 | Create test fixtures | Valid, invalid, date-serial, numeric `.xlsx` files |
| 1.9 | Create curl smoke tests | Phase B test scripts |
| 1.10 | Run CSV regression | Phase A smoke test must still pass |
| 1.11 | Deploy to staging | `supabase functions deploy imports` + run `009` migration on staging |
| 1.12 | Run all tests on staging | Phase A regression + Phase B Excel tests |

### Step 2: Claude Frontend (after backend passes)

| # | Task | Description |
|---|------|-------------|
| 2.1 | Update Import Wizard | Accept `.csv` + `.xlsx`, detect `file_type` from extension |
| 2.2 | Update file size limits | CSV: 5 MB, Excel: 10 MB |
| 2.3 | Update template guide | Add Excel-specific notes |
| 2.4 | Update phase label | "CSV & Excel Invoice Import — Draft Only" |
| 2.5 | Update hook | Detect file type, send correct `file_type` to backend |
| 2.6 | Build verification | `npm run build` — 0 errors |
| 2.7 | Frontend manual testing | Excel upload, parse, validate, execute, CSV regression |

### Step 3: Production Deployment (after staging passes)

| # | Task | Owner |
|---|------|-------|
| 3.1 | Run `009_import_excel_storage_update.sql` on production | Codex |
| 3.2 | Deploy updated `imports` Edge Function to production | Codex |
| 3.3 | Run Phase A CSV regression on production | Codex |
| 3.4 | Run Phase B Excel smoke tests on production | Codex |
| 3.5 | Deploy frontend to production | Shared |
| 3.6 | Frontend UI walkthrough on production | Claude |
| 3.7 | Verify all production checks (§8.5) | Shared |
| 3.8 | Create production verification summary | Claude |
| 3.9 | Commit and push | Shared |

---

## 10. Codex Review Checklist

| # | Check | Pass Criteria |
|---|-------|---------------|
| 1 | XLSX library is pinned — no floating `latest` | Version number in `deno.json` import |
| 2 | XLSX library is Deno-compatible | ESM import, no Node.js polyfills |
| 3 | Bundle size acceptable for Edge Function cold-start | Tested: function deploys and responds within timeout |
| 4 | First sheet only — no multi-sheet processing | Sheet index 0 only |
| 5 | Header row detection — Row 1 must contain column names | Parser fails gracefully if headers missing/invalid |
| 6 | Excel date serial → ISO conversion is correct | Test fixture: serial `46174` → `2026-05-28` |
| 7 | Number precision preserved | `5000.00` not `5000.0000001` |
| 8 | Empty rows skipped | No `import_rows` entries for blank rows |
| 9 | Output `raw_data` JSONB matches CSV parser output shape | Same keys, same value types |
| 10 | Max 500 rows enforced | Batch fails or truncates if > 500 data rows |
| 11 | Max 10 MB file size enforced | Upload rejected if > 10 MB |
| 12 | Upload route accepts `csv` and `xlsx` only | All other `file_type` values rejected |
| 13 | Parse/validate/execute guards allow `csv` and `xlsx` | Both pass; `pdf` and `image` rejected |
| 14 | `import_type = 'invoice'` enforced | `receipt` rejected |
| 15 | Draft execution uses `InvoiceService.createInvoice()` + standalone validators | Not HTTP self-call, not direct insert |
| 16 | `009` migration preserves all CSV MIMEs and adds XLSX | No RLS weakening, bucket stays private, `application/csv` preserved |
| 17 | CSV regression — Phase A still works | Phase A curl test passes after Phase B changes |
| 18 | `posted_count = 0` after Excel import | Draft-only confirmed |
| 19 | `allocated_count = 0` after Excel import | No allocation occurred |
| 20 | `receipt_id = null` on all import rows | No receipt import |
| 21 | No `journal_entries` created by import | SQL verification |
| 22 | Tenant isolation — cross-company Excel upload rejected | curl test |
| 23 | No new Edge Functions created | Parser added to existing `imports` function |
| 24 | No new tables created | Only `009` MIME update |
| 25 | No new RLS policies | Existing policies are format-agnostic |
| 26 | Frontend `npm run build` passes — 0 errors | Build log |

---

## 11. Acceptance Criteria

### Must Pass

- [ ] `009_import_excel_storage_update.sql` adds `.xlsx` MIME type to `ar-imports` bucket
- [ ] Bucket remains private after migration (`public = false`)
- [ ] Upload route accepts `file_type IN ('csv', 'xlsx')` — rejects all others
- [ ] Parse/validate/execute guards allow `file_type IN ('csv', 'xlsx')`, `import_type = 'invoice'`
- [ ] XLSX parser reads first sheet, maps Row 1 headers to keys
- [ ] Excel date serial numbers converted to `YYYY-MM-DD` strings
- [ ] Excel numeric cells preserve 2 decimal place precision
- [ ] Empty rows in Excel are skipped
- [ ] `import_rows.raw_data` JSONB matches the same shape as CSV parser output
- [ ] Existing validation pipeline works identically for CSV and Excel rows
- [ ] Draft execution uses `InvoiceService.createInvoice()` + standalone `validateCreateInvoice()` / `validateInvoiceLines()` — not HTTP self-call
- [ ] `posted_count = 0` — no posting
- [ ] `allocated_count = 0` — no allocation
- [ ] `receipt_id = null` on all import rows
- [ ] No `journal_entries` created by import
- [ ] CSV import still works after Phase B changes (regression)
- [ ] SheetJS dependency is pinned (no floating `latest`)
- [ ] SheetJS is Deno-compatible (ESM, no Node polyfills)
- [ ] Frontend accepts both `.csv` and `.xlsx` in drag-and-drop and file picker
- [ ] Frontend detects file extension and sends correct `file_type` to backend
- [ ] Frontend file size limit: 5 MB for CSV, 10 MB for Excel
- [ ] Frontend template guide updated with Excel format notes
- [ ] Frontend phase label: "CSV & Excel Invoice Import — Draft Only"
- [ ] RLS tenant isolation verified for Excel imports
- [ ] `npm run build` passes with 0 errors
- [ ] All curl smoke tests pass on staging and production

### Must NOT Happen

- [ ] ❌ No invoice posting
- [ ] ❌ No receipt import
- [ ] ❌ No allocation (manual or auto)
- [ ] ❌ No PDF/Image/OCR
- [ ] ❌ No Gemini/AI calls
- [ ] ❌ No new database tables
- [ ] ❌ No new RLS policies
- [ ] ❌ No new Edge Functions
- [ ] ❌ No `GET /allocations`
- [ ] ❌ No `POST /allocations/auto`
- [ ] ❌ No direct inserts into `invoices`, `invoice_lines`, or `journal_entries`
- [ ] ❌ No public storage bucket
- [ ] ❌ No floating/unpinned dependencies

---

## 12. Ownership Matrix

| Task | Owner |
|------|-------|
| XLSX parser implementation (pinned SheetJS) | Codex |
| `009_import_excel_storage_update.sql` | Codex |
| Upload route update (csv/xlsx only) | Codex |
| Parse/validate/execute guard updates | Codex |
| Excel date/number conversion | Codex |
| Empty row skipping logic | Codex |
| Max rows / file size enforcement | Codex |
| `deno.json` dependency management | Codex |
| Deno/bundle compatibility verification | Codex |
| curl smoke test scripts (Phase B) | Codex |
| Test fixture `.xlsx` files | Codex |
| CSV regression test | Codex |
| Staging deployment + smoke test | Codex |
| Production deployment + smoke test | Codex |
| Frontend `.csv` + `.xlsx` acceptance | Claude |
| Frontend file type detection | Claude |
| Frontend file size limit (CSV vs Excel) | Claude |
| Frontend template guide update | Claude |
| Frontend phase label update | Claude |
| Frontend hook update | Claude |
| Frontend build verification | Claude |
| Production UI walkthrough | Claude |
| Evidence documentation | Claude |

---

*Plan revised: 2026-05-30T03:01:26+08:00*  
*Status: Revised v1.2 — Awaiting Codex re-review*  
*Author: Claude (GenAI-assisted development)*
