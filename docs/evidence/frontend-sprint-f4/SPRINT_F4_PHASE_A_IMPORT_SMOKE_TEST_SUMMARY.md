# Sprint F4 Phase A — CSV Invoice Import Draft Flow: Smoke Test Summary

**Date**: 2026-05-30  
**Sprint**: F4 Phase A  
**Commit**: `05d3415` — Complete Sprint F4 Phase A CSV invoice import draft flow  
**Status**: ✅ **Passed** — Staging verified, frontend tested, committed, pushed

---

## 1. Scope Completed

| Feature | Status |
|---------|--------|
| CSV invoice import (upload → parse → validate → execute) | ✅ Complete |
| Draft invoice creation only (no posting) | ✅ Complete |
| Import batch tracking (`import_batches` table) | ✅ Complete |
| Row-level validation with field-level error display | ✅ Complete |
| Row-level result display with invoice ID links | ✅ Complete |
| Frontend `/invoices/import` wizard UI (6-step flow) | ✅ Complete |
| Invoice page "Import CSV" entry point button | ✅ Complete |
| Phase A warning banner and draft-only labeling | ✅ Complete |
| CSV template guide with column reference and sample | ✅ Complete |
| Response shape handling (`{ batch, rows }` wrapper) | ✅ Complete |
| Validation error display (`err.message ?? err.error`) | ✅ Complete |

---

## 2. Staging Backend Verification

| Test | Result |
|------|--------|
| `008_import_tables.sql` migration ran on staging | ✅ Passed |
| `008b_import_rls_smoke_tests.sql` RLS isolation tests | ✅ Passed |
| `imports` Edge Function deployed to staging only | ✅ Deployed |
| `tests/curl/import-phase-a-smoke.ps1` API smoke test | ✅ Passed |
| Batch ID from staging test | `3e6df034-c0d7-4319-ba00-50dc69212ce2` |

### Staging API Endpoints Verified

| Endpoint | Method | Result |
|----------|--------|--------|
| `/imports/upload` | POST (multipart) | ✅ Batch created, file stored |
| `/imports/:id/parse` | POST | ✅ Rows extracted from CSV |
| `/imports/:id/validate` | POST | ✅ Valid/error rows identified |
| `/imports/:id/execute` | POST | ✅ Draft invoices created |
| `/imports/:id` | GET | ✅ Batch detail returned |
| `/imports/:id/rows` | GET | ✅ Row-level data returned |

### Backend Response Shape Confirmed

```
POST /imports/:id/parse    → { batch: ImportBatch, rows: ImportRow[] }
POST /imports/:id/validate → { batch: ImportBatch, rows: ImportRow[] }
POST /imports/:id/execute  → { batch: ImportBatch, rows: ImportRow[] }
```

Frontend correctly unwraps `result.batch` and `result.rows` from the wrapper.

---

## 3. Frontend Manual Test Results

| Test Case | Result | Detail |
|-----------|--------|--------|
| Valid CSV upload | ✅ Passed | File accepted, batch created, stepped to Parse |
| Valid CSV parse | ✅ Passed | Rows extracted and displayed in preview table |
| Valid CSV validate | ✅ Passed | `valid_rows` and `error_rows` counts displayed correctly |
| Draft creation (execute) | ✅ Passed | Draft invoices created via `POST /invoices` |
| Result display | ✅ Passed | 2 drafts created, batch metadata shown, row details with invoice ID links |
| Invoice list shows imported drafts | ✅ Passed | Imported invoices appear as "Draft" status |
| Invalid CSV validation error | ✅ Passed | Row-level errors shown with field name and message |
| "Create Draft" button disabled (0 valid rows) | ✅ Passed | Button correctly disabled when `valid_rows === 0` |
| Phase A warning banner visible | ✅ Passed | Draft-only warnings displayed on import page |
| CSV template guide toggle | ✅ Passed | Column reference and sample CSV shown/hidden correctly |
| Copy sample CSV to clipboard | ✅ Passed | Clipboard copy works with confirmation toast |
| Drag-and-drop upload | ✅ Passed | Drag zone highlights, file accepted on drop |
| File type validation (non-CSV rejected) | ✅ Passed | `.xlsx`, `.pdf`, etc. show "Only .csv files" error |
| File size validation (>5 MB rejected) | ✅ Passed | Oversized file shows "Maximum file size is 5 MB" error |
| "Start Over" reset | ✅ Passed | Wizard resets to Step 1 |
| "Import Another File" (result page) | ✅ Passed | Wizard resets for new import |
| "View Invoices" link (result page) | ✅ Passed | Navigates to `/invoices` |
| Build | ✅ Passed | `npm run build` — 0 errors, 22 pages |

---

## 4. Safety Confirmations

| Safety Check | Status |
|-------------|--------|
| `posted_count = 0` on all import batches | ✅ Confirmed |
| `allocated_count = 0` on all import batches | ✅ Confirmed |
| No receipt import implemented | ✅ Confirmed |
| No allocation (manual or auto) | ✅ Confirmed |
| No Excel (.xlsx) import | ✅ Confirmed |
| No PDF import | ✅ Confirmed |
| No Image/OCR import | ✅ Confirmed |
| `GET /allocations` not used | ✅ Confirmed |
| `POST /allocations/auto` not used | ✅ Confirmed |
| No production deployment | ✅ Confirmed — staging only |
| No backend code modified by frontend sprint | ✅ Confirmed |
| No SQL migrations modified by frontend sprint | ✅ Confirmed |
| No Edge Functions modified by frontend sprint | ✅ Confirmed |

---

## 5. Files Changed (Frontend Only)

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/hooks/use-import.ts` | **NEW** | Import API hook — upload, parse, validate, execute, state management |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | **NEW** | 6-step CSV Import Wizard page |
| `frontend/src/app/(dashboard)/invoices/page.tsx` | **MODIFIED** | Added "Import CSV" button in header |

---

## 6. API Usage (Frontend → Backend)

### Active APIs Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/imports/upload` | POST | Upload CSV file (multipart/form-data) |
| `/imports/:id/parse` | POST | Parse CSV → extract rows |
| `/imports/:id/validate` | POST | Row-level validation |
| `/imports/:id/execute` | POST | Create draft invoices (no posting) |
| `/imports/:id` | GET | Refresh batch status |
| `/imports/:id/rows` | GET | Fetch row-level data |

### APIs NOT Used

| Endpoint | Reason |
|----------|--------|
| `GET /allocations` | ❌ Cross-tenant risk — blocked until Phase E |
| `POST /allocations/auto` | ❌ Unverified — blocked until Phase E+ |
| `POST /invoices/:id/post` | ❌ Phase A is draft-only — posting is Phase C |
| `POST /receipts` | ❌ Receipt import is Phase D |
| `POST /ocr-extract` | ❌ OCR is Phase F |

---

## 7. Known Limitations

| Limitation | Planned Resolution |
|------------|-------------------|
| CSV only — no Excel, PDF, or Image | Phase B (Excel), Phase F (PDF/Image OCR) |
| One CSV row creates one draft invoice | Multi-line invoice grouping is future enhancement |
| No auto-posting | Phase C — explicit posting with user confirmation |
| No receipt import | Phase D — receipt CSV import + computed matching |
| No allocation automation | Phase D — computed proposals → `POST /allocations/manual` |
| No allocation history page | Phase E — after `GET /allocations` is fixed for tenant isolation |
| No OCR/AI extraction | Phase F — Gemini Vision API after structured import is stable |

---

## 8. Next Recommended Phase

### Option A: Phase B — Excel Invoice Import (Draft Only)
- Add `.xlsx` parser to `imports` Edge Function
- Reuse same validation pipeline as CSV
- Update Import Wizard to accept `.xlsx` files
- Incremental backend change (Codex) + frontend update (Claude)

### Option B: Client Demo with Phase A Included
- Add CSV Import to the existing client demo flow
- Update `CLIENT_DEMO_FINAL_CHECKLIST.md` with import steps
- Demo: Upload CSV → Parse → Validate → Create Drafts → View in Invoice List

---

*Evidence generated: 2026-05-30T02:05:53+08:00*  
*Sprint: F4 Phase A*  
*Commit: 05d3415*  
*Author: Claude (GenAI-assisted development)*
