# Client Demo Data Visibility Filter Summary

## Purpose

Historical test and smoke-test records must remain available for audit evidence, but they must not appear in the client-facing cloud prototype. The implementation uses customer-level soft-hide metadata instead of deleting financial records.

No customers, invoices, receipts, allocations, journal entries, import batches, import rows, or audit logs are deleted.

## Visibility Flag

Migration `database/010_customer_visibility_flags.sql` adds these columns to `public.customers`:

- `is_hidden BOOLEAN NOT NULL DEFAULT FALSE`
- `hidden_reason TEXT`
- `hidden_at TIMESTAMPTZ`

The migration does not hide records automatically. Operators must run the preview query in `database/010b_customer_visibility_preview_and_apply.sql`, review every candidate customer, and only then uncomment the explicit update block.

## Client-Facing Filtering

Hidden customers and their linked records are excluded from:

- Dashboard metrics and aging totals
- Customer list and customer detail
- Invoice list and invoice detail
- Receipt list and receipt detail
- Invoice and receipt customer dropdowns
- Invoice, receipt, outstanding, and aging reports
- Allocation wizard customer-linked receipt and invoice choices
- CSV/XLSX import customer matching

The backend read services enforce visibility filters. Frontend hooks also filter by `customers.is_hidden` as defense in depth.

## Preserved Financial Logic

The implementation does not modify P0/P1 financial RPC accounting behavior. Posting, allocation, reversal, bounced cheque handling, journal entry generation, and audit log protection remain unchanged.

Imported CSV/XLSX invoices still use the verified draft-only invoice creation path. Hidden customers cannot be matched for new imports.

## Verification Checklist

Run after applying the migration, reviewing and applying the explicit hide update, deploying the affected Edge Functions, and redeploying the frontend:

- [ ] Hidden customers do not appear in the customer list.
- [ ] Hidden customers do not appear in invoice customer dropdowns.
- [ ] Hidden customers do not appear in receipt customer dropdowns.
- [ ] Hidden-customer invoices do not appear in invoice lists or detail routes.
- [ ] Hidden-customer receipts do not appear in receipt lists or detail routes.
- [ ] Dashboard totals exclude hidden-customer invoices and receipts.
- [ ] Aging and summary reports exclude hidden-customer records.
- [ ] Visible customers still appear normally.
- [ ] Creating an invoice for a visible customer still works.
- [ ] Creating a receipt for a visible customer still works.
- [ ] CSV/XLSX draft invoice import still works for a visible customer.
- [ ] CSV/XLSX import rejects or fails validation for a hidden customer match.
- [ ] Database row counts confirm no financial or audit records were deleted.

## Evidence To Record

Capture:

- Preview query output before applying the hide update.
- `UPDATE ... RETURNING` output for the reviewed customers.
- Before/after screenshots for dashboard, customers, invoices, receipts, and reports.
- Local frontend build result.
- Local smoke-test results.
- Vercel redeploy confirmation and online smoke-test results.
- SQL row-count evidence confirming that financial and audit records remain stored.
