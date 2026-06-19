# Sprint Batch 8B — Financial Mutation Boundary and Role/Visibility Hardening — Evidence

**Project:** GenAI-assisted Accounts Receivable (AR) module
**Batch:** 8B — Financial Mutation Boundary and Role/Visibility Hardening
**Baseline:** `0d7b88e docs(audit): record Batch 8A functional completeness audit`
**Status:** Implemented locally; not deployed, committed, or pushed
**Date:** 2026-06-19

## 1. Scope completed

Batch 8B closes the direct authenticated financial-DML boundary and the role/customer-visibility
gaps identified by the Batch 8A audit:

- Added an operational-read RLS helper that permits AR Clerk, AR Supervisor, Finance Manager, and
  Auditor, while excluding System Admin from operational customer and financial data.
- Hardened customer-access RLS to reject hidden/deleted customers and retain AR Clerk assignment
  scope.
- Hardened journal-entry child access so System Admin cannot read journal lines through the legacy
  company-access helper.
- Removed authenticated direct DML privileges and write policies from protected financial tables.
- Restricted existing financial mutation RPC execution to `service_role`.
- Added explicit AR Clerk guards and customer visibility/assignment checks to invoice draft
  update/delete and line CRUD service methods.
- Hardened allocation preview with explicit allowed roles, tenant ownership, customer assignment,
  and visibility checks before candidate invoice lookup.
- Removed the unused executable `autoAllocate()` mutation method. FIFO and amount-match algorithms
  remain available only for read-only preview and user-confirmed manual allocation.

## 2. Files changed

| File | Change |
| --- | --- |
| `database/015_financial_mutation_boundary_hardening.sql` | New RLS, privilege, and RPC-execution boundary migration. |
| `database/015b_financial_mutation_boundary_smoke_tests.sql` | New transaction-rolled-back SQL security and service-role regression smoke. |
| `backend/supabase/functions/_shared/auth.ts` | Added operational read-role guard and removed System Admin from operational customer access helpers. |
| `backend/supabase/functions/customers/service.ts` | Operational customer lists now always exclude hidden/deleted customers. |
| `backend/supabase/functions/invoices/service.ts` | Added explicit AR Clerk, customer assignment, tenant, and visibility guards to draft/line mutations. |
| `backend/supabase/functions/allocations/service.ts` | Hardened preview guards and removed executable automatic-allocation mutation logic. |
| `tests/curl/batch-8b-security-smoke.ps1` | Added staging-only API/REST negative security smoke script. |
| `docs/evidence/SPRINT_BATCH_8B_FINANCIAL_BOUNDARY_HARDENING_EVIDENCE.md` | This evidence record. |

No frontend source file, existing financial RPC definition, receipt mutation service, customer
mutation logic, fixture, or generated file was changed.

## 3. Migration strategy

`database/015_financial_mutation_boundary_hardening.sql`:

- Creates `public.rls_has_operational_read_access(uuid)`.
- Replaces `public.rls_can_access_customer(uuid, uuid)` to require:
  - matching company;
  - visible and non-deleted customer;
  - an active operational read role;
  - an active customer assignment for AR Clerk.
- Replaces `public.rls_check_je(uuid, boolean)` so journal headers and lines use operational access,
  not broad company/config access.
- Recreates operational SELECT policies for customers, invoices, receipts, credit-control logs,
  journal entries, and report audit logs.
- Drops authenticated write policies and revokes authenticated `INSERT`, `UPDATE`, and `DELETE` on:
  - `invoices`;
  - `invoice_lines`;
  - `receipts`;
  - `allocation_details`;
  - `cn_allocations`;
  - `journal_entries`;
  - `journal_entry_lines`;
  - `credit_control_logs`;
  - `report_audit_logs`;
  - `import_row_allocations`.
- Preserves authenticated SELECT grants, with RLS remaining the row-level enforcement layer.
- Revokes direct `authenticated` execution and grants `service_role` execution for the existing
  financial RPCs:
  - `post_invoice`;
  - `post_receipt`;
  - `allocate_receipt`;
  - `reverse_allocation`;
  - `reverse_journal_entry`;
  - `handle_bounced_cheque`.

The migration does not replace or alter any financial RPC definition or business rule.

## 4. Server guard changes

### Shared authorization

- `requireOperationalReadRole()` permits AR Clerk, AR Supervisor, Finance Manager, and Auditor.
- `requireCustomerAccess()` invokes that guard and verifies the customer belongs to the selected
  company and is visible/non-deleted before applying role/assignment scope.
- `getCustomerAccessFilter()` invokes that guard and removes hidden/deleted customers from AR Clerk
  assignment results.
- System Admin remains eligible for configuration/admin access through the existing configuration
  helpers, but no longer receives operational customer/financial scope.
- The operational customer list always filters `is_hidden = false` and `is_deleted = false`;
  `include_deleted` cannot expose deleted customers through this API.

### Invoice draft mutation

The following methods now require AR Clerk before record lookup:

- `addLines()`;
- `updateLine()`;
- `deleteLine()`;
- `updateDraftInvoice()`;
- `deleteDraftInvoice()`.

Each method enforces tenant ownership through `requireDraftInvoice()`, then customer assignment and
visible/non-deleted customer checks. Line update/delete also verifies that the line belongs to the
specified invoice.

### Allocation preview and auto-allocation quarantine

- Preview allows AR Clerk, AR Supervisor, Finance Manager, and Auditor only.
- Preview checks receipt tenant ownership, customer access, and customer visibility before querying
  outstanding invoice candidates.
- The executable `autoAllocate()` mutation method and its input type were removed.
- `POST /allocations/auto` remains a hard-coded HTTP 403 with
  `AUTO_ALLOCATION_DISABLED`.
- `POST /allocations/manual`, allocation reversal, FIFO preview, and amount-match preview were not
  reimplemented or bypassed.

## 5. Tests added

### SQL smoke

`database/015b_financial_mutation_boundary_smoke_tests.sql` is staging/disposable-database only. It
runs inside one transaction and ends with `ROLLBACK`.

It verifies:

- authenticated `INSERT`, `UPDATE`, and `DELETE` privileges are absent on every protected table;
- authenticated direct execution is absent for all six protected financial RPCs;
- `service_role` retains execution for all six protected financial RPCs;
- a transaction-scoped `service_role` `post_invoice` happy path remains operational;
- AR Clerk sees assigned visible customers only;
- hidden/deleted and cross-tenant data are filtered;
- AR Supervisor, Finance Manager, and Auditor retain intended operational reads;
- Auditor remains unable to mutate invoices;
- System Admin retains company/config read/write access but cannot read operational customers,
  invoices, journal headers, or journal lines;
- direct invoice outstanding and invoice-line DML fail.

The SQL smoke was authored but not executed in this local-only implementation step.

### API/REST smoke

`tests/curl/batch-8b-security-smoke.ps1`:

- requires existing staging role tokens and creates no users or records;
- checks System Admin operational API denial;
- checks allowed-role read regressions;
- checks invoice draft mutation role guards using a non-existent UUID;
- checks allocation preview role/assignment/visibility guards;
- checks direct authenticated REST financial DML denial using a non-existent UUID;
- checks `POST /allocations/auto` remains HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

The API smoke was parsed but not executed. No staging credentials were used and no HTTP endpoint was
called in this implementation step.

## 6. Validation results

| Command/check | Result |
| --- | --- |
| `deno check invoices/index.ts allocations/index.ts customers/index.ts receipts/index.ts reports/index.ts` from `backend/supabase/functions/` | PASS |
| `npm.cmd run build` from `frontend/` | PASS; Next.js production build completed |
| PowerShell parser check for `tests/curl/batch-8b-security-smoke.ps1` | PASS |
| `git diff --check` | PASS; no whitespace errors |
| Secret scan over changed implementation/test files | PASS; no password, token, service key, or JWT value found |
| Auto-allocation search | No executable `autoAllocate()` service method remains; route remains disabled |
| Existing financial RPC file status | `database/007_financial_rpcs.sql` unchanged |
| Frontend source status | No frontend source changes |

An initial broad Deno check that included the unchanged imports function stopped because its remote
SheetJS dependency requires Deno import permission. The affected invoice and allocation functions
were then checked directly and passed.

## 7. Safety confirmations

- Existing financial RPC business logic was not modified.
- `POST /allocations/auto` was not enabled or called.
- No direct `allocation_details` insert was performed.
- No direct `invoices.outstanding` update was performed.
- No direct receipt allocation-balance update was performed.
- No fixture was executed.
- No staging or production data was mutated.
- No user, customer, invoice, receipt, allocation, or other financial record was created in any
  environment.
- OCR/PDF/image import, daily FX sync, bank-charge automation, and system auto-approval were not
  implemented.
- No Supabase or frontend deployment was performed.
- No commit or push was performed.

## 8. Remaining verification and risk

- Migration 015 and both smoke suites still require review before any staging application.
- SQL behavior is statically reviewed but not yet verified against the staging schema.
- The API smoke requires existing staging users/tokens for all required roles. It must not create
  replacement users or records without separate approval.
- The transaction-rolled-back SQL RPC happy path validates the trusted role boundary without
  persistent records, but it has not yet been executed.
- Restricting RPC execution to `service_role` depends on the current Edge Function architecture,
  where financial services use the service-role-backed admin client. Static inspection confirms
  that architecture; staging regression smoke is still required before release.

## 9. Current status

Batch 8B is implemented locally and passes static/type/build checks. It is ready for
post-implementation review before any staging migration, Edge Function deployment, commit, or push.
