# Batch 8A — Full Functional Completeness Audit

**Project:** GenAI-assisted Accounts Receivable (AR) module

**Audit date:** 2026-06-19

**Audit type:** Read-only repository audit

**Repository baseline:** `ba5fdc1 docs(evidence): record Batch 7B production smoke`

## 1. Scope and constraints

This report is a static repository audit. No fixture was executed, no import was run, no financial
record was created, and no staging or production data was queried or mutated. No Supabase or Vercel
deployment command was run.

The audit treats the backend service layer and reviewed financial RPCs as the intended source of
truth. A frontend control is considered complete only when it has a real API route and guarded
backend implementation. UI-only role hiding is not counted as a server-side guard.

Classification values:

- `IMPLEMENTED`
- `PARTIAL`
- `MISSING`
- `UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW`
- `NEEDS_MANUAL_VERIFICATION`

## 2. Executive verdict

The module has a credible core AR backend: invoice and receipt creation/posting, manual
multi-invoice allocation, reversal RPCs, bounced-cheque handling, CSV/XLSX imports, conservative
fuzzy suggestions, customer quick-create, allocation history, tenant/customer scoping, and the live
dashboard are present.

It is not yet functionally complete. The most material gaps are:

1. financial-table RLS still permits authenticated operational users to directly insert/update
   sensitive rows and columns;
2. invoice draft line/update/delete service methods lack explicit operational-role guards while
   using the service-role client;
3. System Admin is treated as full customer-data read access by shared auth filters;
4. reverse-allocation and bounced-cheque APIs exist but are not exposed as working frontend actions;
5. tax-code and payment-term selectors use frontend mock lists;
6. audit log, journal-entry viewer, global search, notifications, profile, report export, and
   credit-note UI remain placeholders;
7. OCR/PDF/image import and daily market FX synchronization are absent;
8. generic automatic allocation correctly remains disabled, but import auto-post/exact-reference
   allocation creates real financial mutations and must continue to be described as a guarded
   service/RPC flow, not autonomous AI approval.

Implementation should proceed only through a narrowly scoped Batch 8B security/completeness batch.
Do not enable `POST /allocations/auto`.

## 3. Requirement-by-requirement audit

The evidence columns list the exact repository paths. The “Server-side guard and coverage” column
identifies SQL smoke tests, HTTP scripts, and evidence documents; the absence of automated tests is
stated explicitly.

| # | Requirement | Status | Frontend evidence | API / backend / SQL evidence | Server-side guard and coverage | Gap / risk and recommended next batch |
|---:|---|---|---|---|---|---|
| 1 | One receipt → multiple invoices | IMPLEMENTED | `frontend/src/app/(dashboard)/allocations/page.tsx`; `frontend/src/components/features/allocations/allocation-table.tsx`; `frontend/src/hooks/use-allocation-logic.ts`; `frontend/src/hooks/use-allocations.ts` | `POST /allocations/manual` in `backend/supabase/functions/allocations/index.ts`; `AllocationService.manualAllocate()` in `backend/supabase/functions/allocations/service.ts`; `allocate_receipt(...)` in `database/007_financial_rpcs.sql` | AR Clerk+ role, company, customer assignment, visible-customer checks; duplicate invoice IDs rejected; RPC locks and validates totals. Covered by `database/007b_financial_rpcs_smoke_tests.sql` and `docs/evidence/audit-remediation/BATCH_3_MULTI_INVOICE_ALLOCATION_HARDENING_SUMMARY.md`. | Core flow is implemented. Batch 8B should add automated API regression coverage, not change the financial RPC. |
| 2 | Overpayment automatic handling | IMPLEMENTED | Allocation wizard leaves unused receipt balance; receipt import displays unapplied cash in `frontend/src/app/(dashboard)/receipts/import/page.tsx` and `frontend/src/components/features/receipts/receipt-table.tsx` | `allocate_receipt(...)` reduces only the allocated amount and preserves `receipts.unallocated_amount`; import caps allocation in `backend/supabase/functions/imports/service.ts` | RPC prevents over-allocation. Covered by `docs/evidence/audit-remediation/BATCH_4_OVERPAYMENT_UNAPPLIED_CASH_SUMMARY.md` and Batch 7B fixture templates (not executed). | “Automatic handling” means preserving excess as unapplied cash, not automatically allocating or writing it off. Keep wording explicit. |
| 3 | Bank charge / discount automatic handling | PARTIAL | Discount input exists in `frontend/src/components/features/allocations/allocation-table.tsx`; receipt import exposes bank-charge fields and review wording | Discount is handled by `allocate_receipt(...)` with discount JE in `database/007_financial_rpcs.sql`. `backend/supabase/functions/imports/service.ts` explicitly says bank-charge accounting is not automated. | Discount has RPC validation and smoke/evidence in `docs/evidence/audit-remediation/BATCH_5_DISCOUNT_BANK_CHARGE_SHORT_PAYMENT_SUMMARY.md`. Bank charge is diagnostic only. | Batch 8B/8C: design a separately approved GL-safe bank-charge RPC/service flow. Do not add direct balance updates. |
| 4 | Fuzzy matching | IMPLEMENTED | `frontend/src/components/features/imports/review-actions.tsx`; both import pages display suggestions and manual review actions | `backend/supabase/functions/_shared/fuzzy.ts`; customer/invoice diagnostics and review resolution in `backend/supabase/functions/customers/service.ts` and `backend/supabase/functions/imports/service.ts`; `POST /imports/:batch/rows/:row/review` | Company/customer/visibility checks; fuzzy results never auto-apply. Covered by Batch 6A/6B/6C evidence under `docs/evidence/audit-remediation/`. No unit tests for scoring. | Add deterministic unit tests for scoring and threshold boundary cases in Batch 8B test hardening. |
| 5 | PDF/Image/OCR import | MISSING | Import pages accept CSV/XLSX only | `ALLOWED_FILE_TYPES = ['csv','xlsx']` in `backend/supabase/functions/imports/index.ts`; parsers are `csv.ts` and `xlsx.ts` only | Unsupported file types are rejected. Evidence explicitly records OCR as deferred. | Separate future OCR batch with malware/file validation, extraction confidence, human review, and no automatic financial mutation. |
| 6 | Fully automatic posting | PARTIAL | Receipt import defaults Auto-Post & Allocate ON but requires a user to execute; invoice import is Draft only | `POST /imports/:id/execute`; `ImportService.executeDraftCreation()`; invoice `auto_post=true` rejected; receipt posting calls `ReceiptService.postReceipt()` | Write roles required; receipt posting uses `post_receipt` RPC. Covered by Phase E and Batch 6C evidence. | No unattended scheduler/AI posting and no invoice auto-post import. Preserve explicit user execution. If required, create a separately approved policy/idempotency batch. |
| 7 | System suggestion | IMPLEMENTED | Review diagnostics and suggestion action UI in `review-actions.tsx` | Fuzzy customer/invoice candidate generation in `_shared/fuzzy.ts`, `customers/service.ts`, and `imports/service.ts` | Suggestions are read-only until a user approves/edits/retries. Covered by Batch 6A–6C evidence. | Add unit tests and clearer confidence provenance; do not market as predictive AI approval. |
| 8 | System auto approve | MISSING | No auto-approve UI or hook | No API automatically approves fuzzy suggestions; exact deterministic matches proceed normally | Review API requires explicit action. Auto-reject exists for no-candidate invalid invoice references, which is not auto-approval. | Do not add in Batch 8B unless a separately approved, thresholded, auditable policy exists. |
| 9 | System auto-create | PARTIAL | Inline customer creation is explicit; import can create customers/documents after Execute | `CustomerService.createInlineCustomer()`; import `resolveImportCustomer()` and draft creation in `imports/service.ts` | Operational role, company, customer-name validation, duplicate checks, visibility checks. Covered by Phase C/D and inline-customer evidence. | It is user-triggered orchestration, not unattended AI creation. Add stronger idempotency tests and wording in Batch 8B. |
| 10 | System auto-allocate | UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW | Generic hook throws in `frontend/src/hooks/use-allocations.ts`; UI says unavailable. Receipt import can allocate one exact-reference invoice after explicit execute. | `POST /allocations/auto` returns 403 in `allocations/index.ts`; unused `AllocationService.autoAllocate()` exists; import uses `AllocationService.manualAllocate()` → `allocate_receipt` RPC | Safety regression covered in Batch 6B, 7A, and 7B evidence. | Keep generic route disabled. Rename/document import behavior as guarded exact-reference allocation. Consider removing or quarantining unused executable `autoAllocate()` service code. |
| 11 | System automatic financial mutation | UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW | Receipt import can post/allocate after explicit Execute | Import calls receipt posting and manual allocation services; those call financial RPCs | Role and preflight checks exist. Evidence covers production smoke. | Must always be described as user-authorized backend orchestration, not autonomous AI mutation. Add idempotency/transaction-boundary tests. |
| 12 | Every frontend function has real backend/API support | PARTIAL | Core invoice/receipt/allocation/import/dashboard flows use `useApi`; placeholders remain in header, credit notes, journal entries, audit log, settings, and report exports | Backend exists for some placeholder domains (credit notes) but not all UI controls/APIs | No server risk for inert controls, but completeness claim fails. | Batch 8B UI truthfulness: disable/remove inert controls or implement supported read APIs. |
| 13 | No mock data | MISSING | Mock tax codes/payment terms in `frontend/src/hooks/use-invoices.ts`; example audit rows in `frontend/src/app/(dashboard)/settings/audit-log/page.tsx`; static JE examples | Real `tax_codes`, `payment_terms`, and audit tables exist, but no frontend lookup/viewer integration | Mock tax IDs are intentionally stripped before backend submission, preventing unsafe writes. | Batch 8B: add read-only config APIs and replace mock lists; remove example audit data from operational navigation or label it as documentation only. |
| 14 | All UI buttons have real logic | PARTIAL | Main financial buttons work. Inert/placeholder controls include header search, notification bell, My Profile, AI sidebar, report exports, and placeholder modules | No corresponding API for several controls | Disabled export buttons are safe; clickable inert header controls are misleading. | Batch 8B: remove, disable, or implement every visible primary/header action. See button inventory below. |
| 15 | No frontend bypass of backend financial flow | IMPLEMENTED | Repository scan found no `supabase.from` financial table access; only auth client creation in `frontend/src/lib/supabase.ts` | Financial calls go through Edge Functions via `frontend/src/hooks/use-api.ts` | Current frontend is thin-client/API based. Batch 7A/7B evidence includes network checks. | Preserve. Add a CI grep/lint guard in Batch 8B. |
| 16 | Complete core AR flow | PARTIAL | Create/post invoice; create/post receipt; manual allocate; import; dashboard work. Reverse/bounce/credit-note management are not complete in UI | Backend has broader capability than frontend | Core happy path is covered by smoke evidence, but exception/reversal paths are not end-to-end UI complete. | Batch 8B: secure server boundaries first, then expose reviewed reverse/bounce actions and draft edit/delete. |
| 17 | Complete invoice CRUD | PARTIAL | Create/list/detail/post/cancel exist; no frontend edit/delete draft flow | Backend supports GET/POST/PATCH/DELETE and line CRUD in `invoices/index.ts` | Create/post/cancel have role guards; draft update/delete/line methods lack explicit `requireRole`. | Batch 8B critical: add explicit operational-role guards and frontend draft edit/delete only after guard tests. |
| 18 | Post invoice | IMPLEMENTED | List/detail actions via `usePostInvoice()` | `POST /invoices/:id/post`; `InvoiceService.postInvoice()`; `post_invoice` RPC | AR Clerk+, company/customer/visibility checks; RPC business rules. Covered by P1 SQL/API evidence. | Add current automated API test to CI. |
| 19 | Cancel invoice | IMPLEMENTED | Invoice detail action via `useCancelInvoice()` | `POST /invoices/:id/cancel`; `InvoiceService.cancelInvoice()` | AR Supervisor+, no allocation, full outstanding, reason, optimistic version, JE reversal. Evidence exists in P1 smoke. | Cancellation is service-orchestrated rather than one atomic RPC; evaluate transaction atomicity in Batch 8B without changing RPC unless separately approved. |
| 20 | Post receipt | IMPLEMENTED | Receipt list/create flow via `usePostReceipt()` | `POST /receipts/:id/post`; `ReceiptService.postReceipt()`; `post_receipt` RPC | AR Clerk+, customer/visibility and fiscal/bank checks. SQL smoke coverage exists. | Add current API regression tests. |
| 21 | Allocate receipt | IMPLEMENTED | Allocation Wizard and receipt import exact-reference flow | `POST /allocations/manual`; `allocate_receipt` RPC | AR Clerk+, customer assignment/visibility, same customer/currency, locks, totals. Strong evidence coverage. | Preserve RPC path. |
| 22 | Reverse allocation | PARTIAL | Allocation history is read-only; no reverse button/hook | `POST /allocations/:id/reverse`; `AllocationService.reverseAllocation()`; `reverse_allocation` RPC | AR Supervisor+, customer access, reason, RPC locks/reverses JEs. SQL smoke exists. | Batch 8B: add guarded frontend reversal action with confirmation and reason; production smoke required. |
| 23 | Bounced cheque | PARTIAL | No frontend bounce action | `POST /receipts/:id/bounce`; `ReceiptService.handleBouncedCheque()`; `handle_bounced_cheque` RPC | Finance Manager+, cheque/status/customer checks; SQL smoke coverage. | Batch 8B: add Finance Manager-only UI after real role API is available; smoke full reversal effects. |
| 24 | Invoice import | IMPLEMENTED | `frontend/src/app/(dashboard)/invoices/import/page.tsx`; `use-import.ts` | Upload/parse/validate/execute/review routes in `imports/index.ts`; invoice creation in `imports/service.ts` | CSV/XLSX limits, role, tenant, visibility, validation; invoices remain Draft. Extensive Phase A–C evidence/scripts. | Add automated repeatable tests; keep Draft-only. |
| 25 | Receipt import | IMPLEMENTED | `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Same import routes; receipt create/post/exact-reference allocation orchestration | Auto-post only for receipts; allocation uses service/RPC; fuzzy rows require review. Phase D/E and Batch 6 evidence. | Default ON remains operationally risky; consider explicit final confirmation in Batch 8B. |
| 26 | Allocation history | IMPLEMENTED | `frontend/src/components/allocation-history-table.tsx` used by allocation/invoice/receipt pages | `GET /allocations`; scoped enrichment in `AllocationService.listAllocations()` | Allowed read roles, AR Clerk assignments, visible customers. Covered by Phase F evidence. | Remove stale “Placeholder” code comment; add reversal action separately. |
| 27 | Reports/dashboard | IMPLEMENTED | Live dashboard plus aging/invoice/receipt/outstanding report pages | `GET /reports/dashboard`, aging, by-customer, statement; `get_ar_dashboard_metrics` in migration 014 | Role/scope/date/forbidden-param guards; service-role-only dashboard RPC. Strong Batch 7A/7B evidence. | Report export and dedicated invoice/receipt aggregate APIs remain separate optional work. |
| 28 | Customer quick create | IMPLEMENTED | `customer-combobox-with-create.tsx`; `use-inline-customer-create.ts` | `POST /customers/inline`; `CustomerService.createInlineCustomer()` | AR Clerk+, validation, duplicate and visibility handling. Production smoke evidence exists. | Preserve; add real role UI and automated tests. |
| 29 | Backend/API completeness | PARTIAL | Main pages have APIs; placeholder pages and config selectors do not | Edge Functions cover customers, invoices, receipts, allocations, imports, reports, bank accounts, credit/debit notes; no complete auth/me, tax-code, payment-term, FX sync, journal-entry list, or audit-log API | Mixed guard quality; see items 37–47. | Batch 8B: security boundary and read-only lookup APIs; later batch for optional viewers. |
| 30 | Invoices API | IMPLEMENTED | `use-invoices.ts` consumes collection/single/post/cancel | `invoices/index.ts` supports list/create/get/update/delete/line CRUD/post/cancel | Endpoint breadth is complete, but draft mutation role guards need remediation. SQL/API evidence covers major mutations. | Treat guard remediation as mandatory before exposing remaining CRUD UI. |
| 31 | Receipts API | IMPLEMENTED | `use-receipts.ts` consumes list/get/create/post/cancel | `receipts/index.ts` also exposes bounce, clear, unallocated | Mutations have explicit role guards; reads are company/customer scoped. | Add frontend bounce/clear only after the role API exists; consider whether the requirements call for draft update/delete. |
| 32 | Allocations API | PARTIAL | Manual allocate and history are integrated; reverse and preview not integrated; auto disabled | `allocations/index.ts` exposes manual, disabled auto, preview, reverse, list | Manual/reverse guarded; preview lacks explicit role/customer-access call before candidate query. | Batch 8B: harden preview role/customer/visibility and integrate reverse. Keep auto disabled. |
| 33 | Customers API | IMPLEMENTED | Lists/detail data/quick create consume customers API, though detail page redundantly derives client-side | `customers/index.ts` supports CRUD, status, credit, rating, credit summary, change log | Mutation roles and visibility checks are generally explicit. | Integrate real single-customer endpoint and management actions only if required. |
| 34 | Reports API | IMPLEMENTED | Dashboard and report hooks | `reports/index.ts`; `reports/service.ts`; migration 014 | Operational/auditor roles; dashboard excludes System Admin-only; AR Clerk scopes. Strong dashboard evidence. | Check legacy aging/customer-statement production role behavior periodically. |
| 35 | Imports API | IMPLEMENTED | Both import wizards and review actions | `imports/index.ts` supports upload/parse/validate/execute/review/list/get/rows | Read/write role sets, batch ownership/company checks, visibility and preflight. Extensive evidence; limited automated unit tests. | Add unit/integration test suite. |
| 36 | Bank account read API | IMPLEMENTED | `useBankAccounts()` and receipt form selector | `GET /bank-accounts` in `bank-accounts/index.ts` | Allowed read roles, company filter, active-only. | Settings page contains stale text claiming the API is unavailable; fix wording in Batch 8B. |
| 37 | Server-side guards | PARTIAL | Frontend role hiding is environment-based and not authoritative | Shared auth/visibility, service guards, RLS, and financial RPC guards exist | Critical gaps: invoice draft line/update/delete methods lack explicit role checks; preview allocation lacks explicit customer access; RLS permits direct sensitive writes. | Batch 8B must be a guard-hardening batch with negative-role tests. |
| 38 | companyId / tenant isolation | IMPLEMENTED | `useApi()` sends `X-Company-Id` | `extractCompanyId()`, active company role lookup, company predicates throughout services/RPCs/RLS | UUID validation and company-role membership are server-side. RLS and SQL tests cover cross-company access. | Add CI/API negative tests for every function. |
| 39 | Role checking | PARTIAL | `use-user-role.ts` uses `NEXT_PUBLIC_DEMO_USER_ROLE`, not the authenticated backend role | Backend `requireRole/requireAnyRole` is used by major mutations; some methods omit it | UX can show/hide the wrong actions; missing service guards matter because services use admin client. | Batch 8B: add `/auth/me` or equivalent read API and explicit guards to every mutation method. |
| 40 | AR Clerk customer assignment | IMPLEMENTED | Customer-filtered lists; no direct frontend bypass | `requireCustomerAccess()`, `getCustomerAccessFilter()`, service filters, migration 014 dashboard scope | Active assignment checks exist; SQL and dashboard role smoke coverage exists. | Add endpoint matrix regression tests. |
| 41 | Hidden/deleted customer filtering | PARTIAL | `frontend/src/lib/customer-visibility.ts` adds defense-in-depth filtering | Service-level `assertCustomerVisible()` and visible-ID queries are common; migration 014 filters both flags | Shared RLS helper `rls_can_access_customer()` does not require `is_hidden=false`/`is_deleted=false`, so direct authenticated reads can still expose hidden/deleted records. | Batch 8B: harden RLS helper/policies in a separately approved migration; verify every list/detail endpoint. |
| 42 | System Admin must not freely access operational financial data | PARTIAL | Frontend demo role treats System Admin read-only; dashboard returns 403 for System Admin-only | `requireRole()` blocks operational mutations, but `requireCustomerAccess()` and `getCustomerAccessFilter()` grant System Admin full customer access; RLS company/customer helpers also allow it | Dashboard evidence covers denial, but invoice/receipt/customer read APIs are not proven denied. | Batch 8B: remove System Admin from operational full-read helpers/policies and add HTTP/SQL negative tests. |
| 43 | Financial mutations are not done unsafely | PARTIAL | Frontend uses APIs only | Posting/allocation/reversal/bounce use RPCs; cancellation and linked-CN adjustments use multi-step service writes; RLS allows direct table updates | Major RPCs lock and validate, but the database boundary does not force RPC-only writes. | Batch 8B critical: revoke/deny direct sensitive DML and define atomic service/RPC boundaries. |
| 44 | `allocation_details` insert only through verified RPC/service flow | UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW | No frontend direct insert | Application service creates allocations through `allocate_receipt` RPC | `database/006_rls_policies.sql` has `ad_insert` for authenticated operational users, so direct insert is technically allowed. | Batch 8B migration: revoke direct insert/update from authenticated or enforce RPC-only policy; retain read policy. |
| 45 | Invoice outstanding update only through verified RPC/service flow | UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW | No frontend direct update | RPC updates during post/allocation/reversal/bounce; service directly updates during cancellation and linked credit-note application | General invoice UPDATE RLS allows operational users to alter `outstanding`; PostgreSQL RLS is row-level, not column-level. | Batch 8B migration/privileges: remove direct sensitive-column update capability; evaluate atomic cancellation/CN RPCs separately. |
| 46 | Receipt allocated/unallocated update only through verified RPC/service flow | UNSAFE_WORDING_NEEDS_RPC_SERVICE_FLOW | No frontend direct update | RPC updates allocation/reversal/bounce; receipt cancellation and `updateAllocationAmounts()` contain direct service updates | General receipt UPDATE RLS permits direct amount changes. `updateAllocationAmounts()` appears unused but is dangerous reusable code. | Batch 8B: deny direct sensitive-column updates and remove/quarantine unused helper after impact review. |
| 47 | Verified RPC/service flow used for financial mutation | PARTIAL | Core UI invokes APIs | `post_invoice`, `post_receipt`, `allocate_receipt`, `reverse_allocation`, `handle_bounced_cheque` are used; other financial transitions are service-orchestrated | Strong for major flows, inconsistent for cancellation/CN and not enforced at privilege layer. | Batch 8B: document canonical mutation matrix and enforce it with DB privileges/tests. |
| 48 | Real-time currency support | PARTIAL | Currency/exchange-rate fields exist; invoice/receipt forms support MYR/SGD/USD, but many labels and defaults hardcode MYR | `exchange_rates` table; service effective-date lookup; exchange-rate snapshots on invoices/receipts/JEs; forex JE in allocation RPC | Currency mismatch and rate validation exist. No live rate API; frontend can send manual/default values. | Batch 8B/8C: base-currency-driven UI and read-only currency/rate API. Remove hardcoded MYR labels. |
| 49 | Daily market FX rates for USD, SGD, MYR, other currencies | MISSING | No rate-sync UI or hook | `exchange_rates` schema and seed rows exist, but no external provider, scheduled sync, provenance, freshness API, or broad currency catalog | RLS protects config writes, but no daily market ingestion exists. | Separate FX integration batch: provider selection, scheduled job, source/timestamp, retry, holiday fallback, approval/override, and tests. |

## 4. Main UI button/function inventory

### 4.1 Real logic with backend support

| Area | Main controls | Backend support |
|---|---|---|
| Authentication | Sign in, sign out | Supabase Auth through `auth-provider.tsx` |
| Dashboard | Refresh | `GET /reports/dashboard?trend_months=6` |
| Invoice list/detail | New, Import, View, Post, Cancel, filters, pagination, retry | Invoice/import Edge Functions |
| Invoice creation | Back/Next, add/remove lines, create draft, create-and-post | Invoice API; post uses RPC |
| Receipt list/detail | New, Import, View, Post, Cancel, filters, pagination | Receipt API; post uses RPC |
| Receipt creation | Customer quick-create, bank selection, create draft/create-and-post | Customer, bank-account, receipt APIs |
| Allocation Wizard | Select receipt, add/remove invoice, fill max, FIFO preview, submit manual allocation | Invoice/receipt reads; `POST /allocations/manual` |
| Allocation history | Retry, filters, pagination, invoice/receipt links | `GET /allocations` |
| Imports | File selection, template copy, parse/validate/execute, reset, review approve/reject/edit/retry | Imports API |
| Reports | Report navigation, sorting/filtering | Reports/invoice/receipt/customer APIs |
| Customer quick-create | Create, cancel, apply name suggestion, select existing | `POST /customers/inline` |

### 4.2 Missing, inert, misleading, or backend-incomplete controls

| Control/page | Finding | Recommended action |
|---|---|---|
| Global search input (`components/layout/header.tsx`) | Placeholder; no state, submit, or API | Disable/remove or implement scoped search API |
| Notification bell | Hardcoded badge `3`; no click logic/API | Remove or mark unavailable |
| My Profile | Clickable with no handler | Remove/disable or add real profile route |
| AI sidebar | Placeholder shell | Keep out of operational navigation until implemented |
| Credit Notes page | Placeholder despite backend Edge Function | Implement reviewed UI later or hide navigation |
| Journal Entries page | Static explanatory cards; no live list API | Add read-only API/viewer or label as documentation |
| Audit Trail page | Hardcoded example rows; no live API | Remove example operational table; add real read API later |
| Report export buttons | Disabled “Coming Soon” | Safe but incomplete |
| Allocation reverse | Backend exists, no frontend action | Add in Batch 8B after role API/guard hardening |
| Bounced cheque / cheque clear | Backend exists, no frontend action | Add after real role API and negative tests |
| Invoice draft edit/delete/line CRUD | Backend exists, no frontend controls; backend role guard gaps | Harden first, then expose |
| Settings bank-account message | Stale claim that GET API is unavailable | Correct in Batch 8B |
| Frontend role matrix | Uses environment demo role | Replace with authenticated role API |

## 5. Repository search results

### 5.1 Mock/demo/placeholder/TODO/FIXME

Confirmed functional concerns:

- `frontend/src/hooks/use-invoices.ts`: mock tax codes and payment terms.
- `frontend/src/app/(dashboard)/settings/audit-log/page.tsx`: example audit data and no live API.
- `frontend/src/app/(dashboard)/journal-entries/page.tsx`: prototype placeholder.
- `frontend/src/app/(dashboard)/credit-notes/page.tsx`: frontend placeholder.
- `frontend/src/components/layout/header.tsx`: global search placeholder, inert notifications/profile.
- `frontend/src/app/(dashboard)/layout.tsx`: AI sidebar placeholder.
- `backend/supabase/functions/daily-overdue/index.ts`: notification placeholder.

Benign matches such as input `placeholder` attributes and demo/evidence comments were not treated as
functional defects.

### 5.2 Direct frontend Supabase financial-table access

No direct frontend financial table reads or writes were found:

- no `supabase.from(...)`;
- no `.from("invoices")`;
- no `.from("receipts")`;
- no `.from("allocation_details")`.

`createClient` appears only in `frontend/src/lib/supabase.ts`, used by the authentication provider
and token retrieval in `useApi()`.

### 5.3 Direct sensitive backend/database writes

Intended financial RPC writes are present in `database/007_financial_rpcs.sql`.

Additional direct service writes include:

- invoice cancellation sets `invoices.outstanding = 0` in
  `backend/supabase/functions/invoices/service.ts`;
- linked credit-note application adjusts invoice outstanding and inserts `cn_allocations` in the
  same service;
- receipt cancellation sets `receipts.unallocated_amount = 0` in
  `backend/supabase/functions/receipts/service.ts`;
- `ReceiptService.updateAllocationAmounts()` directly updates allocated/unallocated amounts and
  appears unused;
- import audit linkage inserts `import_row_allocations`, not `allocation_details`.

No application service direct `allocation_details` insert was found outside the financial RPC.
However, authenticated RLS policy `ad_insert` permits a client to insert directly if row checks pass.

### 5.4 `/allocations/auto`

- Edge route exists but always returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- Frontend hook throws locally and performs no request.
- Allocation page states auto-allocation is unavailable.
- `AllocationService.autoAllocate()` still contains executable internal logic but is not routed.

The route must remain disabled.

## 6. Currency and FX audit

Present:

- `exchange_rates` table with effective date and company/currency unique key;
- RLS configuration policies;
- service lookup of latest effective rate;
- transaction exchange-rate snapshots on invoices, receipts, allocations, and journal entries;
- base-currency amounts;
- forex gain/loss calculation and JEs during allocation;
- frontend selectors for MYR, SGD, and USD.

Missing/partial:

- no external market-rate provider;
- no daily scheduled synchronization;
- no source/provenance/fetched-at metadata;
- no freshness or stale-rate guard;
- no read API for rates/currency catalog;
- no “other currency” dynamic selector;
- hardcoded MYR defaults/labels in company store and several invoice/receipt/report components;
- invoice form mock/config dependencies prevent a fully data-driven currency/config experience.

## 7. Test, smoke, and evidence coverage

Strong existing evidence:

- `database/006b_rls_tests.sql`
- `database/007b_financial_rpcs_smoke_tests.sql`
- `database/008b_import_rls_smoke_tests.sql`
- `tests/curl/import-phase-*.ps1`
- `docs/evidence/production-smoke/P1_PRODUCTION_SMOKE_TEST_SUMMARY.md`
- Batch 3–6 remediation evidence
- Sprint F4 import evidence
- Batch 7A/7B production evidence

Coverage weaknesses:

- no maintained TypeScript unit-test framework or test script;
- no unit tests for fuzzy scoring, frontend allocation calculations, import count semantics, or
  currency calculations;
- no automated endpoint/role matrix covering every Edge Function;
- no automated assertion that sensitive financial DML is impossible outside RPCs;
- no automated UI test suite for all main buttons.

## 8. Top confirmed implemented items

1. Manual one-receipt-to-many-invoice allocation through the verified allocation RPC.
2. Overpayment preservation as unapplied cash.
3. Invoice and receipt posting through verified RPCs.
4. Allocation reversal and bounced-cheque backend/RPC logic.
5. CSV/XLSX invoice and receipt import with validation/review flows.
6. Conservative fuzzy suggestions with explicit human resolution.
7. Customer quick-create through backend validation.
8. Tenant isolation and AR Clerk customer-assignment scoping.
9. Allocation history API/UI.
10. Live production dashboard and report APIs.
11. Read-only active bank-account API.
12. No direct frontend financial-table access.

## 9. Top missing items

1. PDF/image/OCR import.
2. Daily market FX provider and synchronization.
3. Real tax-code and payment-term lookup APIs/frontend integration.
4. Real audit-log viewer/API.
5. Real journal-entry list/drill-down UI/API.
6. Real global search, notification, and profile behavior.
7. Credit-note frontend.
8. Automated system approval.
9. Comprehensive automated unit/API/UI test suite.

## 10. High-risk partial items

1. Direct authenticated RLS insert/update access to `allocation_details`, invoices, receipts, and
   journal tables.
2. Missing explicit role guards on invoice draft update/delete and line mutation service methods.
3. System Admin included in full customer/operational read access helpers.
4. Hidden/deleted flags absent from the core RLS customer-access helper.
5. Financial cancellation/CN workflows are multi-step service writes rather than a clearly atomic
   RPC boundary.
6. Frontend permissions derive from `NEXT_PUBLIC_DEMO_USER_ROLE`, not authenticated backend roles.
7. Receipt import Auto-Post & Allocate defaults ON and creates real financial records after Execute.
8. Unused executable auto-allocation and direct balance-update helper code remains in services.

## 11. Exact recommendation for Batch 8B

**Batch 8B — Financial Mutation Boundary and Role/Visibility Hardening**

Required scope:

1. Add a real read-only authenticated role/context API (`/auth/me` or equivalent) and replace the
   frontend demo-role fallback.
2. Add explicit operational-role guards to every invoice draft/header/line update/delete service
   method and explicit read-role/customer/visibility guards to allocation preview.
3. Remove System Admin from operational financial read scopes while preserving configuration access.
4. Harden hidden/deleted-customer filtering in RLS and shared server helpers.
5. Introduce a separately reviewed migration that prevents authenticated clients from directly:
   - inserting/updating `allocation_details`;
   - updating invoice outstanding/status financial fields;
   - updating receipt allocated/unallocated financial fields;
   - inserting/updating journal financial rows outside approved RPC/service execution.
6. Document a canonical mutation matrix: endpoint → service → RPC → tables → required role.
7. Add negative SQL/API tests proving direct DML and unauthorized roles fail.
8. Add safe frontend actions for reverse allocation and bounced cheque only after items 1–7 pass.
9. Replace mock tax/payment-term data with real read-only APIs, or split this into Batch 8C if the
   security batch must remain minimal.
10. Keep `POST /allocations/auto` disabled and do not modify existing financial RPC behavior without
    a separate explicit approval.

Production sequence:

1. review migration and guard changes;
2. apply and smoke in staging;
3. run role/tenant/direct-DML regression matrix;
4. run authenticated frontend staging smoke;
5. Codex review;
6. backend-first production deployment;
7. production read-only/negative smoke;
8. frontend release.

## 12. Is implementation safe to proceed?

**Yes, but only for the recommended Batch 8B scope and only after explicit approval.**

It is not safe to proceed directly to autonomous posting/allocation, OCR-created transactions, or
daily FX automation. The next implementation should first close the financial DML, role, System
Admin, and hidden/deleted-customer enforcement gaps. Generic auto-allocation must remain disabled.
