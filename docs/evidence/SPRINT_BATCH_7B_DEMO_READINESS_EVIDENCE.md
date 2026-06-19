# Sprint Batch 7B — Demo Readiness & UI Polish — Evidence

**Project:** GenAI-assisted Accounts Receivable (AR) module — TSH Synergy Sdn Bhd
**Batch:** 7B — Demo Readiness & UI Polish
**Status:** Implemented (frontend/docs/templates only) — **not committed, not pushed, not deployed**
**Date:** 2026-06-19
**Plan:** `docs/plans/BATCH_7_DEMO_READINESS_UI_POLISH_PLAN.md` (Codex final review: PASS)
**Production Supabase ref:** `kusseuycqgdilychphpq`

> **Scope guardrails honored:** UI/docs/masked-template only. No backend, database migration,
> Supabase Edge Function, financial RPC, or invoice/receipt/allocation mutation logic was changed.
> `POST /allocations/auto` was not enabled or called. No direct Supabase financial-table access was
> added. No fixture was executed; no persistent financial records were created. No deploy/commit/push.

---

## 1. Purpose

Apply safe, frontend-only demo-readiness polish on top of the completed Batch 7A live dashboard,
verify the live dashboard, and ship masked demo fixture **templates** (no execution), with an
evidence record and a structured smoke/approval checklist.

## 2. Files changed

**Frontend (presentation-only — 4 files):**

| File | Change |
| --- | --- |
| `frontend/src/hooks/use-import.ts` | Added presentation-only helpers `isActiveReviewRow()` and `summarizeValidationCounts()` so both wizards derive **non-overlapping** validation summary counts. No backend contract change, no new endpoint, no reinterpretation of persisted statuses. |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | Corrected stale "Draft Only" banner (removed false "Receipt import / Payment allocation not available yet" claims); header now reads **"Creates Draft Invoices Only"** and explains posting happens later and receipts/allocation are separate. Added a **"Needs Review"** count and switched the **Error** count to the derived, non-overlapping count (Valid / Needs Review / Error / Total). |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Reconciled Auto-Post wording with the actual default: the checkbox defaults **ON**, so the subtitle and banner now state **"Auto-Post & Allocate is ON by default"** (turn it off on the Validate step for draft-only). Added the **"Needs Review"** count and switched the **Error** count to the derived, non-overlapping count. |
| `frontend/src/components/features/receipts/receipt-table.tsx` | Allocation footer label aligned from "Avail:" to **"Unapplied:"** for consistent unapplied-cash terminology. |

**Docs / masked templates (new):**

| File | Purpose |
| --- | --- |
| `docs/demo/fixtures/README.md` | Demo kit guide: token table, repeatable workflow, scenarios, approval gate, template-vs-generated split, safety constraints. |
| `docs/demo/fixtures/.gitignore` | Keeps generated upload-ready files (`generated/`, `*.generated.csv`) untracked. |
| `docs/demo/fixtures/demo-invoices-seed.template.csv` | Seeds draft invoices (RUN_ID-namespaced references). |
| `docs/demo/fixtures/demo-receipt-happy-path.template.csv` | Scenario 1 — exact match, full allocation. |
| `docs/demo/fixtures/demo-customer-fuzzy-match.template.csv` | Scenario 2 — customer_suggestion review path. |
| `docs/demo/fixtures/demo-invoice-fuzzy-match.template.csv` | Scenario 3 — invoice_suggestion review path. |
| `docs/demo/fixtures/demo-fake-invoice-autoreject.template.csv` | Scenario 5 — invoice_not_found auto-reject. |
| `docs/demo/fixtures/demo-overpayment-unapplied-cash.template.csv` | Scenario 6 — overpayment → unapplied cash. |
| `docs/evidence/SPRINT_BATCH_7B_DEMO_READINESS_EVIDENCE.md` | This evidence document. |

## 3. UI polish completed

- **Invoice import — accuracy fix.** The old banner asserted "Receipt import is not available yet"
  and "Payment allocation is not available yet" — both false now. Replaced with an accurate
  draft-only explanation that clearly states **the import creates draft invoices only** and that
  posting/receipts/allocation are handled elsewhere.
- **Receipt import — default-mode honesty.** The Auto-Post & Allocate checkbox defaults ON, but the
  copy previously implied "draft by default". Subtitle and banner now clearly state **Auto-Post &
  Allocate is ON by default**, with an explicit instruction to turn it off for draft-only. The
  existing pre-execution warning box (shown when Auto-Post is on) is retained.
- **Validation summary clarity (non-overlapping counts).** Both import wizards now show **Valid /
  Needs Review / Error / Total** using shared, presentation-only derivation
  (`summarizeValidationCounts` in `use-import.ts`):
  - **Needs Review** counts only *active* review items — `review_required === true` excluding rows
    whose `review_result` is terminal/handled (`revalidated_valid`, `approved_pending_retry`,
    `rejected`, `rejected_invalid_selection`). This keeps server-side auto-rejected / correction-only
    rows out of Needs Review.
  - **Error** counts `Error` / `Unmatched` / `Skipped` rows that are **not** active review items, so
    Error and Needs Review never overlap.
  - **Valid** keeps the existing `batch.valid_rows`; **Total** keeps `batch.total_rows`.
  - No new endpoint and no reinterpretation of persisted backend statuses beyond presentation
    bucketing.
- **Allocation terminology.** Receipt list footer now says **"Unapplied:"** (was "Avail:"),
  matching the receipt detail page's "unapplied cash" language and the plan's allocation wording.
- **Review queue / status badges — verified, no change needed.** `review-actions.tsx` already has
  clear pending-retry, rejected, and revalidation-failed states with legible inline errors;
  `StatusBadge` already provides one consistent presentation mapping. No persisted backend status
  was renamed or reinterpreted.
- **List/detail states — verified, no change needed.** Invoice list, invoice detail, and receipt
  detail already have loading/error/empty states and currency formatting; receipt detail already
  labels positive `unallocated_amount` as **unapplied cash**.

## 4. Dashboard verification (no rebuild, no mock, no DSO endpoint)

Verified against `frontend/src/app/(dashboard)/page.tsx` and `features/dashboard/*`:

- Loads **live** from `useDashboardMetrics(6)` → `GET /reports/dashboard?trend_months=6` via the
  `useApi()` layer. No mock dashboard data present.
- Scope label (Assigned Customers / Company), **As of** date, **Updated** timestamp, and the manual
  **Refresh** control are present and correct (`DashboardHeader`).
- Credit-rating chart reads **"Customer Credit Rating Distribution — Maintained customer credit
  ratings — not a predictive/AI score"** (maintained rating, not predictive AI risk).
- Composition chart reads **"AR & Cash Position"** with currency-aware tooltips driven by
  `meta.base_currency`.
- **No mock DSO chart** is present (`dso-trend-chart.tsx` was removed in Batch 7A; not reintroduced).
- Empty / loading / 403 (role-not-permitted) states are present.

**Result:** No real defect found → **no dashboard code change made** (verification-only, per plan).

## 5. Demo fixture templates / generator structure

- **Masked templates only.** All committed fixtures are `*.template.csv` with `REPLACE`/`RUN_ID`
  tokens — no real customer codes, invoice numbers, bank accounts, names, registration, or contacts.
- **Template-vs-runtime split enforced.** Generated upload-ready files are written to
  `docs/demo/fixtures/generated/` (and `*.generated.csv`), which is **gitignored**
  (verified: `git check-ignore` reports the path is ignored). No runtime identifiers are committed.
- **Five required scenarios** shipped (happy path, customer fuzzy, invoice fuzzy, fake-invoice
  auto-reject, overpayment) plus a draft-invoice seed template.
- **Optional editable-customer scenario (§5.4 #4) omitted** — a safe, deterministic trigger for an
  editable review row cannot be confirmed without staging execution (out of scope for this pass), so
  it was intentionally not shipped, per the plan's "omit if no safe deterministic trigger exists."
- **Multi-invoice allocation** is documented as a manual **Allocation Wizard** (`POST
  /allocations/manual`) scenario, not a receipt-import scenario.

> **Fixtures were NOT executed.** No template was generated into an upload-ready file and no upload
> was performed. **No invoice, receipt, allocation, or other persistent financial record was created
> by this work.** Executing any fixture requires the separate approval gate in plan §5.6.

## 6. Build / safety check results

| Check | Result |
| --- | --- |
| `npm.cmd run build` (in `frontend/`) | **PASS** — exit 0; compiled successfully; all routes generated (incl. static dashboard `/`). |
| `git diff --check` | Clean — only LF→CRLF informational warnings (acceptable per plan); no whitespace/conflict errors. |
| `git status --short` | Modified: `frontend/src` polish (4 files — `hooks/use-import.ts`, both import pages, `receipt-table.tsx`). Untracked: `docs/demo/` (templates), `docs/evidence/SPRINT_BATCH_7B_DEMO_READINESS_EVIDENCE.md` (this file), and the Batch 7B plan doc. No backend/database/Edge/RPC files. |
| Direct Supabase table access in `frontend/src` (`supabase.from`, `.from("invoices"/"receipts"/"allocation_details")`) | **None.** |
| `createClient` in `frontend/src` | Only in the pre-existing auth client `frontend/src/lib/supabase.ts` (untouched, not in change set). |
| `POST /allocations/auto` usage | Not called. `useAutoAllocate()` remains a disabled stub that throws; no network call. |
| Demo `generated/` gitignore | Verified ignored via `git check-ignore`. |

## 7. Safety confirmations

- **No backend / database / Edge Function / financial RPC changes** — change set is `frontend/src`
  presentation + `docs/` only.
- **No invoice/receipt/allocation mutation logic changed.**
- **`POST /allocations/auto` not enabled or called.**
- **No direct Supabase financial-table access added.**
- **No fixture execution; no persistent financial records created; no production data mutated.**
- **No deploy, no commit, no push.**

## 8. Required production sequence (unchanged from Batch 7A)

Batch 7B is presentation/templates only and does not change the Batch 7A production requirement:
production backend (migration 014, `BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur`, reviewed `reports`
Edge Function) must remain deployed before/with the live-dashboard frontend. Batch 7B introduces no
new backend dependency.

## 9. Known limitations / follow-ups

- The editable-customer demo scenario is deferred until a safe deterministic trigger is confirmed on
  staging (requires execution).
- Demo fixture **execution** is gated on explicit user approval (environment, company, customer,
  scenarios, expected records) per plan §5.6.
- A presenter walkthrough script may be added later; the README covers the operational steps.

## 10. Final status

All Batch 7B implementation items complete: UI polish applied, dashboard verified (no defect / no
change), masked fixture templates and generator structure created (not executed), build PASS, safety
checks clean. **Ready for Codex post-implementation review.** No commit/push/deploy performed —
awaiting review and explicit approval.
