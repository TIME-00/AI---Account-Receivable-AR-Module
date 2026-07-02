# Batch 9B — PDF/Image/OCR Import Intake Plan

Status: **PLANNING ONLY (Gate 1 — Claude Planning).** No code, schema, Edge Function, frontend, or
production configuration changes are made by this document. Implementation proceeds only after Codex
review (Gate 2) and explicit user approval (Gate 3).

Prepared by: Claude Code (planning, UI/UX, architecture, evidence checklist).
Backend correctness, schema, RLS, migrations, and deployment are Codex responsibilities in later gates.

Baseline commit at time of writing: `9a2279d737747abce473990d4990cc3b64a29699` (origin/main).

---

## 1. Objective

Batch 9B is the **planning phase** for adding secure PDF/Image/OCR intake to the existing AR import
workflow, for both **invoice** and **receipt** documents.

The goal is to let an authorised user:

1. upload a PDF or image file for invoice or receipt intake;
2. have data extracted from that file using OCR;
3. route the extracted result into a **human review queue** before *any* financial posting,
   allocation, or ledger-impacting mutation occurs.

The OCR flow is strictly an **intake and extraction layer**. It must **not**:

- directly create protected financial records (posted invoices/receipts, allocations);
- post invoices;
- post receipts;
- allocate receipts;
- mutate ledger-impacting fields (`invoices.outstanding`, `receipts.allocated_amount`,
  `receipts.unallocated_amount`, `allocation_details`).

OCR output is treated as **untrusted extracted suggestion data** until a human reviews it and it is
promoted through the existing approved import-draft path and the existing approved financial
APIs/RPCs.

---

## 2. Current Baseline

Grounded in the current repository state (verified during planning):

- **Existing CSV/XLSX import flow exists.** Migrations `008_import_tables.sql` (CSV, Phase A) and
  `009_import_excel_storage_update.sql` (XLSX, Phase B) define the import data model and the private
  storage bucket. The `imports` Edge Function (`backend/supabase/functions/imports/`) parses CSV/XLSX
  and produces draft rows.
- **Import tables already reserve OCR/file structures:**
  - `import_batches` — `import_type` ∈ {`invoice`, `receipt`}; `file_type` CHECK **already allows
    `'pdf'` and `'image'`**; carries status lifecycle, per-batch counts, `auto_post`/`auto_allocate`
    flags, and append-only audit columns (`created_by`, `cancelled_by`, timestamps).
  - `import_rows` — `raw_data`/`mapped_data` JSONB, `status` lifecycle, `validation_errors`,
    `duplicate_of`, and links to `invoice_id`/`receipt_id` once promoted.
  - `import_files` — **already exists** with `file_name`, `file_path`, `file_type` (CHECK allows
    `pdf`/`image`), `file_size_bytes`, and a **reserved `ocr_result JSONB` column** explicitly
    documented as "reserved for later phases."
  - `import_row_allocations` — normalized link to `allocation_details` for later phases.
- **Private storage bucket already exists.** `ar-imports` is `public = FALSE`, 20 MB size limit, with
  a MIME whitelist currently limited to CSV/XLSX/plain text. Storage RLS is **tenant-scoped by folder
  name = `company_id`** (`storage.foldername(name)[1]`), and there are **no UPDATE/DELETE storage
  policies** (files are audit evidence).
- **Import RLS is role- and tenant-scoped.** SELECT is allowed for AR Clerk / AR Supervisor / Finance
  Manager / Auditor; INSERT/UPDATE for AR Clerk / AR Supervisor / Finance Manager; **no DELETE
  policies** (append-only).
- **Financial mutations go through approved backend APIs/RPCs** (migrations `007_financial_rpcs.sql`,
  `015_financial_mutation_boundary_hardening.sql`). Direct DML on protected financial fields is
  blocked at the boundary.
- **`/allocations/auto` is intentionally disabled** and returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.
  It must remain disabled.
- **Dashboard uses real data** (`useDashboardMetrics` → `/reports/dashboard`); no mock data may be
  reintroduced.
- **Batch 9A completed** the UI/API placeholder removal and the dropdown overlay/refresh UX fixes.
- **Batch 9B must build on the existing import/review approach**, extending the reserved
  `import_files.ocr_result` and existing import lifecycle rather than bypassing them or introducing a
  parallel financial path.

> **Baseline implication for Codex:** the schema was pre-designed to accommodate PDF/image/OCR. The
> data-model work in Batch 9B is expected to be **additive extension** of `import_files` (+ focused
> child tables for OCR runs / review), **not** a new import subsystem. Codex must verify existing
> tables before proposing anything new (see §6).

---

## 3. In Scope

### 3.1 File intake planning

- PDF upload intake.
- Image upload intake — PNG, JPG/JPEG, WebP (final list subject to Codex/security review; TIFF and
  HEIC deferred unless justified).
- Multi-page PDF handling plan (page count limit; per-page extraction metadata).
- Multiple uploaded files per import batch (batch → many files → many documents).
- File metadata capture (original name, size, MIME, detected magic-number type, page count, checksum).
- Upload status tracking (see UX states in §8).
- Rejected / quarantined file state (validation failure, MIME spoofing, malware suspicion).
- Private file storage model (reuse `ar-imports` private bucket; tenant-scoped, non-guessable paths).

### 3.2 OCR extraction planning

- OCR provider evaluation criteria (see §7).
- **Provider-agnostic OCR abstraction** design (a backend interface with swappable implementations).
- OCR result schema planning (raw text, structured fields, bounding regions optional, per-page).
- Confidence score handling (document-level and field-level; thresholds drive review routing).
- Field-level extraction results (e.g. invoice no, date, customer, currency, subtotal, tax, total;
  receipt no, date, payer, amount, method, reference).
- Page-level and document-level metadata.
- Support for **both invoices and receipts** (extraction profiles per document type).
- Handling **low-confidence fields** (flag, require human confirmation, block auto-promotion).
- Handling **duplicate documents** (checksum + heuristic match against existing docs/invoices).
- Handling **partial extraction** (some fields extracted, others missing → review with gaps).
- Handling **unreadable files** (OCR failure → `OCR failed` state, no draft row created).

### 3.3 Security and privacy

- Tenant isolation on every table, storage path, and API call.
- **Private storage buckets only** (reuse `ar-imports`; never make public).
- Signed URL strategy with **short expiry** (e.g. 60–300s) for preview/download; backend-issued only.
- **No public file URLs.**
- **No client-side provider secret exposure** — OCR provider keys live only in backend/Edge Function
  secrets, never in frontend bundles or `NEXT_PUBLIC_*`.
- File size limits (align to or tighten from the current 20 MB bucket limit; per-type limits).
- MIME validation **and** magic-number (content-sniffing) validation — must agree.
- Extension validation (allowlist; reject double extensions and mismatched extension/MIME).
- Malware / file-scanning strategy (see §5 step 6; scan-before-OCR gate).
- Dangerous file rejection (executables, scripts, embedded active content in PDFs where detectable).
- EXIF / embedded-metadata risk consideration (strip or ignore EXIF; do not trust embedded metadata).
- Retention policy (define default retention window; separate original file vs raw OCR text vs
  reviewed values).
- Deletion policy (who may delete, soft vs hard, and how it reconciles with append-only audit needs).
- Access logging (who accessed which file / OCR result and when).
- PII and financial-data protection (documents may contain customer PII and banking details).
- OCR provider data-processing risk (see §7 and §15).
- Data-residency consideration (region of provider processing).
- OCR provider training/retention policy consideration (must be "no training on our data").
- Provider fallback and **disable switch** (feature flag to disable OCR and fall back to manual
  CSV/XLSX import instantly).

### 3.4 Auditability

Audit trail must capture, at minimum:

- file upload;
- OCR extraction run;
- review edits (field-level);
- approval / rejection;
- creation of draft import rows;
- final posting through existing approved flows.

Requirements:

- Record **who uploaded, who reviewed, who approved, and when** for every document.
- **Original OCR output must be preserved separately from user-corrected values** — the raw extracted
  value and the reviewed/corrected value are both retained.
- Every change from an OCR value to a reviewed value must be **traceable** (old value, new value,
  actor, timestamp).
- Audit records should be **append-only** where feasible (consistent with existing import tables
  having no DELETE policies).

### 3.5 Review queue and approval flow

- OCR extraction creates **reviewable draft/extracted records only** — never posted financial records.
- A user **must review** extracted invoice/receipt fields before any financial mutation.
- **Role-aware flow (backed by real `/auth/me` capabilities, never demo/env assumptions):**
  - **AR Clerk** may upload and review normal items.
  - **AR Supervisor** or **Finance Manager** may approve high-risk / low-confidence items.
  - **Auditor** and **System Admin** must **not** be granted unsafe financial mutation permissions by
    the frontend (read/oversight only; consistent with Batch 9A role model).
- **Exception states** the queue must represent:
  - low confidence;
  - duplicate suspected;
  - missing customer;
  - amount mismatch (e.g. line sum ≠ stated total);
  - currency mismatch;
  - date issue (unparseable / out-of-range / future-dated where invalid);
  - unreadable document;
  - unsupported file;
  - possible malware / quarantined file.
- The UI must clearly show OCR **confidence**, **extracted fields**, **original document preview**,
  and **required corrections**.

### 3.6 Financial correctness

OCR must **not**:

- directly post invoices or receipts;
- directly allocate receipts;
- directly update `invoices.outstanding`;
- directly update `receipts.allocated_amount` / `receipts.unallocated_amount`;
- insert into `allocation_details`.

OCR output must first land in **import staging/review structures**. Final creation / posting /
allocation continues **only** through the existing approved APIs/RPCs. **Auto-allocation remains
disabled**; `/allocations/auto` must continue to return HTTP 403 `AUTO_ALLOCATION_DISABLED` and is not
enabled by this batch.

### 3.7 Staging-first rollout

- Staging-first implementation and testing (Supabase staging ref `gcdsdyegwjdcskpukqlq`).
- Production rollout is **gated** (see §14).
- **No** production OCR provider keys, production uploads, production fixtures, or production
  record creation unless explicitly approved.
- Production smoke uses **safe read-only checks** unless the user explicitly approves create-record
  testing.

---

## 4. Out of Scope

The following are **out of scope** for Batch 9B planning and initial implementation unless separately
approved in a later batch:

- Direct financial posting from OCR.
- Automatic allocation from OCR.
- Re-enabling `/allocations/auto`.
- Direct mutation of protected financial fields.
- Direct insertion into `allocation_details`.
- Production fixture imports.
- Production document uploads using real client-sensitive files.
- Training OCR models on company documents.
- Permanent document retention without a defined policy.
- Public file access.
- Client-side OCR provider secrets.
- Full AI decision-making without human review.
- Replacing the existing CSV/XLSX import flow (OCR is additive; CSV/XLSX remains).
- Changing P0/P1 financial RPC invariants.
- Dashboard mock data.

---

## 5. Proposed Architecture

High-level, no code. Secure OCR intake pipeline sits **in front of** the existing import-draft flow
and hands off to it.

### 5.1 Text sequence flow

```
┌──────────┐        ┌───────────────────────┐        ┌──────────────────────┐
│  User    │        │  Frontend (Import UI)  │        │  Backend Edge Fn      │
│ (AR role)│        │  Next.js/React         │        │  (imports/ocr)        │
└────┬─────┘        └───────────┬────────────┘        └──────────┬───────────┘
     │  1. Select PDF/image     │                                │
     │─────────────────────────>│                                │
     │                          │  2. Upload/init request        │
     │                          │───────────────────────────────>│
     │                          │                                │ 3. Validate:
     │                          │                                │    tenant/user/role,
     │                          │                                │    file type, size,
     │                          │                                │    MIME + magic number,
     │                          │                                │    extension, upload
     │                          │                                │    count limits,
     │                          │                                │    storage path isolation
     │                          │  (reject → quarantine/error)   │
     │                          │<───────────────────────────────│
     │                          │                                │ 4. Store in PRIVATE bucket
     │                          │                                │    ar-imports/<company_id>/...
     │                          │                                │ 5. State = uploaded / pending_scan
     │                          │                                │ 6. Malware/file safety scan
     │                          │                                │    (or planned gate)
     │                          │                                │ 7. Valid → pending_ocr
     │                          │                                │ 8. OCR worker/provider extracts
     │                          │                                │    raw text + structured fields
     │                          │                                │ 9. Store RAW OCR result
     │                          │                                │    separately from reviewed values
     │                          │                                │ 10. Create review-queue items
     │  11. Review & correct    │  GET review items              │
     │<─────────────────────────│<───────────────────────────────│
     │─────────────────────────>│  PATCH reviewed fields         │
     │                          │───────────────────────────────>│ (record OCR value vs reviewed value)
     │  12. Approve             │  POST approve                  │
     │─────────────────────────>│───────────────────────────────>│ 12. Promote reviewed item into
     │                          │                                │     EXISTING import draft flow
     │                          │                                │ 13. Existing approved APIs/RPCs
     │                          │                                │     perform any financial creation/
     │                          │                                │     posting (unchanged)
     │                          │                                │ 14. Allocation stays manual/approved;
     │                          │                                │     /allocations/auto stays 403
```

### 5.2 Pipeline stages (narrative)

1. User uploads a PDF/image through the Import UI.
2. Frontend sends the file to a backend-controlled upload/init endpoint (no direct public upload).
3. Backend validates tenant/user/role, file type, file size, MIME + magic number, extension, upload
   count limits, and storage path isolation.
4. File is stored in the private `ar-imports` bucket under a tenant-scoped, non-guessable path.
5. File enters `uploaded` (or `pending_scan`) state.
6. Malware / file-safety scan step occurs (or is explicitly planned with a gate before OCR).
7. Valid file enters `pending_ocr`.
8. OCR worker/provider extracts raw text and structured fields via the provider-agnostic abstraction.
9. Raw OCR result is stored **separately** from reviewed values.
10. Extracted fields become review-queue items.
11. User reviews and corrects fields; each correction is recorded against the raw OCR value.
12. Approval promotes the reviewed item into the **existing** import-draft flow.
13. Existing approved backend APIs/RPCs handle any financial creation/posting.
14. Allocation remains manual/approved; `/allocations/auto` remains disabled.

---

## 6. Data Model Planning

> **Planning only. No migrations in this batch.** Names below are **draft/proposed**. Codex must
> **verify existing tables first** and prefer **extending existing structures** over new ones.

### 6.1 Reuse-first directive (critical)

The schema already anticipates this batch:

- **`import_files` already exists** with a reserved `ocr_result JSONB` column and `file_type` allowing
  `pdf`/`image`. OCR raw output likely belongs here or in a child table, **not** a new duplicate
  `import_files` table.
- **`import_batches` / `import_rows`** already model batch/row lifecycle, duplicates
  (`import_rows.duplicate_of`), validation errors, and promotion to `invoice_id`/`receipt_id`.
- **`ar-imports` private bucket** and tenant-scoped storage RLS already exist.

Codex must **avoid creating a second import subsystem**. Proposed new entities should only be created
where the existing tables genuinely cannot represent the concept.

### 6.2 Proposed / candidate entities (draft names — Codex to confirm/rename/merge)

| Draft name | Purpose | Likely disposition |
| --- | --- | --- |
| `import_files` | File metadata + storage path + raw OCR blob | **Already exists** — extend (e.g. add scan/OCR-status columns) rather than recreate |
| `import_documents` | Logical document per file (multi-page PDF → one doc; or one doc per page) | New only if `import_files` cannot carry per-document grouping |
| `ocr_extraction_runs` | One row per OCR attempt (provider, model, version, started/finished, status, doc-level confidence) | Likely new (append-only history of runs) |
| `ocr_extracted_fields` | Field-level raw results (field key, raw value, confidence, page, region) | Likely new (immutable raw extraction) |
| `ocr_review_items` | Reviewable queue item per document (state, exception flags, assignee) | May map onto `import_rows`; Codex to decide reuse vs new |
| `ocr_review_decisions` | Field-level reviewed value + actor + timestamp (raw→reviewed diff) | Likely new (append-only audit of corrections) |
| `file_security_scan_results` | Malware/scan verdicts per file | New if a scanner is integrated |
| `import_audit_events` | Append-only audit for upload/OCR/review/approval/rejection/promotion | May extend existing audit-trigger approach (`005_audit_triggers.sql`); Codex to decide |

### 6.3 Data-model requirements (apply to whatever Codex finalizes)

- These are **draft/proposed names only**.
- Codex must **verify existing tables first** (`import_files`, `import_batches`, `import_rows`,
  `import_row_allocations`, storage bucket, existing audit triggers).
- Codex must **avoid duplicate schema** if current import tables already support the concept.
- All tables must include **tenant isolation fields** where required (`company_id`, or a verifiable
  join to a company-scoped parent, consistent with existing import RLS).
- **RLS must be designed before implementation** (see §10).
- Audit fields must include `created_by`, `reviewed_by`, `approved_by` where applicable, plus
  timestamps.
- Storage paths must be **tenant-scoped and not guessable** (e.g. `<company_id>/<batch_id>/<uuid>`),
  consistent with the existing `storage.foldername(name)[1] = company_id` policy.
- **Public schema only** — no `ar.*` schema.
- Raw OCR values and reviewed values must be **separable** (do not overwrite raw extraction in place).

---

## 7. OCR Provider Risk Assessment

**No final provider is chosen in this batch.** The architecture is provider-agnostic.

### 7.1 Provider categories compared

| Category | Summary | Data-residency/retention posture | Notes |
| --- | --- | --- | --- |
| **Local / self-hosted OCR** (e.g. Tesseract-class, self-run) | Runs on infra we control | Best — data never leaves our boundary | Lower accuracy on complex/financial layouts; ops burden |
| **Cloud OCR provider** (managed document AI) | Managed API, higher accuracy | Highest risk — documents leave our boundary; must verify no-training + region | Best accuracy; strongest legal/privacy scrutiny needed |
| **Hybrid** | Local pre-filter/redaction + cloud extraction, or cloud only for low-confidence | Medium | More complex; can reduce sensitive-data exposure |
| **Manual upload, OCR disabled (fallback)** | Files stored + previewed; user keys all fields manually | Best — no external processing | Always-available safe fallback; also the disable-switch target |

### 7.2 Evaluation criteria (score each candidate)

Data residency · whether uploaded documents are retained · whether data may be used for model
training · encryption in transit and at rest · region support · API-key security · cost · accuracy for
invoices/receipts · PDF/image support · rate limits · availability/SLA · vendor lock-in · ability to
disable the provider quickly · audit/logging support · suitability for real company financial
documents.

### 7.3 Recommended planning stance

- Use a **provider-agnostic architecture** (swappable backend implementation behind one interface).
- **Do not expose provider keys to the frontend** (backend/Edge secrets only).
- Default to **staging-only provider testing first**.
- Use **synthetic sample documents first**.
- **Do not send real sensitive production documents** to any provider until provider risk is reviewed
  and explicitly approved.
- Ship the **"OCR disabled → manual fallback"** path as the default posture in production until a
  provider is approved (see §16 open question).

---

## 8. Frontend UX Plan

**Plan only — no implementation.** Role-aware behavior is driven by the **real `/auth/me` capability
response** (Batch 9A model), never demo/env assumptions.

### 8.1 Required pages / components

- Import page: file-upload option for **PDF/Image** (alongside existing CSV/XLSX).
- File-validation feedback (type/size/MIME/extension errors shown inline).
- Upload progress / state indicator.
- OCR processing status indicator.
- **OCR review queue** (list of documents needing review, with exception badges).
- **Document preview panel** (renders the uploaded PDF/image via short-lived signed URL).
- **Extracted-field editor** (edit each field; validation on amounts/dates/currency).
- **Confidence badge per field** (e.g. high/medium/low with color + numeric score).
- Visible **difference between OCR raw value and user-corrected value** (raw shown, correction shown).
- **Exception queue** (filtered view of documents in exception states).
- **Approval / rejection** buttons (role-gated).
- **"Create draft import"** (or equivalent safe handoff) button that promotes into the existing draft
  flow — never a direct-post button.
- Clear warning copy that **OCR does not directly post financial records** (see §8.3).
- Role-aware UI based on the real backend role/permission response, not demo/env assumptions.

### 8.2 UX states

`Uploaded` · `Pending scan` · `Rejected by validation` · `Quarantined` · `Pending OCR` ·
`OCR failed` · `OCR completed` · `Needs review` · `Needs supervisor approval` ·
`Approved for draft import` · `Rejected` · `Archived/deleted (per retention policy)`.

State→action visibility must be role-aware (e.g. only AR Supervisor/Finance Manager see the
approve action for `Needs supervisor approval`).

### 8.3 User-facing copy / warnings (draft)

- Banner on OCR review screens: *"OCR extraction is a suggestion only. No invoice or receipt is
  created, posted, or allocated until you review the fields and approve them into a draft import.
  Auto-allocation is disabled."*
- Low-confidence field tooltip: *"Low OCR confidence — please verify against the original document."*
- Provider/privacy note (staging): *"Uploaded documents may be processed by an OCR provider for text
  extraction. Do not upload real client-sensitive documents in staging."*
- Disabled-provider fallback: *"OCR is currently disabled. You can still upload the document for
  reference and enter fields manually, or use CSV/XLSX import."*

---

## 9. Backend/API Planning for Codex

**Documentation of expected backend areas for later Codex implementation — Claude does not implement
these.**

### 9.1 Candidate API surface (Codex to design/confirm)

- Upload/init endpoint (creates batch/file records, returns controlled upload target).
- Signed upload URL **or** controlled server-side upload flow (Codex to choose the safer pattern).
- File-validation endpoint/logic (type/size/MIME/magic-number/extension/count).
- OCR run trigger (enqueue/execute extraction).
- OCR result retrieval (raw + structured, tenant-scoped).
- Review-queue APIs (list/filter by state and exception).
- Review-update API (record reviewed field values + raw→reviewed diff).
- Approval/rejection API (role-gated).
- Safe handoff into the **existing** import-draft flow.
- Audit-event writing (upload/OCR/review/approval/rejection/promotion).
- Retention/deletion job planning (scheduled cleanup per policy).

### 9.2 Backend rules (non-negotiable)

- All sensitive actions must **verify the authenticated user** (never trust the client).
- All actions must **enforce tenant isolation**.
- Service-role use must be **tightly scoped** and must never expose data across tenants.
- The **frontend must not decide financial authority** — the backend enforces role/permission.
- The backend must **not trust client-provided tenant IDs** without verification against the user's
  actual roles.
- OCR result must **not be treated as authoritative financial data** — it is untrusted suggestion
  data until reviewed and promoted through approved flows.

---

## 10. Security/RLS Planning

For Codex review before implementation:

- Tenant-scoped SELECT / INSERT / UPDATE policies on all new/extended tables (consistent with the
  existing import RLS pattern: join to `import_batches.company_id` via `user_roles`).
- Role-aware access for upload / review / approval (AR Clerk upload+review; AR Supervisor / Finance
  Manager approve; Auditor read-only; System Admin no financial mutation).
- **No public bucket access** (reuse the private `ar-imports` bucket; keep `public = FALSE`).
- **No cross-tenant file access** (storage RLS keyed on `company_id` folder; verify signed URLs are
  also tenant-checked at issue time).
- No direct user access to unrelated OCR results (RLS on OCR tables mirrors import RLS).
- Audit logs should be **append-only** where possible (consistent with existing import tables having
  no DELETE policies).
- Protected financial tables **remain protected**; the mutation boundary from
  `015_financial_mutation_boundary_hardening.sql` stays intact.
- Existing financial RPCs remain the **only** mutation route for posted financial records.
- `/allocations/auto` remains disabled and is **verified in smoke tests** to return HTTP 403
  `AUTO_ALLOCATION_DISABLED`.

---

## 11. Testing Strategy

**Plan only — no test implementation in this batch.**

### 11.1 Staging tests (Supabase staging ref `gcdsdyegwjdcskpukqlq`)

- Upload a valid PDF → accepted, stored privately, tenant-scoped path.
- Upload a valid image → accepted.
- Reject an unsupported extension.
- Reject incorrect MIME / magic-number (including MIME-spoofed file).
- Reject an oversized file.
- Reject malware / quarantine simulation (if a scanner is available; e.g. EICAR test string).
- Verify a tenant **cannot** access another tenant's file or OCR result (RLS + signed URL checks).
- Verify OCR result creates a **review item only** (no financial record).
- Verify low-confidence fields **require review** (cannot be auto-promoted).
- Verify approval creates a **draft import only**, not a posted financial mutation.
- Verify `/allocations/auto` remains **HTTP 403 `AUTO_ALLOCATION_DISABLED`**.
- Verify **no direct protected-field mutation** occurs anywhere in the OCR path.
- Verify **audit trail** is written for upload, OCR, review, approval/rejection.
- Verify retention/deletion behavior if implemented.
- Verify dashboard remains **real-data only** (no mock reintroduced).

### 11.2 Production-gated smoke (read-only by default)

- Read-only deployment checks first.
- Verify Edge Function active versions.
- Verify frontend build.
- Verify API health.
- Verify `/allocations/auto` remains 403.
- **No** production upload/import/create-record smoke unless explicitly approved.

---

## 12. Evidence Plan

Planned evidence files:

- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN_REVIEW.md` (plan-review template,
  created alongside this plan — see §17).
- Later implementation evidence files **only after approval**.

Evidence hygiene:

- Include screenshots or logs **only when safe** (no sensitive business data).
- **Do not store real sensitive uploaded documents in the repo.**
- **Do not commit OCR provider secrets.**
- **Do not commit production sample files** containing sensitive data.
- **Synthetic fixtures only.**

Each evidence file should record:

- scope;
- safety boundaries;
- provider risk decision;
- RLS/security review;
- staging smoke result;
- production readiness gate;
- `/allocations/auto` verification;
- no-direct-financial-mutation verification;
- worktree / commit summary.

---

## 13. Claude vs Codex Responsibility Split

### Claude Code responsibilities (this and future planning gates)

- Write/update the Batch 9B plan document.
- Define the UI/UX flow.
- Define the review-queue UX.
- Define user-facing copy / warnings.
- Define the evidence checklist.
- Define high-level architecture documentation.
- Identify open questions and the risk register.
- **Do not** implement backend logic.
- **Do not** create migrations.
- **Do not** change Edge Functions.
- **Do not** deploy.

### Codex responsibilities (after Claude plan)

- Review the plan for backend correctness.
- Verify the existing schema / import flow (confirm reuse of `import_files.ocr_result`, bucket, RLS).
- Check RLS/security implications.
- Propose exact migrations **only after approval**.
- Implement Edge Functions / API logic **only after approval**.
- Implement backend tests **only after approval**.
- Verify `/allocations/auto` remains disabled.
- Verify no protected direct financial mutation.
- Run staging deployment/smoke **only after approval**.
- Prepare production rollout checks **only after approval**.

---

## 14. Rollout Gates

| Gate | Name | Entry criteria | Exit criteria | Owner |
| --- | --- | --- | --- | --- |
| **Gate 1** | Claude Planning | Batch 9A complete | Batch 9B plan written; no implementation | Claude |
| **Gate 2** | Codex Review | Plan exists | Codex reviews security, schema, RLS, financial correctness, provider, rollout; issues logged; no implementation | Codex |
| **Gate 3** | User Approval | Codex review complete | User approves implementation scope | User |
| **Gate 4** | Staging Implementation | Scope approved | Approved scope implemented; **staging only**; synthetic/safe files only | Codex (+ Claude UI) |
| **Gate 5** | Staging Smoke Evidence | Staging deployed | Staging smoke passes; evidence written; `/allocations/auto` remains 403 | Codex |
| **Gate 6** | Production Readiness Plan | Staging smoke green | Production rollout plan created; **no** production create-record flows unless approved | Claude + Codex |
| **Gate 7** | Production Deployment | Readiness plan approved | Deploy after user approval; production smoke **read-only by default**; uploads/imports/create-record tests require explicit approval | Codex + User |

---

## 15. Risk Register

| # | Risk | Mitigation | Owner |
| --- | --- | --- | --- |
| 1 | **OCR provider data retention** — provider stores our documents | Require contractual "no retention / no training"; prefer local/self-hosted or approved region; disable switch | Codex + User |
| 2 | **Data residency** — processing in a disallowed region | Verify provider region support; restrict to approved regions; document residency in evidence | Codex + User |
| 3 | **Sensitive financial document exposure** | Private bucket only; short-lived signed URLs; synthetic docs in staging; no real prod docs until approved | Codex + Claude |
| 4 | **Cross-tenant file access** | Tenant-scoped storage RLS + tenant check at signed-URL issue; RLS on all OCR tables; staging cross-tenant test | Codex |
| 5 | **Malware upload** | MIME + magic-number validation; malware/scan gate before OCR; quarantine state; reject active content | Codex |
| 6 | **MIME spoofing** | Require MIME and magic-number to agree; extension allowlist; reject mismatches | Codex |
| 7 | **Large-file abuse** | Enforce size limits (bucket + per-type); upload count limits; reject early | Codex |
| 8 | **OCR hallucination / incorrect extraction** | Treat OCR as untrusted; mandatory human review; confidence thresholds; raw-vs-reviewed diff | Claude (UX) + Codex |
| 9 | **Duplicate invoice/receipt import** | Checksum + heuristic duplicate detection; `duplicate_of`; duplicate-suspected exception state | Codex |
| 10 | **Low-confidence extraction approved accidentally** | Low-confidence fields block auto-promotion; require supervisor approval for high-risk items | Claude (UX) + Codex |
| 11 | **Direct financial mutation bypass** | OCR path only writes staging/review tables; promotion goes through existing approved APIs/RPCs; boundary hardening intact | Codex |
| 12 | **Accidental auto-allocation** | `/allocations/auto` stays disabled (403) and is smoke-verified; no allocation writes in OCR path | Codex |
| 13 | **Audit-trail incompleteness** | Append-only audit for upload/OCR/review/approval/promotion; raw OCR preserved separately | Codex |
| 14 | **Production testing with sensitive data** | Production smoke read-only by default; create-record tests require explicit approval; synthetic-only otherwise | User + Codex |
| 15 | **Cost / rate-limit surprises** | Evaluate cost + rate limits before provider choice; staging quotas; disable switch | Codex + User |
| 16 | **Provider outage** | Provider-agnostic abstraction + manual fallback (OCR disabled) so import still works | Codex |

---

## 16. Open Questions (for User / Codex before implementation)

1. Which OCR provider category is preferred: local/self-hosted, cloud, or provider-agnostic-first?
2. What file retention period should be used (original file vs raw OCR text vs reviewed values)?
3. What maximum file size should be allowed (keep 20 MB, or set per-type limits)?
4. Should OCR support **invoices first, receipts first, or both** in the first implementation?
5. Should **multi-page PDF** be supported in the first implementation?
6. Which roles may **approve low-confidence** OCR results (AR Supervisor only, or also Finance
   Manager)?
7. Are **real company documents** allowed in staging, or **synthetic documents only**?
8. Should original uploaded files be **deletable** after review (and by which role)?
9. Should extracted **raw OCR text be retained** after approval, and for how long?
10. Should OCR be **disabled by default in production** until explicitly enabled (recommended: yes)?

---

## 17. Deliverables

1. **Batch 9B plan document** — `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md` (this file).
2. **Plan-review template** — `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN_REVIEW.md`.
3. Concise summary (in the chat response) of: files created/modified, key plan decisions, open
   questions, whether any code was changed, whether the worktree is clean, and a recommended prompt for
   Codex's second review.

**This is plan-only.** No implementation, no financial-logic change, no deployment, no production
fixtures, and `/allocations/auto` remains disabled.

---

## 18. Gate 2 Codex Review Conditions (LOCKED — must hold before implementation)

Codex completed the Gate 2 second review with verdict **PASS WITH CONDITIONS**. The plan is
directionally safe, but the following conditions are **locked into the plan** and must be satisfied
before and during any implementation gate. They supersede any looser wording earlier in this document.

Codex confirmed the baseline facts: `import_files.ocr_result JSONB` exists; `import_batches.file_type`
and `import_files.file_type` both allow `csv`/`xlsx`/`pdf`/`image`; the `ar-imports` bucket is private;
storage RLS is tenant-scoped by first path folder (`company_id`); there are no storage UPDATE/DELETE
policies; the bucket MIME list currently supports CSV/XLSX/plain-text only (post-migration 009); the
current imports runtime path accepts only CSV/XLSX; `/allocations/auto` remains hard-coded disabled
(`AUTO_ALLOCATION_DISABLED`); and no `ar.*` schema use is proposed.

### 18.1 SVG excluded from v1

- Batch 9B **v1 image support must exclude SVG**.
- Only **raster** image formats may be considered for v1: **PNG, JPEG/JPG, WebP**.
- **SVG requires a separate security review** before any future support (SVG can carry scripts/active
  content and is an XSS/SSRF vector).
- File validation must **reject** SVG, **double extensions**, **MIME/extension mismatch**, and any
  unsupported image type.

### 18.2 Production OCR disabled by default

- **Production OCR must be disabled by default.**
- **OCR provider keys must not be enabled in production** until explicit user approval.
- Production OCR must require a **separate provider / legal / data-residency approval gate**.
- Production smoke remains **read-only by default**.
- **No production upload/import/create-record OCR test may run** unless explicitly approved.

### 18.3 Staging synthetic documents only

- Staging OCR testing must use **synthetic documents only**.
- **No real company-sensitive** invoice/receipt documents may be uploaded to staging unless explicitly
  approved.
- Synthetic test files must **not contain real customer financial data**.
- Synthetic fixtures may be committed **only if** they contain **no secrets, no real company data, and
  no sensitive personal/financial data**.

### 18.4 Reuse-first table disposition (Codex backend/schema disposition)

This section is authoritative over the candidate table list in §6. **§6 entity names are candidate
names only — not approved table names.** Codex must verify the existing import schema again before any
future migration, **prefer extending existing import tables before adding new OCR tables**, and
**avoid duplicate/parallel OCR/import lifecycle tables**.

| Candidate | Codex disposition |
| --- | --- |
| `import_files` | **Reuse and extend.** Best home for file metadata, scan/OCR status, checksum, page count, and the `ocr_result` summary/blob. |
| `import_documents` | **Add only if** multi-page/multi-document grouping cannot be represented by `import_files` + `import_rows`. **Not required by default.** |
| `ocr_extraction_runs` | **Reasonable new append-only table** if multiple OCR attempts/provider runs must be audited. |
| `ocr_extracted_fields` | **Reasonable new table** if field-level confidence, bounding boxes, or diffs are required. Otherwise **JSONB may be enough for v1**. |
| `ocr_review_items` | **Prefer reuse of `import_rows`** unless a separate queue state is demonstrably needed. **Avoid duplicate review lifecycle.** |
| `ocr_review_decisions` | **Reasonable new append-only audit table** for raw-to-reviewed field diffs. |
| `file_security_scan_results` | **New table only if** multiple scan attempts/vendors must be tracked. Otherwise **columns on `import_files` are enough**. |
| `import_audit_events` | **Add only if** existing audit/logging is insufficient for upload/OCR/review/approval/rejection/promotion events. |

### 18.5 Signed URL tenant/role check

- Signed URL issuance must **verify tenant and role at request time**.
- **Do not rely only on storage-path RLS.**
- The backend must verify the authenticated user **belongs to the tenant/company** before issuing
  upload/download/preview signed URLs.
- The backend must verify **role/capability** before allowing upload, review, approval, or preview.
- **Service-role usage inside Edge Functions must still apply explicit tenant checks** (service role
  bypasses RLS, so tenant scoping must be enforced in code).

### 18.6 Malware / file-scan gate

- File scan or file-safety validation **must happen before OCR**.
- A malware/file-scan **failure must create a rejected or quarantined state before OCR**.
- OCR must **not run** on quarantined, rejected, unsupported, oversized, MIME-spoofed, or failed-scan
  files.
- If malware scanning is **not available in v1**, the plan must define a **conservative fallback gate**
  (strict MIME + magic-number + extension + size validation, PDF active-content rejection, no OCR on
  anything not affirmatively validated) and **clearly mark the residual risk** (see Risk #5).

### 18.7 Raw OCR retention limit

- Raw OCR **text retention must be time-limited**.
- Raw OCR text should be retained **only as long as needed for review/audit**.
- After approval/rejection and retention expiry, raw OCR text should be **deleted, redacted, or
  minimized** where feasible.
- **Hashes, metadata, final reviewed values, and audit diffs may be retained longer** per policy.
- Original files must also follow a **defined retention/deletion policy**.

**Recommended initial policy (Codex, FYP prototype):**

| Data class | Retention |
| --- | --- |
| Original uploaded files | Short-lived — e.g. **7–30 days** |
| Raw OCR text | **Shorter** than reviewed structured values and audit metadata |
| Metadata / hash / audit trail | Retained **longer** for auditability |

### 18.8 v1 implementation recommendation (Codex staged posture)

- Start with **provider abstraction + manual fallback first**.
- **Production OCR disabled by default.**
- **Staging synthetic documents only.**
- **No real production documents** sent to any OCR provider until explicitly approved.
- Provider keys **backend-only** — never frontend or `NEXT_PUBLIC_*`.
- **Cloud OCR only after** provider/data-residency approval.
- **Local/self-hosted OCR** may be evaluated for synthetic staging.
- **Invoice OCR first** is safest for v1.
- **Receipts follow** after invoice OCR/review is proven, because receipts interact more directly with
  allocation/cash behavior.
- **Multi-page PDF**: either a **strict page cap** or **defer to a simpler single-page v1** if
  complexity becomes too high.
- **Low-confidence approval requires AR Supervisor or Finance Manager.** AR Clerk may review/prepare
  but **must not final-approve** high-risk/low-confidence OCR items.

### 18.9 Testing additions (required future staging smoke checks)

These are added to the §11 staging test set:

- Cross-tenant **signed URL denial**.
- Cross-tenant **OCR result denial**.
- **Unsupported file** rejection.
- **MIME spoof** rejection.
- **Oversized file** rejection.
- **Double-extension** rejection.
- **SVG** rejection.
- **Malware/quarantine** simulation.
- OCR creates **review/draft only**, not financial records.
- **Low-confidence fields cannot be auto-promoted.**
- `/allocations/auto` remains **HTTP 403 `AUTO_ALLOCATION_DISABLED`**.
- **No direct protected financial DML.**
- **No production upload/import/create-record test** unless explicitly approved.

---

_Gate 2 conditions above are binding. Section 6 (data model) and Section 7 (provider) remain candidate
planning; the dispositions and provider stance in §18 take precedence where they differ._
