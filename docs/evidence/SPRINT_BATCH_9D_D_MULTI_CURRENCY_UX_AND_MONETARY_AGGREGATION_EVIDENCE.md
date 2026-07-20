# Batch 9D-D - Multi-Currency UX and Monetary Aggregation Correctness - Evidence

## Status (CONSOLIDATED - authoritative)

> This Status block is the current authoritative state of Batch 9D-D.
>
> The **backend and staging** scope is **CLOSED** (previously executed and recorded; not re-run and
> not reopened here).
>
> The **frontend** passed through multiple implementation, independent review, and remediation
> cycles before the current consolidated delta. In order:
>
> 1. It was implemented in an earlier gate and **FAILED** an independent frontend/backend
>    integration review with 13 confirmed findings (B9DD-FEIR-001 ... B9DD-FEIR-013). Those were
>    remediated.
> 2. That remediation was **re-reviewed** and **FAILED again**, returning 7 further blocking
>    findings (B9DD-RR-001 ... B9DD-RR-007) plus one informational item (B9DD-RR-008). The first
>    remediation had **overstated its own completeness**: Aging had no pagination, the Customer
>    list/detail still used capped first-page data, MYR defaults survived in the create forms, the
>    allocation workflow still rendered codeless amounts, and the import origin was read from a
>    field production never emits. Section 3.4 records each, and Section 4.4 records the specific
>    claims withdrawn.
>
> 3. B9DD-RR-001 ... B9DD-RR-007 were remediated, and the focused re-review then CONFIRMED
>    B9DD-RR-001 (Aging pagination) and B9DD-RR-003 (form currency/MYR) as **CLOSED** - but
>    returned 6 further findings, B9DD-FR-001 ... B9DD-FR-006: customer filter placeholder rows
>    could speak for a filter they did not belong to; the allocation candidate scan de-duplicated
>    nothing and could terminate early on overlapping pages; the "OCR" page test never entered
>    OCR mode; the monetary guard scanned line-by-line and was bypassable by a line break;
>    credit_rating propagation was unproven; and this document's closure claims outran the code.
>
> 4. B9DD-FR-001 ... B9DD-FR-006 were remediated, and the delta re-review then CONFIRMED
>    B9DD-FR-001 (customer placeholder state), B9DD-FR-003 (real OCR composition) and
>    B9DD-FR-005 (credit_rating coverage) as **CLOSED** - but returned 3 further findings,
>    B9DD-DR-001 ... B9DD-DR-003: the allocation candidate scan was still not fail-closed under
>    mutable offset pagination; the monetary guard's hand-rolled comment stripper could
>    UNDER-scan when a regex literal contained raw comment delimiters; and this document
>    overstated both.
>
> 5. The micro-delta review closed the frontend-only avenue for B9DD-DR-001: an OFFSET scan over a
>    mutable `/invoices` window can DETECT instability but can never PROVE coverage, because a row
>    shifted out of an already-read window appears on no page at all. The remedy was therefore a
>    narrow SOURCE-LEVEL backend delta (Phase A) plus frontend consumption (Phase B).
>
> **Phase A (source-level backend delta, now staging-verified):** Migration 030 adds
> `public.get_allocation_candidates(p_receipt_id, p_user_id, p_company_id)` - STABLE, SECURITY
> DEFINER, `search_path = ''`, service_role-only, read-only, non-paginated, capped at 5,000, and
> deterministically ordered - exposed as `GET /allocations/candidates`.
>
> **Phase B (this gate):** the frontend consumes that contract, the OFFSET scan is DELETED, the
> workbench is disabled unless the contract is currently verified, and the two remaining monetary
> guard gaps (template static segments; structural monetary reductions) are closed with AST
> inspection. See Section 3.7.
>
> **Final FNC closure implementation (current local source):** the candidate QueryCache listener now
> records a synchronous company/receipt lifecycle epoch before scheduling React notification. This
> closes the rapid same-object reset/identical-success schedule that delayed `batchCalls`
> notification previously collapsed. Both held and immediate reset schedules are permanent tests;
> old callback sessions deny and the new session remains usable. Testing Library's existing act
> environment/cleanup is used without redundant global setup. Section 3.12 is the authoritative
> lifecycle description.
>
> **Current staging runtime and credential-incident state (updated 2026-07-20; supersedes later gate-local
> status statements):** Migration 030 is installed in the approved staging project and the governed
> allocations candidate route is deployed and runtime-verified. During that authorized gate, a
> malformed redaction expression emitted an enabled privileged legacy staging service-role API key
> into command output. No repository file, response, plan, or evidence document received the value,
> but it was treated as compromised. A dedicated named modern staging secret was created; all 16
> deployed Edge Functions were migrated through the shared admin/user client helper to the hosted
> `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` dictionaries; only those affected functions
> were redeployed. The legacy anon/service-role pair was then disabled. Both legacy credentials now
> return HTTP 401, while the replacement secret and modern publishable key remain valid in their
> intended server/user paths. The active Batch 9D-B scheduler kept its separate credential and
> unchanged schedule. No production access or action occurred. Commit and push remain
> **unauthorized** because GitHub `main` may trigger a Vercel production deployment. Production
> rollout and Batch 9D-E remain **NOT STARTED**.
>
> **Daily-overdue security follow-up (2026-07-18):** the independent credential-remediation review
> found that `daily-overdue` retained `verify_jwt=false` while its old in-function predicate accepted
> every request when `CRON_SECRET` was absent. The production composition now validates a non-blank
> server secret and a non-blank, constant-time-equal `X-Cron-Secret` value before constructing the
> admin client or performing any privileged read/write. Twelve permanent handler/auth tests cover
> missing/blank server configuration, missing/blank/incorrect callers, a correct caller, zero
> privileged calls on rejection, sanitized responses, ordering, and constant-time composition. The
> approved staging project now has `CRON_SECRET`; only `daily-overdue` was explicitly deployed (v6,
> ACTIVE, `verify_jwt=false`). Missing, empty, incorrect, anonymous, and valid ordinary-user-JWT
> calls return 401/`UNAUTHORIZED`; a correct scheduler call returns 200. The bounded positive call
> moved the three pre-counted due invoices to `Overdue`, held no customers, wrote no credit/customer
> logs, and subsequent calls are idempotent. There is no staging `daily-overdue` cron job to rewire;
> the separate Batch 9D-B FX job remains the only cron job and is unchanged.
>
> **Final independent closure confirmation (2026-07-20):** Claude Code returned
> `PASS - INDEPENDENT STAGING CLOSURE CONFIRMATION COMPLETE`. Batch 9D-D is accepted at source,
> local-validation, staging-runtime, credential-remediation, security-remediation, and independent-
> review levels. No Critical or High finding remains. The confirmation identified one non-blocking
> documentation undercount: staging retains exactly **three** controlled `0.01` allocation records,
> all `Reversed`, each with reversal timestamp, reason, and actor. Their reasons are
> `B9DD runtime gate emergency cleanup`, `B9DD staging runtime negative-matrix reversal`, and
> `Batch 9D-D credential rotation regression reversal`. No active `0.01` gate allocation remains, and receipt/invoice
> arithmetic reconciles. That Medium documentation issue is corrected in this evidence and the plan.

```text
Batch 9D-D backend + staging:  CLOSED (PASS) - previously executed & recorded
Batch 9D-D frontend (first attempt):   FAILED independent Codex FE/BE integration review
  -> findings B9DD-FEIR-001 ... B9DD-FEIR-013 remediated
Batch 9D-D frontend (remediation re-review):  FAILED
  -> findings B9DD-RR-001 ... B9DD-RR-007 (RR-008 informational only)
Batch 9D-D frontend (further remediation):  re-reviewed
  -> B9DD-RR-001 CLOSED, B9DD-RR-003 CLOSED
  -> 6 further findings B9DD-FR-001 ... B9DD-FR-006
Batch 9D-D frontend (final remediation):  re-reviewed
  -> B9DD-FR-001 CLOSED, B9DD-FR-003 CLOSED, B9DD-FR-005 CLOSED
  -> 3 further findings B9DD-DR-001 ... B9DD-DR-003
Batch 9D-D frontend (micro-delta remediation):  reviewed
  -> frontend-only OFFSET scan judged unable to prove coverage
Batch 9D-D Phase A:  IMPLEMENTED; MIGRATION 030 INSTALLED AND VERIFIED IN STAGING
  -> GET /allocations/candidates deployed and verified in staging
  -> PostgreSQL definition, ACL, capacity, ordering and runtime contract verified
Batch 9D-D Phase B:  IMPLEMENTED AND LOCALLY VALIDATED
Staging credential incident:  REMEDIATED; COMPROMISED LEGACY PAIR DISABLED AND REJECTED
Daily-overdue custom auth:  FAIL-CLOSED REMEDIATION DEPLOYED/VERIFIED IN APPROVED STAGING
Codex implementation / self-validation:  PASS
Claude independent source review:  PASS
Independent staging closure confirmation:  PASS
Critical / High findings remaining:  NONE
Commit:  NOT YET AUTHORIZED
Push:  NOT AUTHORIZED (GitHub main may trigger Vercel production deploy)
Production action:  NONE
Production rollout:  NOT STARTED - reserved for Batch 9D-E
Frontend production deployment:  NOT AUTHORIZED
Batch 9D-E:  NOT STARTED
```

Authoritative baseline for this gate:

```text
branch:  main
HEAD == origin/main:  d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d
commit subject:  fix(ar): close Batch 9D-D staging runtime defects
staged area:  empty (no commit performed)
staging Supabase:  gcdsdyegwjdcskpukqlq (explicitly authorized staging runtime target for the recorded gates)
production Supabase:  kusseuycqgdilychphpq (STRICTLY OUT OF SCOPE)
```

---

## 1. Objective

Batch 9D-D delivers correct multi-currency monetary behaviour across the AR module:

- Backend (previously closed): authoritative company-base normalization and per-currency aggregation
  contracts; immutable booked-FX snapshots; FX booking-rate provenance and posting-eligibility read
  contracts; linked Credit Note reference integrity; and staging runtime-defect remediation.
- Frontend (remediated in this gate): a Multi-Currency UX that always shows transaction currency
  explicitly, never performs cross-currency arithmetic in the browser, consumes backend-authoritative
  base totals and per-currency subtotals over the **whole filtered collection**, and surfaces booked-FX
  provenance, rate direction and decision-state without relying on colour alone.

---

## 2. Backend / Staging Evidence (PREVIOUSLY EXECUTED - authoritative, not re-run in this gate)

> The following was executed and recorded prior to the frontend work and is the authoritative
> baseline (`fix(ar): close Batch 9D-D staging runtime defects`, `d5c9c0a`). It was **not** re-run
> and **not** reopened here. This gate performed **no** staging query and **no** staging mutation.

### 2.1 Migrations

| Migration | Purpose | State |
| --- | --- | --- |
| `027_batch_9d_d_authoritative_monetary_aggregation.sql` | Authoritative monetary aggregation (company-base normalization + per-currency subtotals) | Applied + verified in staging |
| `028_linked_credit_note_reference_integrity.sql` | Linked Credit Note reference integrity | Applied exactly once |
| `029_batch_9d_d_staging_runtime_defect_remediation.sql` | Staging runtime-defect remediation (SQL-only) | Applied exactly once |

### 2.2 Backend / staging verification categories (all PASS per authoritative record)

Monetary aggregation; booked FX snapshots; invoice and receipt posting; cancellation and reversal;
manual allocation; linked Credit Note integrity; cheque clearance; sequence concurrency; reference
correction concurrency; hidden/nonexistent reference envelope equivalence; fixture and Auth cleanup;
scheduler state; repository and production safety. No known High, Medium, or Low backend/staging
blocking findings.

### 2.3 Migration 029 defect remediation (recorded)

- `get_next_sequence` compatibility under an empty `search_path`.
- Identical `404` envelope for a hidden vs a non-existent Invoice on reference correction.
- Migration 029 is **SQL-only**; the 16 affected Edge Functions remained **ACTIVE** and **no Edge
  redeployment was required**.

### 2.4 Scheduler

```text
name:  batch_9d_b_fx_scheduler_staging
schedule: 30 7 * * *
state:  active (UNCHANGED by this gate)
```

### 2.5 Cleanup / safety

Fixture and temporary Auth cleanup completed; no production action; no remaining backend/staging
blocker.

---

## 3. Independent review outcome and remediation (THIS GATE)

The frontend has been reviewed THREE times. Section 3.2 records the FIRST round (B9DD-FEIR-001 ...
B9DD-FEIR-013); Section 3.4 records the SECOND (B9DD-RR-001 ... B9DD-RR-007); Section 3.5 records
the THIRD (B9DD-FR-001 ... B9DD-FR-006), which is what this gate remediates. The third round also
CLOSED B9DD-RR-001 (Aging pagination) and B9DD-RR-003 (form currency/MYR).

**This document does not claim that any of those reviews passed**, and makes no "all findings
closed" statement. Where an earlier round's remediation was later found incomplete, that row says
so and points at the finding which superseded it.

### 3.1 Backend contracts the remediation is grounded in (read, not assumed)

| Contract | Source | What it establishes |
| --- | --- | --- |
| `ar_invoice_collection` / `ar_receipt_collection` | `database/027_...sql` | Page rows AND `summary` derive from ONE `scoped_customers` CTE (excludes `is_deleted`/`is_hidden`, applies assignment scope). The summary is computed over the whole `filtered` CTE, **independently of the requested page**. |
| Base normalization | `database/027_...sql` (`ROUND(i.outstanding * i.exchange_rate, 2)`) | `base = transaction x exchange_rate` -> rate direction is `1 <transaction> = <rate> <base>`. |
| `MAX_PAGE_SIZE = 100` | `backend/supabase/functions/_shared/constants.ts` | `page_size=500` was silently clamped to 100. |
| `ar_aging_by_customer` | `database/027_...sql` | Authoritative customer exposure: `status IN ('Open','Overdue','Partially Paid')`, `doc_type IN ('Invoice','Debit Note')`, `outstanding > 0`, with per-customer `by_currency` + `base_total`. |
| `ar_customer_statement` | `database/027_...sql` | Nulls the transaction-currency running balance when the period spans >1 currency; `base_balance` always valid. |
| `attachFxDecisionReadSummary` | `invoices/service.ts`, `receipts/service.ts` | `base_available`, `fx_posting_eligibility`, `fx_decision` are set on EVERY read path -> required, not optional. |
| `GET /auth/me` | `auth/index.ts` | `company.base_currency` is the authoritative base currency and is **nullable**. |
| FX decision CHECKs | `database/022_fx_booking_rate_governance.sql` | `source_category`, `approval_status`, `lifecycle_status` are constrained to closed value sets. |

### 3.2 Finding-by-finding resolution

| Finding | Resolution | Key files | Proof |
| --- | --- | --- | --- |
| **001** list row/summary scope | Removed the capped `/customers` post-filter (backend already scopes rows AND summary identically); preserved `total`/`page`/`page_size`; removed `totalPages = 1`; Credit/Debit Notes now use the server `doc_type` filter with real pagination. | `use-invoices.ts`, `use-receipts.ts`, `use-allocations.ts`, `invoices/page.tsx`, `receipts/page.tsx`, `credit-notes/page.tsx` | `use-invoices.test.tsx` (7), `pages.test.tsx` |
| **002** report completeness | Deleted `useAllInvoices`/`useAllReceipts` (`page_size=500`). Reports now request backend summaries with server filters (`page_size=1` returns full-collection totals); Aging/Outstanding take company totals from `ARSummary`; native `by_currency` shown on both. **PARTIAL - superseded by B9DD-RR-001:** the Aging customer table did NOT actually paginate; it fetched one default page of up to 100 rows and exposed no controls. Fixed in this gate. | `use-f2-data.ts`, `aging-lookup.ts`, `reports/*` | `use-f2-data.test.tsx` (5), and now `reports/aging/page.test.tsx` (10) |
| **003** Customer Statement | New route `/customers/[id]/statement`, hook and view rendering the full contract (per-currency + base opening/movement/closing, period filters, states, nav from Customer detail). | `use-statement.ts`, `statement-view.tsx`, `customers/[id]/statement/page.tsx` | `statement-view.test.tsx` (12) |
| **004** allocation history | Totals grouped by `receipt_currency`; scope labelled "this page"; no invented company-base rollup. | `allocation-history-table.tsx` | `allocation-history-table.test.tsx` (7) |
| **005** receipt-entry exposure | `useCustomerOutstanding` replaced by `useCustomerExposure` (authoritative aging row); exposure shown per-currency + separate base total; no longer relabelled with the receipt currency. | `use-receipts.ts`, `receipt-form-customer.tsx` | `use-receipts.test.tsx` (5) |
| **006** implicit MYR | Default-MYR `formatCurrency` **removed** (not deprecated); `formatMoney`/`formatMoneySafe` require the currency in the signature; company store no longer fabricates MYR; base currency from `/auth/me`; both create forms share one 6-currency list. **PARTIAL - superseded by B9DD-RR-003:** `currency: "MYR"` survived in both form-schema defaults, and `watchCurrency !== "MYR"` plus `Base Currency (MYR)` / `Base Total (MYR)` labels survived in the preview paths. Fixed in this gate. | `lib/utils.ts`, `lib/currency.ts`, `company-store.ts`, `use-base-currency.ts` | `monetary-guard.test.ts` (now 43), `currency.test.ts`, `use-seed-base-currency.test.tsx` |
| **007** FX presentation | `resolveFxRateDisplay` gives direction (`1 USD = 4.4500 MYR`) + lifecycle; a posted document with no decision renders "Booked rate not available" - the `?? exchange_rate` fallback is gone. | `lib/fx-presentation.ts`, `money-cell.tsx`, detail pages | `fx-rate-display.test.ts` (12) |
| **008** import/OCR governance | `readImportGovernance` + `ImportGovernanceCell` surface currency, imported rate + direction, override reason, posting/hold status and non-postable reason in both review tables. **PARTIAL - superseded by B9DD-RR-005:** the ORIGIN was read from `mapped_data.source`, accepting `csv_xlsx_import`/`ocr`, which production never writes there. Fixed in this gate. | `lib/import-governance.ts`, `import-governance-cell.tsx`, both import pages | `import-governance.test.ts` (16), `import-governance-cell.test.tsx` (13) |
| **009** contract types | Aging/CustomerAging/ARSummary/FX enrichment fields made required; statement types defined once and re-exported; `as any` monetary normalization removed. | `types/monetary.ts`, `types/index.ts`, report pages | `tsc` PASS, `monetary-guard.test.ts` |
| **010** integration tests | Page/hook integration coverage added at the API boundary. **PARTIAL - superseded by B9DD-RR-006:** the suite missed several mandatory routes (Dashboard, Invoice/Receipt detail, Receipt report, Customer list/detail, the Statement ROUTE, the import pages) and the static guard missed real production violations. Extended across the RR and FR gates. | `src/test/harness.tsx` + test files | Extended again since; see Section 4 for the current count |
| **011** lint | Added `eslint.config.mjs` (flat, non-interactive) using existing deps; fixed all 39 exposed findings. | `eslint.config.mjs` + 12 files | `npm run lint` exits **0** |
| **012** dependencies | Test stack upgraded to patched versions; Next.js unchanged at 15.5.19. | `package.json`, `package-lock.json` | audits below |
| **013** documentation | This document and the plan corrected. **PARTIAL - superseded by B9DD-RR-007:** the corrected document still overstated completion (see the PARTIAL rows above) and carried non-ASCII typography that renders as mojibake outside UTF-8. Corrected in this gate; see Section 4.4. | this file, plan | Section 4.4 |

### 3.4 Remediation re-review findings (B9DD-RR-001 ... B9DD-RR-008) - remediated in THIS gate

The re-review of the first remediation returned 7 blocking findings plus 1 informational item. Each
is remediated below with the source change and a regression test that fails against the exact
pre-remediation behaviour.

| Finding | Root cause | Remediation | Key files | Regression proof |
| --- | --- | --- | --- | --- |
| **RR-001** Aging pagination | The company summary was authoritative, but the customer table fetched only the default first page (up to 100 rows) and exposed no pagination at all. | The table is now a separate server-paginated dataset with real page state and controls; `total`/`page`/`page_size` come from backend metadata and drive `totalPages`. The summary stays complete and page-independent (never recomputed from page rows). Search/sort are explicitly labelled current-page-only, because `GET /reports/aging/by-customer` accepts only `as_of_date` + pagination (backend `reports/index.ts` ~109) and exposes no customer filter to delegate to. | `reports/aging/page.tsx`, `use-f2-data.ts` | `reports/aging/page.test.tsx` (10): 101 rows -> 5 pages; page 2 requests `page=2`; summary identical across pages; page rows never form the company total |
| **RR-002** Customer list/detail authority (placeholder safety **PARTIAL - superseded by B9DD-FR-001**: `keepPreviousData` left old rows/totals/exposure on screen under a newly selected filter with no updating state; fixed in this gate, Section 3.5) | `useAllCustomers` fetched page 1 (`page_size=100`) and was treated as complete; the list joined Customer page 1 with Aging page 1 and rendered `outstandingMap.get(id)?.amount ?? 0`, so a customer off aging page 1 showed a FALSE ZERO; detail located the customer inside that capped list, so a valid customer beyond the first 100 rendered a FALSE "Customer not found". | `useAllCustomers` **deleted**. New `useCustomerList` is server-paginated and pushes `search`/`status`/`credit_rating` to the backend (all supported at `customers/index.ts` ~101). `useCustomer` uses the GOVERNED `GET /customers/:id`. `useCustomerExposureMap` resolves exposure for exactly the visible IDs via a bounded scan that early-exits when all are found, and reports zero ONLY after the aging set is exhausted - sound because `ar_aging_by_customer` filters `WHERE cg.base_total > 0` (027 ~380), so zero-exposure customers are omitted by design. Four distinct states: loaded / zero / unavailable / loading. | `hooks/use-customers.ts`, `lib/aging-lookup.ts`, `customers/page.tsx`, `customers/[id]/page.tsx`, `components/features/customers/customer-exposure-cell.tsx` | `customers.test.tsx` (13): 250 customers paginate; exposure found on aging page 2 shows `MYR 545.00` not `MYR 0.00`; lookup failure shows "Exposure unavailable", never zero; customer 150 loads via `GET /customers/:id`; governed 404 vs 500 distinguished |
| **RR-003** MYR defaults/labels | `defaultInvoiceValues()`/`defaultReceiptValues()` returned `currency: "MYR"`; `receipt-summary-bar` branched on `watchCurrency !== "MYR"` and printed `Base Currency (MYR)`; `invoice-line-table` printed `Base Total (MYR)`. | Both defaults are now `""` (unselected). `useSeedBaseCurrency` seeds the field from the authenticated company base ONCE, only while empty, and only for an allow-listed currency - so a user's choice is never overwritten and an unavailable/unsupported base leaves the field empty (the schema then blocks submission). Parity is `currency === baseCurrency`; base labels interpolate the REAL base currency; an unknown base renders "Base currency unavailable" with no conversion. | `lib/invoice-schema.ts`, `lib/receipt-schema.ts`, `hooks/use-seed-base-currency.ts`, `use-invoice-form.ts`, `receipts/new/page.tsx`, `invoices/new/page.tsx`, `receipt-summary-bar.tsx`, `invoice-line-table.tsx`, `invoice-review.tsx` | `use-seed-base-currency.test.tsx` (9) + `receipt-summary-bar.test.tsx` (6): SGD-base seeds SGD; delayed context seeds late; USD choice survives a refresh; unavailable base fabricates nothing; SGD parity shows no conversion; MYR-into-SGD-base DOES convert |
| **RR-004** Allocation currency basis (scan completeness **PARTIAL - superseded by B9DD-FR-002**: the exhaustive scan accumulated RAW rows and could terminate early on an overlapping page; fixed in this gate, Section 3.5) | Invoice totals, outstanding, allocation maxima, discounts, the balance bar and forex G/L all rendered through `formatAmount` with no currency, and the validation message named no amounts. | Every transaction amount is labelled with the receipt's currency (allocation is same-currency by construction: `allocations/service.ts` ~445 filters candidates `.eq('currency', receipt.currency)`). Forex G/L is labelled **company base** - migration 028 enforces `forex_gain_loss = ROUND(allocated_amount * (receipt_rate - invoice_rate), 2)`, and those rates convert transaction -> base; with no base currency it renders "Basis not specified" rather than a bare number. Toasts carry currency. `POST /allocations/auto` remains disabled. Separately, `useOutstandingInvoices` no longer caps at one 100-row page - it scans the customer's collection to exhaustion (bounded) because `/invoices` exposes no currency filter, so the cap could silently hide allocatable invoices. | `allocation-table.tsx`, `receipt-panel.tsx`, `invoice-panel.tsx`, `allocations/page.tsx`, `use-allocations.ts`, `receipts/[id]/page.tsx`, `receipt-table.tsx`, `invoices/[id]/page.tsx` | `allocation-table.test.tsx` (14) + `allocations.test.tsx` (5): forex shown as `MYR 25.00` and never `USD 25.00`; unavailable base -> "Basis not specified"; validation message states both amounts; a scan asserts NO codeless money renders in the table; SGD invoice not offered for a USD receipt; no `/allocations/auto` request |
| **RR-005** Import origin | `readImportGovernance` accepted `mapped_data.source` values `csv_xlsx_import` and `ocr`. Neither is ever written there: `importOriginPayload()` (`imports/service.ts` ~299) builds `{source:'csv_xlsx_import', ...}` at POSTING time for the FX RPC's `p_import_origin`, and the only `mapped_data.source` production writes is `'ocr_manual_fallback'` (~589). | Origin is now supplied SEPARATELY from its real envelope - the BATCH (`import_type` + `file_type`), which `GET /imports/:id` returns and both pages already hold. `resolveImportOrigin(batch)` maps csv/xlsx -> "CSV/XLSX import", pdf/image -> "OCR intake", and a missing envelope -> **"Origin not available"** rather than a guess. `mapped_data` parsing is restricted to real fields; `manualFallback` reads the one real marker. Currency, rate+direction, override reason, posting status, HeldGovernance, posting error, low-confidence and "base not booked yet" behaviour are preserved. | `lib/import-governance.ts`, `import-governance-cell.tsx`, `invoices/import/page.tsx`, `receipts/import/page.tsx` | `import-governance.test.ts` (15) + `import-governance-cell.test.tsx` (13) + `import-pages.test.tsx` (7): backend-shaped batch/row fixtures for Invoice/Receipt x CSV/XLSX/OCR; origin unavailable states it; an impossible `mapped_data.source` is ignored; **no test injects an impossible source** |
| **RR-006** Guard + coverage | The guard missed the patterns that actually survived, and mandatory routes had no tests. **PARTIAL - superseded by B9DD-FR-003/FR-004:** the guard still scanned LINE BY LINE (bypassable by a line break), and the "OCR" page test never entered OCR mode. Both fixed in this gate; see Section 3.5. | Guard extended from 13 to 43 checks (now **79**): MYR initializers/assignments/parity/labels, a catch-all MYR literal check, first-page-only `useAll*` hooks, false-zero exposure maps, impossible import sources, mapped_data origin reads, and a reviewed allow-list for the only files that may format money via `formatAmount` (each justified, with its currency context asserted). Lines are whitespace-normalized, not fragile. A **guard-efficacy suite** proves each pattern matches the real pre-remediation line and does NOT match legitimate code. Route coverage added for Dashboard, Invoice/Receipt detail, Receipt report, Customer list/detail, the Statement ROUTE + hook, Aging pagination, the allocation workflow and both import pages. | `lib/monetary-guard.test.ts` + 8 new test files | Extended again since; see Section 4 for the current count |
| **RR-007** Docs + mojibake | This document overstated completion and carried non-ASCII typography. | Section 4.4 lists every withdrawn claim; the PARTIAL rows in 3.2 mark what the first remediation did not finish; counts updated to the real numbers. Mojibake: see Section 4.5. | this file, plan | Section 4.4, Section 4.5 |
| **RR-008** (informational) | Four extraneous packages in the local physical `node_modules`. | **No tracked-file change.** `node_modules` was not deleted or recreated, and `package.json`/`package-lock.json` were not touched for it. Reported as local environment state only - `npm ls --depth=0 --package-lock-only` is clean (Section 4.3). | - | - |

### 3.5 Focused re-review findings (B9DD-FR-001 ... B9DD-FR-006) - remediated in THIS gate

The focused re-review CONFIRMED **B9DD-RR-001 (Aging pagination)** and **B9DD-RR-003 (form
currency/MYR)** as CLOSED, and returned 6 further findings. Each is remediated below with the source
change and a regression test that fails against the exact pre-remediation behaviour.

| Finding | Root cause | Remediation | Key files | Regression proof |
| --- | --- | --- | --- | --- |
| **FR-001** Customer filter placeholder state | `placeholderData: keepPreviousData` (added for RR-002, so the search box would not unmount mid-keystroke) left the PREVIOUS filter's rows, backend total and aging exposure on screen while the newly selected filter was still in flight - with nothing marking them as superseded. A user could read another customer's outstanding exposure as belonging to the filter they had just chosen. | The page now derives `isStale` from React Query's `isPlaceholderData`, which is true exactly while the rows on screen came from a DIFFERENT query key. `isStale` drives: an `aria-live` `role="status"` announcement; a `<caption>` on the table (real text in the a11y tree, not a CSS class); `aria-busy` + dimming; the total replaced by "Counting customers for the new filter..."; the "no matches" claim withheld; pagination disabled; and every exposure cell rendered as "Updating..." rather than a figure. A background refetch of the SAME filter is deliberately NOT marked stale - the data is still authoritative. An error after a filter change surfaces the failure instead of leaving the old rows standing. | `app/(dashboard)/customers/page.tsx`, `components/features/customers/customer-exposure-cell.tsx` (new `stale` state), `test/harness.tsx` (async routes + `createDeferred`) | `customers.test.tsx` - 10 new tests holding the refetch open with a deferred promise: old `MYR 545.00` disappears and is never replaced by `MYR 0.00`; the old total is not restated; paging disables; search/status/credit_rating all behave the same; a settled filter is NOT marked stale (negative control) |
| **FR-002** Allocation pagination de-duplication (**PARTIAL - superseded by B9DD-DR-001**: de-duplication was necessary but not sufficient. The scan still overwrote the total on every page, and still accepted a short or empty page as completion; fixed in this gate, Section 3.6) | The bounded scan accumulated raw rows (`all.push(...rows)`) and terminated on `all.length >= total`. Offset paging is not stable while the collection changes, so an overlapping page's duplicates counted toward `total` twice, the loop exited early, and genuinely allocatable invoices that were never fetched vanished silently. | Candidates are collected in a `Map` keyed by invoice ID; completion is measured in UNIQUE invoices. Termination is now: empty page (exhausted); unique count reaching the backend total; a short page (which also settles a stale/mismatched `total`); or an explicit throw. A FULL page that yields no new invoice means the offset is not advancing - `OutstandingScanNoProgressError` is raised rather than looping or truncating. The 50-page bound still throws `OutstandingScanIncompleteError`. Ordering is FIFO by due date with an explicit `invoice_no` tiebreak, so it no longer depends on sort stability over fetch order. Nothing authoritative is computed from the candidate set. | `hooks/use-allocations.ts` | `use-allocations.test.tsx` (11 new) - scripted per-page responses, never a whole dataset on page 1. The overlap case (pages 1..4, total 250) is one the OLD code fails: it stopped at page 3 with 200 unique and dropped inv-201..inv-250 |
| **FR-003** Real OCR route integration | The "OCR" page test mocked `useImport`, left the page in CSV mode, and injected a PDF batch into CSV hook state. It never rendered `OcrImportFlow` and never touched `useOcrImport`. Worse, the production `OcrImportFlow` rendered **no governance presentation at all** - so there was nothing to cover. | `OcrImportFlow` now renders the SAME `ImportGovernanceCell` the CSV/XLSX review tables use, fed by the batch envelope its own upload returns (`imports/service.ts` ~494 inserts `import_type` + `file_type` on the OCR batch). The fictional test was REMOVED from `import-pages.test.tsx` with a note saying why. | `components/features/imports/ocr-import-flow.tsx`, `app/(dashboard)/import-pages.test.tsx` | `ocr-import.test.tsx` (14 new) - clicks the real "PDF/Image Import" control, renders the real flow, uploads through the real hidden input, and asserts `useOcrImport` really called `POST /imports/ocr/upload` with multipart `import_type`/`file_type`. Invoice AND receipt; PDF and image origins; manual fallback; missing envelope -> "Origin not available"; no pre-posting base amount |
| **FR-004** Guard formatting robustness (**PARTIAL - superseded by B9DD-DR-002**: the whole-file scan removed the line-break bypass, but the hand-rolled comment stripper did not model REGEX LITERALS and could delete real code, causing a FALSE NEGATIVE; fixed in this gate with a TypeScript-parser-backed scanner, Section 3.6) | The scanner split each file on `"\n"` and tested lines independently, so every pattern was bypassable purely by formatting: `currency:\n  "MYR"` matched nothing. A formatter or a merge could have silently disarmed the guard. | The scanner now reads each file whole, strips comments with a small character-scanner that preserves string/template contents (a regex cannot tell `//` in a URL from a comment), collapses comments to a single space (so `a/*x*/b` cannot fuse into `ab`), normalizes all whitespace, and matches against the whole-file text. Line numbers are dropped rather than fabricated - hits report the FILE, which is what the assertions and allow-lists key on. `/g` and `/y` patterns are rejected outright, so no `lastIndex` state can leak between files. Encoding and secret checks scan the RAW file, comments included, because a mojibake'd or key-bearing comment is still a defect. No category was weakened. | `lib/monetary-guard.test.ts` | 60 checks (was 43). The new robustness suite found and fixed **two real holes**: `myrInitializer` required `currency:` with no space, and `crossCurrencyReduce` required `.reduce((` with no space - both bypassable by a line break. Multiline initializer/parity/fallback/reduce/label/false-zero cases, inline-block-comment splitting, comment-documented patterns NOT flagged, and the suite's own mojibake regex proven excluded |
| **FR-005** credit_rating propagation | The implementation was correct but unproven. Proving it found a REAL defect: `setPage(1)` lived in a `useEffect`, which runs AFTER commit - so React first rendered the new rating alongside the OLD page number and fired a real request for `credit_rating=B&page=2`, page 2 of a result set that never existed. | The page reset is now atomic with the filter change via `applyFilter`, so React batches both into one render and the incoherent request is never constructed. | `app/(dashboard)/customers/page.tsx` | `customers.test.tsx` - all six backend-accepted values (AAA, AA, A, B, C, D) sent exactly; "All" OMITS the param entirely (never `credit_rating=All`, which `validateEnum` would reject); combined with search+status+page+page_size; query key isolates ratings; page resets to 1 and page 2 is never requested under a new rating; a deliberately contrary server proves no client-side rating filter is applied |
| **FR-006** Documentation accuracy | Closure claims outran the code. | This section, the corrected counts in Section 4, the PARTIAL markers in Sections 3.2/3.4, and the withdrawal table in Section 4.4. | this file, plan | Section 4 |

### 3.6 Delta re-review findings (B9DD-DR-001 ... B9DD-DR-003) - remediated in THIS gate

The delta re-review CONFIRMED **B9DD-FR-001**, **B9DD-FR-003** and **B9DD-FR-005** as CLOSED, and
returned 3 further findings.

| Finding | Root cause | Remediation | Key files | Regression proof |
| --- | --- | --- | --- | --- |
| **DR-001** Allocation scan not fail-closed (**SUPERSEDED by Phase A + Phase B**: the fail-closed invariants were correct but could only DETECT instability, never prove coverage. The OFFSET scan is now DELETED and replaced by the governed snapshot contract; see Section 3.7) | De-duplicating by invoice ID was necessary but NOT sufficient over a mutable offset window. The scan still (a) overwrote `reportedTotal` on every page, so a SHRINKING collection silently lowered the finish line; (b) accepted a SHORT page as the end of the collection; (c) accepted an EMPTY page the same way; (d) treated an overlapping page as safely de-duplicable and carried on. Codex's case, replayed and confirmed against the pre-remediation algorithm: page 1 returns ids 1-100 of total 150; ids 1-20 are then deleted; page 2 reports total 130 and returns ids 121-150; the old scan saw unique 130 >= total 130 and returned **SUCCESS with 130 rows**, silently omitting ids 101-120 - invoices that appeared on **no page at all**. | The scan is now FAIL-CLOSED and asserts stability instead of inferring it. `initialTotal` is captured ONCE from the first page and never reassigned; every later page must report that same total or the scan throws `OutstandingScanUnstableError`. Any duplicate id - across pages OR within one page - throws, because a repeat is direct evidence the window moved and whatever moved out of view may never be returned. A row without a usable id throws. Success requires unique coverage to EQUAL `initialTotal` exactly; an empty or short page before that throws; unique coverage exceeding the total throws; a zero total must be answered by an empty first page. A capacity pre-check refuses a scan that could never fit the bound (`initialTotal > 50 x 100`) on the FIRST page rather than after 50 pointless requests. Ordering, eligibility rules and the "no authoritative total from candidates" rule are unchanged. | `hooks/use-allocations.ts` | `use-allocations.test.tsx` (23) |
| **DR-001** (UX) Instability rendered as "no invoices" | `allocations/page.tsx` destructured `data: outstandingInvoices = []` and **discarded `error` entirely**, so a scan that FAILED to prove the candidate set rendered as "No outstanding invoices for this customer" - an unverifiable list presented as an authoritative empty one, on the screen where that is most dangerous. | The error is now read and passed to `InvoicePanel`, which renders five DISTINCT states: no receipt selected; loading; verified candidate list; **"Eligible invoices changed while loading. Refresh and try again."**; and a plain API failure. The unverified state shows no candidate rows, no count badge, no ids and no stack. | `app/(dashboard)/allocations/page.tsx`, `components/features/allocations/invoice-panel.tsx` | `allocations.test.tsx` (8) - instability, verified-empty and API failure each assert the other two messages are ABSENT |
| **DR-002** Guard under-scans on regex literals (**PARTIAL - extended by B9DD-MDR-003**: the parser-backed comment handling was correct and is retained, but the literal visitor missed interpolated TEMPLATE segments and the monetary-reduce rule was still a regex; both are now AST visitors, Section 3.7) | The hand-rolled comment stripper modelled strings and templates but NOT regex literals. A regex may legally contain raw comment delimiters: `/[//]/` and `/[/*]/`. Reproduced against the committed stripper: on `const r = /[/*]/;` it read an unterminated block comment and **deleted the entire rest of the file** - `const r = /[/*]/;\nconst value = { currency: "MYR" };` was reduced to `const r = /[ `, so the MYR violation left the scan and the guard PASSED. That is a false negative; the previous claim that regex literals could only cause over-scanning was wrong and is retracted. | Comment removal is now done by the **TypeScript parser** (`typescript` 5.9, already a devDependency - no new dependency). `/` as divide vs `/` as regex-start is context-dependent and cannot be resolved by a lexer alone, so the repo's real parser resolves it: comments are trivia, and a regex literal is a single `RegularExpressionLiteral` token that can never open a comment. `.ts`/`.tsx` are parsed with the correct `ScriptKind`; JSX text is treated as content, not trivia. Comment bytes are BLANKED (not deleted), so every other byte keeps its offset and real adjacency like `rows.reduce((` survives. The catch-all MYR check is now a true AST walk over string/template literal VALUES. A parse-diagnostics gate fails the guard on any production file the parser cannot make sense of. No category, allow-list or check was weakened. | `lib/monetary-guard.test.ts` | 79 checks (was 60), incl. a dedicated regex-literal suite |
| **DR-003** Documentation overstated DR-001/DR-002 | Claims outran the code. | Section 3.6, corrected Sections 4.3/4.4/4.7, corrected counts, and the retraction of the "over-scanning only" statement. | this file, plan | Section 4 |

### 3.7 Consolidated Final Closure Delta - Phase A + Phase B (THIS gate)

The micro-delta review concluded that no frontend-only algorithm can prove candidate completeness over
mutable OFFSET pagination. The remedy is a governed backend contract (Phase A, source-level only) and
its frontend consumption (Phase B).

| Item | Root cause | Remediation | Key files | Proof |
| --- | --- | --- | --- | --- |
| **Governed candidate contract** (supersedes DR-001) | `/invoices` offered OFFSET pagination only. A row shifted out of an already-read window appears on NO page, so the client cannot prove coverage; the fail-closed invariants detected instability but could not recover a missing row, and an exactly-balanced concurrent delete+insert defeated them entirely. | **Phase A (now staging-verified):** Migration 030 adds `public.get_allocation_candidates(p_receipt_id, p_user_id, p_company_id)` - STABLE, SECURITY DEFINER, `search_path = ''`, fully schema-qualified, service_role-only (revoked from PUBLIC/anon/authenticated), read-only, non-paginated, capped at 5,000, deterministically ordered - returning ONE complete candidate set from ONE PostgreSQL statement snapshot. Exposed as `GET /allocations/candidates?receipt_id=<uuid>`. **Phase B:** the frontend sends ONLY the receipt id; customer, company, currency, eligibility, visibility and the cap are all derived and governed server-side. The OFFSET scan, its page/bound constants and both instability error classes are DELETED - there is no fallback, because falling back to `/invoices` would recreate the original defect. | `lib/allocation-candidate-contract.ts` (new), `hooks/use-allocations.ts` | `use-allocations.test.tsx` (42) |
| **Frontend contract validation** | The backend validates the contract (`allocations/service.ts::parseAllocationCandidateResult`); the client must not simply trust it. | An independent Zod gate asserts `contract_version`, `complete === true`, `max_candidates === 5000`, the exact 3-element ordering array, receipt UUID identity against the id ASKED for, `customer_id`/`currency` agreement between the top level and the receipt, a supported 3-letter currency, `total` a non-negative integer `<= max`, `candidates.length === total`, unique non-empty candidate ids, per-candidate currency equal to the receipt currency, doc_type in {Invoice, Debit Note}, status in {Open, Overdue, Partially Paid}, positive finite outstanding and exchange rate, and positive integer versions. Any failure throws `AllocationContractError` and yields NO data. | `lib/allocation-candidate-contract.ts` | `use-allocations.test.tsx` - 29 malformed-contract cases |
| **Authoritative receipt binding** | The receipt row the user clicked may be stale - its unallocated balance in particular. | After a verified read, the CONTRACT's receipt becomes the workbench context (customer, currency, unallocated amount, version). Identity is asserted, not assumed: a contract for a different receipt fails closed. The frontend is still not mutation authority - the existing governed manual route revalidates every financial condition. | `allocations/page.tsx`, `hooks/use-allocations.ts` | `allocations.test.tsx` - governed 42.50 beats the list's stale 300 |
| **Stale candidate/line lifecycle** | The page synced allocation state only when the candidate array was NON-EMPTY (`if (selectedReceipt && outstandingInvoices.length > 0)`), so a later verified-empty result, a failure, or a malformed response left the PREVIOUS receipt's candidates and allocation lines on screen and actionable. | State is rebuilt from a verified contract or cleared - there is no third branch. Lines are cleared on EVERY authoritative read, including a same-receipt refetch, because a later read may carry different candidate versions/outstanding or a different unallocated amount. A contract fingerprint (receipt id + version + unallocated amount + currency + customer + each candidate's id/version/outstanding/status) drives rebinding, so a CHANGED verified result also clears stale lines. **[SUPERSEDED by B9DD-FRR-001 - see Section 3.10.]** The rebind trigger was `dataUpdatedAt`, on the reasoning that structural sharing reuses the same `data` reference for an identical refetch. That reasoning was right about the problem and WRONG about the fix: `dataUpdatedAt` is a millisecond timestamp, so two successful reads in the same millisecond are indistinguishable and the rebind never runs. The trigger is now a collision-free QueryCache revision built on `dataUpdateCount`. | `hooks/use-allocation-logic.ts`, `allocations/page.tsx` | `allocations.test.tsx` (21), `use-allocation-live-verification.test.tsx` (21) |
| **Action-layer enforcement** (**SUPERSEDED by B9DD-CDR-002 + B9DD-CRR-001/002 - see Section 3.9 for the CURRENT architecture**) | Hiding a component is not enforcement. | *Original (no longer the design):* `useAllocationLogic` took an `isContractVerified` boolean and every mutating action refused without it. That was a RENDER-TIME value captured by each `useCallback`, which is exactly the defect CDR-002 raised: it can be stale by the time the callback runs. It is gone. The current design is a live, generation-bound cache read - Section 3.9. | `hooks/use-allocation-logic.ts` | Section 3.9 |
| **B9DD-MDR-003 Section 7.1 template statics** | The literal visitor collected `StringLiteral` + `NoSubstitutionTemplateLiteral` only. Reproduced: `` `MYR` `` was caught, but `` `MYR${x}` ``, `` `${p}MYR${s}` `` and `` `${p}MYR` `` were **all missed** - their static text lives in TemplateHead/Middle/Tail, which were never visited. | `staticStringText` now walks `TemplateExpression.head` and each `templateSpans[].literal`. Spans are collected separately, so `` `${x}MY` + `R${y}` `` cannot be falsely joined into "MYR". A regex body is a `RegularExpressionLiteral`, structurally not a string, so `/MYR/` is correctly not a runtime value. | `lib/monetary-guard.test.ts` | 12 dedicated efficacy tests |
| **B9DD-MDR-003 Section 7.2 monetary reductions** | The cross-currency reduce rule was a regex matching `row.outstanding` only. Reproduced: `row?.outstanding`, `row["outstanding"]`, `row?.["outstanding"]`, `(row as Row).outstanding`, `row!.outstanding` and `Number(row?.outstanding)` - six spellings of the SAME prohibited operation - were **all missed**. | Replaced with a structural AST visitor: `monetaryReduceCallbacks` finds `.reduce()`/`?.reduce()` callbacks (arrow or function, concise or block body, `return` or `+=`) that arithmetically add a governed monetary field, unwrapping parentheses, `as`/`<T>` assertions, non-null assertions, and `Number()`/`parseFloat()`/unary-plus wrappers. Adding a seventh regex would have missed the eighth. The reviewed allow-list is preserved EXACTLY. | `lib/monetary-guard.test.ts` | 22 prohibited-shape tests + 7 false-positive guards |

### 3.3 Shared primitives

| File | Purpose |
| --- | --- |
| `types/monetary.ts` | Exact mirror of the backend monetary/FX/statement read contracts |
| `lib/currency.ts` | Currency-**required** `formatMoney`; `formatMoneySafe` (explicit unavailable); supported-currency policy + shared selector options; `sumByCurrency` (same-currency only) |
| `lib/fx-presentation.ts` | Source/decision mapping **and** `resolveFxRateDisplay` (direction + lifecycle) |
| `lib/aging-lookup.ts` | Server-paginated aging access; bounded customer-row lookup that fails safely |
| `lib/import-governance.ts` | Typed reader for `import_rows.mapped_data` |
| `hooks/use-base-currency.ts` | Authoritative company base currency (nullable, never defaulted) |
| `components/ui/money-cell.tsx` | Canonical MoneyCell (compact/detailed; booked vs estimated base; governed rate) |
| `components/ui/money-summary.tsx`, `currency-subtotals.tsx` | Per-currency subtotals + separate company-base total |
| `components/features/reports/statement-view.tsx` | Customer Statement rendering |
| `components/features/imports/import-governance-cell.tsx` | Import/OCR provenance cell |

---

### 3.8 Consolidated source-level review remediation - B9DD-CDR-001 ... 004 (THIS gate)

The consolidated source-level review accepted **Phase A** and returned four findings against the
frontend. All four were reproduced against the committed code before being fixed.

| Finding | What was actually wrong | Remediation | Files | Tests |
| --- | --- | --- | --- | --- |
| **CDR-001** Read contract applied the write currency list | The backend keeps two deliberate boundaries: `validateCurrency` (`^[A-Z]{3}$`) for existing-document READS, and `validateOperationalCurrencyForWrite` (MYR/SGD/USD/EUR/GBP/CNY) for NEW writes. Its own comment reads "Historical reads may still expose other valid three-letter legacy codes", and the candidate route gates currency with `^[A-Z]{3}$`. The frontend schema imported `SUPPORTED_CURRENCIES` and applied the WRITE list to a READ - stricter than the server it was validating. Because the workbench is fail-closed, a legacy JPY receipt would have been refused with "The eligible invoice list could not be verified" and been **impossible to allocate**. A fixture asserting `XYZ` was rejected had pinned the defect in place. | `readCurrencyCode` accepts any `^[A-Z]{3}$` code. Shape is still exact (no lowercase, blank, 2- or 4-letter). Cross-field agreement (receipt = top level = every candidate) is untouched - that, not the code list, is what prevents mixing currencies. The read contract no longer imports the write list at all. | `lib/allocation-candidate-contract.ts` | `use-allocations.test.tsx` - JPY/AUD accepted; JPY-vs-AUD mismatch rejected; 7 malformed shapes rejected; write list asserted unchanged |
| **CDR-002** Render-time boolean as action authority | `isContractVerified` was computed during render and captured by every `useCallback`. TanStack mutates its cache synchronously; React commits later. **Demonstrated, not argued**: the test asserts a moment where the cache reports `fetchStatus: "fetching"` while the last committed render still reports `isFetching: false` and `isVerified: true`. In that window a captured callback still believed it was authorized. Three real periods produce it - refetch started (data retained, status still `success`); refetch failed (stale data retained, status `error`); refetch succeeded with changed data (new contract cached, workbench still bound to the old one). | `useLiveAllocationContract` reads `getQueryState` under the **one canonical key** at invocation time and returns a binding identity or `null`. `useAllocationLogic` retains the bound generation in a **ref** (state would re-introduce the staleness) and every mutating action calls `isActionAuthorized()`, which requires: a verifier, a bound generation, a live success, `fetchStatus: idle`, no error, data present, `complete`, receipt-id match, and `bindingsMatch` on fingerprint + receipt version + unallocated amount + customer + currency + every candidate id/version. Default is **DENY** (`isContractVerified ?? true` is gone). `buildPayload()` returns null unless live verification passes at that invocation, and the page re-verifies once more immediately before `mutateAsync`. Safe destructive ops (clear lines/selection) stay ungated and are documented as such: they only ever REMOVE state. | `hooks/use-allocations.ts`, `hooks/use-allocation-logic.ts`, `allocations/page.tsx` | `use-allocation-live-verification.test.tsx` (21), `allocations.test.tsx` (21) |
| **CDR-002** Ungoverned receipt binding | `selectReceipt(receipt, invoices)` bound a receipt-LIST row - user intent, with a possibly stale balance - straight into authoritative workbench state, with no governed contract. | **Removed**, not guarded. The page stores only the selected receipt ID; the sole way into authoritative state is `bindVerifiedContract`. The list row is still shown for panel headings as non-authoritative presentation. | `hooks/use-allocation-logic.ts` | `use-allocation-live-verification.test.tsx` - asserts `selectReceipt` is absent from the hook surface |
| **CDR-003** AST guard missed equivalent syntax | 14 forms reproduced as MISSED against the committed visitor: nullish/logical/conditional fallbacks, destructured and aliased parameters, callback-local `const`/`let` taint, `sum = sum + x`, intermediate accumulators, `reduceRight`, and all three JSX static-text forms. | Bounded AST dataflow analysis (Section 4.3). | `lib/monetary-guard.test.ts` | 79 -> 151 checks |
| **CDR-004** Contradictory/overstated evidence | Five specific statements, listed in Section 4.4. | Withdrawn explicitly rather than edited away. | evidence + plan | - |

**Efficacy is proved by mutation, not by assertion.** Each fix was reverted in place to confirm the
new tests actually detect the regression:

| Mutant | Tests failed |
| --- | --- |
| Live verifier always allows (equivalent to the old render-time boolean) | **12** |
| Default-allow restored (`isContractVerified ?? true`) | **2** |
| `reduceRight` dropped from the reduce name check | **3** |
| `JsxText` inspection dropped | **5** |
| Callback-local taint tracking dropped | **9** |
| Destructured-parameter support dropped | **4** |

All mutants were reverted; the suite returns to the full count in Section 4.

### 3.9 Allocation action-authority architecture (HISTORICAL - SUPERSEDED BY 3.12) + B9DD-CRR-001 ... 004

> **Historical remediation record only.** Section 3.12 is the single authoritative current
> architecture. In particular, the receipt-only key, content/generation-only binding, and globally
> collision-free `dataUpdateCount` wording below are superseded.

**Presentation vs authority - the distinction the whole design rests on.**

| Concern | Mechanism | Authority? |
| --- | --- | --- |
| What is DRAWN (rows, panels, enabled-looking buttons) | `isContractVerified`, `validation.canSubmit` - RENDER-time values | **NO.** Provably able to be wrong: a committed render can report `isFetching: false` while the cache already reports `fetchStatus: "fetching"`. |
| What may be DONE (add/edit/fill-max/FIFO/payload/submit) | `isActionAuthorized()` - a synchronous LIVE cache read at INVOCATION time | **YES.** |

**The authority chain:**

1. **One canonical query key** - `allocationCandidateQueryKey(receiptId)`. The hook, the live reader
   and every test address the same cache entry; a second hand-written copy would fail OPEN.
2. **One live reader** - `readLiveAllocationContract()` performs a SINGLE `getQueryState` read and
   returns the governed contract together with the fetch generation that produced it, atomically.
   Production and tests both resolve through it, so they cannot disagree.
3. **Bound content identity** - receipt id/version, unallocated amount, customer, currency, and every
   candidate's id/version/outstanding/status (the fingerprint).
4. **Bound authoritative query generation** (B9DD-CRR-001) - `{ dataUpdateCount, dataUpdatedAt }` from
   the PUBLIC `QueryState` interface. `contractBindingIdentity(contract, queryGeneration)` requires
   it; there is no call shape producing a content-only binding.
5. **Default DENY** - no verifier configured means no authority. `isContractVerified ?? true` is gone.
6. **Immediate authority revocation** (B9DD-CRR-002) - `revokeContractAuthority()` nulls the bound ref
   SYNCHRONOUSLY. `createReceiptSelectionHandler` is the single receipt-ID transition and revokes
   before scheduling; select, reselect and post-submit clear all route through it.
7. **Final live verification before mutation** - `buildPayload()` re-verifies and returns null
   otherwise, and the page re-verifies again immediately before `mutateAsync`. The backend remains the
   final mutation authority regardless.

**Exactly which windows are closed, and by what.** Each row names the test that proves it; none is a
claim about "every background refetch" in the abstract.

| Window | Cache state | Denied by | Test |
| --- | --- | --- | --- |
| Refetch IN FLIGHT | data retained, `status: success`, `fetchStatus: fetching` | `fetchStatus !== "idle"` | Section 3.1 - "rejects stale callbacks the moment a same-query refetch begins" |
| Refetch FAILED, old data retained | data retained, `status: error` | `status !== "success"` | Section 3.2 - "refuses to act on cached data that survived a failed refetch" |
| Refetch returned CHANGED content, not yet rebound | settled success, new content | content fingerprint mismatch **and** generation mismatch | Section 3.5 - 8 changed-field variants |
| Refetch returned BYTE-IDENTICAL content, not yet rebound | settled success, `dataUpdateCount` advanced, **same data reference** | **generation mismatch only** - content compares equal | **B9DD-CRR-001** - "denies stale callbacks once the cache has settled a new generation, before React rebinds" |
| Receipt A -> B, inside the selection event, before commit | A's entry still success/idle with matching content **and** generation | **synchronous revocation only** - the live cache would still authorize A | **B9DD-CRR-002** - "denies receipt A's captured callbacks from inside the selection event itself" |
| Malformed refetch | parser rejects; query errors | `status !== "success"` | Section 3.3 |
| Verified EMPTY refetch | settled success, `total: 0` | not denied - correctly verified; `buildPayload()` returns null (no active lines) | Section 3.4 |
| Eventual presentation cleanup (rebind liveness) | - | rebind clears lines; the effect is driven by the collision-free QueryCache revision (`dataUpdateCount`), NOT by `dataUpdatedAt` - which could not defeat a same-millisecond generation (B9DD-FRR-001, Section 3.10) | Section 3.10 - "still rebinds, clears lines and recovers when dataUpdatedAt cannot change" |

**B9DD-CRR-001 - identical-content refetch generation window.** Content-based binding was blind here
by construction. Reproduced against the previous implementation before fixing:

```text
status: "success"   fetchStatus: "idle"   dataUpdateCount: 1 -> 2
dataUpdatedAtAdvanced: true   sameDataRef: true   (structural sharing)
boundGeneration: 1 (unchanged - React had not rebound)   linesStillPresent: 1
STALE_AUTHORIZED: true        STALE_PAYLOAD_NOT_NULL: true
```

A byte-identical refetch is a genuinely NEW authoritative read whose every content field compares
EQUAL, so a stale callback captured before it was silently RE-AUTHORIZED and could build a payload.
`dataUpdateCount` is the load-bearing field: it is monotonic and cannot collide. `dataUpdatedAt` is
bound as well, but is only millisecond-resolution and is deliberately NOT relied on alone - two
fetches settling inside one millisecond would produce the same value and reopen the window.

**B9DD-CRR-002 - selection handler pre-commit window.** `handleSelectReceipt` previously only called
`setSelectedReceiptId(receipt.id)`, with a comment asserting "the effect clears it before any new data
arrives". The effect does not run until React COMMITS. Until then the verifier closure still addressed
receipt A, A's cache entry was still success/idle with matching content AND generation, and `boundRef`
still held A - so A's callbacks stayed authorized inside the very event that was meant to replace
them. Note this window is NOT closed by CRR-001's generation token: A's generation had not changed.
Only synchronous revocation closes it.

**B9DD-CRR-003 - returned accumulator assignments.** `return (sum += row.outstanding)` and
`return (sum = sum + row.outstanding)` are assignment EXPRESSIONS; the visitor tested returns with a
top-level-`+` rule, and an assignment is not a `+`. Both sat squarely inside the documented
callback-local accumulator-update scope. Fixed with ONE helper,
`expressionMutatesAccumulatorWithProtectedValue`, applied to statement, return and initializer
positions alike (Section 4.3).

**Efficacy proved by mutation, not assertion.** Each fix was reverted in place:

| Mutant | Tests failed |
| --- | --- |
| Query-generation comparison removed from `bindingsMatch` | **1** (the CRR-001 window test, precisely) |
| Synchronous revocation removed from the selection handler | **3** (all CRR-002 tests) |
| Returned-assignment detection disabled | **12** |
| Accumulator identity ignored in the mutation helper (induces false positives) | **2** (the false-positive controls) |

All mutants reverted; the suite returns to the full count in Section 4.

### 3.10 Allocation authority: SAFETY and LIVENESS (HISTORICAL - SUPERSEDED BY 3.12) + B9DD-FRR-001/002

> **Historical remediation record only.** The final current lifecycle, including same-object reset,
> is in Section 3.12. QueryCache delivery is synchronous, but React notification/commit is not.

Section 3.9 described the safety model at that historical gate. What it did not
separate is LIVENESS - whether React ever notices a new authoritative read. B9DD-FRR-001 is that gap,
and the two concerns are now documented apart because they failed independently.

#### 1. Invocation-time SAFETY (unchanged by this gate)

- ONE atomic `getQueryState` read (`readLiveAllocationContract`) returning contract + generation from
  the same snapshot.
- Generation token `{ dataUpdateCount, dataUpdatedAt }`, from the PUBLIC `QueryState` interface.
- `bindingsMatch` compares generation FIRST, then all content identity.
- Default DENY with no verifier.
- `buildPayload()` re-verifies; the page re-verifies again immediately before `mutateAsync`.

#### 2. React rebind LIVENESS (B9DD-FRR-001 - NEW)

- `useAllocationCandidateQueryRevision(receiptId)` subscribes via `useSyncExternalStore` to the PUBLIC
  `queryClient.getQueryCache().subscribe(...)`.
- The snapshot is a PRIMITIVE string
  (`receiptId|status|fetchStatus|dataUpdateCount|dataUpdatedAt|errorUpdateCount`), so `Object.is`
  compares it by value and an unchanged query yields an equal snapshot - no render loop.
- It is derived ONLY from the canonical candidate key, so unrelated QueryCache notifications recompute
  the same string and are semantically no-ops.
- **`dataUpdateCount` is the collision-free successful-generation trigger.** `dataUpdatedAt` remains in
  the revision as defence in depth and diagnostics, but is never the sole trigger.
- No polling, no timers, no forced refetch, no private internals, and structural sharing stays ENABLED
  - the revision observes the generation rather than fighting it.

#### 3. Receipt transition (B9DD-CRR-002, unchanged)

`createReceiptSelectionHandler` revokes authority SYNCHRONOUSLY (a ref write) before scheduling the
new selected ID. No cache check can close that window; only synchronous revocation can.

#### The B9DD-FRR-001 defect, reproduced deterministically

TanStack stamps `dataUpdatedAt: dataUpdatedAt ?? Date.now()` (query-core ~414), so freezing `Date.now`
makes the same-millisecond collision reliable rather than hoped for. Against the previous
`dataUpdatedAt`-only effect:

```text
dataUpdateCount: 1 -> 2      dataUpdatedAtEqual: true     sameDataRef: true
boundGeneration: 1 -> 1      REBOUND: false               linesStillPresent: 1
ACTIONABLE_NOW: false        canSubmit: true
```

Every render-visible input was unchanged - same `data` reference (structural sharing), same
fingerprint, same `dataUpdatedAt` - so the effect never re-ran. The workbench stayed bound to
generation 1 while the cache was on generation 2, and invocation-time authorization then denied every
action **forever**. Worse, the stale `canSubmit` memo still read `true`: the Confirm button rendered
enabled and silently did nothing. **Safety held; liveness did not.** This was a permanently bricked
workbench, not a transient glitch.

After the fix, the same deterministic test reports:

```text
dataUpdateCount: 1 -> 2      dataUpdatedAtEqual: true     sameDataRef: true
boundGeneration: 1 -> 2      REBOUND: true                linesStillPresent: 0
ACTIONABLE_NOW: true
```

Test: `use-allocation-live-verification.test.tsx` - "still rebinds, clears lines and recovers when
dataUpdatedAt cannot change" (freezes `Date.now`, asserts `dataUpdatedAt` byte-equal and
`dataUpdateCount` advanced, then asserts rebind, cleared lines, recovered actionability and no POST).

#### A real consequence for the test suite, recorded rather than glossed

The subscription changed WHEN React commits: it is now notified synchronously by the same cache event
that settles a generation, so React rebinds before an awaiting test can observe anything in between.
B9DD-FCR-003 correction: no single mechanism provides the complete invariant, and the earlier
"closed at source by the subscription alone" phrasing is withdrawn. Four distinct things carry it:
(a) live invocation-time comparison protects financial actions - this is the only load-bearing
security boundary; (b) `useSyncExternalStore` over the public QueryCache subscription makes revision
changes observable; (c) the layout effect performs pre-paint bind/cleanup; (d) binding-session
identity stops old callbacks reviving. With those in place the "settled generation but not yet
rebound" window is not reachable in a way a test can stage rather than merely policed - which is strictly safer, but it also means the integration tests that previously
staged that window can no longer reproduce their own premise, and a test that cannot reproduce its
premise proves nothing.

Those tests were NOT deleted and NOT quietly relaxed. The rule they were probing is now asserted
directly and deterministically in "Generation mismatch denies (direct rule)" - including the exact
same-timestamp case, where every content field is equal and only `dataUpdateCount` differs. The
integration tests now assert what remains genuinely observable end-to-end: the old generation's lines
never survive into the new one. The windows that DO still exist (refetch in flight, failed refetch
with retained data, and the receipt A -> B event-handler window) are unchanged and still tested.

#### Query removal / recreation

A removed query yields a distinct `missing` revision, so authority is revoked at the instant of
removal. A recreated query restarts `dataUpdateCount` at zero and will re-reach the same numeric
values, but nothing stale can match: there is only ever ONE bound binding, and removal revoked it
before recreation. Test: "revokes authority when the query is removed, and rebinds when it is
recreated".

#### Mutation efficacy (mutant reverted; suite returns to 34/34)

| Mutant | Result |
| --- | --- |
| `dataUpdateCount` removed from the revision (leaving `dataUpdatedAt` only) | **1 failure - exactly the deterministic same-timestamp test**, and nothing else: no eventual rebind. |

### 3.11 Allocation authority: five dimensions (HISTORICAL - SUPERSEDED BY 3.12) + B9DD-FDR-001...004

> **Historical remediation record only.** It superseded Sections 3.9/3.10 at that gate, but Section
> 3.12 now supersedes all three. The five-dimension table omits the load-bearing synchronous
> lifecycle-event epoch added for B9DD-FNC-001.

Sections 3.9/3.10 described authority as company-less content + generation. That
was incomplete in two production-reachable ways at that stage.

**No single field is sufficient.** A safe action must prove ALL of:

| # | Dimension | Mechanism | Why it alone is not enough |
| --- | --- | --- | --- |
| 1 | **Tenant** | company id in the canonical key + read from the store at INVOCATION | Content/generation repeat across tenants; the same receipt exists in both |
| 2 | **Query instance** | WeakMap epoch keyed on the public `Query` object | `dataUpdateCount` restarts at 0 on remove/reset/recreate |
| 3 | **Query generation** | `dataUpdateCount` + `dataUpdatedAt` | Monotonic ONLY within one instance |
| 4 | **Contract content** | fingerprint + field identity | Identical content can come from a different tenant/instance |
| 5 | **Binding session** | local monotonic session id, captured per callback | The newest `boundRef` is valid  -  but not the one the callback captured |

`bindingsMatch` compares in exactly that order (tenant, instance, generation,
content), so a later instance or a different tenant fails BEFORE any repeated
value is considered. Session identity is checked by `isActionAuthorized` itself.

#### B9DD-FDR-002  -  company-scoped candidate authority (production-reachable)

Reproduced against the receipt-only key via the REAL `setCompany` path:

```text
currentCompany: COMPANY_B          candidateRequests: 1   (no refetch)
queryKeyUsed: ["allocations","candidates", RCP]           (no tenant)
boundCustomerName: "Company A"     <- A's contract shown UNDER Company B
COMPANY_A_CALLBACK_STILL_AUTHORIZED: true
COMPANY_A_PAYLOAD_NOT_NULL: true   canSubmit: true
```

The header's switcher updates the Zustand store in place and `useApi` starts
sending the new `X-Company-Id` immediately  -  but TanStack does not refetch just
because a queryFn closure changed. Same key, same enabled state, no refetch. The
backend would have rejected the eventual Company-B-header mutation, but frontend
tenant context had ALREADY failed: the user was reading, and could act on,
another company's financial data.

Remediation, three independent mechanisms:

1. **Invocation-time (the security boundary)**  -  `readLiveAllocationContract`
   resolves the current tenant from the store on every action, so a Company-A
   callback denies the instant the store flips, before any render or effect.
2. **Render-time**  -  the receipt selection is stored COMPANY-QUALIFIED and then
   derived, so the new tenant renders unselected in the same render. This also
   removed a pointless Company-B read issued for a receipt the user had never
   chosen in that tenant.
3. **Layout-phase**  -  revokes the bound ref and clears rows/lines/FIFO before
   paint.

The company id is the ACTIVE COMPANY IDENTITY (a UUID), never a display name. It
is a tenant discriminator used to select the correct governed backend contract  -
never itself an authority over money. Company-scoped keys mean Company B is a
different cache entry, so no broad destructive cache clearing is needed and other
tenants' caches are left intact.

#### B9DD-FDR-001  -  Query instance identity

Reproduced against the generation-only design:

```text
q1IsQ2_objectIdentity: false        <- genuinely a different Query object
dataUpdateCount: 1 -> 1             <- SAME
dataUpdatedAtEqual: true            <- SAME (frozen clock)
contentEqualByFingerprint: true     <- SAME
OLD_BINDING_AUTHORIZED_AGAINST_Q2: true
```

Every token repeated, because `dataUpdateCount` is monotonic ONLY WITHIN ONE
Query INSTANCE. A WeakMap keyed on the public `Query` object (from
`QueryCache.find(...)`) assigns a stable runtime epoch: one Query object always
yields the same epoch, a recreated one yields a new epoch, and repeated snapshot
reads allocate nothing. The live reader takes identity, state, contract and
generation from ONE `Query` object, so no read can pair one Query's content with
another's token.

**What the epoch does NOT cover (B9DD-FCR-001).** It distinguishes a DIFFERENT
Query object. It does nothing for `resetQueries()`, which calls `query.reset()`
on the EXISTING object: the object identity - and therefore the epoch - is
unchanged, state resets to pending/count-zero, the observer refetches, and a
byte-identical response can land on exactly the same `dataUpdateCount`,
`dataUpdatedAt` and content. Every token field, epoch included, can repeat.

Safety there comes from the LIFECYCLE, not the token: the reset produces an
observable pending/fetching revision, the layout effect revokes the old binding,
the binding session is cleared, and the final success starts a NEW session the old
callbacks do not belong to. The two cases are now tested separately and
permanently ("gives the recreated Query a different epoch" and "stays fail-closed
when resetQueries reuses the SAME Query object"), and mutation-checked: ignoring
the binding session makes the reset test fail.

**Runtime limits, stated precisely (B9DD-FCR-003).** The epoch lives in a
module-level WeakMap, so it is per JS runtime:

- a full page reload creates a new runtime and remounts state, so bindings and
  epochs are recreated together;
- SSR and the client runtime do not share the WeakMap;
- Fast Refresh / HMR may PRESERVE React hook state while resetting the module -
  in which case epochs are reassigned under surviving component state. That is
  not a case of "HMR discards the bindings": the comparison simply fails and
  denies until the next valid rebind.

The design does not depend on reload/SSR/HMR destroying bindings. Every one of
those paths fails CLOSED (deny, then rebind), never open.

#### Callback binding-session identity

Each `bindVerifiedContract` starts a NEW session; each callback captures the
session of the render that created it. Previously a callback captured under
generation N read the newest mutable `boundRef` and therefore PASSED against N+1
while acting on N's captured `invoices`/`lines`  -  which is how a stale FIFO
closure could repopulate the workbench with the previous generation's rows and
produce a duplicate line for the same invoice.

#### B9DD-FDR-003  -  presentation vs mutation authority

`validation.canSubmit` is a memo over [lines, selectedReceipt, invoices,
isActionAuthorized, session]. When live authority moves without any of those
changing, it does NOT recompute  -  it keeps reporting `true` while invocation-time
authorization already denies. Proven directly (Section: "shows why
validation.canSubmit alone is NOT live authority").

Measured at the DOM: with the rebind in a PASSIVE effect, immediately after a
byte-identical cache advance the page still showed `Confirm Allocation (1)`,
**enabled**, while every action denied  -  an enabled control that silently did
nothing.

Two changes close it:

1. The binding effect is now a **layout** effect, so the rebind and line-clear
   happen BEFORE paint  -  the enabled-but-inert frame is closed at the source
   rather than painted and corrected afterwards.
2. `canSubmitNow = validation.canSubmit && presentationAuthorityValid`, where the
   second term is recomputed from the live query revision; the table is gated on
   it and the Confirm button is handed the authority-aware value.

Presentation is NOT the mutation authority: `handleSubmit` still checks payload,
`canSubmitNow`, the binding session, and one final live verification before
`mutateAsync`. The backend remains the final authority regardless.

#### Mutation efficacy (all mutants reverted; files verified byte-identical)

| Mutant | Result |
| --- | --- |
| Company removed from the canonical key | **2 failures**  -  incl. the decisive mounted-query tenant-switch test |
| Invocation-time company comparison removed | **2 failures** |
| Query-instance epoch ignored | **2 failures** |
| Callback binding-session ignored | **4 failures** |
| Live presentation authority removed from table/Confirm | **NOT CAUGHT  -  see below** |

**The presentation mutant is not caught, and that is reported rather than
papered over.** `act()` flushes render AND passive/layout effects synchronously,
so a test can never observe the pre-rebind frame that the gate exists to cover;
with the layout-phase rebind, that frame no longer paints at all. The gate is
therefore defence in depth whose removal no current automated test can
distinguish. What IS proven: the premise (the `canSubmit` memo goes stale while
live authority denies) at hook level, and that no enabled-and-inert Confirm
survives any reachable transition at page level.

### 3.12 Final allocation lifecycle architecture (CURRENT) + B9DD-FNC-001 ... 003

This is the single authoritative current description. An action is allowed only when all of these
independent identities agree at invocation time:

1. **Current tenant:** the canonical key is
   `['allocations', 'candidates', companyId, receiptId]`, and the live reader gets the active company
   synchronously from the Zustand store.
2. **Query object:** a WeakMap epoch distinguishes remove/recreate with a new public TanStack Query
   object.
3. **Query lifecycle event:** the public QueryCache subscription synchronously advances a monotonic
   per-QueryClient, company/receipt lifecycle epoch for every matching `added`, `removed`, or
   `updated` event. Multiple consumers record the same event object once. Unrelated, observer-only,
   stale-company, and other-receipt events do not advance it.
4. **QueryState generation:** `{ dataUpdateCount, dataUpdatedAt }` distinguishes successful reads
   within an uninterrupted Query lifetime. It is not claimed globally monotonic.
5. **Contract content:** receipt id/version/customer/currency/unallocated amount and candidate
   id/version/outstanding/status must still match.
6. **Local binding session:** every bind creates a new callback session; captured callbacks from an
   older session cannot act through a newer mutable binding.

The QueryCache listener receives events synchronously. It advances the lifecycle epoch before it
passes the React notification through public `notifyManager.batchCalls`. Scheduling prevents a
QueryCache callback from synchronously updating React during another render, but scheduling cannot
erase lifecycle meaning: `getSnapshot()` and the live binding both include the already-advanced
epoch. Invocation-time verification therefore denies immediately while React notification is still
queued. The layout effect subsequently clears/rebinds before paint, and the new bind rolls the local
session.

**Same-object reset:** `resetQueries()` keeps the same Query object and therefore the same WeakMap
epoch. With a frozen clock and byte-identical response, final `dataUpdateCount`, `dataUpdatedAt`, and
content can also repeat. Both permanent schedules are covered:

- held response: pending/fetching is rendered, old authority clears, final success creates a new
  session;
- immediate response: reset and identical success finish before scheduled React notification, but
  the synchronous lifecycle epoch has already advanced, every old callback denies, the delayed
  React commit rolls the session, old lines stay cleared, and the new session works.

The immediate test uses the real QueryClient, candidate hook, public revision subscription, live
reader, allocation logic, exact company-scoped key, same Query object/epoch, frozen time, repeated
final QueryState/content, and captured add/remove/amount/discount/fill/FIFO/payload callbacks. It also
asserts no mutation POST. Direct subscription tests prove relevant-event counting across two
subscribers, unrelated/stale-company filtering, and unsubscribe behavior.

**Fast Refresh:** it may preserve React hook state while module-level WeakMaps/counters are recreated.
Safety does not depend on HMR destroying bindings. Any company/query/lifecycle/generation/content or
session mismatch denies until the next governed rebind.

**Presentation versus security:** the layout rebind is pre-paint presentation cleanup;
`presentationAuthorityValid` and `canSubmitNow` are defence in depth. Invocation-time live
verification in each action, payload construction, and immediately before `mutateAsync` remains the
financial security boundary. The backend mutation remains final authority.

**React warnings:** Testing Library 16.3.2 already installs the React act-environment boundary and
automatic cleanup when its React entry point is imported. The redundant explicit global flag and
duplicate cleanup were removed from `vitest.setup.ts`. Warning removal is attributable to correct
`act`/`waitFor` boundaries, removal of invalid lifecycle probes, and safely scheduled
QueryCache-to-React notification. Console output is not suppressed.

## 4. Validation performed IN THIS GATE

> Actual commands and actual results. Nothing below is claimed from a previous run.

| Command | Exit | Result |
| --- | --- | --- |
| `npm test -- --run` | 0 | **28 files, 530 tests passed, 0 failed, 0 skipped** |
| `npx --no-install vitest run` | 0 | Same suite - 530 passed, 0 skipped |
| `npx --no-install vitest run --reporter=verbose` | 0 | Same 530; **0** occurrences of all six React warning patterns (Section 4.11) |
| `npx --no-install tsc --noEmit` | 0 | PASS |
| `npm run lint` | 0 | **[OK] No ESLint warnings or errors** (a real, non-interactive PASS) |
| `npm run build` | 0 | PASS - **26 application routes** compiled (27 build rows incl. `/_not-found`), including `/customers/[id]/statement` |
| `npm audit --json` | 1 | 3 moderate, **0 high, 0 critical** (see Section 4.2) |
| `npm audit --omit=dev --json` | 1 | 2 moderate, **0 high, 0 critical** (production) |
| `git diff --check` | 0 | No whitespace errors (only pre-existing LF->CRLF notices) |

Test file breakdown (28 files / 530 tests, verified by the complete Vitest run):

```text
lib/monetary-guard.test.ts                166   AST guard: templates + JSX + bounded dataflow
hooks/use-allocations.test.tsx             56   Governed candidate contract + CDR-001 legacy currency
hooks/use-allocation-live-verification.test.tsx  51   CDR/CRR/FRR/FDR/FCR + FNC immediate reset/event subscription
app/(dashboard)/customers/customers.test.tsx  34   RR-002 + FR-001 + FR-005 (CLOSED)
app/(dashboard)/allocations/allocations.test.tsx  26   D1..D10 + refetch + FDR-003 presentation
lib/import-governance.test.ts              15   RR-005
app/(dashboard)/ocr-import.test.tsx        14   FR-003 (CLOSED)
components/features/allocations/allocation-table.test.tsx  14   RR-004
components/features/imports/import-governance-cell.test.tsx  13   RR-005
components/features/reports/statement-view.test.tsx  12   FEIR-003
lib/fx-rate-display.test.ts                12   FEIR-007
app/(dashboard)/detail-pages.test.tsx      11   RR-006
lib/currency.test.ts                       11   FEIR-006
app/(dashboard)/pages.test.tsx             10   FEIR-010
app/(dashboard)/reports/aging/page.test.tsx  10   RR-001 (CLOSED)
hooks/use-seed-base-currency.test.tsx       9   RR-003 (CLOSED)
components/allocation-history-table.test.tsx   7   FEIR-004
components/ui/money-cell.test.tsx           7   FEIR-006
hooks/use-invoices.test.tsx                 7   FEIR-001
app/(dashboard)/import-pages.test.tsx       6   RR-005 (CSV/XLSX)
components/features/receipts/receipt-summary-bar.test.tsx   6   RR-003
hooks/use-api.test.tsx                      6   API client
hooks/use-f2-data.test.tsx                  5   FEIR-002
hooks/use-receipts.test.tsx                 5   FEIR-005
lib/fx-presentation.test.ts                 5   FEIR-007
app/(dashboard)/allocations/allocation-company-isolation.test.tsx  5   FDR-002 tenant isolation (NEW)
app/(dashboard)/dashboard.test.tsx          4   RR-006
components/ui/money-summary.test.tsx        3   FEIR-006
--------------------------------------------
TOTAL                                     530   28 files, 0 failed, 0 skipped
```

Current FNC delta: **+4 tests** (526 -> 530), file count unchanged at 28: the load-bearing
immediate-response same-object reset regression plus relevant-event counting across two subscribers,
unrelated/stale-company filtering, and unsubscribe coverage. The held reset regression remains.

Historical FCR delta: **+2 tests** (524 -> 526), file count unchanged at 28: the permanent
same-Query-object `resetQueries` regression (B9DD-FCR-001) and the direct
revoke-before-schedule ordering assertion that replaced an un-acted lifecycle test
(B9DD-FCR-002).

Delta from the gate before that: **+21 tests** (503 -> 524) and **+1 file** (27 -> 28).
`allocation-company-isolation.test.tsx` is NEW (5, FDR-002);
`use-allocation-live-verification.test.tsx` 34 -> 45 (FDR-001 epoch, binding
sessions, direct tenant/instance rule tests); `allocations.test.tsx` 21 -> 26
(FDR-003 rendered-control tests).

Delta from the previous gate: **+8 tests** (495 -> 503), file count unchanged at 27. All eight are in
`use-allocation-live-verification.test.tsx` (26 -> 34): the deterministic same-timestamp FRR-001
reproduction, the no-rebind-loop check, the unrelated-QueryCache-activity control, query
removal/recreation, and four direct generation-mismatch rule tests.

Delta from the previous gate: **+20 tests** (475 -> 495), file count unchanged at 27.
`monetary-guard.test.ts` 151 -> 166 (CRR-003 returned assignments, false-positive controls, and the
no-weakening regression); `use-allocation-live-verification.test.tsx` 21 -> 26 (CRR-001 identical-
content generation window; CRR-002 synchronous revocation).

Delta from the previous gate: **+67 tests** (408 -> 475) and **+1 file** (26 -> 27).
`monetary-guard.test.ts` 123 -> 151 (bounded dataflow + JSX text); `use-allocations.test.tsx`
42 -> 56 (CDR-001 legacy currency reads); `allocations.test.tsx` 17 -> 21 (genuine background
refetch at page level); `use-allocation-live-verification.test.tsx` is NEW (21, CDR-002).

`use-allocations.test.tsx` 11 -> 23 (DR-001), `monetary-guard.test.ts` 60 -> 79 (DR-002),
`allocations.test.tsx` 5 -> 8 (DR-001 instability UX).

Delta from the previous gate: **+2 files, +62 tests** (24/240 -> 26/302). `import-pages.test.tsx`
went 7 -> 6 because the fictional "OCR" test was REMOVED (see Section 3.5, FR-003).

`npm audit` exits 1 whenever any advisory exists; the exit code is not a failure of this gate's
acceptance criteria, which concern critical/high advisories in the newly added test stack.

### 4.1 Lint status - corrected claim

The previous evidence stated `next build` produced a clean lint. That claim is **withdrawn**: the
repository had `eslint` and `eslint-config-next` as devDependencies but **no configuration file**, so
`next lint` prompted interactively and could never pass. A flat `eslint.config.mjs` now exists and
`npm run lint` genuinely exits 0. Configuring it exposed **39 real errors** (19 `no-explicit-any`,
17 `no-unused-vars`, 3 `no-unescaped-entities`) - all fixed, none suppressed. No rule category was
broadly disabled; the only relaxations are an `^_` ignore pattern for intentionally-unused args and
`no-explicit-any` off **in test files only**.

### 4.2 Dependency audit - introduced vs pre-existing

| Advisory | Severity | Scope | Introduced by this batch? |
| --- | --- | --- | --- |
| `next` -> `postcss` | moderate | **production** | **No - pre-existing.** `next@15.5.19` is unchanged from the committed baseline. |
| `postcss` | moderate | **production** | **No - pre-existing** (transitive via `next`). |
| `js-yaml` (via `eslint` -> `@eslint/eslintrc`) | moderate | dev | **No - pre-existing.** `eslint@^9` was already a baseline devDependency (`git show HEAD:frontend/package.json`). |

Newly added test stack - **acceptance met**:

```text
vitest  2.1.9  -> 4.1.10  (was: CRITICAL advisory, direct)
vite  5.x  -> 8.1.4  (was: HIGH advisory, transitive)
@vitejs/plugin-react  4.7.0  -> 6.0.3
jsdom  25.0.1 -> 29.1.1
@testing-library/react  16.3.2
@testing-library/jest-dom  6.9.1
@testing-library/user-event  14.6.1  (added)

critical: 0  high: 0  unresolved vulnerable direct test dependency: none
next: 15.5.19 (UNCHANGED - not downgraded to npm's invalid 9.3.3 suggestion)
```

`npm audit fix` was **not** run. The lockfile was regenerated through npm from the committed baseline
lock so the diff reflects only the intended dependency change.

### 4.3 Static audits (this gate)

Enforced as executable tests in `src/lib/monetary-guard.test.ts` (**151 checks**; 13 -> 43 -> 60 ->
79 -> 123 -> 151).

**The bounded AST dataflow analysis (B9DD-CDR-003), stated with its limits.**

The policy is explicit: a non-allow-listed `.reduce(...)` or `.reduceRight(...)` callback must not
arithmetically aggregate a protected monetary field across rows. The protected set is unchanged -
`outstanding`, `total_amount`, `receipt_amount`, `allocated_amount`, `base_total`, `amount` - and the
reviewed file allow-list (`lib/currency.ts`, `lib/invoice-calculator.ts`, `hooks/use-allocation-logic.ts`,
`hooks/use-receipts.ts`) is preserved exactly.

What the visitor analyses:

- **Callback parameter binding** - identifier rows, object destructuring (`(sum, { outstanding })`),
  aliased destructuring (`{ outstanding: value }`), typed destructuring, and any multi-line
  formatting of them.
- **Protected-value expressions** - direct/optional property access, element and optional-element
  access, parentheses, `as` and angle-bracket assertions, `!`, `satisfies`, `Number(...)`,
  `parseFloat(...)`, unary `+`, `??`, `||`, `&&`, conditional expressions, arithmetic, and any
  nesting of these.
- **Callback-local taint** - `const v = row.outstanding`, `let v; v = row?.outstanding ?? 0`,
  `const { outstanding } = row`, `const { outstanding: v } = row`.
- **Accumulator updates** - concise return, block return, `sum += x`, `sum = sum + x`, intermediate
  accumulators (`const next = sum + x; return next`), across multiple statements and `if` branches.
- **RETURNED accumulator assignments** (B9DD-CRR-003) - `return (sum += x)`,
  `return (sum = sum + x)`, `return (sum = x + sum)`, through assertions (`as number`) and
  `Number(...)` wrappers, for accumulator ALIASES (`const acc = sum; return (acc += x)`), inside `if`
  branches and nested blocks, after an early return, in function-expression reducers, and via
  `reduceRight`. One helper (`expressionMutatesAccumulatorWithProtectedValue`) serves the statement,
  return and initializer positions, so those forms cannot drift apart.
- **Laundering through a local** - a protected value assigned to any callback-local (by `=` or `+=`)
  taints that local, so folding it in later is still caught. This is why the accumulator-identity rule
  did not weaken the guard.
- **Both fold directions** - `reduce` and `reduceRight`, matched by exact method name so unrelated
  methods are not misclassified.

What it explicitly does **NOT** do, and this is a boundary rather than an oversight:

- **No whole-program or interprocedural analysis.** Analysis stops at the single reducer callback.
  A value laundered through an external helper (`sum + toNumber(row)`) is **not** detected. This is
  asserted as a test so the limit is visible in review and cannot be quietly overclaimed later.
- **Nested function bodies are not attributed to the outer reducer**, so a protected read inside an
  unrelated inner callback is not a false positive.

What it does **NOT** flag, deliberately (B9DD-CRR-003 Section 3.4): a write whose left-hand side is
not the accumulator (`row.count += 1`, `row.outstanding += 1`, `acc[row.currency] = ...`); accumulator
mutation with a non-protected field (`sum += row.quantity`); and a protected value assigned to a local
that never reaches the accumulator. Policy and documentation are aligned here: the guard prohibits
protected AGGREGATION, not all accumulator mutation.

So this is a strong barrier against the realistic accidental case, **not** a proof of absence
against a determined author. Mutation results for this visitor are in Sections 3.8 and 3.9.

**What is AST and what is not - stated precisely.** The guard is NOT uniformly a set of AST
visitors, and this document does not claim it is. Three distinct mechanisms are in use:

| Mechanism | Categories |
| --- | --- |
| **AST structural visitors** | the MYR static-text check (`staticStringText` over StringLiteral, NoSubstitutionTemplateLiteral, TemplateHead, TemplateMiddle, TemplateTail **and JsxText**); the bounded monetary-reduction dataflow analysis (`monetaryReduceCallbacks`); the parse-diagnostics gate |
| **Parser-aware normalized text** (TypeScript parser strips comments; patterns then match the remaining real code) | MYR initializer / assignment / default parameter / runtime fallback / parity comparison; hard-coded base labels; fake `useAll*` hooks; page sizes above the backend maximum; forced `totalPages = 1`; false-zero exposure maps; first-row currency assumptions; impossible import-origin literals; `mapped_data.source` origin inference; unjustified `formatAmount`; latest-rate fetches; direct Supabase mutation; `/allocations/auto`; `as any` around monetary responses |
| **Raw source scans** (comments included, deliberately) | secrets; mojibake; conflict markers - and ONLY these |

The second row is not a regex over hand-stripped text: comments and regex literals are resolved by
the real parser first, so the known bypasses are closed. Migrating those categories to full AST
visitors would be a further improvement and is recorded as a limitation, not claimed as done.

**Scanner architecture (B9DD-DR-002).** Monetary policy checks run against source whose comments were
removed by the **TypeScript parser** - not by a hand-rolled scanner. `typescript` 5.9 is already a
devDependency, so no new parser dependency was added.

Why a parser and not a lexer or a regex: deciding whether `/` starts a division or a regex literal is
context-dependent and cannot be settled by scanning characters. A regex may legally contain raw
comment delimiters - `/[//]/`, `/[/*]/` - and the previous hand-rolled stripper misread the second as
an unterminated block comment and **deleted the rest of the file**, so any violation after it left the
scan and the guard passed. Reproduced against the committed code:

```text
in  : const r = /[/*]/;\nconst value = { currency: "MYR" };
out : const r = /[
```

Under the parser, comments are trivia identified with full grammatical context, and a regex literal is
a single `RegularExpressionLiteral` token that can never open a comment.

Implementation notes:

- `ts.createSourceFile(..., setParentNodes = true, ScriptKind.TS | ScriptKind.TSX)` - `.tsx` is parsed
  as TSX, `.ts` as TS; the wrong variant yields wrong tokens.
- Comment ranges are collected by walking `getChildren()` (which, unlike `forEachChild`, includes
  punctuation tokens, so `foo(a /* c */)` is covered) and taking leading + trailing comment ranges at
  every node. JSX text is skipped: `<p>https://x</p>` is CONTENT, and asking for trivia at its start
  would misread the `//`.
- Comment bytes are **blanked to spaces, not deleted**. Every other byte keeps its original offset, so
  real code is untouched and adjacency such as `rows.reduce((` survives exactly - which the patterns
  depend on. Blanking also stops `a/*x*/b` fusing into the identifier `ab`.
- Strings, templates and regex bodies are deliberately preserved: `const c = "MYR"` is a real runtime
  value and must stay visible.
- The catch-all MYR check is a genuine **AST walk** over string/template literal VALUES, so it
  distinguishes a literal from a comment, from JSX text and from a regex body structurally.
- A **parse-diagnostics gate** fails the guard on any production file the parser cannot make sense of,
  rather than scanning it as a soup of tokens.
- `/g` and `/y` patterns are rejected outright, so no `lastIndex` state leaks between files.
- Encoding, secret and conflict-marker checks scan the **RAW** file, comments included, because a
  mojibake'd or key-bearing comment is still a defect.
- Tests, the harness, `node_modules` and `.next` remain excluded; Windows and POSIX separators both
  resolve through `path.join`/`path.sep`; the MYR allow-list remains `lib/currency.ts` only.

No guard category, allow-list or check was weakened to make the parser migration easier.

A **guard-efficacy suite** asserts each pattern matches the real pre-remediation source line and does
not match legitimate code. A **scanner robustness suite** covers multiline initializers, parity
comparisons, fallbacks, reduces, base labels and false-zero reads, inline block comments between
tokens, and comment-documented patterns. A **regex-literal suite** (B9DD-DR-002) covers forbidden code
after `/[//]/`, `/[/*]/`, escaped-slash and URL regexes - on the same line and far later in the file -
plus a compliant regex-bearing file that must stay clean. All three call the same production scanner.

Also run: `npm ls --depth=0 --package-lock-only` - clean (Section 4.6).

| Check | Result |
| --- | --- |
| `?? "MYR"` / `\|\| "MYR"` runtime fallback | none |
| Default-MYR parameter in any signature | none |
| `currency === "MYR"` parity branch | none (outside the currency-policy module) |
| `formatCurrency` exported / imported | none (removed) |
| Fake "all rows" page size (>100) | none - **this check caught 3 real survivors** during remediation (`use-allocations.ts` x2, `use-receipts.ts`), now fixed |
| `totalPages = 1` | none |
| Cross-currency `reduce` over money | none |
| First-row currency assumption (`[0]?.currency`) | none |
| Current/latest FX lookup while rendering | none |
| Direct Supabase financial mutation / `rpc` from frontend | none |
| `POST /allocations/auto` | still disabled; not reintroduced |
| `as any` around monetary/report responses | none |
| Conflict markers / mojibake | none |
| Secret-like literals | none |
| `currency: "MYR"` form/schema initializer (**RR-003**) | none |
| `currency = "MYR"` assignment default (**RR-003**) | none |
| `watchCurrency ===`/`!== "MYR"` parity (**RR-003**) | none (case-insensitive check) |
| `Base Currency (MYR)` / `Base Total (MYR)` label (**RR-003**) | none |
| ANY `"MYR"` literal outside `lib/currency.ts` (**RR-003**) | none (catch-all backstop) |
| First-page-only `useAll*` hook presented as complete (**RR-002**) | none (`useAllCustomers` deleted) |
| False-zero exposure map read (`...Map.get(...) ?? 0`) (**RR-002**) | none |
| Impossible `"csv_xlsx_import"` mapped_data source (**RR-005**) | none (outside the origin module) |
| Origin read from `mapped_data.source` (**RR-005**) | none (outside the origin module) |
| Codeless monetary `formatAmount` (**RR-003/RR-004**) | none - a reviewed allow-list names the only 4 files that may use it, each with its currency context asserted |

---

### 4.4 Claims WITHDRAWN from the previous version of this document (B9DD-RR-007)

Each statement below appeared in the previous evidence and was **not true**. It is withdrawn here
rather than quietly edited away.

| Previous claim | Why it was wrong | Where it is now honest |
| --- | --- | --- |
| "The frontend has now been through **TWO** independent Codex reviews:" followed by an enumeration of **five** stages (B9DD-CDR-004 Section 6.1). | Self-contradictory on its own page: the count did not match the list beneath it. The numeric summary is removed rather than corrected to "five", because the count was never the point and a number is exactly the kind of thing that goes stale at the next gate. | Section 1 header - "multiple implementation, independent review, and remediation cycles". |
| "No backend source, migration, or environment/deployment configuration was modified." (B9DD-CDR-004 Section 6.5) | True of the frontend-only gates; **false** for the consolidated delta. Phase A modified two backend files, added a backend contract test, and added Migration 030. Carrying the old sentence forward made the document deny the very work it was documenting. | Section 6 - per-phase breakdown. |
| The claim that lines "are cleared on EVERY authoritative read", as supported by the D1-D10 tests (B9DD-CDR-004 Section 6.2). | The RULE was right; the EVIDENCE did not establish it. Those tests deselect and reselect a receipt, which unmounts one query and mounts another - never the same-query background refetch that actually breaks. Worse, the rule was not even true: structural sharing reuses the `data` reference on an identical refetch, so the rebind effect did not re-run. Found by writing a genuine refetch test, not by review. | Section 3.8; `use-allocation-live-verification.test.tsx`; `dataUpdatedAt` in the rebind trigger. |
| That a render-time `isContractVerified` boolean made every action fail-closed (B9DD-CDR-002). | A render-time value is captured by every `useCallback` and can be stale by the time the callback runs. This is not theoretical: `use-allocation-live-verification.test.tsx` asserts the exact window - the cache reports `fetchStatus: "fetching"` while the last committed render still reports `isFetching: false` and `isVerified: true`. | Section 3.8; `useLiveAllocationContract`. |
| That the candidate parser's currency rule was correct because it rejected unsupported codes (B9DD-CDR-001). | It applied the six-code NEW-WRITE list to an existing-document READ contract, making the client stricter than the backend it validates. A legacy JPY receipt would have been refused as an "unverifiable contract". A test fixture (`XYZ`) asserted this behaviour, so the defect was pinned in place by its own test. | Section 3.8; `readCurrencyCode`. |
| That the Query-object epoch covers all remove/reset/recreate cases (B9DD-FCR-001). | **Retracted.** It covers removal + a NEW Query object. `resetQueries()` calls `query.reset()` on the SAME object: identity and epoch are unchanged, and a byte-identical refetch can land on the same count, timestamp and content - every token field repeats. Safety there is the reset/pending revision + layout revocation + binding-session rollover, now tested separately and mutation-checked. | Section 3.11; "stays fail-closed when resetQueries reuses the SAME Query object". |
| That reload/SSR/HMR "discard the bindings too" (B9DD-FCR-003). | **Retracted.** Fast Refresh may PRESERVE React hook state while resetting the module-level WeakMap, so epochs are reassigned under surviving state. That is not the bindings being discarded - it is a mismatch, which denies until a valid rebind. The design must not depend on HMR destroying anything. | Section 3.11 runtime limits. |
| That displayed rows have a real one-render lag behind authority (B9DD-FCR-003). | **Retracted.** The bind/cleanup moved to a LAYOUT effect: it lands after commit but before paint, so no frame shows the previous receipt's rows as actionable. | Limitation 19. |
| That these lifecycle suites were warning-free (B9DD-FCR-002). | **Retracted - the check itself was broken.** It read the DEFAULT reporter (which hides React's console.error) and its "Cannot update a component..." pattern was a literal substring that React's interpolated component name could never match. Verbose + corrected regex showed 39 + 23 + 3 real warnings. | Section 4.11 (all six patterns now 0). |
| That `dataUpdateCount` is a globally collision-free generation (B9DD-FDR-001). | **Retracted.** It is monotonic ONLY WITHIN ONE Query INSTANCE and restarts at zero on remove/reset/recreate. Reproduced: `dataUpdateCount: 1 -> 1`, same timestamp, same content, different Query object - and the old binding authorized against the new one. Instance identity, not the counter, is what distinguishes them. | Section 3.11; `queryInstanceEpoch`. |
| That allocation authority was fully bound once tenant-less content + generation matched (B9DD-FDR-002). | **Retracted, and this was production-reachable.** The candidate key had no company. Switching tenant via the real `setCompany` left Company A's contract cached, displayed and locally actionable under Company B (`candidateRequests: 1`, `boundCustomerName: "Company A"`, `canSubmit: true`). The backend would have rejected the eventual mutation, but frontend tenant context had already failed. | Section 3.11; company-scoped key. |
| That old callbacks are dead because DOM handlers usually rewire on commit (B9DD-FDR old-callback hardening). | **Retracted as a safety argument.** "Usually rewire" is not a guarantee, and a retained callback read the newest `boundRef` and PASSED against a later binding while acting on its own captured `invoices`/`lines`. Old callbacks are now denied by explicit binding-SESSION identity, not by hoping the handler was replaced. | Section 3.11. |
| That a transient `missing` revision proved removal/recreation safety (B9DD-FDR-001). | It proved only that removal is observable. It did NOT prove that a RECREATED query with repeated count/timestamp/content cannot match an old binding - which was the actual risk, and which only the instance epoch closes. | Section 3.11. |
| That `validation.canSubmit` reflects live authority (B9DD-FDR-003). | **Retracted.** It is a memo; when live authority moves without its dependencies changing it stays `true`. Measured at the DOM: after a byte-identical cache advance the page showed an ENABLED "Confirm Allocation (1)" while every action denied. | Section 3.11; `canSubmitNow` + layout-phase rebind. |
| That the same-timestamp window is "closed at source" by the revision subscription alone (B9DD-FDR-003). | Overstated. The revision closes the LIVENESS gap (the rebind fires), but the rebind ran in a PASSIVE effect, so an enabled-but-inert frame still painted. It is closed by revision observation PLUS the layout-phase rebind PLUS the presentation gate. | Section 3.11. |
| That a QueryCache notification means React has already committed (B9DD-FDR-003). | It means the CACHE moved. React's commit is a separate event, and passive effects run after paint - which is exactly where the enabled-but-inert frame lived. | Section 3.11. |
| That `dataUpdatedAt` in the effect dependencies "defeats structural sharing", and that it made "every authoritative read rebind" (B9DD-FRR-001). | **False, and retracted.** `dataUpdatedAt` is a MILLISECOND timestamp. Two successful byte-identical reads completing in the same millisecond leave it unchanged, so the rebind never ran: `dataUpdateCount: 1 -> 2` while `boundGeneration` stayed 1, lines were retained, and every action was denied FOREVER while `canSubmit` still rendered `true`. The fix identified the right problem (structural sharing) and picked a field that could not solve it. | Section 3.10; `useAllocationCandidateQueryRevision`. |
| That timestamp collision was an authorization concern only, adequately covered by binding `dataUpdateCount` in the generation token (B9DD-FRR-001). | It was ALSO a lifecycle concern, and there it was worse: authorization merely denied, but the rebind never fired, so denial became permanent. Binding the counter fixed SAFETY while leaving LIVENESS broken - the two are now documented separately because they failed separately. | Section 3.10. |
| That all CRR findings were closed (B9DD-FRR-001). | CRR-001's safety half was closed; its liveness half was not, and was not tested. The claim is now made only against the deterministic same-timestamp test that actually exercises it. | Section 3.10. |
| That the live verifier made stale callbacks unable to act during background-refetch transitions generally (B9DD-CRR-001/002). | **Overstated, and retracted.** Two windows remained open, both reproduced: (a) a BYTE-IDENTICAL refetch settles a new generation whose content compares EQUAL, so the content-only binding re-authorized stale callbacks before React rebound (`STALE_AUTHORIZED: true`, `STALE_PAYLOAD_NOT_NULL: true`); (b) the receipt A -> B handler scheduled state without revoking, so A's callbacks stayed authorized inside the selection event. The claim is now made only per-window, each naming its test. | Section 3.9 window table. |
| That the reduce guard covered the documented callback-local accumulator-update scope (B9DD-CRR-003). | `return (sum += row.outstanding)` and `return (sum = sum + row.outstanding)` were inside that scope and were NOT detected - 12 forms reproduced as missed. | Section 3.9; Section 4.3. |
| Section 4.8's "only mutable offset pagination exists", "this gate is not authorized to add or modify a backend endpoint", and the backend fix "recorded here for a future batch, NOT actioned" (B9DD-CRR-004). | Active present-tense text asserting a world Phase A had already replaced. The recommendation WAS actioned - it is Migration 030 - so the section denied the very delta the document exists to evidence. | Section 4.8.1 (labelled historical) + Section 4.8.2 (current). |
| The monetary reduce guard "covers them all by unwrapping to the access itself" (B9DD-CDR-003). | Overstated. It covered the access SPELLINGS, but missed nullish/logical fallbacks, destructuring, aliasing, callback-local variables, accumulator assignment, `reduceRight`, and JSX static text - 14 forms, each reproduced as MISSED against the previous visitor before being fixed. | Section 4.3; Section 3.8. |
| "All 13 findings resolved." | Seven areas were incomplete; the re-review returned B9DD-RR-001 ... B9DD-RR-007. | Status block; PARTIAL rows in Section 3.2; Section 3.4 |
| Aging/Outstanding "page their row tables". | The Aging customer table fetched ONE default page (<=100 rows) with no pagination controls at all. | Section 3.4 RR-001 |
| Customer Management data was complete. | `useAllCustomers` fetched page 1 only; a customer beyond it showed a FALSE ZERO exposure, and Customer detail could show a FALSE "Customer not found". | Section 3.4 RR-002 |
| "No runtime MYR path remains." | `currency: "MYR"` survived in BOTH form-schema defaults; `watchCurrency !== "MYR"`, `Base Currency (MYR)` and `Base Total (MYR)` survived in the preview paths. | Section 3.4 RR-003 |
| Import review surfaced "origin". | The origin was read from `mapped_data.source` (`csv_xlsx_import`/`ocr`) - values production never writes there. | Section 3.4 RR-005 |
| "Mandatory integration testing complete." | Dashboard, Invoice/Receipt detail, Receipt report, Customer list/detail, the Statement ROUTE and both import pages had no tests. | Section 3.4 RR-006 |
| The static guard covered the monetary rules. | It missed every pattern that actually survived (see RR-003/RR-005), and some tests asserted against impossible fixtures. | Section 3.4 RR-006 |
| "15 files, 124 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "24 files, 240 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "26 files, 302 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "26 files, 336 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "26 files, 408 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "27 files, 475 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "27 files, 495 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "27 files, 503 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "28 files, 524 tests." | Superseded. | Section 4 (28 files, 530 tests) |
| "28 files, 526 tests." | Superseded by the FNC closure implementation. | Section 4 (28 files, 530 tests) |
| The DR gate's allocation scan "succeeds only when it can prove it saw the whole collection". | **Overstated, and retracted.** The invariants DETECT instability; they cannot PROVE coverage over a mutable OFFSET window, because a row shifted out of an already-read window appears on no page. The scan is now DELETED in favour of the governed snapshot contract. | Section 3.7 |
| The DR gate's "the candidate list FAILS VISIBLY rather than degrading" (as a complete claim). | True of the hook, but the page still had a stale-state hole: allocation state was synced only when the candidate array was non-empty, so a verified-empty/failed/malformed later read left the prior receipt's candidates and lines actionable. | Section 3.7 |
| The DR gate's monetary guard "no category weakened... 79 checks" (as sufficient). | The parser-backed comment/regex handling was sound and is retained, but the literal visitor missed interpolated template segments and the monetary-reduce rule was still a regex matching one access spelling out of seven. | Section 3.7 |
| The FR gate's **"regex literals... fails toward scanning MORE than necessary, never less - the safe direction for a guard"**. | **Flatly wrong, and retracted.** A regex containing `/*` made the hand-rolled stripper delete the rest of the file, so the guard scanned LESS and passed a real violation. It was a false-negative risk, not an over-scan. | Section 3.6 DR-002; Section 4.3 |
| The FR gate's allocation scan "de-duplicates by invoice ID and measures completion in UNIQUE invoices... every exit is either authoritative exhaustion or an explicit throw". | De-duplication was necessary but NOT sufficient. The scan overwrote the total each page and accepted short/empty pages, so a shrinking collection returned "success" while skipping invoices that appeared on no page. | Section 3.6 DR-001; Section 5 item 7 |
| The FR gate's "the allocation candidate list FAILS VISIBLY rather than degrading". | It failed in the HOOK, but `allocations/page.tsx` discarded the error and rendered "No outstanding invoices for this customer" - so the user saw a confident empty list, not a failure. | Section 3.6 DR-001 (UX) |
| The RR gate's "Mandatory integration testing complete" / OCR coverage. | The OCR page test never entered OCR mode: it mocked `useImport`, stayed in CSV mode and injected a PDF batch into CSV state. The production `OcrImportFlow` rendered no governance at all. | Section 3.5, FR-003 |
| The RR gate's "guard is demonstrably able to fail". | True of its CASES, but the SCANNER was line-oriented: `currency:\n  "MYR"` bypassed every pattern. | Section 3.5, FR-004; Section 4.3 |
| The RR gate's allocation "scans to exhaustion". | It scanned raw rows and could terminate EARLY on overlapping pages, omitting real candidates. | Section 3.5, FR-002 |
| "no test injects an impossible source" (RR-005 row). | Withdrawn as stated. Adversarial NEGATIVE fixtures now deliberately pass `csv_xlsx_import` and `ocr` to prove they are IGNORED - see Section 4.7. No production-shaped fixture uses them. | Section 4.7 |

**Not withdrawn, and still true:** the backend/staging record in Section 2 (not re-run, not
reopened); the lint correction in Section 4.1; the dependency classification in Section 4.2; and the
`v_customer_credit_utilization` limitation in Section 5.

### 4.5 Mojibake (B9DD-RR-007)

Both documents are and were **valid UTF-8** - `git diff --check` reports no encoding errors. The real
risk is that certain code points render as mojibake in a cp1252/latin-1 viewer, which is a live
concern on this Windows repository and is how the review observed them.

Remediation, and its deliberate limit:

- **This evidence document** is authored entirely by this batch, so it was converted to **pure ASCII**
  (em/en dashes, arrows, ellipses, multiplication signs, section signs, middle dots, check/warning
  marks). Verified: zero code points above U+007F remain.
- **The plan document's** non-ASCII typography is overwhelmingly **pre-existing committed content**
  from earlier, closed batches - at `HEAD` it holds 92 arrows, 91 em dashes and 49 section signs.
  Rewriting those lines would rewrite historical content, which this gate forbids. Only the lines
  **this gate authors** were converted (16 lines); **933 committed lines are preserved
  byte-identical**. Verified: the lines this gate adds contain **no** characters above U+007F.

No source file contains mojibake, conflict markers or replacement characters - enforced as an
executable check in `monetary-guard.test.ts`, not asserted by review.

### 4.6 Local package state (B9DD-RR-008 - INFORMATIONAL ONLY)

```text
npm ls --depth=0 --package-lock-only   -> exit 0, clean (no extraneous, no invalid)
npm ls --depth=0                       -> exit 0, reports 4 extraneous packages in the
                                          PHYSICAL local node_modules:
                                            @emnapi/core@1.11.1
                                            @emnapi/runtime@1.11.1
                                            @emnapi/wasi-threads@1.2.2
                                            @tybys/wasm-util@0.10.3
```

These are WASM/N-API shims left in the local install tree. Per the gate, this was **not** acted on:

- `node_modules` was **not** deleted or recreated;
- `package.json` / `package-lock.json` were **not** modified for this finding;
- it is **not** claimed to be a tracked dependency defect.

Because the lock-only resolution is clean, the dependency graph the repository actually declares is
correct. This is **local environment state only** and requires no tracked-file change.


### 4.7 Test fixture classes (B9DD-FR-003, Section 5)

Two DIFFERENT kinds of fixture appear in the suite, and conflating them is what made the previous
evidence wrong. They are labelled here explicitly.

**Production-shaped fixtures** reproduce what the backend really emits, and are what every
behavioural assertion rests on:

- the import BATCH envelope (`import_type` + `file_type`), which `GET /imports/:id` and the OCR
  upload route both return (`imports/service.ts` ~494);
- `mapped_data.source === 'ocr_manual_fallback'` - the ONLY source marker production writes
  (`imports/service.ts` ~589);
- no company-base amount and no `fx_decision` before posting.

**Adversarial / negative fixtures** deliberately contain values production CANNOT produce, and exist
only to prove the UI ignores them. They are confined to one clearly-marked block in
`ocr-import.test.tsx` ("OCR route - adversarial mapped_data"):

- `mapped_data.source = 'csv_xlsx_import'` - built by `importOriginPayload()` at POSTING time for
  the FX RPC (`imports/service.ts` ~299) and never written to `mapped_data`;
- `mapped_data.source = 'ocr'` - emitted nowhere at all.

Both assert the batch envelope still wins and the hostile value changes nothing. The previous
evidence claimed "no test injects an impossible source"; that claim is withdrawn (Section 4.4). The
accurate statement is: **no production-shaped fixture uses an impossible source, and the only tests
that contain one are adversarial tests proving it is ignored.**

### 4.8 Backend candidate-contract assessment

#### 4.8.1 HISTORICAL pre-Migration-030 limitation - SUPERSEDED (B9DD-DR-001, Section 3.1)

**Everything in 4.8.1 describes the state BEFORE Phase A and is NOT current.** It is retained as the
record of why the backend delta was necessary. Its conclusions - that only mutable OFFSET pagination
exists, that no governed candidate route exists, and that a backend fix was unauthorized future work -
were true when written and are **NOT true now**. The current architecture is 4.8.2.

Before choosing any frontend algorithm, the committed backend was inspected for an existing route or
pagination contract that already solved stable candidate listing. At that time it did not. Read, not
assumed:

| Source | What it provides | Usable as a stable candidate contract? |
| --- | --- | --- |
| `allocations/service.ts` ~435 `getOutstandingInvoices` | Exactly the governed candidate query wanted: ONE unpaginated `.select()` filtered by company/customer/currency, `.in('status', ['Open','Overdue','Partially Paid'])`, `.in('doc_type', ['Invoice','Debit Note'])`, `.gt('outstanding', 0)`, `.order('due_date')`. | **No** - it is `private` and exposed by NO route. |
| `allocations/index.ts` ~97 `GET /allocations/preview` | Calls `previewAllocation` -> returns `AllocationProposal[]` (`service.ts` ~222). | **No** - it returns an allocation PLAN from `allocateFIFO`/`allocateAmountMatch` (`algorithms.ts` ~53), truncated by `receipt.unallocated_amount`. It is not the eligible candidate set, and it requires an auto-allocation method. |
| `allocations/index.ts` ~86 `POST /allocations/auto` | - | **No** - returns 403 `AUTO_ALLOCATION_DISABLED`, and remains disabled. |
| `allocations/index.ts` ~116 `GET /allocations/collection` | Existing allocation records. | **No** - not candidates. |
| `invoices/index.ts` ~108 `GET /invoices` | `parsePagination` + `meta.total`, `MAX_PAGE_SIZE = 100` (`_shared/constants.ts` ~89). | **Offset only.** No cursor, keyset, snapshot id, or version/`updated_at` consistency metadata. A repo-wide search for cursor/keyset/snapshot pagination found none (the only `snapshot` hits are FX-basis naming in `reports/monetary-contracts.ts`). |

Conclusion AT THAT TIME (superseded): only mutable offset pagination existed, and that gate was not
authorized to add or modify a backend endpoint. The frontend therefore failed closed (Section 3.6,
DR-001) rather than inferring completeness it could not demonstrate. The cleanest real fix was
identified as a backend one and recorded for a future batch: expose a governed single-query read
route, which would remove the multi-page scan, the invariants and the retry UX entirely.

**That recommendation was subsequently ACTIONED as Phase A.** It is no longer future work.

#### 4.8.2 CURRENT source-level architecture (authoritative)

| Element | State |
| --- | --- |
| `database/030_batch_9d_d_allocation_candidate_snapshot.sql` - `public.get_allocation_candidates(p_receipt_id, p_user_id, p_company_id)`: STABLE, SECURITY DEFINER, `search_path = ''`, service_role-only, read-only, **non-paginated** (no OFFSET, no SQL LIMIT), capped at 5,000, deterministically ordered by due_date/invoice_no/id. Count and JSON aggregation come from ONE PostgreSQL statement snapshot. | **INSTALLED and definition/ACL/runtime-verified in the approved staging project only. Production is untouched.** |
| `GET /allocations/candidates` (`allocations/index.ts`, `allocations/service.ts`) - returns one complete candidate set or fails explicitly (BR-ALLOC-CANDIDATE-LIMIT) above capacity. | **DEPLOYED and positive/negative/tenant-verified in the approved staging project only.** |
| Frontend consumer - `lib/allocation-candidate-contract.ts`, `hooks/use-allocations.ts`, `hooks/use-allocation-logic.ts`, `allocations/page.tsx`. The OFFSET scan is **DELETED**, with no fallback. | **IMPLEMENTED LOCALLY.** |
| PostgreSQL runtime behaviour of Migration 030. | **PROVEN IN STAGING:** installed metadata/ACL and function definition inspected; governed positive, empty, tenant, role and direct-RPC denial paths exercised; complete non-paginated result and stable ordering verified. Production remains untouched. |

There is therefore **no remaining frontend OFFSET candidate scan**, and no "future backend candidate
contract" outstanding: the contract exists in source and is now installed/deployed and verified in
the approved staging project. No production deployment occurred.

### 4.9 Phase A preservation and Deno checks (Phase B)

Phase B changed NO backend or database file. All four Phase A files are byte-identical to the handoff:

| File | State | Lines |
| --- | --- | --- |
| `backend/supabase/functions/allocations/index.ts` | modified by Phase A, untouched by Phase B | 170 |
| `backend/supabase/functions/allocations/service.ts` | modified by Phase A, untouched by Phase B | 769 |
| `backend/supabase/functions/allocation_candidate_contract_test.ts` | added by Phase A, untouched | 434 |
| `database/030_batch_9d_d_allocation_candidate_snapshot.sql` | added by Phase A, untouched | 253 |

Deno results (no dependency installed, no lockfile written):

| Command | Exit | Result |
| --- | --- | --- |
| `deno check --no-lock allocations/service.ts` | 0 | PASS |
| `deno check --no-lock allocation_candidate_contract_test.ts` | 0 | PASS |
| `deno test --no-check --allow-read --no-lock allocation_candidate_contract_test.ts` | 0 | **12 passed, 0 failed** |
| `deno test --allow-read --no-lock allocation_candidate_contract_test.ts` (CHECKED) | - | **BLOCKED** - see below |

**The checked-test blocker, characterized precisely.** The normal checked `deno test` path fails with
`Could not find a matching package for 'npm:@types/node' in the node_modules directory`. This is a
PRE-EXISTING environment limitation, not a Phase A or Phase B defect, and the mechanism is:

`allocation_candidate_contract_test.ts` -> `allocations/service.ts` -> `_shared/db.ts` -> `supabase`
-> `https://esm.sh/@supabase/supabase-js@2` (per the COMMITTED, untouched `import_map.json`), whose
types reference `npm:@types/node`. There is no Deno `node_modules` directory and no
`"nodeModulesDir": "auto"`; installing one is not authorized in this gate.

Two facts keep this honest rather than convenient:

- `deno check` PASSES on both the service and the test, so the code type-checks. Only the `deno test`
  checked path trips the type-reference resolution.
- The committed, Phase-A-unrelated `fx_booking_governance_test.ts` runs fine under CHECKED
  `deno test` (14 passed) - because it imports nothing and reads files as text. So the blocker is not
  a blanket environment failure; it affects any checked test that transitively imports `_shared/db.ts`,
  which the Phase A test is simply the first to do.

**These remain source-contract fixtures, not the basis of the runtime proof.** The 12 passing tests
assert properties of the migration text and the service's contract parsing. Runtime proof is recorded
separately in the current staging status and incident-closure sections; the synthetic tests are not
misrepresented as live database execution.

### 4.10 File inventory for the consolidated delta (B9DD-CDR-004 Section 6.6)

Counts are read from Git at the end of validation, not carried forward. The prior report said
"8 modified" while listing nine paths; that arithmetic slip is why these are now enumerated per
phase rather than summarised.

**Phase A - backend + database (source-level only; UNTOUCHED by every later phase).** Verified
byte-identical by SHA-256 before and after this remediation (Section 4.9):

| Path | Phase A action |
| --- | --- |
| `backend/supabase/functions/allocations/index.ts` | MODIFIED |
| `backend/supabase/functions/allocations/service.ts` | MODIFIED |
| `backend/supabase/functions/allocation_candidate_contract_test.ts` | ADDED |
| `database/030_batch_9d_d_allocation_candidate_snapshot.sql` | ADDED |

**Phase B - original frontend consumption:**

| Path | Action |
| --- | --- |
| `frontend/src/lib/allocation-candidate-contract.ts` | ADDED |
| `frontend/src/hooks/use-allocations.ts` | MODIFIED |
| `frontend/src/hooks/use-allocations.test.tsx` | MODIFIED |
| `frontend/src/hooks/use-allocation-logic.ts` | MODIFIED |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | MODIFIED |
| `frontend/src/app/(dashboard)/allocations/allocations.test.tsx` | MODIFIED |
| `frontend/src/components/features/allocations/invoice-panel.tsx` | MODIFIED |
| `frontend/src/lib/monetary-guard.test.ts` | MODIFIED |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | MODIFIED |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | MODIFIED |

**B9DD-FNC-001...003 final Codex implementation - 7 paths (0 added, 7 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/vitest.setup.ts` | modified | FNC-002 (remove redundant act flag/cleanup; correct attribution) |
| `frontend/src/lib/allocation-candidate-contract.ts` | modified | FNC-001 (required lifecycle epoch in binding/match) |
| `frontend/src/hooks/use-allocations.ts` | modified | FNC-001 (synchronous filtered event epoch + scheduled React notification) |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | modified | FNC-001 held/immediate reset + event/filter/unsubscribe regressions |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | modified | FNC-003 accurate revision comment |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | FNC-002/003 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | FNC-003 |

No backend/database or dependency file changed in this closure implementation.

**B9DD-FCR-001...003 closure remediation (historical gate) - 6 paths (0 added, 6 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/vitest.setup.ts` | modified | FCR-002 (historical explicit act flag; removed by FNC-002 as redundant) |
| `frontend/src/hooks/use-allocations.ts` | modified | FCR-002 (`notifyManager.batchCalls`) |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | modified | FCR-001 reset regression + FCR-002 act boundaries + naming (45 -> 47) |
| `frontend/src/app/(dashboard)/allocations/allocations.test.tsx` | modified | FCR-002 act/waitFor boundaries |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | FCR-003 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | FCR-003 |

Six rows, six paths (four code/test + two documents). No file added. No production
allocation logic changed except the `notifyManager` subscription fix; `package.json`
and `package-lock.json` untouched (mtimes 2026-07-16).

**B9DD-FDR-001...004 consolidated remediation - 9 paths (1 added, 8 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/src/app/(dashboard)/allocations/allocation-company-isolation.test.tsx` | **ADDED** | FDR-002 |
| `frontend/src/lib/allocation-candidate-contract.ts` | modified | FDR-001, FDR-002 (companyId + queryEpoch in the binding; comparison order) |
| `frontend/src/hooks/use-allocations.ts` | modified | FDR-001, FDR-002 (company-scoped key, WeakMap epoch, atomic live read, revision) |
| `frontend/src/hooks/use-allocation-logic.ts` | modified | binding-session identity |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | modified | FDR-002, FDR-003 (company-qualified selection, layout-phase rebind + cleanup, presentation authority) |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | modified | FDR-001 + sessions (34 -> 45) |
| `frontend/src/app/(dashboard)/allocations/allocations.test.tsx` | modified | FDR-003 (21 -> 26) |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | FDR-004 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | FDR-004 |

Nine rows, nine paths. `package.json` and `package-lock.json` are untouched -
their mtimes (2026-07-16) predate this gate.

**B9DD-FRR-001/002 narrow remediation - 5 paths (0 added, 5 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/src/hooks/use-allocations.ts` | modified | FRR-001 (`allocationCandidateQueryRevision`, `useAllocationCandidateQueryRevision`) |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | modified | FRR-001 (rebind driven by the revision) |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | modified | FRR-001 tests (26 -> 34) |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | FRR-002 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | FRR-002 |

No file was ADDED by this gate. `allocation-candidate-contract.ts`, `use-allocation-logic.ts`,
`monetary-guard.test.ts` and every backend/database file are untouched, as are the package manifests.

**B9DD-CRR-001 ... 004 focused remediation - 8 paths (0 added, 8 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/src/lib/allocation-candidate-contract.ts` | modified | CRR-001 (generation token, required binding param, generation-first `bindingsMatch`) |
| `frontend/src/hooks/use-allocations.ts` | modified | CRR-001 (single atomic live reader) |
| `frontend/src/hooks/use-allocation-logic.ts` | modified | CRR-002 (`revokeContractAuthority`, `createReceiptSelectionHandler`) |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | modified | CRR-002 (synchronous revocation on every receipt-ID transition) |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | modified | CRR-001 + CRR-002 tests (21 -> 26) |
| `frontend/src/lib/monetary-guard.test.ts` | modified | CRR-003 (151 -> 166) |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | CRR-004 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | CRR-004 |

No file was ADDED by this gate. `package.json` / `package-lock.json` are unchanged - their
mtimes are 2026-07-16, predating this gate.

**B9DD-CDR-001 ... 004 consolidated remediation - 10 paths (1 added, 9 modified):**

| Path | Action | Finding |
| --- | --- | --- |
| `frontend/src/hooks/use-allocation-live-verification.test.tsx` | **ADDED** | CDR-002 |
| `frontend/src/lib/allocation-candidate-contract.ts` | modified | CDR-001, CDR-002 |
| `frontend/src/hooks/use-allocations.ts` | modified | CDR-002 |
| `frontend/src/hooks/use-allocations.test.tsx` | modified | CDR-001 |
| `frontend/src/hooks/use-allocation-logic.ts` | modified | CDR-002 |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | modified | CDR-002 |
| `frontend/src/app/(dashboard)/allocations/allocations.test.tsx` | modified | CDR-002 |
| `frontend/src/lib/monetary-guard.test.ts` | modified | CDR-003 |
| `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` | modified | CDR-004 |
| `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` | modified | CDR-004 |

`frontend/package.json` and `frontend/package-lock.json` are **NOT** in this list. Their diffs are
pre-existing from an earlier gate; their mtimes (2026-07-16) predate this remediation.

**Whole-worktree totals after daily-overdue remediation and final validation** (`git diff --shortstat`; branch `main`, HEAD
`d5c9c0a`, staged 0):

| Metric | Before credential remediation | Final |
| --- | --- | --- |
| Modified tracked files | 58 | **62** (+ shared Edge helper/config, daily-overdue handler, quote-robust backend guard) |
| Untracked files | 53 | **74 total: 56 Batch 9D-D files plus 18 unrelated `social-media/` files excluded from the proposed Batch commit** |
| Insertions | 5,991 | **6,231** |
| Deletions | 1,202 | **1,313** |

### 4.11 React lifecycle warnings (B9DD-FCR-002)

An earlier gate reported these suites "warning-free". That was **wrong twice over**
and is withdrawn:

1. it scanned the DEFAULT reporter, which does not surface React's `console.error`
   output; and
2. its grep for "Cannot update a component while rendering a different component"
   used a literal substring, but React interpolates the component name -
   "Cannot update a component (`AllocationsPage`) while rendering a different
   component" - so the pattern could never match.

Reproduced with `--reporter=verbose` and a corrected regex:

| Pattern | Before | After |
| --- | --- | --- |
| `not wrapped in act` | **39** | **0** |
| `Cannot update a component .* while rendering a different component` | **3** | **0** |
| `testing environment is not configured to support act` | **23** | **0** |
| `[Mm]aximum update depth` | 0 | **0** |
| `hydrat` | 0 | **0** |
| `state update on an unmounted` | 0 | **0** |

Root causes and fixes - all real, none suppressed:

- **The act-environment flag was not the root cause.** `@testing-library/react`
  16.3.2 already sets `IS_REACT_ACT_ENVIRONMENT` in its `beforeAll` and restores
  it in `afterAll`, and already registers automatic cleanup. The later explicit
  flag and duplicate cleanup were redundant and are now removed from
  `vitest.setup.ts`.
- **setState during render.** `useQuery` can start a fetch DURING render; the
  resulting synchronous QueryCache notification called `onStoreChange`, forcing a
  store re-render mid-render. The subscription now routes through the PUBLIC
  `notifyManager.batchCalls`, exactly as TanStack's own `useBaseQuery` does. The
  matching QueryCache event advances the lifecycle authority synchronously
  before that React notification is scheduled, so rapid reset/success cannot be
  hidden by the batching. Invocation-time authorization reads that epoch directly.
- **Tests manufacturing an invalid lifecycle.** Several tests performed un-acted
  cache/store mutations purely to observe a pre-commit window. Those either now
  initiate inside `act()` with a HELD response (so the window is real and
  committed, not manufactured), or the load-bearing rule moved to a deterministic
  direct assertion - e.g. the selection handler's revoke-before-schedule ordering
  is now asserted on `createReceiptSelectionHandler` itself, with no React at all.
- **`waitFor` nested inside `act`.** Untangled in the epoch test.

`console.error` is NOT globally suppressed anywhere; the warnings have no cause
rather than no voice. Verified across the FULL suite in
verbose mode: all six patterns **0**.

## 5. Known limitations and remaining justified items

1. **Backend contract limitation - `v_customer_credit_utilization` (recorded, NOT modified).**
   `database/002_create_views.sql` computes `total_outstanding`, `credit_utilization` and
   `available_credit` as `SUM(i.outstanding)` **across transaction currencies with no FX
   normalization** - a legacy pre-9D-D behaviour. It is therefore not a safe multi-currency exposure
   authority. No backend change was made (outside this gate's authorization). The frontend routes
   around it: exposure comes from `ar_aging_by_customer`, and Customer detail shows *Available
   credit* / *Utilisation* **only** when the credit limit currency and the company base currency
   provably match, with an explicit explanation otherwise.
2. **`customers.credit_limit` has no declared currency** in the schema. The backend's own credit view
   pairs it with `default_currency`, so credit limits are rendered with `default_currency` and never
   with an unrelated (e.g. draft receipt) currency.
3. **Import rows carry no company-base amount or `fx_decision`** - those exist only after posting.
   Import review therefore shows an explicit "Base amount not booked yet" state rather than a
   computed one (per B9DD-FEIR-008 Section 7).
4. **Remaining `"MYR"` literals** are confined to `lib/currency.ts` (the supported-currency policy and
   its display labels) and test fixtures. No runtime monetary path defaults to MYR - enforced by a
   catch-all guard check, not by review.
5. **`formatAmount` (a plain number formatter with no currency parameter) is still used in 3 UI
   files**, all justified and enforced: two dense line tables whose monetary COLUMN HEADERS name the
   document currency, and the chart tooltip which prefixes the code itself. The guard asserts both the
   allow-list and that each file's stated currency context still exists. Any new usage elsewhere fails
   the suite.
6. **`GET /reports/aging/by-customer` exposes no customer filter** (only `as_of_date` + pagination), so
   the Aging table's search/sort are current-page-only and are labelled as such in the UI rather than
   presented as a whole-report filter.
7. **[SUPERSEDED - see the CURRENT STATE and HISTORICAL blocks below]** (B9DD-DR-001,
   B9DD-CDR-004 Section 6.4.)

   **CURRENT STATE (authoritative).** The allocation workbench does not use `/invoices` at all. It
   reads `GET /allocations/candidates`, backed by Migration 030's `get_allocation_candidates` RPC,
   which returns ONE complete, snapshot-consistent candidate set with no OFFSET, no SQL LIMIT and
   no Edge pagination. A governed backend candidate contract therefore EXISTS in source and is
   installed/deployed and runtime-verified in the approved staging project only. The RPC's 5,000 cap is a
   real product limit: above it the backend raises BR-ALLOC-CANDIDATE-LIMIT and the workbench
   refuses rather than showing a partial list.

   **HISTORICAL - PRE-MIGRATION-030 EVIDENCE. The paragraph below describes the state BEFORE
   Phase A and is NOT current. It is retained as the record of why the backend delta was
   necessary. Its statements that no backend candidate contract exists, and that backend changes
   are outside the batch's authorization, were true when written and are NOT true now.**

   > `/invoices` offers OFFSET pagination only (`invoices/index.ts` ~108: `parsePagination` +
   > `meta.total`); there is no cursor, keyset, snapshot id or version field with which to pin a
   > consistent view, and `allocations/service.ts` ~435 `getOutstandingInvoices` - which DOES
   > fetch the whole governed candidate set in one query - is `private` and exposed by no route.
   > Backend changes were outside that gate's authorization, so the frontend failed closed: it
   > captured one immutable `initialTotal`, required every page to repeat it, threw on any
   > duplicate id, and succeeded only when unique coverage EQUALLED that total. A premature short
   > or empty page threw. That was a real behavioural limit: during concurrent invoice
   > creation/deletion for the same customer, or above 5,000 invoices, the candidate list FAILED
   > VISIBLY and the user had to retry. It was the intended trade-off for an allocation surface -
   > a silently incomplete candidate list is worse than an error - but it was a limit, not a
   > triumph, and a stable backend candidate contract would remove it. That contract is now
   > Migration 030.
13. **[RESOLVED by Phase A + Phase B]** The fail-closed OFFSET scan could detect instability but
    not prove stability; an exactly-balanced delete+insert defeated it. That gap is closed at the
    source: the governed RPC is non-paginated, so there is no window to shift and nothing to
    reconcile. The scan is deleted.
14. **[RESOLVED in the staging runtime gate] Migration 030 runtime behaviour is proven in staging.**
    The installed definition and ACL, governed RPC and Edge route, tenant/Clerk restrictions,
    manual-allocation regression, complete-set shape and deterministic order were exercised against
    the approved staging project. The Phase A tests remain synthetic source-contract fixtures and are
    not presented as the live proof. Production was not accessed or changed.
15. **Not every monetary guard category is a full AST visitor** (B9DD-MDR-003). The MYR
    static-text check (including JSX text), the bounded monetary-reduction dataflow analysis and
    the parse gate are AST visitors; the remaining categories match patterns against
    parser-normalized (comment-free, regex-safe) code. That closes the known bypasses but is not
    the same as structural inspection, and this document does not claim otherwise. Section 4.3
    lists exactly which is which.
17. **The monetary dataflow analysis is BOUNDED to a single reducer callback** (B9DD-CDR-003
    Section 4.3). It does not follow external helper calls and performs no whole-program or
    interprocedural analysis, so a protected value laundered through a helper
    (`sum + toNumber(row)`) is NOT detected. This is asserted as an explicit test rather than left
    implicit, so the limit is visible in review. The guard is a strong barrier against the
    realistic accidental case; it is not a proof of absence against a determined author.
18. **`canSubmit` remains a render-time value** (B9DD-CDR-002). It is deliberately NOT the
    submission authority - it only decides whether the button renders enabled. `buildPayload()`
    re-verifies against the live query cache at invocation, and the page re-verifies once more
    immediately before `mutateAsync`. The backend remains the final mutation authority regardless.
19. **Authority and presentation are decoupled, by design** (B9DD-CRR-002, corrected by
    B9DD-FCR-003). Revocation is a ref write and takes effect immediately; `invoices`/`lines` are
    React state. The binding/cleanup now runs in a LAYOUT effect, so it lands after commit but BEFORE
    browser paint - there is no painted frame showing the previous receipt's rows as actionable. The
    earlier claim of a real one-render display lag is withdrawn. What remains true, and is the point:
    a QueryCache notification does not mean React has committed, so authority must never be inferred
    from what is on screen - every action re-verifies against the live cache at invocation.
20. **The QueryState token and lifecycle revision use only TanStack's public contract**
    (B9DD-CRR-001, B9DD-FRR-001). `dataUpdateCount`, `dataUpdatedAt`, `status`, `fetchStatus` and
    `errorUpdateCount` are read from the PUBLIC `QueryState` interface of the installed version
    (@tanstack/query-core 5.95.2), and the subscription uses the PUBLIC
    `queryClient.getQueryCache().subscribe(...)` (QueryCache extends the exported `Subscribable`). No
    internal or undocumented field is touched. A future major version could change either shape, which
    would be a compile/type break rather than a silent weakening. `dataUpdatedAt` alone is
    insufficient because millisecond resolution collides. `dataUpdateCount` is monotonic only in an
    uninterrupted Query lifetime; the synchronous lifecycle epoch handles same-object reset events
    whose final QueryState values repeat.
21. **The QueryCache subscription source is global, but the listener is narrowly filtered.** Only
    `added`, `removed`, or `updated` events whose exact key matches the active company and receipt
    advance authority and schedule React notification. Observer-only, unrelated, stale-company, and
    other-receipt events return without notifying. This is asserted by event-counting, unrelated-event,
    company-isolation, and unsubscribe tests.
22. **The Query-instance epoch is per JS RUNTIME** (B9DD-FDR-001). A WeakMap keyed on the public
    `Query` object gives one Query a stable epoch and a recreated Query a new one, and allocates
    nothing on repeated reads. It is NOT stable across a page reload, an SSR/client boundary, or an
    Fast Refresh module reset. Fast Refresh may preserve React hook state while resetting module-level
    trackers; safety therefore does not assume bindings are discarded. Any tracker/binding mismatch
    denies until a governed rebind - a real runtime boundary stated rather than implied.
23. **Pre-paint presentation protection is the LAYOUT-phase rebind; the gate is defence in depth**
    (B9DD-FDR-003, clarified by B9DD-FCR-003). The primary mechanism is that binding/cleanup runs in
    a layout effect, so the previous generation's rows and lines never paint as actionable.
    `presentationAuthorityValid` and `canSubmitNow` sit behind that as defence in depth, and final
    invocation-time authorization remains independently load-bearing regardless of either. `act()` flushes render AND effects synchronously, so a test cannot
    observe the pre-rebind frame the gate covers; and with the rebind moved to the LAYOUT phase that
    frame no longer paints at all. Removing the gate therefore fails no test today. It is retained
    because it is correct and because the underlying premise IS proven (the `canSubmit` memo goes
    stale while live authority denies). This is recorded as unproven-by-mutation rather than claimed.
24. **Tenant identity is a discriminator, not an authority over money** (B9DD-FDR-002). The company
    id selects the correct governed backend contract and scopes the cache; every monetary figure still
    comes from that contract, and the backend re-validates every balance at execution regardless.
25. **QueryCache receipt is synchronous; React notification and commit are not.**
    `notifyManager.batchCalls` schedules the `useSyncExternalStore` notification, so an awaiting test
    can deliberately hold that scheduler and observe the cache-settled/pre-commit interval. The
    synchronous lifecycle epoch is already part of live authority in that interval; the immediate
    reset integration test proves all stale callbacks deny before scheduled notification, then proves
    the eventual rebind/session rollover and recovered actionability.
16. **Two justified MYR strings remain outside `lib/currency.ts`** (B9DD-MDR-003 Section 7.1).
    Broadening the literal check to a substring test over all template forms surfaced two
    pre-existing help strings: `"3-letter ISO code (default: MYR)"` (which accurately documents
    real backend behaviour - `imports/service.ts` defaults an imported document's currency to MYR)
    and `"3-letter ISO code (e.g. SGD, MYR)"` (a worked example). Neither is a currency value, a
    default, or a label on an amount. They are allow-listed by EXACT TEXT rather than by file, so
    any other MYR string anywhere still fails, and a companion test fails if either string goes
    stale.
8. **B9DD-RR-008 (informational).** Four extraneous packages exist in the local physical
   `node_modules`. Per the gate this was **not** acted on: `node_modules` was not deleted or
   recreated and no manifest was touched for it. `npm ls --depth=0 --package-lock-only` is clean, so
   this is local environment state, **not** a tracked dependency defect.
9. **`next lint` deprecation notice** - Next.js 15.5 prints a notice recommending the ESLint CLI. The
   command still runs and exits 0; migrating the runner is out of scope for this gate.
10. **The monetary guard reports FILES, not line numbers** (B9DD-FR-004/DR-002). A whole-file
    normalized scan cannot honestly attribute a match to a line. This is a deliberate trade of precision in
    REPORTING for the elimination of formatting-based bypass; a fabricated line number would be
    worse than none. Two context-sensitive checks use a companion scanner that reports a window of
    surrounding code.
11. **Regex literals ARE modelled, by the TypeScript parser** (B9DD-DR-002). The previous entry
    here claimed regex literals could only cause over-scanning; that was wrong and is retracted
    (Section 4.4). Distinguishing `/` division from a regex needs real parsing, so the guard now
    uses the repo's own TypeScript parser rather than a hand-rolled scanner. The residual limit is
    narrower and worth naming: the guard's authority now rests on the parse, so a production file
    the parser cannot read would be uninspectable - which is why a parse-diagnostics gate FAILS
    the guard instead of skipping such a file.
12. **`placeholderData: keepPreviousData` remains in `use-dashboard.ts` and `useAgingByCustomerF2`**
    without the B9DD-FR-001 stale-marking treatment applied to the Customer list. Those surfaces
    are page-navigation only (no filter-identity change that could mislabel a row's exposure), and
    B9DD-RR-001 (Aging) was CLOSED at the focused re-review - so they were deliberately NOT
    reopened in this narrow gate. Recorded here rather than left implicit.

---

## 6. Boundaries - confirmed for this gate

- No commit; no push; no merge; no reset/checkout/stash/clean.
- Migration 030 was applied only to the explicitly approved staging project in the preceding runtime
  gate; it was not reapplied during credential remediation. The allocations route and the other 15
  Edge Functions proven to share the compromised legacy-key helper were deployed only to that staging
  project. No frontend/Vercel deployment occurred.
- Controlled staging queries and disposable fixtures were limited to the authorized RPC, Edge,
  tenant/Clerk, manual-allocation/reversal and scheduler regression matrices. Final cleanup found no
  disposable users, roles, assignments, synthetic limit rows, or active gate allocations. Exactly
  three controlled `0.01` allocation records are retained as reversed audit history:
  `B9DD runtime gate emergency cleanup`, `B9DD staging runtime negative-matrix reversal`, and
  `Batch 9D-D credential rotation regression reversal`. All three are `Reversed` and have reversal timestamp,
  reason, and actor metadata. The affected receipt/invoice balances reconcile to the remaining active
  `1.00` allocation. No active `0.01` gate allocation remains.
- The Batch 9D-B scheduler configuration and its separate credential were not changed. A CLI deployment
  default that temporarily enabled platform JWT verification for three custom-auth functions was
  detected, corrected remotely, and is now pinned in `backend/supabase/config.toml`.
- No production access or action of any kind.
- A malformed redaction expression exposed the enabled privileged legacy staging service-role key in
  command output. The value was not written to the repository, responses, logs, evidence, or plan. It
  was treated as compromised, all affected consumers were migrated, and the legacy anon/service-role
  pair was disabled and proven rejected. No credential value is preserved here.
- **Backend source, precisely (B9DD-CDR-004 Section 6.5).** An earlier version of this line said no
  backend source or migration was modified. That was true of the frontend gates and became FALSE
  once Phase A landed. For the complete consolidated delta:
  - **Phase A MODIFIED two backend files** (`allocations/index.ts`, `allocations/service.ts`),
    **ADDED one backend contract test** (`allocation_candidate_contract_test.ts`) and **ADDED
    Migration 030** (`database/030_batch_9d_d_allocation_candidate_snapshot.sql`).
  - **Phase B and this consolidated remediation modified NONE of those four files** - verified by
    SHA-256 before and after (Section 4.9).
  - Credential remediation modified the shared Edge database helper and added a focused resolver test;
    the accepted custom-auth `verify_jwt` deployment settings are now explicit in Supabase config.
- No dependency installed, upgraded, removed or repaired; `package.json` and `package-lock.json`
  are untouched by this remediation.

### 6.1 Staging credential incident closure (sanitized)

| Item | Verified result |
| --- | --- |
| Exposed credential | Enabled privileged **legacy staging service-role API key**. Exposure was command-output only, caused by malformed redaction; the value is not reproduced or fingerprinted here. |
| Replacement | One dedicated named modern staging secret, consumed through `SUPABASE_SECRET_KEYS`; the hosted default modern publishable key is consumed through `SUPABASE_PUBLISHABLE_KEYS`. No legacy fallback remains in `_shared/db.ts`. |
| Affected Edge consumers | `invoices`, `receipts`, `allocations`, `imports`, `reports`, `customers`, `bank-accounts`, `auth`, `lookups`, `notifications`, `search`, `fx-rate-sync`, `fx-rates`, `credit-notes`, `debit-notes`, and `daily-overdue`. All shared the migrated helper and were redeployed to staging only. |
| Pre-revocation proof | Modern-key canary, all affected user/read routes, direct service-only candidate RPC, candidate route, controlled manual allocation/reversal, and the separate Batch 9D-B scheduler path succeeded before revocation. |
| Revocation | The platform legacy-key mode was disabled after migration. This disables the paired legacy anon and service-role keys without rotating the JWT signing key. |
| Rejection / replacement proof | Both legacy keys return HTTP 401. The modern secret succeeds only on its intended server path; the modern publishable key succeeds on the user-facing key path. |
| Post-revocation runtime | Candidate/RPC positive and negative matrix, tenant and Clerk assignment rules, controlled manual allocation/reversal, all affected read routes, scheduler smoke, and `POST /allocations/auto` (403, `AUTO_ALLOCATION_DISABLED`) pass. |
| Cleanup | No disposable users, roles, assignments, synthetic capacity rows, or active gate allocations remain. Exactly three controlled `0.01` records remain as reversed audit history; all three are `Reversed` with reversal timestamp, reason, and actor, no active `0.01` gate allocation remains, and receipt/invoice arithmetic reconciles to the pre-existing active `1.00` allocation. |
| Scope | Approved staging project only. No production project access, key action, migration, deployment, fixture, or user action occurred. No scheduler or Vault value changed. |

### 6.2 Daily-overdue fail-closed follow-up (sanitized)

| Item | Verified result |
| --- | --- |
| Original defect | With `verify_jwt=false`, the predicate `if (expectedSecret && supplied !== expectedSecret)` failed open when the server setting was absent/blank; privileged invoice, customer and audit work was then reachable. |
| Final boundary | A focused validator rejects missing/blank server configuration with sanitized 500, rejects missing/blank/incorrect callers with sanitized 401, and compares the correct caller using the accepted constant-time helper before `getAdminClient()` exists. |
| Mutation efficacy | Restoring the fail-open condition made the absent/blank server-secret tests fail (2 failures). Bypassing constant-time comparison made the wrong-secret/composition tests fail (3 failures). Both mutations were restored; 12/12 focused tests pass. |
| Staging secret/deploy | `CRON_SECRET` was absent, so one strong staging-only value was set through Edge secret storage without repository or report exposure. `daily-overdue` alone was explicitly deployed; v6 is ACTIVE with `verify_jwt=false`. Updating the project secret caused the platform to roll function versions, but no other function source was explicitly deployed or changed in this follow-up. |
| Negative runtime | Missing, empty, incorrect, anonymous and valid ordinary-user-JWT-without-scheduler-secret requests return 401/`UNAUTHORIZED`; unauthorized database fingerprints did not change. |
| Positive runtime | Correct secret returns 200. Exactly three pre-counted invoices transitioned to `Overdue`; no customer was held and no customer/credit-control log was inserted. Repeats return 200 with zero updates. |
| Scheduler | No `daily-overdue` cron invocation exists in staging. The one Batch 9D-B FX job remains ACTIVE on `30 7 * * *`; its command fingerprint and accepted internal auth/source were not changed. |
| Local frontend environment | `frontend/.env.local` currently resolves to the prohibited production ref. It was not edited or used for any network request in this gate. Interactive local frontend staging checks require a separate explicit staging environment configuration. |
| Independent confirmation | Claude Code subsequently obtained its separately configured read-only Management access and returned `PASS - INDEPENDENT STAGING CLOSURE CONFIRMATION COMPLETE`. No credential is included here. |

## 7. Current closure state and next gate

The Codex staging runtime, credential incident, and daily-overdue security-remediation work passed its
local and staging matrices, and Claude Code subsequently returned
`PASS - INDEPENDENT STAGING CLOSURE CONFIRMATION COMPLETE`. Batch 9D-D is therefore accepted at source,
local-validation, staging-runtime, credential-remediation, security-remediation, and independent-review
levels. No Critical or High finding remains. The sole Medium documentation undercount is corrected to
three reversed controlled records. The next action is to request explicit authorization for one local
Batch 9D-D commit. Push, frontend deployment, production, and Batch 9D-E remain unauthorized/not started.

Authoritative status:

- Batch 9D-D **backend/staging baseline through Migration 029 remains closed** and was not reopened.
- Batch 9D-D **Phase A Migration 030 and the candidate route are installed/deployed and verified in the
  approved staging project only**. PostgreSQL runtime, ACL, Edge route, tenant isolation, manual
  allocation and disabled-auto behavior passed the authorized matrix.
- The staging credential incident is **remediated**: all 16 affected Edge consumers use the modern
  named secret/publishable dictionaries; the compromised legacy pair is disabled and returns 401;
  replacement consumers and the separate Batch 9D-B scheduler path pass.
- `daily-overdue` now fails closed before privileged work for missing server configuration and missing,
  blank, or incorrect caller authentication; the controlled staging positive/negative matrix passes.
- Batch 9D-D **Phase B remains locally implemented and validated**; no frontend deployment occurred.
- Codex implementation/self-validation, Claude independent source review, and Claude independent staging
  closure confirmation are all **PASS**.
- Exactly three controlled `0.01` allocation records remain, all `Reversed` with reversal timestamp,
  reason, and actor; no active gate allocation remains and financial arithmetic reconciles.
- **Commit: NOT YET AUTHORIZED. Push: NOT AUTHORIZED.** A push to GitHub `main` may trigger a Vercel
  production deployment.
- **Frontend production deployment: NOT AUTHORIZED.**
- Batch 9D-E **production rollout: NOT STARTED**, and reserved for that batch.

This document records staging runtime and credential-incident closure without authorizing commit,
push, production, or Batch 9D-E. It does not claim production readiness or production execution.
