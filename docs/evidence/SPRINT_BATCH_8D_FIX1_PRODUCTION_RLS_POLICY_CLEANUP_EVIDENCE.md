# Sprint Batch 8D-Fix1 Production RLS Policy Cleanup Evidence

## Objective

Batch 8D-Fix1 removed legacy production SELECT RLS policies that bypassed the Batch 8B operational read/customer visibility helper path.

Result: **COMPLETED SUCCESSFULLY WITH OPTIONAL TOKEN CAVEAT**.

## Production target

- Production project ref: `kusseuycqgdilychphpq`.
- Production URL: `https://kusseuycqgdilychphpq.supabase.co`.
- Staging ref was absent from active environment values during verification.
- Local `HEAD` and `origin/main`: `203e68e444fa4292b558e87dbff1ea01b60de476`.
- Worktree status before/after verification: clean.

## Approved SQL applied

The following approved production SQL cleanup was applied:

```sql
BEGIN;

DROP POLICY IF EXISTS "Temp Allow All" ON public.customers;
DROP POLICY IF EXISTS "Temp Allow All" ON public.invoices;

DROP POLICY IF EXISTS "Allow AR Clerks to view assigned customers" ON public.customers;
DROP POLICY IF EXISTS "Allow AR Clerks to view invoices of assigned customers" ON public.invoices;

COMMIT;
```

No other policy, grant, helper, function, migration, or financial RPC business logic change was made.

## Policy state

### Before cleanup

The following legacy SELECT policies existed in production:

| Table | Policy | Issue |
| --- | --- | --- |
| `customers` | `Temp Allow All` | Broad `SELECT` policy with `USING (true)` for `authenticated`. |
| `invoices` | `Temp Allow All` | Broad `SELECT` policy with `USING (true)` for `authenticated`. |
| `customers` | `Allow AR Clerks to view assigned customers` | Legacy assigned-customer policy that bypassed the newer helper path. |
| `invoices` | `Allow AR Clerks to view invoices of assigned customers` | Legacy assigned-customer policy that bypassed the newer helper path. |

The authoritative replacement policies already existed:

| Table | Replacement policy |
| --- | --- |
| `customers` | `cust_select` |
| `invoices` | `inv_select` |

### After cleanup

Confirmed absent:

- `customers`: `Temp Allow All`
- `invoices`: `Temp Allow All`
- `customers`: `Allow AR Clerks to view assigned customers`
- `invoices`: `Allow AR Clerks to view invoices of assigned customers`

Confirmed still present:

- `customers`: `cust_select`
- `invoices`: `inv_select`

The retained replacement policies enforce the Batch 8B operational read/customer visibility path:

- `customers.cust_select` uses:
  - `rls_has_operational_read_access(company_id)`
  - `rls_can_access_customer(id, company_id)`
- `invoices.inv_select` uses:
  - `rls_has_operational_read_access(company_id)`
  - `rls_can_access_customer(customer_id, company_id)`

## Helper verification

Confirmed helper functions still exist:

- `rls_has_operational_read_access(uuid)`
- `rls_can_access_customer(uuid, uuid)`

## Privilege/RPC verification

Production-safe catalog verification passed.

Confirmed:

- `authenticated` direct `INSERT`, `UPDATE`, and `DELETE` remain denied on protected financial tables checked.
- `authenticated` protected financial RPC execution remains denied.
- `service_role` retains protected financial RPC execute privilege.

Protected financial tables checked included:

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

## Post-Fix1 required smoke

Read-only / negative-only production smoke passed with a valid Finance Manager token.

| Check | Result |
| --- | --- |
| Finance Manager `GET /customers` | HTTP 200 |
| Finance Manager `GET /invoices` | HTTP 200 |
| Finance Manager `GET /reports/dashboard?trend_months=6` | HTTP 200 |
| Finance Manager `GET /reports/aging` | HTTP 200 |
| Finance Manager `GET /imports` | HTTP 200 |
| Finance Manager `POST /allocations/auto` | HTTP 403 `AUTO_ALLOCATION_DISABLED` |

## Optional token caveat

Optional role checks were attempted but blocked by credential validity:

- Auditor `GET /reports/aging`: HTTP 401.
- System Admin operational reads: HTTP 401.

These are recorded as optional credential issues, not backend verification failures.

## Safety confirmations

- No SQL was reapplied during post-verification.
- No rollback SQL was run.
- No Edge Functions were deployed.
- No production imports were run.
- No production fixtures were run.
- No production customers were created.
- No production invoices were created.
- No production receipts were created.
- No production allocations were created.
- No production users were created or reset.
- No production financial records were created or mutated.
- No financial RPC happy paths were executed.
- No direct financial-table mutation occurred.
- No direct `allocation_details` insert occurred.
- No direct `invoices.outstanding` update occurred.
- No direct `receipts.allocated_amount` update occurred.
- No direct `receipts.unallocated_amount` update occurred.
- No direct financial-record delete occurred.
- `/allocations/auto` remains disabled and returned HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No mock dashboard data was reintroduced.
- No code was modified.
- No dependency change was made.
- No commit or push was performed during Batch 8D-Fix1 execution or evidence creation.

## Final status

Batch 8D-Fix1 is **completed successfully** for the approved production legacy SELECT RLS policy cleanup.

Remaining caveat:

- Optional Auditor/System Admin checks require valid production role tokens if they need to be completed later.
