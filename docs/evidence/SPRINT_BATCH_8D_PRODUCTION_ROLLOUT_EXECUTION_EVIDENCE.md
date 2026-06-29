# Sprint Batch 8D Production Rollout Execution Evidence

## Final rollout result

- Result: **COMPLETED WITH CONDITIONS**.
- Production target: `kusseuycqgdilychphpq`.
- Approved commit deployed/verified locally: `37f48aa93ed472e0927da1eb3bee8dfdda15534f`.
- Local `HEAD` and `origin/main`: `37f48aa93ed472e0927da1eb3bee8dfdda15534f`.
- Worktree status after rollout: clean.
- Corrected Supabase deploy working directory: `backend`.
- Corrected deploy command shape:
  - `supabase functions deploy <function> --project-ref kusseuycqgdilychphpq --use-api --yes`
- No manual Vercel deployment was run.
- No evidence commit/push was performed during rollout execution.

## Approved rollout scope executed

### Edge Functions

The reviewed production Edge Functions were deployed in the approved scope after correcting the CLI working directory:

| Function | Production result | Final version |
| --- | --- | ---: |
| `customers` | Deployed, ACTIVE | 14 |
| `invoices` | Deployed, ACTIVE | 19 |
| `receipts` | Deployed, ACTIVE | 13 |
| `allocations` | Deployed, ACTIVE | 13 |
| `reports` | Deployed, ACTIVE | 12 |
| `credit-notes` | Deployed because it was active/exposed | 8 |
| `debit-notes` | Deployed because it was active/exposed | 8 |
| `imports` | Deployed last, ACTIVE | 20 |
| `bank-accounts` | Not redeployed; already ACTIVE and health/smoke passed | 2 |
| `daily-overdue` | Not deployed; outside approved scope | 6 |

Pre-rollout versions available from production inventory:

| Function | Pre-rollout version | Post-rollout version |
| --- | ---: | ---: |
| `customers` | 13 | 14 |
| `invoices` | 18 | 19 |
| `receipts` | 12 | 13 |
| `allocations` | 12 | 13 |
| `reports` | 11 | 12 |
| `credit-notes` | 7 | 8 |
| `debit-notes` | 7 | 8 |
| `imports` | 19 | 20 |
| `bank-accounts` | 2 | 2 |
| `daily-overdue` | 6 | 6 |

### Database

- Applied only:
  - `database/015_financial_mutation_boundary_hardening.sql`
- Result: applied successfully to production.
- Not run:
  - `database/015b_financial_mutation_boundary_smoke_tests.sql`

## Production-safe privilege/catalog verification

Production-safe catalog checks were run after migration 015.

Passed checks:

- Protected financial table direct DML boundary passed.
- `authenticated` has no direct `INSERT`, `UPDATE`, or `DELETE` on protected financial tables checked.
- Protected financial RPC execution boundary passed.
- `authenticated` cannot execute protected financial RPCs checked.
- `service_role` retains execute privilege for protected financial RPCs checked.
- Helper functions exist:
  - `rls_has_operational_read_access(uuid)`
  - `rls_can_access_customer(uuid, uuid)`

Protected tables checked included:

- `invoices`
- `invoice_lines`
- `receipts`
- `allocation_details`
- `cn_allocations`
- `journal_entries`
- `journal_entry_lines`
- `credit_control_logs`
- `report_audit_logs`
- `import_row_allocations`

Protected RPCs checked included:

- `post_invoice`
- `post_receipt`
- `allocate_receipt`
- `reverse_allocation`
- `reverse_journal_entry`
- `handle_bounced_cheque`

## Important remaining condition

Production catalog verification found legacy broad SELECT policies still present:

- `customers`: `Temp Allow All`
- `invoices`: `Temp Allow All`

These were not fixed during this rollout evidence task. They remain a production condition requiring a separately reviewed production-safe SQL fix. The fix must not blindly re-grant financial DML or RPC access to `authenticated`.

## Function boot/read health

Function boot/read health passed with a Finance Manager token after adding the required `X-Company-Id` header.

Read health passed for:

- `customers`
- `invoices`
- `receipts`
- `allocations`
- `reports/dashboard`
- `reports/aging`
- `imports`
- `bank-accounts`

An earlier read-health attempt without `X-Company-Id` returned expected `400 VALIDATION_ERROR` responses and was corrected by adding the company header.

## Vercel production frontend verification

- Production frontend URL tested: `https://account-receivable-module.vercel.app/`
- Result: HTTP 200.
- Server header: `Vercel`.
- Exact Vercel deployment commit metadata could not be verified because:
  - no local Vercel CLI was available;
  - no `.vercel/project.json` was present;
  - no commit SHA was exposed in response headers.
- No manual Vercel production deployment was run.

## Minimum production smoke result

Approved read-only / negative-only smoke checks were run.

| Check | Result |
| --- | --- |
| `GET /reports/dashboard?trend_months=6` with Finance Manager | HTTP 200 |
| `GET /invoices` | HTTP 200 |
| `GET /receipts` | HTTP 200 |
| `GET /allocations` | HTTP 200 |
| `GET /reports/aging` with Finance Manager | HTTP 200 |
| `GET /imports` | HTTP 200 |
| `GET /bank-accounts` | HTTP 200 |
| `POST /allocations/auto` | HTTP 403 `AUTO_ALLOCATION_DISABLED` |

## Optional checks blocked by credentials

The following optional checks were not completed because the current optional role tokens returned HTTP 401:

- Auditor aging report check:
  - `GET /reports/aging` returned HTTP 401 with current Auditor token.
- System Admin operational-denial checks:
  - `GET /customers`
  - `GET /invoices`
  - `GET /receipts`
  - `GET /allocations`
  - each returned HTTP 401 with the current System Admin token.

These are recorded as optional credential issues, not backend smoke failures.

## Rollback / forward-fix note

- No rollback was executed.
- Edge Functions are active on the deployed versions listed above.
- Migration 015 has committed in production; prefer forward fix if a follow-up issue is found.
- Do not blindly re-grant protected financial DML or protected financial RPC access to `authenticated`.
- Any compensating SQL rollback or legacy policy cleanup must be separately reviewed and explicitly approved.
- Edge Function rollback, if ever required, must not reintroduce unsafe financial mutation behavior or SheetJS/xlsx `0.18.5`.

## Safety confirmations

- No production fixtures were run.
- No production import upload/parse/validate/execute was run.
- No production customers were created.
- No production invoices were created.
- No production receipts were created.
- No production allocations were created.
- No production users were created or reset.
- No production financial records were created or mutated.
- No direct financial-table mutation was performed.
- No direct `allocation_details` insert was performed.
- No direct `invoices.outstanding` update was performed.
- No direct `receipts.allocated_amount` or `receipts.unallocated_amount` update was performed.
- No direct financial-record delete was performed.
- No financial RPC business logic was modified.
- `/allocations/auto` remains disabled and returned HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No mock dashboard data was reintroduced.
- No dependency changes were made.
- No `npm audit fix`, `npm update`, or package install was run.
- No code change was made during evidence creation.
- No commit or push has been performed for this evidence file.

## Final status

Batch 8D production rollout execution is recorded as **COMPLETED WITH CONDITIONS**.

Remaining conditions:

1. Review and fix legacy broad SELECT policies on production `customers` and `invoices` through a separately approved production-safe SQL batch.
2. Refresh optional production Auditor/System Admin tokens if those optional role checks need to be completed.
3. Vercel exact commit metadata remains unavailable from local tooling/headers; runtime frontend availability was verified with HTTP 200.
