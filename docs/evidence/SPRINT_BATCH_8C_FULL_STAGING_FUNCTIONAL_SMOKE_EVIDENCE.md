# Batch 8C Full Staging Functional Smoke Evidence

## 1. Scope and result

- Validation date: 2026-06-22 (Asia/Kuala_Lumpur).
- Staging project: `gcdsdyegwjdcskpukqlq`.
- Company: `81000000-0000-0000-0000-000000000001`.
- Commit tested: `eebdf2394a84f33f46d6b8b8294d9db582af62c9`.
- Initial Batch 8C result: **PARTIAL**.
- Batch 8C-Fix1 result: **PASS**.
- Batch 8C-Fix2 result: **PASS**.
- Final Batch 8C status: **PASS**.
- The Auditor aging-report caveat is resolved.
- Core invoice, receipt, allocation, reversal, cancellation, dashboard, and readback flows passed.
- Remaining records are only cancelled, reversed, or append-only audit records with zero active
  financial balance.
- No production action occurred.
- No direct financial-table mutation occurred.
- No financial RPC business logic changed.
- No token values were written.
- Runtime CSV/XLSX files were removed.

The initial invoice-import and Auditor-report defects are retained below as historical findings and
their successful Fix1/Fix2 resolutions are recorded in Sections 7 and 8.

## 2. Preflight

- Local `HEAD` and `origin/main` matched the tested commit.
- Worktree was clean.
- `SUPABASE_URL` matched `https://gcdsdyegwjdcskpukqlq.supabase.co`.
- `COMPANY_ID` matched the target staging company.
- All five role tokens passed read-only validity checks without printing their values.
- `POST /allocations/auto` remained hard-coded disabled.
- No executable `autoAllocate()` mutation method was present.

Existing staging resources used:

- Customer: `P1API-CUST-001` (`85000000-0000-0000-0000-000000000001`).
- Bank account: `P1API-001` (`84000000-0000-0000-0000-000000000001`), SGD.

## 3. Core API business flow

Primary run reference:

`B8C-FULLSMOKE-20260620-20260622185444`

Created records:

- Invoice: `17545e86-359b-475c-a565-6f303665353c`.
- Receipt: `561a5e82-92cf-47a0-ac37-6d503d9159e7`.
- Allocation: `303c490a-566e-409d-afd4-1fa90eaf5670`.

Results:

- Draft invoice creation: PASS.
- Invoice line creation: PASS.
- Draft invoice update: PASS.
- Invoice posting: PASS; outstanding was 100 SGD.
- Missing invoice mutation target: PASS; HTTP 404 `NOT_FOUND`.
- Draft receipt creation: PASS.
- Receipt posting: PASS; unallocated amount was 80 SGD.
- Manual allocation: PASS; 60 SGD allocated through `POST /allocations/manual`.
- Invoice readback after allocation: PASS; outstanding was 40 SGD.
- Receipt readback after allocation: PASS; allocated/unallocated were 60/20 SGD.
- Allocation history readback: PASS.
- Allocation reversal: PASS.
- Balance restoration: PASS; invoice outstanding returned to 100 SGD and receipt balances returned
  to allocated/unallocated 0/80 SGD.
- Invoice cancellation: PASS.
- Receipt cancellation: PASS.
- `POST /allocations/auto`: PASS negative check; HTTP 403 `AUTO_ALLOCATION_DISABLED`.

Final states:

- Invoice: `Cancelled`, outstanding 0.
- Receipt: `Cancelled`, allocated/unallocated 0/0.
- Allocation: `Reversed`.

Two setup attempts occurred before the primary run:

- The first created draft invoice was deleted through the supported API after a local PowerShell
  assertion-type error.
- Invoice `0dd3c881-38cb-4762-b5da-4af8608cca72` was posted, then cancelled after receipt creation
  rejected unsupported payment method `EFT`. The supported `TT` method was used in the successful
  run.

Bounced-cheque handling was skipped. It creates a separate deliberate financial audit trail and was
not necessary to validate the mutation boundaries exercised by the primary flow.

## 4. Import functional smoke

Runtime files used the prefix:

`B8C-FULLSMOKE-20260620-20260622185546`

Four runtime files were generated under the OS temporary directory:

- invoice CSV;
- invoice XLSX;
- receipt CSV;
- receipt XLSX.

They were never added to the repository and were removed after validation.

### Invoice CSV

Import batch:

- Batch: `b061fc56-7c8b-426e-80eb-1db3bc3a3094`.
- Row: `7232ee82-2c97-461b-bd32-3b5db4d7cd59`.
- Created invoice: `c35ac36c-801f-4e58-b106-be9c307848ed`.

Upload, parse, validation, and execution completed. The row was marked `Created`, and its
`mapped_data.lines` contained one valid line. However, the created draft invoice contained no
invoice lines.

Consequences:

- Posting failed with `BR-INV-002: Invoice must have at least 1 line item`.
- Draft deletion failed with HTTP 500 because `import_rows.invoice_id` references the invoice:
  `import_rows_invoice_id_fkey`.

Safe cleanup:

- Added the same prefixed line through `POST /invoices/:id/lines`.
- Posted through the supported invoice API.
- Cancelled through the supported invoice API.
- Final state: `Cancelled`, outstanding 0.

Result: **FAIL**. The invoice import execution path reported success but did not persist its mapped
invoice line.

### Invoice XLSX and SheetJS

The prefixed XLSX file was generated successfully, but upload/parse/execute was not run after the
invoice CSV defect. Therefore the Batch 8B SheetJS parsing change was **not functionally verified**
by Batch 8C.

Result: **NOT RUN**.

### Receipt CSV and XLSX

Not run after the invoice CSV defect. No receipt import record was created.

Result: **NOT RUN**.

### Review queue

No review-required row was reached before validation stopped. No approve, reject, edit, or retry
action was executed.

Import batch/row metadata and its uploaded prefixed staging object remain as audit evidence. The
linked financial invoice is cancelled and has no active balance.

## 5. Reports and final readback

- Dashboard: HTTP 200.
- Aging report with Finance Manager: HTTP 200.
- Open invoice list: HTTP 200.
- Receipt list: HTTP 200.
- Allocation history: HTTP 200.
- Prefix audit: HTTP 200.

Auditor access to `GET /reports/aging` returned HTTP 403:

`This action requires AR Clerk or higher. Auditor role is read-only.`

The report itself is operational with Finance Manager, but this is a separate Auditor read-role
regression/caveat.

Final prefixed financial records:

- `0dd3c881-38cb-4762-b5da-4af8608cca72`: invoice `Cancelled`, outstanding 0.
- `17545e86-359b-475c-a565-6f303665353c`: invoice `Cancelled`, outstanding 0.
- `c35ac36c-801f-4e58-b106-be9c307848ed`: imported invoice `Cancelled`, outstanding 0.
- `561a5e82-92cf-47a0-ac37-6d503d9159e7`: receipt `Cancelled`, allocated/unallocated 0/0.
- `303c490a-566e-409d-afd4-1fa90eaf5670`: allocation `Reversed`.

No active open B8C financial balance remains.

## 6. Safety confirmation and remaining risks

- No production action occurred.
- No direct financial-table mutation was performed.
- No direct `allocation_details` insertion was performed.
- No direct invoice outstanding update was performed.
- No direct receipt allocated/unallocated update was performed.
- Financial mutations used supported Edge Function/service/RPC-backed flows only.
- Financial RPC business logic was not changed.
- No migration or deployment was performed.
- No token, JWT, password, cookie, or key value was printed or written.
- No commit or push was performed.

Findings at the end of the initial run (items 1–4 are resolved in Section 7):

1. Invoice import execution must persist its validated mapped lines before marking a row `Created`.
2. Imported draft cleanup semantics need review because the import-row foreign key blocks the
   supported draft deletion route.
3. Invoice and receipt XLSX parsing must be rerun after the invoice import defect is fixed.
4. Receipt CSV/XLSX import flows remain unverified.
5. Auditor aging-report access should be reconciled with the intended read-only role scope.

## 7. Batch 8C-Fix1 import persistence and cleanup recovery

**Validation time:** 2026-06-22 19:39:11 +08:00

### Corrected root cause

Source tracing showed that invoice import execution already passed validated `mapped_data.lines` to
`InvoiceService.createInvoice(auth, header, lines)`. The initial imported invoice lines were removed
by the later cleanup attempt:

1. `DELETE /invoices/:id` called `deleteDraftInvoice()`;
2. `deleteDraftInvoice()` deleted `invoice_lines` first;
3. invoice header deletion then failed because `import_rows.invoice_id` deliberately retains the
   invoice as import audit evidence;
4. the failed deletion left a draft invoice with no lines.

Therefore the observed line-less invoice was caused by non-atomic cleanup ordering, not by CSV/XLSX
mapping. The import audit foreign key behaved as designed, but the service mutated child rows before
checking whether the parent could be deleted.

### Fix applied

Only `backend/supabase/functions/invoices/service.ts` changed:

- invoice creation now verifies that the number of persisted lines matches the validated input;
- if line persistence or subsequent creation readback fails, the still-unlinked draft header and
  lines are cleaned up before the error is returned;
- imported draft deletion now checks `import_rows.invoice_id` before deleting any line;
- an imported draft returns HTTP 409 `CONFLICT` with instructions to use the supported post/cancel
  audit workflow;
- the delete denial preserves all invoice lines and totals.

No migration was needed. The append-only import audit constraint remains unchanged. Receipt import,
review queue, allocation, financial RPC, and frontend behavior were not changed.

### Local validation

- `deno check invoices/index.ts`: PASS.
- `deno check --no-lock --config imports/deno.json imports/index.ts`: PASS.
- Deno checks for invoices, receipts, allocations, customers, and reports: PASS.
- `git diff --check`: PASS.
- Secret/JWT scan: PASS.
- Generated runtime artifact scan: PASS.
- `database/007_financial_rpcs.sql`: unchanged.
- migrations 015/015b: unchanged.
- frontend and demo fixture paths: unchanged.
- `POST /allocations/auto`: still hard-coded disabled.
- no executable `autoAllocate()` mutation method exists.

### Staging deployment

The changed invoice service is bundled by both functions, so only these functions were deployed to
staging:

```text
supabase functions deploy invoices --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Results:

- invoices: ACTIVE version 6;
- imports: ACTIVE version 6.

No production deployment or migration was performed.

### B8C-FIX1 import tests

Runtime prefix:

`B8C-FIX1-IMPORT-20260622192930`

The four generated files were stored under the OS temporary directory, were never tracked, and were
removed after validation.

#### Invoice CSV

- Batch: `2086f38d-12ef-41af-8362-611cb9846459`.
- Invoice: `6db61cb5-4581-4def-9951-66c4d9043e87`.
- Upload/parse/validate/execute: PASS.
- Persisted lines: 1.
- Calculated total: 22 SGD for quantity 2 × unit price 11.
- Imported draft delete guard: HTTP 409 `CONFLICT`.
- Readback after denied deletion: line remained present.
- Posting: PASS.
- Cleanup: invoice `Cancelled`, outstanding 0.

#### Invoice XLSX / SheetJS

- Batch: `d7c46812-b4b5-4d43-bcb8-ca4f6a598c9f`.
- Invoices:
  - `e1b22a9a-9e2d-4d87-9f53-eb9bd4c26f54`;
  - `c4b12a31-c2f6-4b9b-96e8-fc5f44bb0bed`.
- SheetJS XLSX upload/parse: PASS.
- Valid rows: 2.
- Persisted lines: 1 per invoice.
- Posting: PASS.
- Cleanup: both invoices `Cancelled`, outstanding 0.

#### Receipt CSV

- Batch: `a6c1a80d-2b5f-45fc-a128-ef5f54f41515`.
- Receipt: `6d6c43a6-4c30-43b2-b313-8b3db81fb1a4`.
- Upload/parse/validate/execute with `auto_post=true`: PASS.
- Posted without invoice reference: PASS.
- Allocation state before cleanup: allocated 0; full amount remained unallocated.
- Cleanup: receipt `Cancelled`, allocated/unallocated 0/0.

#### Receipt XLSX / SheetJS

- Batch: `1afaa592-9608-4414-b265-9dda38cc2670`.
- Receipt: `9c332a81-af24-44a4-961f-bce66b3c9156`.
- SheetJS XLSX upload/parse: PASS.
- Execute with `auto_post=true`: PASS.
- Allocation state before cleanup: allocated 0; full amount remained unallocated.
- Cleanup: receipt `Cancelled`, allocated/unallocated 0/0.

No review-required rows were produced, so approve/reject/edit/retry actions were not applicable.

### Final readback and safety

- Dashboard: HTTP 200.
- Aging report with Finance Manager: HTTP 200.
- Open invoice list: HTTP 200.
- Receipt list: HTTP 200.
- Allocation history: HTTP 200.
- `POST /allocations/auto`: HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- Prefix audit: all five B8C-FIX1 financial records are cancelled with zero active balance.

Remaining B8C/B8C-FIX1 records are append-only import batch/row/upload audit evidence and financial
documents in valid `Cancelled`/`Reversed` states. No active open balance remains.

The earlier Auditor aging-report HTTP 403 caveat remains unresolved and should be reviewed
separately; the aging endpoint itself passed with Finance Manager.

- No production action occurred.
- No direct financial-table mutation occurred.
- No financial RPC business logic changed.
- No fixture execution occurred.
- No token value was printed or written.
- Runtime CSV/XLSX files were removed.
- No commit or push was performed.

## 8. Batch 8C-Fix2 Auditor report authorization

### Root cause

The non-dashboard report GET methods used `requireRole(auth, 'AR Clerk')`. That helper enforces
mutation-oriented role hierarchy and deliberately rejects Auditor, even though Batch 8B established
Auditor as an allowed operational read-only role.

Affected read-only methods:

- aging summary;
- aging by customer;
- customer statement.

Dashboard already used an explicit read-role list containing Auditor and excluding System Admin.

### Fix applied

Only `backend/supabase/functions/reports/service.ts` changed:

- replaced `requireRole(auth, 'AR Clerk')` with `requireOperationalReadRole(auth)` on all three
  non-dashboard report GET methods;
- retained AR Clerk assignment filtering through `getCustomerAccessFilter()` and
  `requireCustomerAccess()`;
- retained full operational read scope for AR Supervisor, Finance Manager, and Auditor;
- retained System Admin operational-report denial;
- did not change report calculations or financial RPC logic.

### Local validation

- `deno check reports/index.ts`: PASS.
- Deno checks for invoices, receipts, allocations, customers, and reports: PASS.
- `deno check --no-lock --config imports/deno.json imports/index.ts`: PASS.
- `git diff --check`: PASS.
- Secret/JWT scan: PASS.
- Generated artifact scan: PASS.
- Financial RPC, migration 015/015b, frontend, demo, and fixture paths: unchanged.
- `POST /allocations/auto` remains hard-coded disabled.
- No executable `autoAllocate()` mutation method exists.

### Staging deployment

Only reports was deployed:

```text
supabase functions deploy reports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: PASS. Production was not targeted.

### Authenticated staging retest

Fresh valid role tokens were used without printing or storing their values.

Results:

- Auditor aging summary: HTTP 200.
- Finance Manager aging summary: HTTP 200.
- System Admin aging summary: HTTP 403.
- Auditor aging by customer: HTTP 200.
- Auditor customer statement: HTTP 200.
- Finance Manager dashboard: HTTP 200.
- Auditor dashboard: HTTP 200.
- System Admin dashboard: HTTP 403.
- Auditor open invoice list: HTTP 200.
- Auditor receipt list: HTTP 200.
- `POST /allocations/auto`: HTTP 403 `AUTO_ALLOCATION_DISABLED`.

The first customer-statement test used ambiguous PowerShell interpolation in the local request path
and returned route-not-found. The corrected `${customer}` path immediately returned HTTP 200. This
was a smoke-harness invocation issue, not an application defect.

No user, password, financial record, fixture, import, or direct table mutation was created or
performed. No token value was printed or written. Financial RPC business logic remains unchanged.
The previous Auditor aging-report caveat is resolved.
