# Batch 7B — Demo Readiness & UI Polish — Implementation Plan

**Project:** GenAI-assisted Accounts Receivable (AR) module — TSH Synergy Sdn Bhd
**Batch:** 7B — Demo Readiness & UI Polish
**Status:** PLAN ONLY — not implemented, not committed, not pushed
**Production Supabase ref:** `kusseuycqgdilychphpq`
**Date:** 2026-06-18 (revised 2026-06-19 to reconcile with completed Batch 7A)

> **Hard rule for this batch:** UI polish, demo readiness, fixture preparation, smoke checklist, and evidence structure only. No financial RPC changes, **no database migration** (if one becomes necessary, stop Batch 7B and obtain approval for a separately scoped backend batch), no new automatic posting/allocation, no `POST /allocations/auto`, no OCR/PDF/Image import, no direct Supabase table writes from the frontend. Backend remains the source of truth.

> **Batch 7A is complete (do not re-do).** Batch 7A — Live Production Dashboard Data — is implemented, reviewed, deployed to staging **and production**, and smoke-verified (final evidence commit `4352cce`). The dashboard now renders **live** metrics from `GET /reports/dashboard?trend_months=6` via `useApi()` — there is **no remaining mock dashboard data**. Specifically, Batch 7A already: deleted the hardcoded `dso-trend-chart.tsx`; removed `DSO_TREND_DATA` / `CREDIT_RISK_DATA` / the invalid "Collection Rate" / the "Real-Time Data" wording; converted credit risk to a **live** "Customer Credit Rating Distribution" labeled *"Maintained customer credit ratings — not a predictive/AI score"*; renamed the composition chart to **"AR & Cash Position"** with currency-aware tooltips; added empty + loading + 403 states; and added live indicators (scope label, as-of date, last-updated, manual refresh). **Consequence for 7B:** the former "relabel mock DSO/Credit-Risk charts as Illustrative/Sample demo analytics" decision is **withdrawn — it no longer applies**. Dashboard work in 7B is reduced to **demo-readiness verification** of the already-live dashboard (no new mock data, no new dashboard endpoints).

---

## 1. Current repo findings

### 1.1 Pages that already exist (`frontend/src/app/(dashboard)/`)

| Route | File | Notes |
| --- | --- | --- |
| Dashboard | `page.tsx` | **Live (Batch 7A).** Live KPI cards + aging + "AR & Cash Position" composition + collection-trend + live credit-rating-distribution + quick stats + top-customers; scope/as-of/last-updated indicators + manual refresh |
| Customers list / detail | `customers/page.tsx`, `customers/[id]/page.tsx` | |
| Invoices list / detail / new / import | `invoices/page.tsx`, `invoices/[id]/page.tsx`, `invoices/new/page.tsx`, `invoices/import/page.tsx` | Import = Batch 6C 4-step wizard |
| Receipts list / detail / new / import | `receipts/page.tsx`, `receipts/[id]/page.tsx`, `receipts/new/page.tsx`, `receipts/import/page.tsx` | Import = Batch 6C; Auto-Post default ON |
| Allocations | `allocations/page.tsx` | Receipt ↔ invoice matching |
| Reports | `reports/page.tsx` + `reports/aging`, `reports/invoices`, `reports/receipts`, `reports/outstanding` | |
| Credit notes | `credit-notes/page.tsx` | |
| Journal entries | `journal-entries/page.tsx` | |
| Settings | `settings/page.tsx`, `settings/roles`, `settings/audit-log` | |
| Login | `login/page.tsx` | |

### 1.2 Shared components already available

- UI primitives: `ui/kpi-card.tsx`, `ui/status-badge.tsx`, `ui/step-indicator.tsx`, `ui/summary-row.tsx`, `ui/loading-button.tsx`.
- Dashboard (post-7A, all live): `features/dashboard/aging-chart.tsx`, `composition-chart.tsx` ("AR & Cash Position"), `collection-trend-chart.tsx` (new in 7A), `credit-risk-chart.tsx` (live rating distribution), `top-customers.tsx` (new in 7A), `quick-stats.tsx`, `chart-tooltip.tsx`. **`dso-trend-chart.tsx` was deleted in 7A.**
- Imports: `features/imports/review-actions.tsx` (Batch 6C).
- Invoices/receipts/allocations: full set of feature components (forms, tables, panels, review).

### 1.3 API / data layer

- All network access flows through `hooks/use-api.ts` (`useApi()` → `get/post/patch/del/rawFetch`), which injects `Authorization` + `X-Company-Id` and parses the `APIResponse<T>` envelope.
- **Verified:** a repo-wide search for `supabase.from(` in `frontend/src` returns **no matches** — the frontend performs **no direct table reads/writes**; everything goes through backend Edge Functions. This is a key Batch 7 safety baseline and must be preserved.
- Data hooks exist per domain: `use-dashboard`, `use-invoices`, `use-receipts`, `use-allocations`, `use-import`, etc.

### 1.4 What Batch 6C already provides (do not re-do)

- Frontend review queue actions wired to the Batch 6B route `POST /imports/:batchId/rows/:rowId/review`.
- Approve customer/invoice and edit customer/invoice-reference auto-chain `retry_validation`; reject does not; manual Retry retained; rejected rows show correction-only state.
- Fake `invoice_reference` (`invoice_not_found` + zero candidates) auto-rejected server-side and honored in the UI.
- Receipt Import "Auto-Post & Allocate" defaults ON (frontend default only).
- 4-step wizard: Upload File → Validate → Create Drafts → Result; upload auto-parses and auto-validates.

### 1.5 Where Batch 7 should modify UI (high level)

- **Dashboard:** **already live (7A) — no mock data remains.** 7B scope here is verification only: confirm empty/loading/403 states render across scopes (AR Clerk `assigned_customers` vs company), refresh works, currency labels are consistent. No code change expected unless verification surfaces a defect.
- **Import wizard (both pages):** final wording, empty/error states, summary panel clarity, review-queue affordances.
- **Review queue (`review-actions.tsx`):** copy polish, badge consistency, clearer pending/rejected states.
- **Invoice/receipt list + detail:** status-badge consistency, empty states, allocation progress clarity.
- **Demo fixtures:** a NEW demo CSV kit generated via a repeatable `RUN_ID`-chained workflow with masked/non-sensitive demo data (the existing `tests/fixtures/*` use `REPLACE`-token placeholders and are not directly uploadable; hardcoded production invoice references must be avoided because they go stale after one demo).

### 1.6 Risks / unclear areas (must resolve during implementation, not assume)

1. **Mock dashboard data — RESOLVED IN BATCH 7A (no longer a 7B risk).** The prior concern (hardcoded `DSO_TREND_DATA` / `CREDIT_RISK_DATA` under a "Real-Time Data" subtitle) was eliminated by Batch 7A: the dashboard is now fully live via `GET /reports/dashboard`, the DSO chart was deleted, credit-risk is a live maintained-rating distribution explicitly labeled "not a predictive/AI score", and the "real-time" wording is gone. **The "Illustrative / Sample demo analytics" relabel decision is withdrawn.** 7B must **not** reintroduce mock dashboard data and must **not** add a new dashboard/DSO endpoint. Remaining dashboard risk for 7B is limited to verifying live empty/loading/403/role-scope states present well in the demo.
2. **Existing fixtures are placeholder-token files.** `tests/fixtures/import-phase-*.csv` contain `CUST-REPLACE-001`, `REPLACERUNID`, `INVOICE-REFERENCE-REPLACE-001`, etc. They are designed for a substitution harness, not for a live demo upload. The demo kit must use **real seeded customer codes / invoice references** from the demo tenant — these values must be confirmed against seed data before files are written.
3. **Demo data visibility filter.** A `CLIENT_DEMO_DATA_VISIBILITY_FILTER` already exists (see `docs/evidence/cloud-deployment/`). Any new demo fixtures must not regress that filter (no leaking of internal/test rows). Confirm the filter's expected behavior before adding demo data.
4. **Auto-Post ON default during demo.** Receipt import posts/allocates by default. The demo script must make this explicit so the presenter does not accidentally post when intending a draft-only walkthrough.
5. **Reports pages depth.** Several report sub-pages exist; need a quick pass to confirm which are demo-ready vs. stubs, so the demo script only routes to ready pages.

---

## 2. Batch 7 scope

1. **Dashboard demo verification (no mock work)** — the live dashboard shipped in Batch 7A; 7B only **verifies** demo readiness: empty/loading/403 states across AR Clerk (`assigned_customers`) and company scope, refresh + last-updated/as-of indicators, and consistent currency/number formatting. Apply small presentation fixes only if verification finds a defect. **No reintroduction of mock data; no new dashboard endpoint.**
2. **Import Wizard final demo polish** — clear 4-step stepper labels, friendly empty/parse/validate error states, a concise validation summary panel (valid vs. needs-review vs. error counts), consistent button wording.
3. **Review Queue UI polish** — copy clarity for approve/edit/reject/retry, consistent badges (pending-retry, rejected, revalidation-failed), inline-error legibility, confidence/reason display.
4. **Invoice/Receipt display polish** — `status-badge` consistency across list + detail, allocation progress clarity (allocated / unallocated / overpayment), empty-state messaging, currency formatting.
5. **Demo CSV fixture kit** — a NEW set generated via a repeatable `RUN_ID`-chained workflow (import draft invoices → post → reference them in receipt CSVs), using masked/non-sensitive demo-customer values, kept separate from `tests/fixtures/`. Multi-invoice allocation is demonstrated via the manual Allocation Wizard, not receipt import (see §5–§6).
6. **Smoke test checklist** — repeatable manual + build/typecheck steps (see §6).
7. **Evidence doc structure** — `docs/evidence/SPRINT_BATCH_7B_DEMO_READINESS_EVIDENCE.md` (see §7).
8. **Optional demo script draft** — a short presenter walkthrough mirroring the existing `CLIENT_DEMO_CHECKLIST.md` format, including the Auto-Post-ON caveat.

---

## 3. Out-of-scope items (explicitly NOT in Batch 7)

- No OCR / PDF / Image import.
- No `POST /allocations/auto` (must remain disabled / unused).
- No new or changed financial RPCs.
- No direct table mutation for financial fields (`invoices.outstanding`, `receipts.allocated_amount`, `receipts.unallocated_amount`, `allocation_details`).
- **No database migration.** If one becomes necessary, stop Batch 7B and obtain approval for a separately scoped backend batch.
- No new fully-automatic posting/allocation feature beyond the already-approved Batch 6C behavior.
- No frontend direct Supabase table writes.
- No backend business-logic / validation behavior changes.

---

## 4. Proposed frontend changes

> All changes are presentation-only. No data hook should gain new write paths; no new endpoint should be called that mutates financial state.

| Area | Likely files | Proposed polish |
| --- | --- | --- |
| Dashboard | `app/(dashboard)/page.tsx` and `features/dashboard/*` (live, from 7A) | **Verification-first — no change expected.** The live dashboard already has consistent `formatCurrency`, empty/loading/403 states, and accurate labels. Only apply minor presentation fixes if a demo-readiness defect is found; do not reintroduce mock data or add endpoints |
| Import wizard | `app/(dashboard)/invoices/import/page.tsx`, `app/(dashboard)/receipts/import/page.tsx`, `ui/step-indicator.tsx` | Stepper label clarity; validation summary panel (valid / needs-review / error); friendlier parse/validate error banner copy; consistent execute-button wording. Invoice import wording must say **"creates draft invoices only"** (invoice import auto-post stays blocked) |
| Review queue | `components/features/imports/review-actions.tsx` | Copy polish; consistent badge styling (reuse `ui/status-badge.tsx` where possible); clearer pending-retry / rejected / revalidation-failed messaging; legible inline error |
| Invoice list/detail | `app/(dashboard)/invoices/page.tsx`, `app/(dashboard)/invoices/[id]/page.tsx`, `ui/status-badge.tsx` | Status-badge consistency (presentation mapping only — never rename/reinterpret persisted backend statuses); empty-state; currency formatting; show JE reference **only if** the existing API already returns it (do not add a JE-reference display if the response does not carry it) |
| Receipt list/detail | `app/(dashboard)/receipts/page.tsx`, `app/(dashboard)/receipts/[id]/page.tsx`, `features/receipts/receipt-summary-bar.tsx`, `features/receipts/receipt-table.tsx` | Allocation progress clarity: treat a positive `unallocated_amount` as **"unapplied cash"** by default; use "overpayment" wording **only** where backend diagnostics clearly support it. Status-badge consistency (presentation mapping only); empty-state |
| Shared primitives | `ui/status-badge.tsx`, `ui/kpi-card.tsx`, `ui/summary-row.tsx`, `ui/step-indicator.tsx` | Small, backwards-compatible polish only (variants/wording); status-badge changes are presentation-only and must not rename or reinterpret persisted backend statuses; no API change that breaks existing callers |

**Wording / status / empty-state / summary improvements to target**

- Status badges: one consistent vocabulary and color mapping for Draft / Open / Posted / Paid / Cancelled / Valid / Error / Needs Review / Rejected.
- Empty states: every list and the import result should show a friendly "no data yet" message instead of a blank table.
- Summary panels: import Validate step shows a compact count summary; receipt detail shows clear allocated / unallocated figures, labeling positive `unallocated_amount` as "unapplied cash" by default and reserving "overpayment" only for cases backend diagnostics clearly identify as such.
- No risky backend behavior changes: polish must not alter which endpoint is called or what payload is sent for any financial action.

---

## 5. Proposed CSV fixtures (PLAN ONLY — do not generate files yet)

**Convention note:** existing `tests/fixtures/import-phase-*.csv` use `REPLACE`-token placeholders (e.g. `CUST-REPLACE-001`, `INVOICE-REFERENCE-REPLACE-001`, `REPLACERUNID`) intended for a substitution harness — **not** directly uploadable. The Batch 7B demo kit must produce uploadable files, but built through a **repeatable, self-contained workflow** rather than hardcoded production invoice references. Proposed location: `docs/demo/fixtures/` or `tests/fixtures/demo/` (decide during implementation to match repo convention; keep separate from the placeholder fixtures).

### 5.0 Templates vs. generated runtime files (what gets committed)

To avoid committing stale or production-derived identifiers, the kit is split into two clearly separated kinds of file:

- **Committed = masked templates / generator inputs only.** What lands in Git are `REPLACE`/`RUN_ID`-token **templates** (or a small generator script + its masked input), containing only masked, non-sensitive demo values. These are inert — they do not by themselves target any live record.
- **Generated upload-ready files normally remain untracked.** The actual uploadable CSVs — produced by substituting a session `RUN_ID` and any **runtime invoice references** created in-demo — should **not** normally be committed; add them to `.gitignore` (e.g. a `*.generated.csv` pattern or an ignored `generated/` subfolder).
- **No production identifiers committed without review.** No real/production customer codes, invoice references, bank account codes, or other live identifiers may be committed. If any concrete identifier must be committed for documentation, it requires explicit review first.

### 5.1 Repeatable, chained demo workflow (no manual DB edits)

Hardcoded production invoice references go stale after one demo (an invoice becomes Paid or loses outstanding balance). To keep the kit repeatable, the demo data is **generated by the demo flow itself**, chained, using a unique `RUN_ID` per session:

1. **Import demo draft invoices** — upload an invoice-import CSV whose invoice references are uniquely namespaced with a `RUN_ID` (e.g. `DEMO-<RUN_ID>-INV-001`). This creates **draft invoices only** (invoice import auto-post stays blocked).
2. **Post those demo invoices** through the existing UI or verified posting flow, so they have real outstanding balances.
3. **Generate receipt-import CSVs** that reference the **newly created demo invoice numbers** from step 2 (same `RUN_ID`), so allocation always targets live, in-demo outstanding invoices.

No manual database editing is required at any step; everything flows through verified import/post endpoints. Unique `RUN_ID` references prevent duplicate receipt/invoice reference collisions across repeated demo runs.

### 5.2 Client-data protection (mandatory)

- **Do not** place real client customer names, registration numbers, contact names/phones/emails, bank account numbers, or any sensitive data into Git fixtures.
- Use **explicitly designated demo customers** and **masked / non-sensitive** values only (e.g. `DEMO CUSTOMER A`, placeholder reg/contact fields left blank or clearly fake).
- Confirm **every** fixture target customer/invoice is visible in and belongs to the **demo company context** before the file is written.

### 5.2a Pre-finalization fixture discovery & rehearsal (required before any fixture is finalized)

Before any demo fixture is finalized, the following must be done — **read-only discovery first, then rehearsal**, never assumption:

- **Read-only verification** (via existing read endpoints / UI — no writes) of: the target **company**, a **visible demo customer**, the customer's **currency**, a valid **bank account code**, and any **required references** the scenario depends on. Do not hardcode any of these from memory.
- **Staging rehearsal where practical:** rehearse the chained workflow (import drafts → post → receipt import) on **staging** before any production execution, to confirm the scenario behaves as documented.
- **No assumption that the editable-customer scenario works.** Its trigger must be confirmed against live (staging) backend behavior — see §5.4 #4.
- **Omit the editable-customer scenario** entirely if no **safe, deterministic** trigger exists; do not force it with risky input.

### 5.3 Receipt CSV header (aligned to current backend mapper)

The receipt import mapper currently supports discount / bank-charge / short-payment fields (Batch 5). Demo receipt fixtures must keep the header aligned with the backend mapper and existing fixture convention:

```
customer_code,customer_name,registration_no,bill_addr_line1,bill_city,bill_state,bill_postal,bill_country,contact_name,contact_phone,contact_email,receipt_date,currency,receipt_reference,payment_method,bank_account_code,bank_account_id,amount,cheque_date,remarks,invoice_reference,allocation_amount,discount_amount,bank_charge_amount,short_payment_reason
```

(`discount_amount`, `bank_charge_amount`, `short_payment_reason` are verified as mapped in `imports/service.ts`; leave them blank for scenarios that do not exercise them.)

### 5.4 Required demo scenarios (one small CSV each, generated per §5.1)

| # | Fixture (proposed name) | Scenario | Expected demo outcome |
| --- | --- | --- | --- |
| 1 | `demo-receipt-happy-path.csv` | Demo customer, exact `customer_code`, valid in-demo `invoice_reference`, exact `allocation_amount` | All rows Valid → Create, Post & Allocate succeeds cleanly |
| 2 | `demo-customer-fuzzy-match.csv` | `customer_name` close-but-not-exact to a demo customer | Row flagged `review_required` (customer_suggestion) → Approve customer → auto-retry → Valid |
| 3 | `demo-invoice-fuzzy-match.csv` | Valid demo customer, `invoice_reference` close-but-not-exact to an in-demo invoice | Row flagged `review_required` (invoice_suggestion) → Approve invoice → auto-retry → Valid |
| 4 | `demo-edit-customer-correction.csv` *(OPTIONAL — include only if a safe deterministic trigger is confirmed)* | **Needs confirmation during implementation** — a row that deterministically produces an **editable review state** under current backend classification. ⚠️ "No match + no suggestion" does **not** reliably create a review row: depending on current backend behavior it may trigger **customer auto-creation** instead. The exact input that yields an editable review row must be confirmed against live (staging) backend behavior (per §5.2a) before this fixture is finalized; do not assume it is guaranteed. **If no safe deterministic trigger exists, omit this scenario** rather than forcing risky input. | Reviewer uses Edit customer (`customer_code`) → auto-retry → Valid (only if included after the deterministic trigger is confirmed) |
| 5 | `demo-fake-invoice-autoreject.csv` | `invoice_reference` that does not exist and yields zero candidates (`invoice_not_found`) | Auto-rejected (correction-only state), no approve flow shown |
| 6 | `demo-overpayment-unapplied-cash.csv` | `amount` > matched in-demo invoice outstanding | Posts with positive `unallocated_amount` surfaced as **unapplied cash** (labeled "overpayment" only where backend diagnostics support it); no direct balance writes — backend handles |

> **Multi-invoice allocation is NOT a receipt-import fixture.** Receipt import currently maps one receipt row to one exact invoice reference; multiple CSV rows create **multiple receipts**, not one receipt allocated across multiple invoices. Demonstrating Batch 3 multi-invoice allocation is therefore moved to the **presenter / smoke checklist** as a manual Allocation Wizard scenario (see §6). Do not imply that receipt import demonstrates multi-invoice allocation.

### 5.5 Fixture side effects (must be documented in the kit)

- Running these fixtures **creates real demo financial records** (draft/posted invoices, posted receipts, allocations) through verified flows — they are not inert sample data.
- Every run uses a unique `RUN_ID` so references never collide across demos.
- **Cleanup safety (mandatory):**
  - **No deletion and no direct cleanup of any financial record is permitted** (no destructive DB cleanup, no manual table edits).
  - **No customer visibility flag may be changed without explicit user approval.** In particular, **do not soft-hide existing shared customers** just to hide a demo run.
  - `RUN_ID`-scoped records **may remain as clearly marked demo records** — they are not required to be removed.
  - **Dedicated demo-company / demo-customer scoping is the preferred isolation strategy** (keep demo data inside a designated demo context rather than mutating shared data).

**Constraints for all demo fixtures:**
- Keep amounts small and obviously "demo" (round figures, clear remarks).
- Must not regress the existing demo data-visibility filter (no internal/test-only rows leaking into demo views).
- No fixture should require OCR/PDF/Image; CSV (and optionally XLSX mirror) only.

### 5.6 Production-mutation approval gate (mandatory before any fixture is executed)

Running a fixture **creates persistent financial records** (§5.5). Therefore, **before any fixture is run** — i.e. before any invoice, receipt, allocation, or other persistent financial record is created — the plan requires **explicit user approval** that identifies all of:

- **Target environment** (e.g. staging vs production);
- **Company** (the demo tenant);
- **Demo customer(s)** to be used;
- **Scenarios to execute** (which of §5.4 #1–#6);
- **Expected persistent financial records** that will result (counts/types of invoices, receipts, allocations).

**Clarification:** creating the fixture **files/templates does not authorize running them.** Authoring/committing masked templates (§5.0) is permitted within Batch 7B; **executing** any fixture against any environment is a separate action that requires the explicit approval above. No production execution may proceed on assumption.

---

## 6. Smoke test checklist (to run during implementation, before evidence sign-off)

**Build / static checks (frontend):**
- [ ] `cd frontend && npm.cmd run build` passes (compile + lint + types).
- [ ] Typecheck/lint clean (no new warnings introduced by polish).

**Import upload flow:**
- [ ] Invoice Import shows exactly 4 steps; upload auto-parses + auto-validates and lands on Validate.
- [ ] Receipt Import shows exactly 4 steps; same auto flow.

**Validation flow:**
- [ ] Valid rows, needs-review rows, and error rows are clearly counted/summarized.
- [ ] Parse/validate error surfaces on the Validate step (no crash, friendly copy).

**Review queue actions:**
- [ ] Customer fuzzy → Approve → auto-retry → Valid.
- [ ] Invoice fuzzy → Approve → auto-retry → Valid.
- [ ] Edit customer correction → auto-retry → Valid.
- [ ] Fake invoice_reference → auto-rejected, correction-only.
- [ ] Reject does not auto-retry; manual Retry still works.

**Create drafts / execution:**
- [ ] Invoice import Create Drafts **creates draft invoices only** (invoice import auto-post stays blocked).
- [ ] Receipt import: **confirm the selected import mode before execution** — Auto-Post & Allocate defaults ON, so verify the checkbox state matches intent. With Auto-Post ON it posts + allocates via the existing flow; with it OFF it creates drafts only.
- [ ] No financial document is created by approve/edit/reject/retry — only the Create / Create-Post-Allocate button executes.

**Multi-invoice allocation (manual Allocation Wizard — NOT receipt import):**
- [ ] Create and post one demo receipt (UI or verified flow).
- [ ] Open the Allocation Wizard and select **multiple** posted in-demo invoices for that receipt.
- [ ] Allocate across them via **one atomic manual allocation request** (`POST /allocations/manual`), confirming the Batch 3 multi-invoice allocation behavior.
- [ ] Confirm receipt import was NOT used to claim multi-invoice allocation.

**Receipt / invoice display:**
- [ ] Status badges consistent across list and detail.
- [ ] Receipt detail shows correct allocated / unallocated figures; positive `unallocated_amount` labeled "unapplied cash" (not auto-labeled "overpayment").
- [ ] Empty states render where there is no data.

**Reports / dashboard (live — Batch 7A; verify only):**
- [ ] Dashboard loads with **live** data from `GET /reports/dashboard`; no mock data and no "real-time" claim.
- [ ] Credit-rating chart reads "Customer Credit Rating Distribution — Maintained customer credit ratings — not a predictive/AI score"; composition reads "AR & Cash Position" with currency-aware tooltips.
- [ ] Empty, loading, and 403 (role-not-permitted) states render cleanly; scope label, as-of date, last-updated, and manual refresh behave for both AR Clerk (`assigned_customers`) and company scope.
- [ ] Report sub-pages used in the demo are confirmed ready (no stub routed in the demo script).

**No seed/test data visibility regression:**
- [ ] Demo data-visibility filter still hides internal/test rows.
- [ ] New demo fixtures do not appear where they should not.

**Safety re-confirmation:**
- [ ] `POST /allocations/auto` never called.
- [ ] Verify `POST /allocations/auto` still returns **HTTP 403 `AUTO_ALLOCATION_DISABLED`**.
- [ ] No direct Supabase table write added in `frontend/src` — search for `.from(` and any frontend Supabase **client** usage (`supabase.from`, `createClient` writes) → expect no table mutations.
- [ ] `git diff --check` passes (whitespace/conflict markers; CRLF warnings only acceptable).
- [ ] `git status --short` reviewed — only intended Batch 7 files changed (frontend polish, new demo fixtures/docs); no backend or migration files.

---

## 7. Evidence file plan

Proposed file: `docs/evidence/SPRINT_BATCH_7B_DEMO_READINESS_EVIDENCE.md`

Proposed sections (mirrors the project's existing evidence convention):
1. Purpose
2. Scope (UI polish, fixtures, smoke checklist, demo script)
3. Files changed (frontend polish + new fixtures + docs)
4. Dashboard polish — before/after, data-labeling resolution
5. Import wizard polish
6. Review queue polish
7. Invoice/receipt display polish
8. Demo CSV fixture kit — list, scenarios, expected outcomes
9. Smoke test results (from §6)
10. Commands / checks (build, typecheck, lint, `.from(` / frontend Supabase client search, `git diff --check`, `git status --short`, `POST /allocations/auto` → 403 `AUTO_ALLOCATION_DISABLED`)
11. Safety confirmations (no RPC/migration/auto-allocation/OCR/direct-write)
12. Demo script (optional, or linked checklist)
13. Risks / follow-ups
14. Final status

A companion presenter checklist may be added as `docs/evidence/audit-remediation/BATCH_7_CLIENT_DEMO_CHECKLIST.md` (format reused from `frontend-sprint-f1/CLIENT_DEMO_CHECKLIST.md`).

---

## 8. Risk controls (pre-confirmed for this plan)

| Control | Status for Batch 7 |
| --- | --- |
| No financial RPC change needed | ✅ Confirmed — Batch 7 is presentation + fixtures + docs only; no RPC touched |
| No database migration | ✅ Confirmed — **no migration in Batch 7B.** If one becomes necessary, stop Batch 7B and obtain approval for a separately scoped backend batch |
| No direct Supabase table writes from frontend | ✅ Confirmed baseline — `supabase.from(` search returns zero matches in `frontend/src`; polish must preserve this |
| `POST /allocations/auto` not enabled | ✅ Confirmed — remains disabled/unused |
| No OCR/PDF/Image import | ✅ Confirmed — out of scope |
| No new automatic posting/allocation | ✅ Confirmed — only the already-approved Batch 6C Auto-Post default exists; no new auto behavior |
| Backend remains source of truth | ✅ Confirmed — all actions continue to call existing Edge Function endpoints |
| Dashboard data source | ✅ Live (Batch 7A) — dashboard reads `GET /reports/dashboard`; no mock data remains; 7B must not reintroduce mock data or add a dashboard/DSO endpoint |
| "Unapplied cash" vs "overpayment" | ✅ Confirmed — positive `unallocated_amount` shown as unapplied cash by default; "overpayment" only where backend diagnostics support it |
| JE reference display | ✅ Confirmed — shown only if the existing API already returns the journal reference; no new field introduced |
| Status badges are presentation-only | ✅ Confirmed — mapping/wording only; persisted backend statuses never renamed or reinterpreted |
| `POST /allocations/auto` returns 403 | ✅ To re-verify in smoke — expected `AUTO_ALLOCATION_DISABLED` (403); route stays disabled |
| No client sensitive data in fixtures | ✅ Confirmed — designated demo customers + masked/non-sensitive values only; no real names/reg/contact/bank data |

**No open feature-scope decisions remain. The remaining items are implementation gates and execution approvals, not scope changes.** The former dashboard-labeling decision is now **moot** — Batch 7A delivered a fully live dashboard, so 7B dashboard work is verification only (no mock data, no new endpoint). The remaining gates, all to be resolved during implementation (and, for production mutation, approved by the user) rather than as scope changes, are:

- fixture directory / template-vs-runtime split (§5.0);
- a safe deterministic editable-customer trigger (§5.4 #4) — confirmed against staging, or the scenario is omitted;
- the target demo environment, company, and customer (§5.2, §5.6);
- the cleanup/retention strategy (§5.5);
- explicit user authorization to **execute** any fixture that creates persistent financial records (§5.6).

---

## Summary of plan intent

Batch 7B is a **non-functional, demo-readiness pass** that builds on the now-complete Batch 7A live dashboard: tighten UI copy, badges (presentation-only), empty/loading states, and summary panels across import wizard / review queue / invoice & receipt views; **verify** (not rebuild) the already-live dashboard's demo readiness (empty/loading/403/role-scope, refresh, currency); produce a **repeatable demo CSV kit** generated through a `RUN_ID`-chained workflow (import draft invoices → post → reference in receipt CSVs) using masked/non-sensitive demo data covering five required scenarios plus one optional editable-customer scenario, with multi-invoice allocation shown via the manual Allocation Wizard; provide a repeatable **smoke checklist** (including git/Supabase-write/403 safety checks); and capture it all in a structured **evidence document** plus an optional presenter script. No backend, RPC, migration, or financial-write changes are required or permitted; no mock dashboard data is reintroduced. The plan is safe for Codex review.
