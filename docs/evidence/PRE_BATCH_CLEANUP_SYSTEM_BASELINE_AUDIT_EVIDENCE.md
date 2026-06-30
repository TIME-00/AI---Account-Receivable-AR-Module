# Pre-Batch Cleanup & System Baseline Audit Evidence

## Final conclusion

Result: **PASS WITH DEFERRED CLEANUP**.

The repository, staging, and production baselines were inspected before the next functional batch. Conservative test/smoke/demo data discovery found candidates in both staging and production, but no records were cleaned because none met the safe Category A/B cleanup threshold.

All discovered candidates were classified as one of:

- protected financial records that must not be direct-deleted;
- append-only import audit evidence;
- hidden/deferred audit/demo evidence;
- active fixture/customer records requiring explicit user approval before action.

No production or staging records were created, imported, deleted, reversed, cancelled, hidden, or mutated during this audit.

## Scope

Audit scope:

- local repository baseline;
- production frontend reachability;
- staging and production Supabase Edge Function inventory;
- staging and production database catalog/RLS/privilege posture;
- conservative test/smoke/demo data discovery;
- cleanup eligibility classification;
- read-only / negative-only verification.

Hard boundaries preserved:

- `/allocations/auto` remains disabled.
- No direct insert into `allocation_details`.
- No direct update to `invoices.outstanding`.
- No direct update to `receipts.allocated_amount` or `receipts.unallocated_amount`.
- No direct deletion of protected financial records.
- No financial RPC happy-path execution.
- No production fixtures/imports/create-record flows.
- No mock dashboard data reintroduced.

## Environment checked

| Environment | Project/ref | Result |
| --- | --- | --- |
| Repository | `main` | Clean and aligned with `origin/main` |
| Production frontend | `https://account-receivable-module.vercel.app/` | HTTP 200, `Server: Vercel` |
| Production Supabase | `kusseuycqgdilychphpq` | Checked |
| Staging Supabase | `gcdsdyegwjdcskpukqlq` | Checked |

Git baseline:

- Branch: `main`
- Commit checked: `08aec992e93436b05212dbc35719c5d9eb36ec06`
- `HEAD` matched `origin/main`.
- Worktree was clean before audit.

## Commands/checks run

Representative commands/checks:

- `git branch --show-current`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git status --short --untracked-files=all`
- `rg -n -F 'AUTO_ALLOCATION_DISABLED' backend/supabase/functions frontend/src`
- `rg -n -F 'autoAllocate' backend/supabase/functions frontend/src`
- `rg -n "mock|placeholder|TODO|FIXME|sample" frontend/src ...`
- production frontend HTTP HEAD via .NET `HttpClient`
- `supabase functions list --project-ref kusseuycqgdilychphpq -o json`
- `supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json`
- `supabase link --project-ref gcdsdyegwjdcskpukqlq`
- `supabase link --project-ref kusseuycqgdilychphpq`
- read-only Supabase `db query --linked` catalog/data discovery SQL
- read-only / negative-only production API smoke using Finance Manager token

No deployment, SQL mutation, import execution, fixture execution, user creation/reset, or financial-record mutation command was run.

## Phase 1 — Repository and deployment baseline

### Git baseline

- Current branch: `main`.
- Latest commit: `08aec992e93436b05212dbc35719c5d9eb36ec06`.
- `HEAD` matched `origin/main`.
- Worktree clean.

### Frontend baseline

- Production frontend URL returned HTTP 200.
- Server header: `Vercel`.
- Exact Vercel commit metadata was not checked in this audit.

### Edge Function inventory

Production functions:

| Function | Status | Version | JWT |
| --- | --- | ---: | --- |
| `allocations` | ACTIVE | 13 | true |
| `bank-accounts` | ACTIVE | 2 | true |
| `credit-notes` | ACTIVE | 8 | true |
| `customers` | ACTIVE | 14 | true |
| `daily-overdue` | ACTIVE | 6 | false |
| `debit-notes` | ACTIVE | 8 | true |
| `imports` | ACTIVE | 20 | true |
| `invoices` | ACTIVE | 19 | true |
| `receipts` | ACTIVE | 13 | true |
| `reports` | ACTIVE | 12 | true |

Staging functions:

| Function | Status | Version | JWT |
| --- | --- | ---: | --- |
| `allocations` | ACTIVE | 5 | true |
| `bank-accounts` | ACTIVE | 1 | true |
| `customers` | ACTIVE | 1 | true |
| `imports` | ACTIVE | 7 | true |
| `invoices` | ACTIVE | 6 | true |
| `receipts` | ACTIVE | 3 | true |
| `reports` | ACTIVE | 5 | true |

### Migration / catalog baseline

Production migration history table `supabase_migrations.schema_migrations` was not available through the read-only query path used in this audit. Batch 8D/8D-Fix1 applied state was therefore verified through resulting catalog state:

- Batch 8D helper functions exist.
- Batch 8D protected financial DML/RPC boundary remains enforced.
- Batch 8D-Fix1 legacy SELECT policies are absent.
- Replacement `cust_select` / `inv_select` policies remain.

### `/allocations/auto`

- Source scan confirmed `AUTO_ALLOCATION_DISABLED` remains in `backend/supabase/functions/allocations/index.ts`.
- Production API smoke confirmed `POST /allocations/auto` returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.

### Mock / placeholder scan

No mock dashboard data was found.

Known non-dashboard placeholders/mocks remain and were not changed:

- `frontend/src/hooks/use-invoices.ts` contains mock tax-code/payment-term option fallback comments/data.
- layout/header search remains a placeholder future UI element.
- login/form placeholders are normal input placeholders.

These are baseline observations only; no implementation was performed.

## Phase 2 — Test data discovery

Discovery used conservative markers:

- `test`
- `smoke`
- `fixture`
- `demo`
- `codex`
- `claude`
- `sample`
- `temp`
- `B8C-FULLSMOKE`
- `B8C-FIX1`
- `B8F2-XLSXSEC`
- `PROD-SMOKE`
- `CUST-00003`

Tables inspected:

- `customers`
- `invoices`
- `receipts`
- `allocation_details`
- `import_batches`
- `import_rows`
- `import_files`

### Staging discovery summary

Candidate counts:

| Table | Category | Count |
| --- | --- | ---: |
| `customers` | E — requires approval | 5 |
| `import_batches` | D — keep append-only audit evidence | 38 |
| `import_files` | D — keep import file metadata evidence | 5 |
| `import_rows` | D — keep import row audit evidence | 50 |
| `invoices` | C — protected financial record | 1 |
| `invoices` | D — cancelled/zero audit-safe evidence | 10 |
| `receipts` | D — cancelled/zero audit-safe evidence | 5 |

Notable staging candidates:

- `B8C-FULLSMOKE-*` invoices/receipts/import evidence.
- `B8C-FIX1-IMPORT-*` invoices/receipts/import evidence.
- `B8F2-XLSXSEC-*` invoices/receipts/import evidence.
- Older F4 Phase A/B import smoke audit evidence.
- Older RLS/API fixture customers such as `P1API-CUST-*` and `RLS-CUST-*`.

### Production discovery summary

Candidate counts:

| Table | Category | Count |
| --- | --- | ---: |
| `allocation_details` | C — protected financial allocation record | 23 |
| `customers` | D — hidden/deferred evidence | 2 |
| `customers` | E — requires approval | 2 |
| `import_batches` | D — keep append-only audit evidence | 37 |
| `import_files` | D — keep import file metadata evidence | 29 |
| `import_rows` | D — keep import row audit evidence | 144 |
| `invoices` | C — protected financial record | 68 |
| `invoices` | D — cancelled/zero audit-safe evidence | 1 |
| `receipts` | C — protected financial record | 32 |
| `receipts` | D — cancelled/zero audit-safe evidence | 1 |

Notable production candidates:

- historical Batch 3 / Batch 4 smoke customers and financial records;
- `PROD-SMOKE-*` customer/invoice/receipt/allocation records;
- Batch 5/6 import smoke batches and rows;
- `CUST-00003`, documented in older evidence as hidden/re-hidden demo/test customer evidence;
- many import batch/row/file records that are append-only audit evidence.

## Phase 3 — Safe cleanup decision

No records were cleaned.

Reason:

- Category A: no clearly disposable non-financial records were identified.
- Category B: no records were identified where cleanup was both clearly safe and available through a supported application/RPC path without audit-trail risk.
- Category C: protected financial records were not touched.
- Category D: audit/evidence/demo consistency records were intentionally retained.
- Category E: active fixture/customer records require explicit user approval before action.

Before/after counts therefore remained unchanged.

### Staging before/after counts

| Table | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `allocation_details` | 5 | 5 | 0 |
| `customers` | 5 | 5 | 0 |
| `import_batches` | 45 | 45 | 0 |
| `import_files` | 45 | 45 | 0 |
| `import_rows` | 55 | 55 | 0 |
| `invoices` | 34 | 34 | 0 |
| `receipts` | 13 | 13 | 0 |

### Production before/after counts

| Table | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `allocation_details` | 26 | 26 | 0 |
| `customers` | 908 | 908 | 0 |
| `import_batches` | 65 | 65 | 0 |
| `import_files` | 65 | 65 | 0 |
| `import_rows` | 155 | 155 | 0 |
| `invoices` | 1128 | 1128 | 0 |
| `receipts` | 40 | 40 | 0 |

## Phase 4 — Verification after cleanup decision

Because no data cleanup was performed, verification confirms baseline integrity rather than post-mutation state.

### Production API verification

Using Finance Manager token:

| Check | Result |
| --- | --- |
| `GET /reports/dashboard?trend_months=6` | HTTP 200 |
| `GET /invoices` | HTTP 200 |
| `GET /receipts` | HTTP 200 |
| `GET /reports/aging` | HTTP 200 |
| `GET /imports` | HTTP 200 |
| `POST /allocations/auto` | HTTP 403 `AUTO_ALLOCATION_DISABLED` |

### Production catalog/RLS/privilege verification

Passed:

- `rls_has_operational_read_access(uuid)` exists.
- `rls_can_access_customer(uuid, uuid)` exists.
- `customers: Temp Allow All` absent.
- `invoices: Temp Allow All` absent.
- `customers: cust_select` present.
- `invoices: inv_select` present.
- `authenticated` direct `INSERT`, `UPDATE`, and `DELETE` denied on protected financial tables checked.
- `authenticated` protected financial RPC execution denied.
- `service_role` retains protected financial RPC execute privilege.

Dashboard API returned HTTP 200. The production dashboard RPC signature is:

- `get_ar_dashboard_metrics(p_company_id uuid, p_user_id uuid, p_scope_mode text, p_as_of_date date, p_trend_months integer)`

### Staging catalog/RLS/privilege verification

Passed:

- `get_ar_dashboard_metrics(uuid, uuid, text, date, integer)` exists.
- `rls_has_operational_read_access(uuid)` exists.
- `rls_can_access_customer(uuid, uuid)` exists.
- `customers: Temp Allow All` absent.
- `invoices: Temp Allow All` absent.
- `customers: cust_select` present.
- `invoices: inv_select` present.
- `authenticated` direct `INSERT`, `UPDATE`, and `DELETE` denied on protected financial tables checked.
- `authenticated` protected financial RPC execution denied.
- `service_role` retains protected financial RPC execute privilege.

Staging API smoke was not run because the active role-token environment was production-targeted. Production tokens were not used against staging.

## Records cleaned

None.

## Records deferred

Deferred cleanup includes:

- all staging and production protected financial records identified by smoke/demo markers;
- all append-only import batch/row/file audit evidence;
- hidden/deferred demo/test customers such as `CUST-00003` and `PROD-SMOKE-CUST`;
- historical production smoke customers and financial records that may require dedicated supported cancellation/reversal/hide workflows and explicit approval.

## Records requiring user approval

Examples requiring explicit approval before action:

- staging `P1API-CUST-*` and `RLS-CUST-*` fixture customers;
- production `Batch 3 Smoke Test Sdn Bhd`;
- production `Batch 4 Smoke Test Sdn Bhd`;
- any active financial records linked to historical smoke/demo customers.

## Risks and uncertainties

- Production contains historical smoke/demo financial records, including active allocations and open/active financial records. These were intentionally not touched because direct deletion or direct balance updates would violate safety boundaries.
- Some older import evidence is append-only and intentionally retained for audit consistency.
- Some active fixture customers may be safe to hide or retire later, but that requires explicit user approval and a supported visibility/change path.
- Staging API smoke was skipped because only production-targeted role tokens were active during this audit.
- GitHub still reports two moderate dependency vulnerabilities from the previously accepted non-blocking dependency state.

## Final recommendation

Proceed to the next functional/demo-readiness batch.

Recommended follow-up cleanup path:

1. Create a separate final cleanup batch for historical smoke/demo records.
2. For each customer/financial chain, decide whether to keep as audit evidence, hide customer, reverse/cancel through supported APIs, or leave permanently as test history.
3. Do not direct-delete protected financial records.
4. Do not direct-update financial balances.
5. Treat production cleanup as approval-gated and auditable.

Final status: **PASS WITH DEFERRED CLEANUP**.
