# P0 + P1 Production Readiness Runbook

This runbook prepares production deployment for the completed P0 RLS and P1 financial RPC work. It is a checklist only. Do not use it to deploy P2, change frontend UI, add new product features, or introduce any `ar.*` schema.

## 1. Production Deployment Sequence

Apply database files in this order:

```text
1. database/001_create_tables.sql        only if production is not already initialized
2. database/002_create_views.sql         only if production is not already initialized
3. database/003_seed_data.sql            only if production needs initial seed/reference data
4. database/004_auth_tables.sql
5. database/005_audit_triggers.sql
6. database/006_rls_policies.sql
7. database/007_financial_rpcs.sql
```

Deploy these Edge Functions to production after the database migrations are applied:

```bash
supabase functions deploy invoices --project-ref <PROD_PROJECT_REF>
supabase functions deploy receipts --project-ref <PROD_PROJECT_REF>
supabase functions deploy allocations --project-ref <PROD_PROJECT_REF>
```

There is no deployable `journal-entries` Edge Function in the current repository because `backend/supabase/functions/journal-entries` contains `service.ts` only. The journal reversal service is bundled through the deployed functions above.

## 2. Files Allowed To Run In Production

Allowed production database files:

```text
database/001_create_tables.sql
database/002_create_views.sql
database/003_seed_data.sql
database/004_auth_tables.sql
database/005_audit_triggers.sql
database/006_rls_policies.sql
database/007_financial_rpcs.sql
```

Notes:

- Run `001_create_tables.sql`, `002_create_views.sql`, and `003_seed_data.sql` only if production is not already initialized or if the production deployment plan explicitly requires them.
- For an already initialized production database, verify whether each base/schema file is idempotent before applying it.

## 3. Files That Must Not Be Run In Production

Do not run these files in production:

```text
database/006b_rls_tests.sql
database/007b_financial_rpcs_smoke_tests.sql
database/007c_api_staging_fixtures.sql
```

Reason:

- `006b_rls_tests.sql` is a staging/test validation script.
- `007b_financial_rpcs_smoke_tests.sql` creates temporary smoke-test fixtures and rolls back.
- `007c_api_staging_fixtures.sql` creates persistent staging-only API test data.

## 4. Production Preflight SQL Checklist

Run these read-only checks before production deployment. Any returned problem rows must be explained or fixed before go-live.

```sql
-- Companies
SELECT id, company_code, company_name, is_active
FROM companies
ORDER BY company_code;

-- Invalid roles
SELECT *
FROM user_roles
WHERE role NOT IN ('AR Clerk','AR Supervisor','Finance Manager','System Admin','Auditor');

-- Active production users by company/role
SELECT company_id, role, COUNT(*)
FROM user_roles
WHERE is_active = TRUE
GROUP BY company_id, role
ORDER BY company_id, role;

-- Customer assignments must match customer company
SELECT uca.*
FROM user_customer_assignments uca
JOIN customers c ON c.id = uca.customer_id
WHERE uca.company_id <> c.company_id;

-- Required config keys per active company
WITH required(key) AS (
  VALUES
  ('default_ar_control_acct'),
  ('default_revenue_acct'),
  ('default_cheque_acct'),
  ('default_discount_acct'),
  ('default_forex_gain_acct'),
  ('default_forex_loss_acct'),
  ('invoice_future_days_limit')
)
SELECT c.id AS company_id, c.company_code, r.key
FROM companies c
CROSS JOIN required r
LEFT JOIN ar_system_config cfg
  ON cfg.company_id = c.id
 AND cfg.config_key = r.key
WHERE c.is_active = TRUE
  AND cfg.config_key IS NULL;

-- Configured GL accounts must exist and be active
SELECT cfg.company_id, cfg.config_key, cfg.config_value
FROM ar_system_config cfg
LEFT JOIN gl_accounts ga
  ON ga.company_id = cfg.company_id
 AND ga.account_code = cfg.config_value
 AND ga.is_active = TRUE
WHERE cfg.config_key IN (
  'default_ar_control_acct',
  'default_revenue_acct',
  'default_cheque_acct',
  'default_discount_acct',
  'default_forex_gain_acct',
  'default_forex_loss_acct'
)
AND ga.id IS NULL;

-- Open fiscal periods for current month
SELECT c.id, c.company_code
FROM companies c
LEFT JOIN fiscal_periods fp
  ON fp.company_id = c.id
 AND fp.period_code = to_char(CURRENT_DATE, 'YYYY-MM')
 AND fp.status = 'Open'
WHERE c.is_active = TRUE
  AND fp.id IS NULL;

-- Active bank accounts with GL mapping
SELECT company_id, COUNT(*) AS active_bank_accounts
FROM bank_accounts
WHERE is_active = TRUE
  AND gl_account_id IS NOT NULL
GROUP BY company_id;

-- Invalid invoice statuses
SELECT id, invoice_no, status
FROM invoices
WHERE status NOT IN ('Draft','Open','Partially Paid','Paid','Overdue','Cancelled','Written Off');

-- Invalid receipt statuses
SELECT id, receipt_no, status
FROM receipts
WHERE status NOT IN ('Draft','Posted','Fully Allocated','Cancelled','Bounced');

-- Journal entries must be balanced at header and line level
SELECT
  je.id,
  je.je_no,
  je.total_debit,
  je.total_credit,
  COALESCE(SUM(jel.debit_amount), 0) AS line_debit,
  COALESCE(SUM(jel.credit_amount), 0) AS line_credit
FROM journal_entries je
LEFT JOIN journal_entry_lines jel ON jel.je_id = je.id
GROUP BY je.id, je.je_no, je.total_debit, je.total_credit
HAVING je.total_debit <> je.total_credit
    OR je.total_debit <> COALESCE(SUM(jel.debit_amount), 0)
    OR je.total_credit <> COALESCE(SUM(jel.credit_amount), 0)
    OR COALESCE(SUM(jel.debit_amount), 0) <> COALESCE(SUM(jel.credit_amount), 0);

-- Orphan invoice lines
SELECT il.*
FROM invoice_lines il
LEFT JOIN invoices i ON i.id = il.invoice_id
WHERE i.id IS NULL;

-- Orphan journal entry lines
SELECT jel.*
FROM journal_entry_lines jel
LEFT JOIN journal_entries je ON je.id = jel.je_id
WHERE je.id IS NULL;

-- Orphan allocation receipt references
SELECT ad.*
FROM allocation_details ad
LEFT JOIN receipts r ON r.id = ad.receipt_id
WHERE r.id IS NULL;

-- Orphan allocation invoice references
SELECT ad.*
FROM allocation_details ad
LEFT JOIN invoices i ON i.id = ad.invoice_id
WHERE i.id IS NULL;

-- Orphan customer child rows
SELECT cbd.*
FROM customer_bank_details cbd
LEFT JOIN customers c ON c.id = cbd.customer_id
WHERE c.id IS NULL;

-- Unexpected ar schema
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'ar';

-- Unexpected ar.* references in functions/views
SELECT 'function' AS object_type, proname AS object_name
FROM pg_proc
WHERE pg_get_functiondef(oid) LIKE '%ar.%'
UNION ALL
SELECT 'view', table_name
FROM information_schema.views
WHERE view_definition LIKE '%ar.%';
```

## 5. Backup And Rollback Plan

Before deployment:

```text
1. Confirm Supabase automatic backup / PITR status.
2. Take a manual database backup or confirmed restore point.
3. Export schema and key financial tables if possible:
   companies, customers, invoices, invoice_lines, receipts,
   allocation_details, journal_entries, journal_entry_lines,
   ar_system_config, user_roles, user_customer_assignments.
4. Record currently deployed Edge Function versions or commit SHA.
5. Save the production secrets list, without exposing secret values in documentation.
```

Edge Function rollback:

```bash
supabase functions deploy invoices --project-ref <PROD_PROJECT_REF>
supabase functions deploy receipts --project-ref <PROD_PROJECT_REF>
supabase functions deploy allocations --project-ref <PROD_PROJECT_REF>
```

Run those rollback deploys from the previous known-good commit.

SQL rollback limitations:

- Do not assume financial SQL can be safely rolled back after live financial mutations occur.
- RLS/RPC changes should be reverted only by applying a reviewed reverse migration or restoring from backup.
- If financial mutations have already occurred, prefer a reviewed forward-fix migration over destructive rollback.
- Never delete audit logs to undo a test or deployment.

Test before rollback:

- API authentication still works.
- Existing invoices and receipts can be read.
- No new unbalanced journal entries exist.

Test after rollback:

- Read checks still pass.
- Mutation path either works on the previous version or is intentionally paused.
- No partial state remains from the failed deployment.

## 6. Production Smoke Test Checklist

Use minimal safe test records only. Prefer a dedicated production smoke customer and small amounts.

Checklist:

- Create or identify one production smoke customer assigned to an AR Clerk.
- Confirm the current fiscal period is open.
- Confirm required GL config and bank account mapping are present.
- Post one draft invoice.
- Post one draft receipt.
- Allocate the receipt to the invoice.
- Reverse that allocation.
- Cancel one separate open unallocated invoice to test the reversal journal entry path.
- Handle bounced cheque only if a dedicated safe CHQ receipt exists and Finance approves the test.

After each action, verify:

- API response has `success = true`.
- Document status is expected.
- No duplicate journal entry was created.
- Journal entry header totals equal line totals.
- Debit equals credit.
- Edge Function logs show no unexpected 500 errors.

Do not use real customer balances for smoke testing unless Finance explicitly approves.

## 7. Deployment Risk Notes

Missing config risks:

- RPCs fail if required GL accounts or config keys are absent.
- Cheque posting depends on `default_cheque_acct`.
- Discount and forex paths depend on discount and forex GL config.

Historical data risks:

- Old records may have statuses or balances not covered by staging fixtures.
- Existing unbalanced journal entries must be resolved before enabling mutation flows.
- Existing orphan rows can cause reports or reversals to behave unpredictably.

Concurrency risks:

- RPCs use row locks, but production users may still attempt duplicate posting/allocation at the same time.
- First production deployment window should be low-traffic if possible.

Service role / RLS risks:

- Edge Functions use the service role, but P1 RPCs enforce `user_roles` and customer access internally.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is correct only in production function secrets.
- Never expose the service role key to frontend code, Postman collections, screenshots, or documentation.

Token/auth risks:

- Users must have active `user_roles`.
- AR Clerk assignment must exist for assigned-customer mutations.
- Auditor and System Admin must remain blocked from operational financial mutations.

## 8. Go / No-Go Criteria

Go when:

- Preflight SQL has no unexplained problem rows.
- Backup or restore point is confirmed.
- Production secrets are verified.
- `006_rls_policies.sql` and `007_financial_rpcs.sql` have already passed staging.
- Edge Function build/check passed from the deployment commit.
- A rollback commit/version is identified.
- Finance/admin agrees on the production smoke-test records.

No-go when:

- Required GL config or fiscal period is missing.
- Any existing journal entry is unbalanced.
- Orphan financial rows exist and are unexplained.
- Production users or roles are incomplete.
- Backup status is uncertain.
- Any staging P1 verification result cannot be reproduced or explained.

## 9. FYP Evidence To Record

Record these items for FYP documentation:

- Migration files applied and timestamps.
- Staging verification results for P0, P1 SQL, and P1 API.
- Production preflight SQL outputs.
- Edge Function deployment logs.
- Production smoke-test request/response screenshots or exported Postman run.
- Journal entry balance verification screenshots.
- Negative authorization test evidence.
- Backup and rollback plan approval note.
