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

## 10. Staging validation

**Validation time:** 2026-06-19 21:21:32 +08:00
**Staging project ref:** `gcdsdyegwjdcskpukqlq`
**Production project ref not targeted:** `kusseuycqgdilychphpq`
**Result:** PARTIAL — migration and SQL smoke passed; five Edge Functions deployed; `imports`
deployment failed before API smoke.

### CLI root recovery

The first migration attempt used:

```text
supabase db query --linked --file "..\..\database\015_financial_mutation_boundary_hardening.sql" --workdir "backend\supabase" --agent=no -o table
```

It failed before SQL execution with:

```text
Cannot find project ref. Have you run supabase link?
```

Local diagnosis confirmed that the valid Supabase CLI project root is `backend`, because it contains
`supabase/config.toml` and `supabase/.temp/project-ref` beneath it. Both available local project-ref
files contained staging ref `gcdsdyegwjdcskpukqlq`.

The corrected command was run from `backend`:

```text
supabase db query --linked --file "..\database\015_financial_mutation_boundary_hardening.sql" --agent=no -o table
```

### Migration 015

Migration `database/015_financial_mutation_boundary_hardening.sql` applied successfully to staging.
No broad migration push was used. Production was not targeted.

### SQL smoke

Command run from `backend`:

```text
supabase db query --linked --file "..\database\015b_financial_mutation_boundary_smoke_tests.sql" --agent=no -o table
```

Result: PASS (exit code 0). The smoke is transaction-scoped and ends with `ROLLBACK`.

A read-only post-check confirmed:

- synthetic Batch 8B companies: 0;
- synthetic Batch 8B customers: 0;
- synthetic Batch 8B invoices: 0;
- synthetic Batch 8B journal entries: 0;
- temporary `batch8b_*` test helpers: 0;
- `authenticated` cannot execute `post_invoice`;
- `service_role` can execute `post_invoice`.

No persistent financial test record remained.

### Staging Edge Function deployment

The following explicit staging deployments succeeded:

```text
supabase functions deploy invoices --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy allocations --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy customers --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy receipts --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy reports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

`receipts` and `reports` were deployed because they bundle the changed shared authorization helper.

The dependent `imports` deployment was attempted with:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: FAIL. Supabase returned HTTP 400 while bundling:

```text
Failed to bundle the function (reason: Cannot import from cdn.sheetjs.com:443
at .../supabase/functions/imports/xlsx.ts:6:34)
```

No retry or code change was attempted. Validation stopped at this failure.

### API and core regression smoke

Not run because the dependent `imports` deployment failed. Required staging token/ID availability
was therefore not evaluated in this run. `tests/curl/batch-8b-security-smoke.ps1` was not executed,
and no HTTP call to `POST /allocations/auto` was made during this validation attempt.

The deployed allocations route remains hard-coded to return HTTP 403 with
`AUTO_ALLOCATION_DISABLED`.

### Safety confirmation

- No production command or production deployment was run.
- No fixture was executed.
- No persistent staging financial record was created by the rollback-only SQL smoke.
- No financial RPC business logic was modified.
- No commit or push was performed after this evidence update.
- At the end of this validation attempt, the remaining blocker was the `imports` SheetJS dependency
  source. Section 11 records its subsequent resolution and the remaining credential blocker.

## 11. Imports dependency recovery

**Recovery date:** 2026-06-19

### Root cause and minimal fix

The imports function-level dependency configuration mapped:

```text
xlsx -> https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs
```

Supabase remote bundling could not reach `cdn.sheetjs.com:443`. The XLSX parser itself used only the
standard SheetJS `read`, `utils`, and `SSF` APIs and did not require a behavior change.

The minimal dependency-only fix changed
`backend/supabase/functions/imports/deno.json` to:

```text
xlsx -> npm:xlsx@0.18.5
```

No parser, import workflow, financial service, frontend, migration, RLS policy, or financial RPC
business logic was changed.

### Local validation

The following checks passed:

```text
deno check --config imports/deno.json imports/index.ts
deno check --config imports/deno.json imports/xlsx.ts
git diff --check
```

The pinned npm dependency resolved successfully and the unchanged parser type-checked. Secret scan,
protected-path checks, and the hard-coded `AUTO_ALLOCATION_DISABLED` route check also passed.

### Staging deployment

Only `imports` was deployed:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. The staging `imports` function is `ACTIVE` at version 4.

### API and core regression blocker

The authenticated Batch 8B API smoke and core regression checks were not run because the current
process environment does not contain the required staging credentials:

- `SUPABASE_URL`;
- `SUPABASE_ANON_KEY`;
- `COMPANY_ID`;
- `AR_CLERK_TOKEN`;
- `AR_SUPERVISOR_TOKEN`;
- `FINANCE_MANAGER_TOKEN`;
- `AUDITOR_TOKEN`;
- `SYSTEM_ADMIN_TOKEN`.

Optional existing staging IDs for deeper assignment/visibility checks are also unavailable:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

No users or records were created to work around the missing credentials. No API request, fixture,
import execution, or financial mutation was performed.

### Recovery safety confirmation

- Production was not targeted.
- No fixture or upload-ready import file was executed.
- No persistent staging or production financial record was created.
- Financial RPC business logic remains unchanged.
- `POST /allocations/auto` remains hard-coded HTTP 403 with `AUTO_ALLOCATION_DISABLED`; it was not
  called because authenticated staging credentials were unavailable.
- No commit or push was performed.

## 12. Authenticated staging API smoke attempt

**Attempt time:** 2026-06-19 21:42:03 +08:00

All required environment variables were present, and `SUPABASE_URL` was confirmed to target staging
project `gcdsdyegwjdcskpukqlq`. Variable values were not printed.

The following optional existing-record IDs were unavailable, so their deeper checks were expected to
be skipped:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

The security smoke was invoked with:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

Result: FAIL before the first System Admin operational-denial assertion completed. Windows
PowerShell `Invoke-WebRequest` threw:

```text
Object reference not set to an instance of an object.
tests/curl/batch-8b-security-smoke.ps1:74
```

Validation stopped immediately. The script was not modified or retried. The read-only core
regression checks were not run.

No token value, password, cookie, or Supabase key was printed or written to this evidence file. No
production action, fixture execution, import execution, user creation, password reset, or persistent
financial-record mutation occurred. Financial RPC business logic remains unchanged.

The deployed route remains hard-coded to return HTTP 403 with `AUTO_ALLOCATION_DISABLED`, but that
negative HTTP assertion was not reached during this failed script run.

## 13. Windows PowerShell smoke harness recovery

### Root cause and harness fix

The original wrapper used Windows PowerShell 5.1 `Invoke-WebRequest` and depended on its exception
response object for expected HTTP 4xx responses. On the first expected denial response,
`Invoke-WebRequest` threw an internal `NullReferenceException` before the script could inspect the
status or JSON body.

Only `tests/curl/batch-8b-security-smoke.ps1` was changed. `Invoke-Status` now uses
`System.Net.Http.HttpClient` and:

- sends the same authorization, API key, and company headers;
- sends the same JSON request bodies;
- returns HTTP status and parsed JSON for both success and non-success responses;
- does not throw merely because the server returns HTTP 4xx/5xx;
- disposes request, response, and client objects;
- does not print token or key values.

The test cases and assertions were not broadened or converted into fixture/mutation tests.

### Local validation

- Windows PowerShell version: 5.1.
- PowerShell parser: PASS.
- `git diff --check`: PASS.
- Secret scan: PASS.
- Token-output scan: PASS.
- Backend source, frontend source, financial RPCs, migrations, and fixtures were unchanged by the
  harness fix.

### Fixed staging API smoke result

Command:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

Harness result: PASS — HTTP requests and expected non-2xx responses were processed without the
previous `Invoke-WebRequest` failure.

API/security result: FAIL. System Admin operational denial passed for `/customers` and `/invoices`,
then failed for receipts:

```text
System Admin must not read /receipts. Expected HTTP 403, got 200
```

Validation stopped immediately. The `/allocations` System Admin denial, allowed-role regressions,
invoice mutation guards, allocation preview guards, direct REST DML denials, and
`POST /allocations/auto` assertion were not reached in this run. Read-only core regression was not
run.

The optional receipt/customer ID checks remained skipped because these variables were unavailable:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

No token value was printed or written. No production action, fixture/import execution, user
creation, password reset, or persistent financial-record mutation occurred. Financial RPC business
logic remains unchanged. The source route for `POST /allocations/auto` remains hard-coded HTTP 403
with `AUTO_ALLOCATION_DISABLED`, but that negative assertion was not reached after the receipts
failure.

## 14. Receipts operational-read guard fix

**Validation time:** 2026-06-20 01:16:59 +08:00

### Root cause

The local receipt list inherited the operational-role denial indirectly through
`getCustomerAccessFilter()`, but the staging `receipts` function was still ACTIVE at version 2 with
its prior bundle. The earlier parallel deployment reported success without advancing the deployed
receipt version/hash. This left staging receipt reads without the Batch 8B shared authorization
behavior.

### Minimal fix

`backend/supabase/functions/receipts/service.ts` now calls `requireOperationalReadRole(auth)`
explicitly at the start of every operational receipt GET service path:

- receipt detail (`getReceiptById`);
- receipt list/search/filter (`listReceipts`);
- unallocated receipts by customer (`getUnallocatedReceipts`).

The existing tenant, customer assignment, and hidden/deleted visibility checks remain in place.
Receipt create, post, clear-cheque, cancel, bounced-cheque, allocation-balance behavior, and
financial RPC calls were not changed.

### Local validation

- `deno check receipts/index.ts`: PASS.
- Deno checks for invoices, allocations, customers, receipts, reports, and imports: PASS.
- PowerShell smoke parser: PASS.
- `git diff --check`: PASS.
- Secret scan: PASS.
- Protected migration, financial RPC, frontend, and fixture paths unchanged.
- `POST /allocations/auto` remains hard-coded with `AUTO_ALLOCATION_DISABLED`.

### Staging deployment

Only receipts was deployed, serially:

```text
supabase functions deploy receipts --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. Staging receipts is ACTIVE at version 3 with a new bundle hash.

### Security smoke rerun blocker

The smoke was rerun:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

It stopped on the first request because the current System Admin token was no longer accepted:

```text
System Admin must not read /customers. Expected HTTP 403, got 401
```

This run did not reach `/receipts`, so the deployed receipt denial could not be confirmed through
HTTP. No separate request or retry was made. Core read-only regression was not run.

Optional ID-based checks remained skipped because the five optional staging IDs were unavailable.

No token value was printed or written. No production action, fixture/import execution, user
creation, password reset, or persistent financial-record mutation occurred. Financial RPC business
logic remains unchanged. `POST /allocations/auto` remains disabled, but its negative assertion was
not reached in this run.

## 15. Fresh-token staging security smoke rerun

**Rerun time:** 2026-06-20 01:25:23 +08:00

All required environment variables were present and `SUPABASE_URL` matched staging project
`gcdsdyegwjdcskpukqlq`. No variable value was printed.

The five optional existing-record IDs remained unavailable, so their deeper checks were skipped:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

Command:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

Result: PARTIAL/FAIL.

Checks completed before failure:

- System Admin operational denial passed for `/customers`, `/invoices`, `/receipts`, and
  `/allocations`.
- The receipts System Admin denial fix is therefore confirmed through staging HTTP.
- Allowed-role read regressions passed for AR Clerk customers, AR Supervisor invoices, Finance
  Manager receipts, and Auditor allocation history.
- Auditor and System Admin invoice draft mutation denial checks completed before the failing AR
  Clerk assertion.

Failure:

```text
AR Clerk should pass role guard and reach missing-record check.
Expected HTTP 404, got 500.
```

This occurred on `DELETE /invoices/ffffffff-ffff-4fff-8fff-ffffffffffff`.
Validation stopped. Allocation preview checks, direct authenticated REST DML checks,
`POST /allocations/auto`, and the separate read-only core regression were not reached.

No token value was printed or written to a file or this evidence record. No production action,
fixture/import execution, user creation, password reset, or persistent staging financial-record
mutation occurred. Financial RPC business logic remains unchanged. The auto-allocation route remains
hard-coded disabled, but its negative HTTP assertion was not reached in this rerun.

## 16. Invoice missing-record error handling fix

**Validation time:** 2026-06-20 03:25:25 +08:00

### Root cause

Invoice draft and line mutation paths used the shared `fetchById()` helper. That helper uses
Supabase `.single()`, and a zero-row result is returned as a query error. The helper converted that
condition into a generic `Error`, which the API error handler correctly mapped to HTTP 500 instead
of `NotFoundError`/HTTP 404.

### Minimal invoice-local fix

`backend/supabase/functions/invoices/service.ts` now has invoice-local helpers using
`.maybeSingle()`:

- `fetchInvoiceOrThrow()`;
- `fetchInvoiceLineOrThrow()`.

They map an absent row to `NotFoundError` while retaining generic HTTP 500 behavior for real query
failures. The helpers are used by:

- draft invoice update/delete and line-add validation through `requireDraftInvoice()`;
- invoice line update/delete;
- invoice detail;
- invoice cancellation.

Authorization, tenant, assignment, hidden/deleted customer checks, invoice create/post behavior, and
financial RPC business logic were not changed.

### Local validation

- `deno check invoices/index.ts`: PASS.
- Deno checks for invoices, allocations, customers, receipts, reports, and imports: PASS.
- PowerShell smoke parser: PASS.
- `git diff --check`: PASS.
- Secret scan: PASS.
- Financial RPC, migration 015/015b, frontend, and fixture paths unchanged.
- `POST /allocations/auto` remains hard-coded with `AUTO_ALLOCATION_DISABLED`.

### Staging deployment

Only invoices was deployed:

```text
supabase functions deploy invoices --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. Staging invoices is ACTIVE at version 5 with a new bundle hash.

### Security smoke rerun blocker

The full smoke was rerun, but stopped on its first request:

```text
System Admin must not read /customers. Expected HTTP 403, got 401
```

The current System Admin token was no longer accepted, so the invoice missing-record assertion was
not reached and could not be confirmed through staging HTTP in this run. No retry or isolated
request was made. Core read-only regression was not run.

No token value was printed or written. No production action, fixture/import execution, user
creation, password reset, or persistent financial-record mutation occurred. Financial RPC business
logic remains unchanged. `POST /allocations/auto` remains disabled, but its negative assertion was
not reached.

## 17. Fresh-token staging security smoke rerun

**Validation time:** 2026-06-20 22:28:13 +08:00

### Environment preflight

All required staging environment variables were present, and `SUPABASE_URL` matched staging project
`gcdsdyegwjdcskpukqlq`. Values were not printed or written.

The following optional identifiers were unavailable, so their deeper visibility checks remained
skipped:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

### API/security smoke result

Command:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

Result: PARTIAL/FAIL.

Checks completed before failure:

- System Admin operational API denial checks passed.
- Allowed operational/read-role regression checks passed.
- Invoice draft mutation role guards passed, including the deployed missing-invoice behavior:
  an allowed AR Clerk reached HTTP 404 rather than HTTP 500.
- Allocation preview role-denial checks passed before the allowed-role missing-record assertion.

Failure:

```text
AR Clerk should pass preview role guard and reach missing-record check.
Expected HTTP 404, got 500.
```

The failing request used a nonexistent receipt ID for allocation preview. This indicates that the
allowed-role allocation-preview missing-record path still maps an absent receipt to HTTP 500 rather
than `NotFoundError`/HTTP 404.

Validation stopped immediately. Direct authenticated REST financial-DML denial checks,
`POST /allocations/auto`, and the separate read-only core regression were not reached.

No production action, fixture/import execution, user creation, password reset, or persistent
staging financial-record mutation occurred. No token value was printed, written to files, or added
to evidence. Financial RPC business logic remains unchanged. `POST /allocations/auto` remains
hard-coded disabled, but its HTTP negative assertion was not reached in this rerun.

## 18. Allocation preview missing-receipt fix and staging rerun

**Validation time:** 2026-06-20 22:33:02 +08:00

### Root cause and minimal fix

`AllocationService.previewAutoAllocation()` used the shared `fetchById()` helper. The helper uses
Supabase `.single()` and converts a zero-row result into a generic `Error`, which is returned as
HTTP 500.

Only `backend/supabase/functions/allocations/service.ts` was changed for this defect. The preview
receipt lookup now uses `.maybeSingle()` and:

- maps an absent receipt to `NotFoundError`/HTTP 404;
- retains HTTP 500 for actual query failures;
- retains HTTP 404 for a receipt outside the requested company;
- performs customer assignment and hidden/deleted visibility checks before querying candidate
  invoices.

No allocation mutation path, financial RPC business logic, balance field, or
`allocation_details` write was changed. No executable auto-allocation logic was introduced.

### Local validation

- `deno check allocations/index.ts`: PASS.
- Deno checks for invoices, allocations, customers, receipts, and reports: PASS.
- `deno check --config imports/deno.json imports/index.ts`: PASS.
- PowerShell smoke-script parser check: PASS.
- `git diff --check`: PASS.
- JWT-like value scan across changed files: PASS.
- `database/007_financial_rpcs.sql`, migrations 015/015b, frontend source, and fixture paths:
  unchanged.
- `POST /allocations/auto` remains hard-coded 403 with `AUTO_ALLOCATION_DISABLED`.
- No `autoAllocate()` executable mutation method exists.

The imports Deno check generated an untracked lockfile; it was removed as a local validation
artifact and was not deployed or retained.

### Staging deployment

Only allocations was deployed:

```text
supabase functions deploy allocations --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. The deployment targeted staging project `gcdsdyegwjdcskpukqlq` only.

### API/security smoke

Command:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

Result: PASS.

The smoke confirmed:

- System Admin operational API denial;
- allowed operational/read-role access;
- invoice draft mutation role guards;
- missing invoice mutation target returns HTTP 404;
- allocation preview role guard and missing receipt target returns HTTP 404;
- direct authenticated REST financial DML is denied;
- `POST /allocations/auto` returns HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

The following optional deep-visibility checks were skipped because identifiers were unavailable:

- `ASSIGNED_RECEIPT_ID`;
- `UNASSIGNED_RECEIPT_ID`;
- `HIDDEN_RECEIPT_ID`;
- `HIDDEN_CUSTOMER_ID`;
- `DELETED_CUSTOMER_ID`.

### Read-only core regression

Result: PARTIAL.

- invoices list: HTTP 200;
- receipts list: HTTP 200;
- allocation history: HTTP 200;
- dashboard: HTTP 200;
- bank accounts list: HTTP 404;
- imports list: HTTP 503;
- disabled auto-allocation: confirmed by the complete security smoke as HTTP 403 with
  `AUTO_ALLOCATION_DISABLED`.

The bank-accounts and imports endpoint availability failures are separate from the allocation
preview fix. No additional code change or deployment was made for them in this narrowly scoped
fix.

No production action, fixture/import execution, user creation, password reset, or persistent
staging financial-record mutation occurred. No token value was printed, written to files, or added
to evidence. Financial RPC business logic remains unchanged.

## 19. Read-only core endpoint availability recovery

**Validation time:** 2026-06-20 22:48:47 +08:00

### Bank accounts HTTP 404

Root cause: `bank-accounts` existed locally with a valid read-only `GET /bank-accounts` route but
was not deployed to staging. The staging function list did not contain the function, so the gateway
returned HTTP 404 before application routing.

No bank-accounts source change was required. The existing function was deployed only to staging:

```text
supabase functions deploy bank-accounts --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. `bank-accounts` is ACTIVE at staging version 1, and the authenticated read endpoint
returns HTTP 200.

### Imports HTTP 503

Root cause: the deployed imports function was ACTIVE in management metadata but returned
`BOOT_ERROR` at invocation. The temporary `npm:xlsx@0.18.5` import mapping bundled successfully but
did not start in the hosted Edge Runtime.

The only imports code/config change was the SheetJS dependency mapping in
`backend/supabase/functions/imports/deno.json`:

```text
xlsx -> https://esm.sh/xlsx@0.18.5?target=deno
```

The parser implementation and import workflow were not changed. The pinned Deno-targeted ESM
dependency passed local type checking and replaced both the inaccessible SheetJS CDN source and the
hosted-runtime-incompatible npm mapping.

Only imports was redeployed:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. `imports` is ACTIVE at staging version 5, and authenticated `GET /imports` returns
HTTP 200. No upload, parse, validate, review, execute, approve, reject, or retry route was called.

### Local validation

- `deno check bank-accounts/index.ts`: PASS.
- `deno check --config imports/deno.json imports/index.ts`: PASS.
- PowerShell smoke-script parser check: PASS.
- `git diff --check`: PASS.
- Protected financial RPC, migration 015/015b, frontend, and fixture paths: unchanged.
- `POST /allocations/auto` remains hard-coded disabled.
- No executable `autoAllocate()` mutation logic exists.

The Deno check generated an untracked lockfile, which was removed as a local validation artifact.

### Final staging verification

The complete Batch 8B API/security smoke passed:

```text
& '.\tests\curl\batch-8b-security-smoke.ps1'
```

It reconfirmed System Admin operational denial, allowed-role reads, invoice mutation guards,
missing-record HTTP 404 behavior, allocation preview guards, direct REST financial-DML denial, and
HTTP 403 `AUTO_ALLOCATION_DISABLED` for `POST /allocations/auto`.

The final read-only core regression passed:

- invoices list: HTTP 200;
- receipts list: HTTP 200;
- allocation history: HTTP 200;
- dashboard: HTTP 200;
- bank accounts list: HTTP 200;
- imports list: HTTP 200;
- disabled auto-allocation: HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

No production action, fixture/import execution, user creation, password reset, or persistent
staging financial-record mutation occurred. No token value was printed, written to files, or added
to evidence. Financial RPC business logic remains unchanged.
