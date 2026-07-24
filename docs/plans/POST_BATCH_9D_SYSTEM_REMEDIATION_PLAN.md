# Post-Batch-9D System Remediation Plan

**Gate P1 — Consolidated Read-Only Diagnosis, UI/UX Design, and Implementation Plan (canonical, Codex-reconciled).**

- Project: Degree Final Year Project — Accounts Receivable (AR) Module (TSH Synergy)
- Repository: `TIME-00/AI---Account-Receivable-AR-Module` · Branch: `main`
- Diagnosed at HEAD: `b3b6a634f0f2c6f7ac28d864114c7bc41d4413ef` (plan remains uncommitted until it passes Codex re-review)
- Production Supabase: `kusseuycqgdilychphpq` · Company: `00000000-0000-0000-0000-000000000001`
- Production frontend: https://account-receivable-module.vercel.app/
- Data classification: **P1 — SYNTHETIC / DEMO DATA**
- Ownership: **Claude** owns plan/documentation, frontend architecture/implementation planning, UI/UX, and frontend test/browser-validation planning. **Codex** owns backend, database, migrations, RPC/Edge implementation, financial-contract validation, tenant isolation, and security/code audit. Claude never implements migrations or backend logic.
- This document is the single authoritative plan. It contains one authoritative version of every conclusion, using only the final Codex-reconciled decisions.

---

## 1. Executive Summary

Twelve reported issues were traced frontend → hook/query-key → Edge endpoint/RPC → SQL migration → accepted Batch 9D evidence, then reconciled against Codex's independent review and its authoritative read-only Production findings. Canonical conclusions:

- **No monetary summation defect exists in the frontend or SQL.** Invoice and receipt list totals come from the same authoritative routine (migration 027) rendered by the same `MoneySummary`. The apparent "foreign summed as MYR" is a **legacy/demo booked-snapshot** condition: three policy-visible foreign invoices are `LEGACY_UNVERIFIED`, Posted, booked at rate **1**, with internally-consistent stored base equations. The displayed values are historical **booked-base** totals, not present MAS valuations. The catalog-rate figure MYR 534,333 is a **counterfactual only**. Gate A presents these rows truthfully; correcting them is a separate, explicitly authorized data decision (DP-1) outside Gate A.
- **The red "Blocked" badge (Issues 3, 5) is FX posting-eligibility, not business or allocation status.** The fix is **frontend presentation mapping** (Posted → "Booked / Rate locked"; `LEGACY_UNVERIFIED` → "Legacy rate unverified"; genuine inconsistency/rejection → danger). **No database migration is required.**
- **New-entry FX is broken and its fix requires a backend contract change and a forward migration (Issues 9, 10).** No FX fetch exists in the frontend; both forms use a manual `exchange_rate` defaulting to 1 (invoice label hard-codes `?`). `GET /fx-rates/lookup` reads `fx_reference_rates`, but the create routes do not accept `fx_reference_rate_id`, and a looked-up numeric rate currently becomes `MANUAL_OVERRIDE`. The core `fx_record_booking_decision` accepts a reference id, but **the four governed RPC wrappers omit it and hardcode `NULL`**, so `REFERENCE_SELECTED` is unbookable end-to-end. Gate A therefore includes **one Codex-owned forward SQL migration** extending those wrappers plus the Edge/service wiring; Claude builds one shared governed FX component/hook.
- **Notifications (Issues 7, 8) need a real architecture, not a limit tweak.** The page sends `limit=50`; the backend accepts 1–20 → `VALIDATION_ERROR`; the dropdown works on the default 10. Fix = stable cursor pagination (max 20/request) + a per-user acknowledgement store keyed `import:<batch_uuid>:<condition_type>`, with separate unread-count, read-one and read-all contracts. `overdue_ar` is **de-scoped**; scope is import alerts only.
- **Lists "capped at 15" (Issue 4) was already remediated** (commit `233005146f7e9551e45fc437fc7fcade678a9f62`). Caps: **Edge/API max 100**, **internal RPC max 200**, fallback 20, page size 15. "All" means all statuses → rename **"All statuses"**. Gate A adds regression fixtures only.
- **Credit & Debit Notes (Issue 6)** — physical 0 CN / 1 DN (the DN belongs to a hidden customer, correctly excluded); policy-visible 0/0. The empty UI is expected and correct; populated behavior is tested with local fixtures.
- **Report Export (Issue 11)** is **Option B**: Codex adds bounded authoritative export-data routes; Claude generates PDF/XLSX with sanitization, Unicode, and object-URL revocation. Empty reports still generate valid files.
- **Feature Status (Issue 12)** is a hard-coded array; exact phase-aware strings are defined and change only when the relevant gate passes.

Consolidation is **three gates** (A → B → C).

---

## 2. Current Authoritative Baseline

- Batch 9D is fully Production-deployed and CLOSED (gates 9D-E1…E4, 9D-E). This plan does not reopen it. Migrations 017–030 installed; 16 Edge Functions deployed; MAS FX provider enabled; one approved daily FX scheduler (`batch_9d_e_fx_scheduler_production`, `30 7 * * *` UTC); no conflicting scheduler; no daily-overdue cron; automatic allocation disabled (`AUTO_ALLOCATION_DISABLED`).
- Post-reset operational state (Codex SELECT-only, authoritative): three policy-visible foreign invoices; two policy-visible foreign receipts; physical CN/DN = 0/1; policy-visible CN/DN = 0/0 (details in §5).
- Architecture: Next.js 15.5.x + React 19 + TS + Tailwind (`frontend/src`); Deno/TS Edge Functions (`backend/supabase/functions`); PostgreSQL migrations (`database/`). Authoritative monetary aggregation = `database/027_batch_9d_d_authoritative_monetary_aggregation.sql`. FX booking governance = `database/022`–`026`.

---

## 3. Scope and Non-Goals

**In scope now:** documentation normalization producing this single canonical, implementation-ready plan.

**In scope (later, when authorized):** Claude frontend implementation/tests; Codex backend/RPC/Edge/migration/financial/security work.

**Prohibitions honored:** no code/backend/migration/schema edits; no data mutation; no identities; no Edge deploy; no scheduler/secret change; no Vercel deploy; no stage/commit/push; no Gate A implementation start. Booked FX rates are never overwritten with current/reference rates; heterogeneous native currencies are never summed as one; backend-authoritative totals are never replaced by client-calculated ones. `Poster/` and `social-media/` remain out of scope and untouched.

---

## 4. Confirmed Root-Cause Matrix (all 12 issues)

| # | Issue | Classification | Root cause (authoritative) | Owner(s) | Gate |
|---|-------|----------------|-----------------------------|----------|------|
| 1 | Credit Rating drill-down | Missing feature (frontend **+ backend filter**) | Chart has no click/keyboard behavior; `credit_rating_distribution` has no customer rows. `GET /customers?credit_rating=` returns zero-outstanding customers and does not reproduce the chart's outstanding-only population. Extend `ar_aging_by_customer` + `/reports/aging/by-customer` with an exact `credit_rating` filter. | Codex (RPC/Edge filter) + Claude (chart/modal) | B |
| 2 | Invoice base totals / legacy snapshots | Data-state (code correct) + insufficient UI explanation | Frontend/SQL/API correct. Three policy-visible foreign invoices are `LEGACY_UNVERIFIED`, Posted, booked at rate 1, internally consistent. Totals are booked-base, not current-rate valuations; MYR 534,333 is a catalog counterfactual. | Codex (data facts; correction only if separately authorized) + Claude (UI clarity) | A (present-only); correction = DP-1 |
| 3 | Invoice "Blocked" badge | Presentation defect (frontend) | Not a status — FX posting-eligibility chip; `blocked` conflates `LEGACY_UNVERIFIED`, already-Posted, and inconsistent states. No migration required. | Claude (mapping) | A |
| 4 | Lists "capped at 15" / "All" | Already remediated (regression/polish) | Real server pagination since commit `2330051`. Caps: Edge/API 100, RPC 200, fallback 20, page 15. "All" = all statuses → "All statuses". | Claude | A |
| 5 | Receipt "Blocked" badge | Presentation defect (frontend) | Same FX posting-eligibility chip on receipts; independent of allocation status. | Claude (mapping) | A |
| 6 | Credit & Debit Notes empty | Expected/correct behavior | Physical 0 CN / 1 DN; the 1 DN belongs to a hidden customer, correctly excluded. Policy-visible 0/0. Empty state is correct. | Claude (copy/tests) | B |
| 7 | Notifications page unusable | Confirmed defect (contract + architecture) | Page sends `limit=50`; backend allows 1–20 → `VALIDATION_ERROR`; no cursor/page param; `meta.total` = array length; `overdue_ar` not produced. Limit tweak insufficient. | Codex (cursor + endpoints) + Claude (UI) | B |
| 8 | Notification badge stale | Confirmed design gap | No read/unread model; `notifCount = notifications.length`. Requires per-user acknowledgement store + unread-count endpoint. | Codex (migration/API/RLS) + Claude (UI/cache) | B |
| 9 | New Receipt FX (rate=1, editable) | Confirmed defect (frontend + backend contract + migration) | No FX fetch; default rate 1; freely editable. The four governed RPC wrappers omit `p_fx_reference_rate_id` and hardcode `NULL`; create validators don't accept it — so `REFERENCE_SELECTED` is unbookable end-to-end. Requires a Codex forward migration + Edge/service change. | Codex (wrapper migration + booking contract) + Claude (FX component) | A |
| 10 | New Invoice FX display ("?") | Confirmed defect (frontend + backend contract + migration) | Legacy header form hard-codes `?`; manual rate; no fetch; same wrapper/validator gap as #9 (forward migration required). | Codex (wrapper migration + booking contract) + Claude (shared FX component) | A |
| 11 | Report Export (4 reports) | Missing feature (Option B) | Export disabled/"Coming Soon"; no export data path. | Codex (export-data routes) + Claude (PDF/XLSX + UX) | C |
| 12 | Stale Feature Status | Stale hard-coded wording | Hard-coded array; wrong FX/export/notifications/notes labels. | Claude | A/B/C |

---

## 5. Evidence Supporting Each Root Cause

Production data facts for Issues 2 and 6 are Codex's authoritative SELECT-only findings and are treated as settled planning evidence. All other statements are source-verified at the cited paths.

### Issue 1 — Credit Rating drill-down
- `frontend/src/components/features/dashboard/credit-risk-chart.tsx:54-58` — `<Bar>`/`<Cell>` have no `onClick`; SVG bars are not inherently keyboard-focusable.
- `frontend/src/app/(dashboard)/page.tsx:139-145` + `types/index.ts:538-543` — chart data is `{ rating, customer_count, outstanding_base }` only; the dashboard distribution counts only customers with company-base outstanding > 0.
- `GET /customers?credit_rating=A` (`customers/service.ts:367`) returns all policy-visible A-rated customers, **including zero-outstanding ones**, so it does not reproduce the chart population. The current A-rating match (two visible, both with outstanding) is a data coincidence, not a durable contract. Local-filter/all-customers and per-customer N+1 are rejected.
- `ar_aging_by_customer` (migration 027) already returns `credit_rating`, `base_total`, and bucket fields and filters outstanding-only (invoice predicate + `ranked WHERE base_total > 0`), so an exact `credit_rating` filter added there yields the correct drill-down dataset.

### Issue 2 — Invoice base totals / legacy snapshots
- Frontend consumes backend totals only: `invoices/page.tsx:199-202`; `use-invoices.ts:213-223`; `money-summary.tsx:31-83` (per-currency native subtotals + separate backend `base_total`; never sums across currencies).
- SQL is symmetric/correct: `database/027_...sql` — `ar_invoice_collection` uses `document_base_total = SUM(f.base_total)` and `current_base_total = SUM(ROUND(i.outstanding*i.exchange_rate,2))` (lines 528-543); `ar_receipt_collection` mirrors it with `SUM(f.base_amount)` (lines 713-729).
- Policy-visible foreign invoices: count **3**; native total **110,100.00**; stored booked base **MYR 110,100.00**; booked-rate-1 rows **3**; all `LEGACY_UNVERIFIED`; all Posted; all have journal entries; one Paid SGD invoice has two allocations; document-date catalog rates exist (≈ 3.33, 4.50, 4.89).
- Policy-visible foreign receipts: count **2**; native total **SGD 300.00**; stored booked base **MYR 999.00**; booked-rate-1 rows **0** (receipts carry realistic booked rates — the reason receipts convert correctly while these invoices do not).
- Visible invoice summaries: current booked-base outstanding **MYR 110,106.00**; original booked-base document total **MYR 110,500.00**; catalog-rate **counterfactual** for the three foreign invoices **MYR 534,333.00** (a counterfactual only — not the correct booked total).
- Classification: frontend summation defect **no**; SQL aggregation defect **no**; API mapping defect **no**; legacy/demo booked-snapshot condition **yes**; insufficient UI explanation **yes**. These rows are Posted with journal entries and (one) allocations, so an FX-decision supersession cannot safely correct them.

### Issues 3 & 5 — "Blocked" presentation
- `status-badge.tsx:8-28` has no "Blocked" invoice/receipt status. The chip comes from `MoneyCell` (`money-cell.tsx:94-96,152-154`) via `decisionReason={... fx_posting_eligibility?.reason}` (`invoices/page.tsx:318`, `receipt-table.tsx:133`), mapped in `fx-presentation.ts:109-114` (reason `blocked` → "Blocked", danger, `ShieldAlert`).
- Backend contract `backend/supabase/functions/_shared/fx-read-contracts.ts:42-86`: `blocked` includes `LEGACY_UNVERIFIED` (49-51), already-`Posted` lifecycle (61-63), and the fallback (85). The field is FX posting eligibility, not business status. For a Posted record, `eligible:false` means "do not post again / booked rate locked" — not financially/allocation/payment/import blocked. Receipt allocation status and FX posting eligibility are independent.

### Issue 4 — historical 15-row behavior
- Historical remediation commit `233005146f7e9551e45fc437fc7fcade678a9f62`. Pagination derives from `meta.total` via `totalPagesFrom` (`use-invoices.ts:57-62,246-250`); prev/next in `invoices/page.tsx:368-390` and `receipt-table.tsx:178-192`.
- Caps: invoice page size 15; receipt page size 15; frontend hook fallback 20 (`use-invoices.ts:195`); Edge/API default 20, **maximum 100** (`_shared/constants.ts:88-89`; applied by `parsePagination`, `_shared/validators.ts:304-309`); internal RPC **maximum 200** (`ar_invoice_collection`/`ar_receipt_collection` reject `p_page_size > 200`, migration 027:467/652). Search/filter changes reset page to 1; search is server-side over the complete authorized collection; all pages reachable. "All" clears the status filter (all statuses), not "all rows".

### Issue 6 — Credit & Debit Notes
- `credit-notes/page.tsx:48-59` queries notes from the invoices table via `ar_invoice_collection(p_doc_type='Credit Note'|'Debit Note')`.
- Physical Credit Notes **0**; physical Debit Notes **1**; policy-visible CN **0**; policy-visible DN **0**. The single physical DN belongs to a **hidden customer** and is correctly excluded by normal visibility rules. The empty page is expected and correct.

### Issue 7 — Notifications page
- `notifications/page.tsx:26` → `useNotifications(50)` → `?limit=50` (`use-notifications.ts:12-22`). `notifications/index.ts:33-40` `normalizeLimit` throws `VALIDATION_ERROR` for `>20`; header dropdown uses default 10 (`header.tsx:64`).
- Endpoint has no cursor/page param; `meta.total` is only the returned limited array length (`notifications/index.ts:98-100`), not the full actionable count. Backend derives import-related notifications only; `overdue_ar` exists in `types/index.ts:349` and page copy (`notifications/page.tsx:49`) but is not produced.

### Issue 8 — badge
- `header.tsx:64-65` `notifCount = notifications?.length ?? 0`. `NotificationItem` (`types/index.ts:348-357`) has no `read` field; signals are derived from `import_batches` (`notifications/index.ts:65-100`). No persistence of "read", so opening the bell cannot decrement the count. Query key `["notifications", limit]` is not company/user-scoped.

### Issues 9 & 10 — FX lookup and booking contract
- Frontend defects: `receipt-form-amount.tsx:88-123` (editable rate, disabled only at parity), `receipt-schema.ts:110` (`exchange_rate: 1` default), `receipts/new/page.tsx:106` (submits rate only if ≠1); `invoice-header-form.tsx:126-137` (label literal `?`, plain manual field). No `/fx-rates` call exists in `frontend/src`.
- Reference read contract `GET /fx-rates/lookup` (`fx-rates/index.ts:42-44`): authenticated operational-read role; company from request context; direction transaction→base; effective date = latest active reference on/before requested date; response includes found, requested date, actual/effective date, reference-only flag, stale state, rate, provider, provider timestamp, and reference/version/source identifiers. Base parity is not synthesized — must be handled as exact rate 1.
- Contract gap: `/fx-rates/lookup` reads `fx_reference_rates`; create without an explicit rate reads legacy booking-authoritative `exchange_rates` (→ `CATALOG`); an explicit numeric rate is classified `MANUAL_OVERRIDE`. Create validators accept `exchange_rate` but not `fx_reference_rate_id` (`invoices/validators.ts:38,103-104`; receipts equivalently).
- Governed-RPC wrapper gap (source-verified): the core decision function `public.fx_record_booking_decision` already accepts `p_fx_reference_rate_id UUID DEFAULT NULL` (migration 023:266) and snapshots `v_reference.id` when it is supplied (372,571,648). However, **all four governed wrappers omit that parameter and hardcode `NULL` into the decision call** — `fx_create_governed_invoice_draft(UUID,UUID,JSONB,JSONB,BOOLEAN,TEXT)` passes `NULL` at the 6th `fx_record_booking_decision` argument (947-957), and `fx_create_governed_receipt_draft(UUID,UUID,JSONB,BOOLEAN,TEXT)`, `fx_update_governed_invoice_fx(UUID,UUID,UUID,CHAR(3),DATE,NUMERIC,BOOLEAN,TEXT)`, and `fx_update_governed_receipt_fx(UUID,UUID,UUID,CHAR(3),DATE,NUMERIC,BOOLEAN,TEXT)` do the same (1034,1098,1160). Because neither the wrappers nor the Edge create/update validators plumb a reference id, `REFERENCE_SELECTED` is **unbookable end-to-end**. Closing the gap requires a Codex-owned forward SQL migration that extends these four wrappers to forward a validated reference id into `fx_record_booking_decision` (see §12).
- FX governance (source-verified, migration 023): `fx_booking_approval_status_for_deviation` (lines 144-167): `BASE_PARITY`/`CATALOG` → `NotRequired`; deviation NULL → `Pending`; **≤ 0.50% → `NotRequired`**; **>0.50% through ≤ 5% → `Pending`**; **> 5% → `Rejected`**. `MANUAL_OVERRIDE` requires `override_reason` length ≥ 5 (line 439). Approval guard (`fx_booking_approve`, lines 1201-1221): decision must be `Pending`; **maker cannot approve own** (1204-1205); **deviation > 2% requires Finance Manager** (1210-1212); **deviation ≤ 2% requires AR Supervisor or Finance Manager** (1214-1216); **System Admin/Auditor alone cannot approve** (1218-1220).

### Issue 11 — Report Export
- `reports/page.tsx:82-98` (disabled "Coming Soon"); `reports/aging/page.tsx:149-151` (disabled per-report export). Data sources: aging + customer-outstanding via `/reports/aging` and `/reports/aging/by-customer` (`reports/index.ts:92-117`); invoice/receipt summaries via `ar_invoice_collection`/`ar_receipt_collection` (page-capped at Edge 100). The `reports` function has no export route; a full authorized-dataset export needs bounded server-authoritative export-data routes.

### Issue 12 — Feature Status
- `settings/page.tsx:194-209` hard-codes rows including `Daily FX Sync → "Planned (Batch 9D)"` (208), `Report Export → "Planned"` (209), and `Global Search / Notifications / Profile → "Live"` (201) despite the failing Notifications page.

---

## 6. Target Behavior

1. Clicking or keyboard-activating a rating bar opens an accessible modal/side-panel listing that rating's outstanding-only customers (name, code, rating, base outstanding, overdue/aging, → detail link), consuming authoritative exposure rows directly; the caption reiterates "maintained master data, not an AI score"; the bar amount and count reconcile exactly with the returned rows.
2. Present the three legacy foreign invoices truthfully as legacy booked snapshots — separate native amount, booked company-base amount, booked rate, FX provenance, and current/reference rate (informational only) — with a `LEGACY_UNVERIFIED` warning tooltip; never imply recalculation at today's rate. No mutation in Gate A.
3 & 5. Map FX posting-eligibility to precise presentation across invoice/receipt list+detail and CN/DN consumers; keep business status, allocation progress, and FX posting state distinct.
4. Confirm pagination; rename "All" → **"All statuses"**; add regression fixtures; no unbounded query.
6. Keep the honest empty state; test populated behavior with local fixtures and the hidden-customer exclusion.
7. Complete professional page with cursor pagination (≤20/request), unread/all + type filters, read/unread state, timestamps, source context, deep links, mark-one and mark-all, loading/empty/error, full a11y, responsive; copy scoped to import alerts only.
8. Authoritative unread count independent of page size; opening the bell does not blanket-mark read; clicking an item marks it read before navigation; mark-all is server-side, transactional and idempotent over the current actionable set; resolved conditions disappear; a materially different condition type creates a new unread key.
9 & 10. Governed FX entry via a shared component: currency + amount + read-only reference rate with explicit direction (`1 SGD = x MYR`), effective date, provider/source, stale/fresh state, computed base preview (informational); no editable numeric rate in normal mode; base parity = exact 1 (`BASE_PARITY`); missing rate blocks normal submit with no silent fallback to 1; stale rate available only through governed manual override; submit sends `fx_reference_rate_id` (or override + reason), never a client base total.
11. Each report exports PDF + `.xlsx` over the complete authorized dataset with server-computed native/base totals, title/company/timestamp/filters/totals, correct currency semantics, tenant/role scope, safe filenames/MIME, professional formatting, valid empty exports, and size-ceiling handling.
12. Accurate phase-aware Feature-Status strings, flipped only when the relevant gate passes.

### 6.1 Feature Status — exact phase-aware strings (Issue 12)

Feature Status is a hard-coded array (`settings/page.tsx:194-209`); Claude centralizes it into a typed frontend map during implementation. Strings change only after the relevant gate passes; unfinished work is never pre-labelled "Live".

| Phase | Feature | Exact string |
|-------|---------|--------------|
| Baseline (before Gate A) | Daily FX Sync | `Live (Automated)` |
| Baseline | Auto-Allocation | `Disabled` |
| Baseline | Report Export | `Planned` |
| Before Gate B | Notifications | `Degraded — Import Alerts Only` |
| After Gate B | Notifications | `Live — Import Alerts` |
| After Gate B | Credit & Debit Notes | `List Available — Create via Invoice Workbench` |
| During Gate C | Report Export | `In Progress` |
| After Gate C passes | Report Export | `Live — PDF & Excel` |

---

## 7. Claude Ownership (frontend · UI/UX · docs · frontend tests)

- **Gate A:** shared `useFxReferenceRate` hook (calls `GET /fx-rates/lookup`) + shared governed `FxRateField` component (normal read-only mode + governed manual-override mode); integrate into `receipt-form-amount.tsx` and `invoice-header-form.tsx` (wrappers differ only in `invoice_date` vs `receipt_date`); remove the literal `?`; submit `fx_reference_rate_id`. Revise `fx-presentation.ts` + `MoneyCell`/`FxChip` for Booked/Legacy/Rejection presentation across invoice/receipt list+detail and CN/DN. Legacy-snapshot UI clarity. List polish: "All statuses", de-duplicate `PAGE_SIZE`, empty-count footer. FX/pagination Feature-Status strings. Frontend tests.
- **Gate B:** click/keyboard on `credit-risk-chart.tsx` + accessible `CreditRatingDrilldown` modal/side-panel consuming the extended aging exposure endpoint; CN/DN empty/populated copy + tests; Notifications page + dropdown + badge consuming the cursor list via an accessible "Load more" (no infinite scroll), unread-count, read and read-all; company/user/filter/cursor-aware query keys; multi-tab sync (`BroadcastChannel` `ar-notifications:<company_id>:<user_id>` + refetch on focus). Feature-Status strings. Frontend tests.
- **Gate C:** per-report Export menu (PDF/XLSX); dynamic-import `jspdf`/`jspdf-autotable`/`exceljs`; formula-injection sanitization; Unicode font; object-URL revocation; generating/success/error states; empty/oversize handling; safe filenames + MIME. Final Feature-Status flip. Frontend tests.
- **All gates:** documentation updates (§17); keep the full suite green.

## 8. Codex Ownership (backend · DB · migrations · RPC/Edge · financial contract · security/tenant isolation)

- **Gate A:** ship **one forward SQL migration** (see §12) that extends the four governed wrappers (`fx_create_governed_invoice_draft`, `fx_create_governed_receipt_draft`, `fx_update_governed_invoice_fx`, `fx_update_governed_receipt_fx`) with a trailing optional `p_fx_reference_rate_id UUID DEFAULT NULL` (or an equivalent version-safe contract) that forwards the validated id into `fx_record_booking_decision` to record `REFERENCE_SELECTED`, without introducing ambiguous PostgreSQL overloads; then wire the Edge/service create + draft-update calls to that parameter. Validate company, pair, direction, effective date, active/superseded state and stale policy; calculate + snapshot booked rate and base amount; never trust a client base total. Preserve the exact manual-override governance (§5 Issues 9/10) and all existing wrapper properties (ownership, SECURITY INVOKER/DEFINER, fixed `search_path`, grants/EXECUTE, maker-checker, tenant validation, numeric/manual-override behavior, legacy no-reference callers). Provide read-only data facts for the three legacy invoices; no correction inside Gate A. Migration-level + backend financial + tenant-isolation contract tests.
- **Gate B:** extend `ar_aging_by_customer` + `/reports/aging/by-customer` with an exact `credit_rating` filter (outstanding-only, scoped, paginated) reconciling with the dashboard distribution; forward migration for the notification acknowledgement store (columns/constraints per §9.5.6, `import_batch_id` FK `ON DELETE CASCADE`, RLS/service boundary) plus a **bounded pruning function** (deletes only non-actionable acknowledgements older than 90 days, ≤500 rows/call, company/user-scoped or service-restricted, invoked best-effort from the authenticated read/read-all flow — no new cron); authenticated notification endpoints `GET /notifications` (cursor list, `created_at DESC, notification_key DESC`), `GET /notifications/unread-count`, `POST /notifications/read`, `POST /notifications/read-all` (transactional, server-derived set) with validation + idempotency; CN/DN local fixtures for populated tests. All migrations Codex-owned.
- **Gate C:** the four bounded authoritative export-data routes `GET /reports/export/aging`, `GET /reports/export/invoices`, `GET /reports/export/receipts`, `GET /reports/export/customer-outstanding` with the exact params/rows/summary/ordering of §9.6.2–9.6.5 (complete authorized rows + server-computed native/base totals + `generated_at` + company metadata + exact filter/sort echo + deterministic ordering with an ID tie-breaker + 5,000-row / 8-MiB ceiling + `422 EXPORT_DATASET_TOO_LARGE`); JWT-scoped company/role/assignment visibility; never accept client totals; export authorization + isolation tests.
- **All gates:** independent plan review; full code/security/contract audit; continued remediation until PASS.

---

## 9. API and Data Contracts

Summary of required contract changes (no "no-change" row is retained where backend work is required):

| # | Area | Change | Owner |
|---|------|--------|-------|
| 1 | Credit-rating drill-down | Extend `ar_aging_by_customer` + `GET /reports/aging/by-customer` with an exact `credit_rating` filter (outstanding-only, scoped, paginated, authoritative exposure fields). `/customers?credit_rating=` is **not** the drill-down dataset. | Codex |
| 2 | FX reference booking | Invoice and Receipt create/draft-update accept a validated `fx_reference_rate_id`; server records `REFERENCE_SELECTED`; client never sends a base total. | Codex |
| 3 | FX presentation | No database contract change required; frontend maps existing `fx_posting_eligibility.reason` + `fx_decision.source_category`/`lifecycle_status`. | Claude |
| 4 | Notifications | Cursor list; unread-count; read-one; read-all; per-user acknowledgement storage. | Codex |
| 5 | Report export | Four bounded authoritative export-data routes (complete rows + server totals + filter echo). | Codex |

**9.1 Credit-rating exposure (Gate B).** `ar_aging_by_customer(..., p_credit_rating TEXT DEFAULT NULL)` and `GET /reports/aging/by-customer?credit_rating=` filter `scoped_customers` by exact `credit_rating` while preserving outstanding-only semantics (existing `base_total > 0`) and scope/pagination. Reconciliation contract: for a rating R, `SUM(row.base_total)` over all pages must equal the chart bar amount, and the total row count must equal the chart `customer_count`. Frontend consumes rows directly (no N+1, no all-customers fetch).

**9.2 FX reference→booking (Gate A).** New optional `fx_reference_rate_id` accepted by `POST /invoices`, invoice draft-update, `POST /receipts`, receipt draft-update, and forwarded through the four governed wrappers into `fx_record_booking_decision`. This requires the Gate A forward migration in §12 (the wrappers currently omit the parameter and hardcode `NULL`). Client submits `{ transaction currency, document/receipt date, fx_reference_rate_id }` and no base total. Backend validation: id exists; company match; direction = transaction→base; effective date rule (latest active on/before `invoice_date`/`receipt_date`); active/not-superseded; stale policy = blocked for auto `REFERENCE_SELECTED` (see 9.3); pair matches the transaction/base currencies; then snapshot booked rate + base (NUMERIC authoritative, 2-dp rounding via the existing convention) and record `REFERENCE_SELECTED`. Base parity → exact rate 1, `BASE_PARITY`, no lookup. Manual override remains a separate governed action carrying `override_reason` (≥5 chars) and the deviation/approval flow (§5). Mirror any new response fields in `frontend/src/types/monetary.ts`.

**9.3 Stale-rate policy (Gate A, decided).** A stale reference rate is not auto-bookable as `REFERENCE_SELECTED`; normal submission is blocked with a clear message. A stale rate may be used only via the governed manual-override path (explicit reason + deviation/approval). Frontend behavior matches backend enforcement exactly (frontend disables normal submit on stale, offers override where role-permitted). Codex finalizes the exact staleness window in the booking RPC and confirms it equals the lookup's stale flag basis.

**9.4 FX posting-eligibility presentation (Gate A).** No contract change and no migration required; presentation is entirely a frontend mapping of the existing `fx_posting_eligibility.reason` and `fx_decision.source_category`/`lifecycle_status` fields.

**9.5 Notifications (Gate B) — exact contract.** Scope is **import alerts only**; `overdue_ar` is fully de-scoped and no plan section implies overdue notifications exist.

*9.5.1 Ordering and cursor.* Stable order is exactly `created_at DESC, notification_key DESC`. The cursor tuple is `(created_at, notification_key)`, encoded as base64url JSON `{ "created_at": "<ISO-8601>", "notification_key": "import:<batch_uuid>:<condition_type>" }`. The next page returns rows strictly after the cursor in descending tuple order: `created_at < cursor.created_at OR (created_at = cursor.created_at AND notification_key < cursor.notification_key)`. Maximum page size is **20**. The deterministic notification key is `import:<batch_uuid>:<condition_type>`.

*9.5.2 List — `GET /notifications`.* Params: `limit` integer 1–20 default 20; `cursor` optional base64url; `read_state` = `all | unread | read` default `all`; `type` = `import_error | import_review` optional. Response:
```json
{
  "data": [
    {
      "notification_key": "import:<batch_uuid>:<condition_type>",
      "type": "import_error",
      "title": "string",
      "message": "string",
      "severity": "error",
      "created_at": "ISO-8601 timestamp",
      "source": { "type": "import_batch", "id": "uuid" },
      "deep_link": "/imports/<uuid>",
      "read_at": null
    }
  ],
  "meta": { "limit": 20, "next_cursor": "base64url-or-null", "has_more": true }
}
```
`meta.total` is not used as a fake page-limited total.

*9.5.3 Unread count — `GET /notifications/unread-count`.* Response `{ "data": { "unread_count": 0 } }`. The count is server-authoritative, independent of list page size, company-scoped, user-scoped, and computed as the current actionable derived notification set minus that user's acknowledgements.

*9.5.4 Read one — `POST /notifications/read`.* Body `{ "notification_key": "import:<batch_uuid>:<condition_type>" }`. Validates the key belongs to a current or historically valid notification source inside the authenticated company; writes/updates that user's acknowledgement; idempotent; cannot acknowledge another user's or company's notification. Response `{ "data": { "notification_key": "string", "read_at": "ISO-8601 timestamp" } }`.

*9.5.5 Read all — `POST /notifications/read-all`.* Optional body `{ "type": "import_error" }` or empty to acknowledge all current actionable import alerts. Derives the complete current actionable set server-side; performs the acknowledgement upsert transactionally; idempotent; never trusts a client-supplied list of notification IDs. Response `{ "data": { "acknowledged_count": 0, "completed_at": "ISO-8601 timestamp" } }`.

*9.5.6 Acknowledgement storage and retention.* Import alerts only, so the store uses an explicit import source reference (not an unresolved polymorphic source). Minimum columns: `company_id`, `user_id`, `notification_key`, `import_batch_id`, `condition_type`, `read_at`, `dismissed_at` (nullable), `created_at`, `updated_at`. Constraints: unique `(company_id, user_id, notification_key)`; `import_batch_id` references the import-batch source with `ON DELETE CASCADE`; tenant/user isolation enforced through authenticated Edge endpoints and RLS/service boundaries. Retention: while the source condition remains actionable, the acknowledgement is retained so the notification stays read; when the condition is no longer actionable it is excluded from the derived list immediately, and its acknowledgement is retained for **90 days** from the later of `read_at` or source-resolution timestamp, after which it is eligible for deletion. The Gate B migration provides a bounded pruning function that deletes only non-actionable acknowledgements older than 90 days, is company/user-scoped or service-restricted, processes at most **500 rows per call**, and never deletes acknowledgements for active conditions. Bounded pruning is invoked as a best-effort maintenance step from the authenticated notification write flow (read/read-all), not through unrestricted client DML; source deletion removes acknowledgements via `ON DELETE CASCADE`. **No new cron is required for Gate B.**

Predicates bind `company_id` + authenticated `user_id`; no unrestricted client-side acknowledgement DML. `overdue_ar` is de-scoped.

**9.6 Report export-data routes (Gate C) — exact contracts.** The backend returns authoritative JSON data only; Claude's frontend generates PDF/XLSX from it.

*9.6.1 Common rules.* All four routes use `GET`. Each: derives company from the authenticated request context; enforces role and assignment visibility; ignores any client-supplied financial total; returns monetary values as decimal strings and timestamps as ISO-8601 UTC; returns the complete filtered result set (not only the visible UI page); does **not** accept `page`, `page_size` or `cursor`; applies deterministic ordering with a stable ID tie-breaker; and enforces a maximum **5,000 rows** and maximum serialized JSON payload **8 MiB**. Controlled oversize response — HTTP `422`:
```json
{ "error": { "code": "EXPORT_DATASET_TOO_LARGE",
  "message": "The filtered report exceeds the export limit. Narrow the report filters and try again.",
  "details": { "row_limit": 5000, "payload_limit_bytes": 8388608, "estimated_rows": 0 } } }
```
Validation errors use `VALIDATION_ERROR`; auth/authorization use the project's standard sanitized error contract. Common success envelope:
```json
{ "data": {
  "schema_version": 1, "report_type": "string", "generated_at": "ISO-8601 UTC",
  "company": { "id": "uuid", "name": "string", "base_currency": "MYR", "timezone": "string" },
  "filters": {}, "sort": { "field": "string", "order": "asc" },
  "row_count": 0, "summary": {}, "rows": [] } }
```

*9.6.2 AR Aging — `GET /reports/export/aging`.* Params: `as_of_date` (YYYY-MM-DD, required), `search` (optional), `sort` (`customer_code | customer_name | outstanding_base | overdue_base`), `order` (`asc | desc`, default `asc`). Rows: `customer_id`, `customer_code`, `customer_name`, `credit_rating`, `current_base`, `bucket_1_30_base`, `bucket_31_60_base`, `bucket_61_90_base`, `bucket_91_plus_base`, `outstanding_base`, `overdue_base`. Summary: `base_currency`, `customer_count`, `outstanding_base_total`, `overdue_base_total`, bucket totals, `native_by_currency[]`. Ordering appends `customer_id ASC` as the final stable tie-breaker.

*9.6.3 Invoice Summary — `GET /reports/export/invoices`.* Params: `date_from`/`date_to` (YYYY-MM-DD, optional), `status` (optional exact supported Invoice status), `doc_type` (`Invoice | Credit Note | Debit Note`, optional), `currency` (ISO code, optional), `search` (optional), `sort` (`invoice_date | invoice_no | customer_name | total_amount | base_total | outstanding`), `order` (`asc | desc`, default `desc`). Rows: `invoice_id`, `invoice_no`, `doc_type`, `invoice_date`, `due_date`, `customer_id`, `customer_code`, `customer_name`, `status`, `currency`, `total_amount_native`, `outstanding_native`, `booked_exchange_rate`, `base_currency`, `base_total`, `outstanding_base`, `fx_source_category`, `fx_lifecycle_status`. Summary: `document_count`, `base_currency`, `document_base_total`, `outstanding_base_total`, `native_by_currency[]`, `status_breakdown[]`, `doc_type_breakdown[]`. Ordering appends `invoice_id ASC` as the stable tie-breaker.

*9.6.4 Receipt Summary — `GET /reports/export/receipts`.* Params: `date_from`/`date_to` (YYYY-MM-DD, optional), `status` (optional exact supported Receipt status), `payment_method` (optional exact supported method), `currency` (ISO code, optional), `search` (optional), `sort` (`receipt_date | receipt_no | customer_name | receipt_amount | base_amount | unallocated_amount`), `order` (`asc | desc`, default `desc`). Rows: `receipt_id`, `receipt_no`, `receipt_date`, `customer_id`, `customer_code`, `customer_name`, `status`, `payment_method`, `currency`, `receipt_amount_native`, `allocated_amount_native`, `unallocated_amount_native`, `booked_exchange_rate`, `base_currency`, `base_amount`, `unallocated_base`, `fx_source_category`, `fx_lifecycle_status`. Summary: `receipt_count`, `base_currency`, `receipt_base_total`, `allocated_base_total`, `unallocated_base_total`, `native_by_currency[]`, `status_breakdown[]`, `payment_method_breakdown[]`. Ordering appends `receipt_id ASC` as the stable tie-breaker.

*9.6.5 Customer Outstanding — `GET /reports/export/customer-outstanding`.* Params: `as_of_date` (YYYY-MM-DD, required), `credit_rating` (optional exact supported rating), `customer_status` (optional exact supported status), `search` (optional), `sort` (`customer_code | customer_name | outstanding_base | overdue_base`), `order` (`asc | desc`, default `asc`). Rows: `customer_id`, `customer_code`, `customer_name`, `customer_status`, `credit_rating`, `credit_limit`, `base_currency`, `outstanding_base`, `overdue_base`, `current_base`, `bucket_1_30_base`, `bucket_31_60_base`, `bucket_61_90_base`, `bucket_91_plus_base`, `oldest_due_date`. Summary: `customer_count`, `base_currency`, `outstanding_base_total`, `overdue_base_total`, bucket totals, `credit_limit_total`, `native_by_currency[]`. Ordering appends `customer_id ASC` as the stable tie-breaker.

*9.6.6 Filter semantics.* The route's explicit server parameters are the authoritative export filters. Page-local frontend filters not represented in the request never silently alter the exported dataset; the response echoes the normalized filters and sorting actually applied.

No change is proposed to the migration-027 aggregation math or the `user_roles` visibility contract.

---

## 10. UI/UX Specifications

**10.1 Credit-Rating Drilldown (Gate B).** Right-side sheet (desktop) / full-screen dialog (mobile); `role="dialog"` labelled "Customers rated {R}"; focus trap; ESC + overlay close; focus restoration to the activated bar. Chart accessibility: focusable rating bars via a custom Recharts shape or an equivalent overlaid rating-button row; Enter/Space activation; visible focus ring. Body: maintained-data caption + a table (name, code, rating chip, base outstanding, overdue/aging, → detail); paginated; loading skeleton; empty ("No customers rated {R} with outstanding"); error + retry.

**10.2 FX Rate Field, shared (Gate A).**
- Normal mode: currency selector; transaction amount; read-only rate display with explicit direction `1 {CCY} = {rate} {BASE}`; effective date; provider/source; stale/fresh badge; computed estimated base (informational; backend authoritative); loading skeleton; missing-rate state + retry; no editable numeric rate. On submit, sends `fx_reference_rate_id`.
- Manual-override mode: explicit "Use manual rate" action, role-aware availability; rate field; required reason; baseline/reference comparison; deviation %; expected approval status (NotRequired ≤0.50% / Pending >0.50%–≤5% / Rejected >5%); maker-checker notice (maker cannot approve own; >2% needs Finance Manager, ≤2% needs AR Supervisor or Finance Manager; System Admin/Auditor alone cannot approve); cannot bypass backend validation.
- Base parity: exact 1, no lookup, `BASE_PARITY` note.
- Shared architecture: one hook + one component; query key includes company, from-currency, to/base-currency, effective date; changing currency/date invalidates the previous selection; submit waits for a valid selection.

**10.3 Notifications (Gate B).** Header + description ("Import alerts"); filter chips (All / Unread / by type); list items (severity icon+text, title, message, source context, timestamp, read/unread indicator, deep link); mark-one + mark-all; loading/empty/error; full keyboard + SR support; responsive. Dropdown limit is defined separately from the unread total; clicking marks-read before navigation.
- **Pagination interaction — accessible "Load more" button (no automatic infinite scroll).** The first page loads automatically; the user explicitly activates Load more; the button uses `next_cursor`; it disables/disappears when `has_more=false`; loading and retry states are announced accessibly; cursor pages append without replacing earlier rows.
- **Query-key contract (company/user/filter/cursor-aware).** List root key `["notifications", companyId, userId, { readState, type, limit }]`, with the cursor handled as the infinite-query page parameter (part of each fetched page identity). Unread-count key `["notifications", companyId, userId, "unread-count"]`. Read-one and read-all mutations invalidate all notification-list queries for the authenticated company/user plus the unread-count query. Company switch or logout removes the prior company/user's notification cache.
- **Multi-tab sync.** Channel `ar-notifications:<company_id>:<user_id>` via `BroadcastChannel`, plus refetch on window focus; broadcast after read-one and read-all.

**10.4 Report Export (Gate C).** Per-report "Export ▾" menu (PDF / Excel); generating/success/error states; PDF MIME `application/pdf`, XLSX MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; document metadata = report title, company, generated timestamp, applied filters, native-currency breakdown, company-base totals, complete authorized rows, page numbers where relevant, safe deterministic filename. The four export datasets (paths, params, rows, summary, ordering) are the exact contracts in §9.6.2–9.6.5; the frontend renders them, computes no totals, and echoes the server-normalized filters/sort per §9.6.6.
- **Frontend generation contract:** retain `exceljs`, `jspdf`, `jspdf-autotable` via **dynamic imports**; an approved bundled Unicode-capable font; formula-injection protection for any value beginning `=`, `+`, `-`, `@`; object-URL revocation; safe deterministic filenames; correct MIME types.
- **Valid empty exports:** empty reports remain exportable and produce a valid file containing title, company, filters, zero totals, and "No records".
- **Generation tests:** PDF openability; XLSX workbook readability.

**10.5 Blocked/Booked presentation (Gate A).** Replace bare red "Blocked": Posted lifecycle → "Booked" / "Rate locked", neutral/informational, tooltip "This document is already posted. Its booked exchange rate cannot be changed."; `LEGACY_UNVERIFIED` → "Legacy rate unverified", warning, tooltip explaining the historical booked rate lacks verified reference provenance; genuine rejection/inconsistent → danger with a precise reason. Colour is never the sole signal (WCAG 1.4.1).

---

## 11. Authorization-Only Decision Points

All design/architecture questions are resolved above. Only the following require authorization/evidence beyond planning; each states why it cannot be decided now, its owner, evidence required, authorization required, and default-safe behavior.

- **DP-1 — Correct the three Posted legacy foreign invoices?**
  Why not now: they are Posted with journal entries and (one) allocations, so correction is a financial restatement, not an FX supersession. Owner: Codex (impact assessment + any migration). Evidence required: full assessment of journal entries, journal lines, allocations, paid/open state, downstream reports, prior financial evidence, and restatement/audit implications. Authorization: explicit, separate Production-mutation authorization. **Default: no mutation**; Gate A presents the rows truthfully.
- **DP-2 — Create optional synthetic Production Credit/Debit Notes?**
  Why not now: not required for correctness; the empty page is correct. Owner: Codex (data op). Evidence: confirmed physical/visible counts (settled). Authorization: explicit, separate. **Default: no creation**; populated behavior is covered by local test fixtures only.
- **DP-3 — Per-gate deployment authorization.**
  Why not now: deployment is a human-authorized, Codex-executed step per gate. Owner: Codex-executed. Evidence: gate PASS. Authorization: explicit per gate. **Default: no deployment**; read-only post-deploy verification only.
- **DP-4 — Production migration / data mutation authorization.**
  Why not now: applying any migration or data change to Production is a controlled operation. Owner: Codex. Evidence: reviewed forward migration + gate PASS. Authorization: explicit. **Default: no Production mutation**; migrations are forward-only and independently reviewed before any authorized application.

---

## 12. Migration Requirements

### Gate A migration requirement (confirmed deliverable)

Gate A **includes one Codex-owned forward SQL migration**. The core `public.fx_record_booking_decision` accepts `p_fx_reference_rate_id` (023:266), but the four governed wrappers omit that parameter and pass `NULL` into the decision call (§5 Issues 9&10), so `REFERENCE_SELECTED` cannot be recorded through create/update. The migration atomically:

1. extends all four governed Invoice/Receipt create/update wrappers (`fx_create_governed_invoice_draft`, `fx_create_governed_receipt_draft`, `fx_update_governed_invoice_fx`, `fx_update_governed_receipt_fx`) with a trailing optional `p_fx_reference_rate_id UUID DEFAULT NULL` (or an equivalent version-safe contract);
2. passes the validated reference id into `fx_record_booking_decision`;
3. enables the governed path to record `REFERENCE_SELECTED`;
4. preserves existing legacy callers that do not provide a reference id;
5. preserves existing function ownership, SECURITY INVOKER/DEFINER behavior, fixed `search_path`, grants and EXECUTE privileges, maker-checker controls, tenant/company validation, and existing numeric/manual-override behavior;
6. prevents ambiguous PostgreSQL overload resolution;
7. is accompanied by updates to the Edge/service calls that use the new parameter;
8. adds migration-level and backend tests for: reference-selected Invoice creation; reference-selected Receipt creation; permitted draft updates; old-caller compatibility; wrong-company id; wrong currency pair; superseded/inactive id; stale id; forged id; base parity; and manual override remaining separate.

The plan may implement this either by replacing the existing signatures in a controlled forward migration or by adding new overloads while retaining compatibility wrappers — but Codex **must not leave ambiguous duplicate overloads**. This migration does **not** include correction of the three legacy Posted invoices (that is DP-1).

### Per-gate migration summary

- **Gate A:** the forward wrapper migration above (confirmed). No data-correction migration; no migration for the Blocked/Booked presentation change (frontend mapping only, §9.4).
- **Gate B:** one Codex-owned forward migration for the notification acknowledgement store + RLS/service boundary + the **bounded pruning function** (§9.5.6); the additive SQL/RPC change for exact `credit_rating` filtering may be included in the same consolidated Gate B migration where safe. No new cron.
- **Gate C:** no database schema migration; new bounded read-only backend export routes only (§9.6).
- All Production migration application remains separately authorized (DP-4). All migrations are Codex-owned, forward-only, and independently reviewed. Claude implements no migration.

---

## 13. RLS and Authorization

- Drill-down (1) reuses governed, RLS-enforced aging/customer endpoints; the added `credit_rating` filter narrows within the same visibility contract — no new exposure.
- FX reference→booking (9/10): the reference lookup and create/booking RPCs run under authenticated operational-read/create roles with company from request context; ordinary users cannot submit an arbitrary numeric rate as `REFERENCE_SELECTED` (only a validated `fx_reference_rate_id`); manual override is governed by the maker-checker role thresholds (§5). Codex validates server enforcement.
- Notifications (7/8): the acknowledgement store is tenant + per-user scoped (`company_id` + `auth.uid()`), RLS-enforced; endpoints are authenticated Edge Functions; no client-side acknowledgement DML. Cross-user and cross-company isolation are explicit test cases.
- Export (11): same role/tenant/assignment scope as the underlying reports; the server computes totals so no client value is trusted.
- No change to the migration-027 SECURITY INVOKER model or the `user_roles` visibility contract.

---

## 14. Test Matrix

Every implementation gate additionally requires: lint; type-check (`npm exec -- tsc --noEmit`); the relevant new frontend tests; the complete frontend suite (28 files / 530 tests baseline, kept green plus additions); backend tests; Production build; migration verification where applicable; read-only post-deployment verification; and no Production mutation without separate authorization.

**Gate A**
- FX wrapper migration (migration-level + backend): reference-selected Invoice creation; reference-selected Receipt creation; permitted Invoice/Receipt draft updates; **old-caller compatibility** (legacy call with no reference id still works); wrong-company id; wrong currency pair; superseded/inactive id; stale id; forged id; base parity; manual override remaining separate; **no ambiguous overload resolution** on the four wrappers.
- FX contract: reference-rate direction; effective date; MYR parity (exact 1); stale rate (blocked in normal mode; override-only); missing rate (no silent rate-1 fallback; block + retry); reference-ID validation; wrong-company reference ID; wrong-pair reference ID; superseded reference ID; forged reference ID; manual-override reason required; approval-threshold boundaries (0.50% / 2% / 5%); maker-checker (maker≠checker; >2% Finance Manager; ≤2% AR Supervisor/Finance Manager; System Admin/Auditor alone rejected); server-authoritative base calculation; rounding (NUMERIC 2-dp); Invoice/Receipt parity of the shared component.
- Presentation: Posted → Booked/Rate-locked; `LEGACY_UNVERIFIED` → Legacy-unverified; genuine rejection/inconsistent → danger; each lifecycle/source combination; Invoice list+detail, Receipt list+detail, CN/DN consumers.
- Lists: >15 invoice rows; >15 receipt rows; second-page reachability; correct `meta.total`; search hit existing only beyond page 1; filter/search resets page; no record discoverable only via search; next/previous disabled at correct boundaries; "All statuses" label.
- Legacy-snapshot UI: native/booked-base/booked-rate/provenance/current-reference separation; `LEGACY_UNVERIFIED` tooltip; no today's-rate-recalculation implication.

**Gate B**
- Drill-down: exact credit-rating exposure filter; chart bar amount/count ↔ returned rows reconciliation; modal keyboard accessibility (Enter/Space, visible focus); focus trap + restoration; labelled dialog; ESC close.
- CN/DN: empty-state copy; populated local fixture; hidden-customer exclusion.
- Notifications: cursor pagination (`created_at DESC, notification_key DESC`); stable cursor tuple / deterministic ordering; "Load more" appends without replacing and disables at `has_more=false`; unread total beyond first page and independent of page size; mark-one read (`POST /notifications/read`); mark-all read (`POST /notifications/read-all`, transactional); idempotency; cross-user isolation; cross-company isolation; forged source/key; source-state transition (resolved condition disappears); condition-type change creates a new unread key; bounded pruning (only non-actionable acknowledgements >90 days, ≤500 rows/call, never deletes active conditions); `ON DELETE CASCADE` on source deletion; company/user/filter/cursor-aware query keys; cache invalidation on read/read-all; multi-tab synchronization; dropdown/page consistency; loading/empty/error; keyboard + SR behavior.

**Gate C**
- All four export routes (`/reports/export/{aging,invoices,receipts,customer-outstanding}`); role + assignment authorization; cross-company isolation; complete dataset beyond the visible page; explicit server filters only (page-local filters never leak); deterministic ordering with the ID tie-breaker; native + base totals (server-computed, client totals never trusted); empty documents produce valid files; Unicode rendering; formula-injection sanitization (`= + - @`); 5,000-row / 8-MiB ceiling + controlled `422 EXPORT_DATASET_TOO_LARGE`; PDF MIME + openability; XLSX MIME + workbook readability; safe deterministic filename; exact filter/sort echo.

---

## 15. Local/Staging/Production Validation

- Local: lint + type-check + Vitest; component/interaction/a11y tests; visual review vs the reported screenshots.
- Staging: Codex validates backend/RPC/migration/export/notification/FX-booking contracts and financial + tenant-isolation invariants; Claude validates the frontend against staging endpoints.
- Production: read-only verification only (e.g., `/login` HTTP 200, canonical title) after any authorized deployment; no data mutation without separate authorization. Each deployment is a separately authorized Codex-executed step.

---

## 16. Deployment and Rollback

- Frontend deploys via the existing Vercel path (Codex-executed, separately authorized); rollback = redeploy the prior READY deployment.
- Backend/Edge/migration deploys via the existing Supabase path; migrations forward-only; rollback via a forward compensating migration or the versioned-supersession path (never destructive rewrites of booked data).
- The Gate A wrapper migration is deployed with its Edge/service changes as one unit (the wrappers must accept `p_fx_reference_rate_id` before the Edge layer forwards it); rollback is a forward compensating migration that restores the prior wrapper signatures/behavior and reverts the Edge calls, with legacy no-reference callers unaffected throughout.
- The Gate B acknowledgement migration (store + bounded pruning) and Gate C export routes are additive/read-mostly; the DP-1 legacy-invoice correction (if ever authorized) is gated behind full impact assessment and is independently reversible by superseding versions.

---

## 17. Documentation Updates

- This plan (canonical).
- Per gate: update the Batch 9D UX/aggregation notes for the clarified Blocked/Booked semantics, the FX reference-selection governance, the legacy booked-snapshot presentation, the Notifications architecture (cursor + acknowledgement), the export contracts, and the Feature-Status source map. Documentation must transparently record code-defect vs data-state vs expected behavior, mirroring §5.

---

## 18. Acceptance Criteria

- **Gate A PASS:** the forward wrapper migration extends the four governed Invoice/Receipt create/update wrappers to forward a validated `p_fx_reference_rate_id` (no ambiguous overloads; legacy no-reference callers preserved); new-invoice and new-receipt foreign entry select a governed reference rate via `fx_reference_rate_id` (server-validated, snapshotted as `REFERENCE_SELECTED`), display explicit direction, and expose no free-typed rate in normal mode; base parity = exact 1; missing rate blocks with no silent 1; stale = override-only; manual override enforces reason + the exact deviation/role thresholds and maker-checker; literal `?` removed; Posted/legacy documents render as Booked/Legacy (not danger "Blocked") across invoice/receipt list+detail and CN/DN; legacy snapshots presented truthfully with no today's-rate implication and no mutation of the three rows; pagination verified with the "All statuses" label and regression fixtures; FX/pagination Feature-Status strings correct; full suite green + Codex financial/security sign-off.
- **Gate B PASS:** rating bars are keyboard/mouse-activatable and open an accessible drill-down whose rows reconcile exactly with the bar amount/count via the extended outstanding-only exposure endpoint; CN/DN empty state honest (with populated fixtures + hidden-customer exclusion tested); the notification acknowledgement store (with `ON DELETE CASCADE` and the bounded 90-day pruning function) is in place; the Notifications page loads via cursor pagination (`created_at DESC, notification_key DESC`) with an accessible "Load more", unread-count independent of page size, mark-one (`POST /notifications/read`) / mark-all (`POST /notifications/read-all`, idempotent, isolated, transactional), resolved/condition-type behavior, company/user/filter/cursor-aware keys, and multi-tab sync; the badge reflects the unread-count contract; related Feature-Status strings correct; full suite green + Codex migration/RLS/security sign-off.
- **Gate C PASS:** all four reports export correct professional PDF + `.xlsx` over the complete authorized dataset with server-computed native/base totals, correct MIME/filenames, filter echo, Unicode, formula-injection sanitization, valid empty exports, and size-ceiling handling; Report Export Feature-Status → `Live — PDF & Excel`; full suite green + Codex export-authorization/isolation sign-off.

---

## 19. Gate Sequence

Three consolidated gates, each following the workflow: (1) authorized implementation → (2) Codex backend/database implementation and validation → (3) Claude frontend/UI implementation and validation → (4) Codex full code/security/contract audit and continued remediation until PASS → (5) one appropriate Claude independent read-only review → (6) deployment only after explicit authorization.

- **Gate A — Governed FX + monetary presentation + list polish** (Issues 2, 3, 4, 5, 9, 10 + FX/pagination Feature Status).
  - Codex backend first: one forward SQL migration extending the four governed wrappers with `p_fx_reference_rate_id` (§12, no ambiguous overloads), plus the Edge/service wiring and the governed `REFERENCE_SELECTED` booking contract through permitted invoice/receipt create + draft-update flows, plus migration-level + backend tests.
  - Claude frontend second: shared FX component/hook, monetary/legacy presentation, Booked/Blocked mapping, pagination regression/polish, and relevant Feature Status.
  - The three legacy invoices are not corrected in Gate A.
- **Gate B — Drill-down + CN/DN + Notifications** (Issues 1, 6, 7, 8 + Feature Status).
  - Codex backend first: exact `credit_rating` exposure filter plus the notification acknowledgement migration/API/RLS.
  - Claude frontend second: accessible rating drill-down, CN/DN behavior, Notifications page/dropdown/badge/cache/multi-tab, and relevant Feature Status.
- **Gate C — Report Export** (Issue 11 + final Feature Status).
  - Codex backend first: four authoritative export-data routes.
  - Claude frontend second: PDF/XLSX generation, export UX, and the final Feature-Status flip.

Gates ship A → B → C; each depends only on its own backend deliverables. Ownership never assigns migrations or backend logic to Claude.

---

## 20. Authorization Boundaries

- This gate is documentation normalization only; it updated only this plan file. No frontend/backend/migration/data/scheduler/secret/deployment change; no stage/commit/push; Gate A implementation not started.
- Backend/database/migration/RPC/Edge/financial/security work is Codex-owned; normal frontend/UI implementation is Claude-owned and never delegated to Codex.
- Any Production data mutation (DP-1 legacy correction, DP-2 synthetic notes) is separately identified, bounded, deterministic, evidence-backed, independently reviewed by Codex, and separately authorized before execution (DP-3, DP-4).
- Historical booked FX rates are never overwritten with current/reference rates; heterogeneous native currencies are never summed as one; backend-authoritative totals are never replaced by client-calculated ones.
- `Poster/` and `social-media/` remain out of scope and untouched.
