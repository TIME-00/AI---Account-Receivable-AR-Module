# Sprint F2 — Frontend Smoke Test Summary

**Date**: 2026-05-27  
**Sprint**: F2 — Reports & Customer Visibility  
**Codex Review**: ✅ **PASS** — Sprint F2 integration readiness  
**Build**: ✅ **PASS** — 19/19 pages, zero errors

---

## 1. Sprint F2 Scope Completed

| # | Page | Route | Status |
|---|------|-------|--------|
| F2.1 | Customer List | `/customers` | ✅ Completed |
| F2.2 | Customer Detail | `/customers/[id]` | ✅ Completed |
| F2.3 | Report Center | `/reports` | ✅ Completed |
| F2.4 | AR Aging Report | `/reports/aging` | ✅ Completed |
| F2.5 | Invoice Summary Report | `/reports/invoices` | ✅ Completed |
| F2.6 | Receipt Summary Report | `/reports/receipts` | ✅ Completed |
| F2.7 | Customer Outstanding Report | `/reports/outstanding` | ✅ Completed |

### Key Features Per Page

| Page | Features |
|------|----------|
| **Customer List** | Data table, search by name/code/email, status filter chips, credit rating filter chips, sort by name/credit limit/outstanding, clickable rows to detail |
| **Customer Detail** | Info card, credit utilization bar, tabs (Invoices / Receipts / Aging), breadcrumb navigation, not-found state |
| **Report Center** | 4 report cards with icons and gradient accents, navigation hub, disabled export with "Coming Soon" |
| **AR Aging Report** | 6 summary cards (Total / Current / 1–30 / 31–60 / 61–90 / 90+), customer aging table, sort/search, static "As of: Today" label |
| **Invoice Summary** | Client-side date range filter, summary cards (count / total / paid / outstanding), status breakdown table, top 10 recent invoices |
| **Receipt Summary** | Client-side date range filter, summary cards (count / total / allocated / unallocated), payment method breakdown, status breakdown, top 10 recent receipts |
| **Customer Outstanding** | Summary cards (customers with outstanding / total / overdue), ranked table, % of total AR with progress bars |

All pages include loading, empty, and error states.

---

## 2. Codex Review Result

| Check | Result |
|-------|--------|
| Sprint F2 integration readiness | ✅ **Pass** |
| `npm run build` | ✅ Pass — 19/19 pages, zero errors |
| Backend Edge Functions modified | ❌ None |
| SQL migrations modified | ❌ None |
| New Edge Functions created | ❌ None |
| API usage limited to approved endpoints | ✅ Confirmed |
| `supabase.from(...)` direct table queries | ❌ None found |
| Service role key in frontend | ❌ None found |
| `date_from` / `date_to` params sent to backend | ❌ None |
| `as_of` param sent to aging endpoints | ❌ None |
| `customer_id` query param sent to backend | ❌ None |
| `GET /customers/:id` calls | ❌ None |
| `GET /allocations` calls | ❌ None |
| `POST /allocations/auto` calls | ❌ None |
| `/reports/aging/customers` calls | ❌ None |
| P2–P5 features implemented | ❌ None |

---

## 3. Approved APIs Used

| Endpoint | Hook | Pages |
|----------|------|-------|
| `GET /customers` | `useAllCustomers()` | Customer List, Customer Detail |
| `GET /invoices` | `useAllInvoices()` | Customer Detail, Invoice Summary Report |
| `GET /receipts` | `useAllReceipts()` | Customer Detail, Receipt Summary Report |
| `GET /reports/aging` | `useAgingSummaryF2()` | AR Aging Report |
| `GET /reports/aging/by-customer` | `useAgingByCustomerF2()` | Customer List, Customer Detail, AR Aging Report, Customer Outstanding Report |

### API Compliance Notes

- All hooks are defined in `frontend/src/hooks/use-f2-data.ts`
- All hooks fetch with `page_size=500` for client-side processing
- No unverified query parameters are sent to any endpoint
- Aging hooks do NOT send `as_of_date` — current aging only
- Invoice/receipt hooks do NOT send `date_from` / `date_to`
- Customer detail does NOT call `GET /customers/:id` — finds customer client-side from full list
- All list endpoints are treated as raw arrays (no `{ data, total }` wrapping assumed)

---

## 4. Frontend-Derived Data

| Derivation | Source API | Pages |
|-----------|-----------|-------|
| Customer outstanding balance | `GET /reports/aging/by-customer` → match by `customer_id` | Customer List, Customer Detail |
| Available credit (limit − outstanding) | `GET /customers` + aging data | Customer Detail |
| Credit utilization % | Calculated from limit and outstanding | Customer Detail |
| Invoice list for specific customer | `GET /invoices` → filter client-side by `customer_id` | Customer Detail (Invoices tab) |
| Receipt list for specific customer | `GET /receipts` → filter client-side by `customer_id` | Customer Detail (Receipts tab) |
| Customer aging breakdown | `GET /reports/aging/by-customer` → filter by `customer_id` | Customer Detail (Aging tab) |
| Invoice date range filtering | `GET /invoices` → filter by `invoice_date` in JS | Invoice Summary Report |
| Receipt date range filtering | `GET /receipts` → filter by `receipt_date` in JS | Receipt Summary Report |
| Invoice status grouping + sums | Aggregated from filtered invoice array | Invoice Summary Report |
| Receipt payment method grouping | Aggregated from filtered receipt array | Receipt Summary Report |
| Receipt status grouping + sums | Aggregated from filtered receipt array | Receipt Summary Report |
| Overdue amount per customer | Sum of `bucket_1_30 + bucket_31_60 + bucket_61_90 + bucket_over_90` | Customer Outstanding Report |
| % of total AR per customer | `customer_outstanding / total_outstanding × 100` | Customer Outstanding Report |

> All frontend-derived values are clearly noted on report pages with the text:  
> *"All values are computed client-side from [invoice/receipt] data."*

---

## 5. Not Used / Explicitly Out of Scope

| Item | Reason |
|------|--------|
| `GET /customers/:id` | Not verified for F2. Customer detail derived client-side from `GET /customers`. |
| `GET /allocations` | Not verified. Allocation history is placeholder-only (Sprint F3). |
| `GET /bank-accounts` | Does not exist. Bank account from env var only. |
| `GET /reports/aging/customers` | Wrong route. Correct route is `/by-customer`. |
| `GET /journal-entries` | Not verified. Journal entries page is placeholder (Sprint F3). |
| `GET /journal-entries/:id` | Not verified. No JE drill-down. |
| Audit log API | Does not exist. Audit log page is placeholder (Sprint F3). |
| `POST /allocations/auto` | Not verified. Remains disabled. |
| `supabase.from(...)` in hooks | Forbidden — no frontend direct table queries. |
| Service role key in frontend | Forbidden — security violation. |
| `date_from` / `date_to` backend params | Not verified. Date filtering is client-side only. |
| `as_of` / `as_of_date` backend param | Not verified. Show current aging only. |
| Customer create / edit UI | Deferred — F2 is read-only for customers. |
| Report PDF / Excel export | Deferred — buttons shown as "Coming Soon". |
| P2–P5 features | Not implemented. |

---

## 6. Manual Smoke Test Checklist

| # | Test Case | Result | Notes |
|---|-----------|--------|-------|
| 1 | Customer List loads at `/customers` | ✅ Pass | Table renders with all customers |
| 2 | Customer List search works | ✅ Pass | Filters by name, code, email client-side |
| 3 | Customer List status filter works | ✅ Pass | Active / Inactive / Blocked / On Hold chips |
| 4 | Customer List credit rating filter works | ✅ Pass | AAA through D filter chips |
| 5 | Customer List sort by outstanding works | ✅ Pass | Ascending / descending toggle |
| 6 | Customer Detail loads at `/customers/[id]` | ✅ Pass | Info card, credit utilization bar render |
| 7 | Customer Detail Invoices tab works | ✅ Pass | Filtered invoices with clickable rows |
| 8 | Customer Detail Receipts tab works | ✅ Pass | Filtered receipts with clickable rows |
| 9 | Customer Detail Aging tab works | ✅ Pass | Aging buckets with formatted amounts |
| 10 | Customer Detail not-found state works | ✅ Pass | Shows "Customer not found" for invalid ID |
| 11 | Report Center loads at `/reports` | ✅ Pass | 4 report cards with navigation |
| 12 | AR Aging Report loads at `/reports/aging` | ✅ Pass | Summary cards + customer table |
| 13 | AR Aging Report search works | ✅ Pass | Filters customer rows by name |
| 14 | AR Aging Report sort works | ✅ Pass | Sort by any column |
| 15 | Invoice Summary loads at `/reports/invoices` | ✅ Pass | Date filter, summary cards, status breakdown |
| 16 | Invoice Summary date filter works | ✅ Pass | Client-side date range filtering |
| 17 | Receipt Summary loads at `/reports/receipts` | ✅ Pass | Date filter, payment method breakdown |
| 18 | Receipt Summary date filter works | ✅ Pass | Client-side date range filtering |
| 19 | Customer Outstanding loads at `/reports/outstanding` | ✅ Pass | Ranked table with progress bars |
| 20 | All pages have loading states | ✅ Pass | Spinner with loading text |
| 21 | All pages have empty states | ✅ Pass | Icon + descriptive text |
| 22 | All pages have error states | ✅ Pass | Red error text with message |

---

## 7. Known Limitations

| Area | Limitation |
|------|-----------|
| **Frontend-Derived Values** | Customer outstanding, credit utilization, report summaries, and date filtering are all computed client-side. Values may differ from backend calculations for edge cases. |
| **Pagination** | Client-side only. All data fetched with `page_size=500`. May not scale beyond ~500 records per entity. |
| **Report Exports** | Not implemented in Sprint F2. Export buttons show "Coming Soon". |
| **Aging Date Picker** | Disabled — shows current aging only. `as_of` param not verified. |
| **Customer Detail** | Derived from full customer list (client-side `find` by ID). Not using `GET /customers/:id`. |
| **Date Filtering** | Client-side only on invoice/receipt reports. Backend date filter params not verified. |
| **Remaining Stub Pages** | Journal Entries, Audit Log, Settings, Credit Notes remain as stubs (Sprint F3 scope). |
| **Allocation Polish** | Allocation wizard exists from F1 but polish deferred to Sprint F3. |
| **Role Gating** | All F2 pages are read-only and accessible to all authenticated users. |
| **ESLint** | Not configured. `npm run lint` prompts interactively. |

---

## 8. Build Verification

```
✓ Compiled successfully
✓ Generating static pages (19/19)

Route (app)                              Size     First Load JS
┌ ○ /                                    113 kB          301 kB
├ ○ /customers                           5.62 kB         198 kB
├ ƒ /customers/[id]                      6.3 kB          198 kB
├ ○ /reports                             2.33 kB         112 kB
├ ○ /reports/aging                       5.46 kB         198 kB
├ ○ /reports/invoices                    5.53 kB         198 kB
├ ○ /reports/outstanding                 5.29 kB         197 kB
├ ○ /reports/receipts                    5.57 kB         198 kB
└ ... (19 pages total, 0 errors)
```

---

## 9. Files Created / Modified in Sprint F2

| File | Action |
|------|--------|
| `frontend/src/hooks/use-f2-data.ts` | **NEW** — Shared hooks for F2 (useAllCustomers, useAllInvoices, useAllReceipts, useAgingSummaryF2, useAgingByCustomerF2, formatCurrency, formatDate) |
| `frontend/src/app/(dashboard)/customers/page.tsx` | **REWRITTEN** — Full customer list with table, filters, sort |
| `frontend/src/app/(dashboard)/customers/[id]/page.tsx` | **NEW** — Customer detail with info card, credit bar, tabs |
| `frontend/src/app/(dashboard)/reports/page.tsx` | **REWRITTEN** — Report center hub with 4 cards |
| `frontend/src/app/(dashboard)/reports/aging/page.tsx` | **NEW** — AR Aging report with summary + customer table |
| `frontend/src/app/(dashboard)/reports/invoices/page.tsx` | **NEW** — Invoice summary with date filter + status breakdown |
| `frontend/src/app/(dashboard)/reports/receipts/page.tsx` | **NEW** — Receipt summary with date filter + method breakdown |
| `frontend/src/app/(dashboard)/reports/outstanding/page.tsx` | **NEW** — Customer outstanding rankings |

**Total**: 1 new hook file + 2 rewritten pages + 5 new pages = **8 files**

---

## 10. Confirmation

- ✅ Sprint F2 scope complete (7 pages)
- ✅ Codex review passed
- ✅ Build passed (19/19 pages, zero errors)
- ❌ No backend changes
- ❌ No database migration changes
- ❌ No Edge Function changes
- ❌ No P2–P5 work implemented
- ❌ No deployment

---

## 11. Next Steps

| Step | Priority |
|------|----------|
| Sprint F3 implementation (Allocation polish, JE placeholder, Audit placeholder, Settings, Roles, UI polish) | 🔴 High |
| Sprint F3 Codex review | 🔴 High |
| Combined F1+F2+F3 client demo | 🔴 High |
| Client feedback collection | 🟡 Medium |
| Sprint F4+ planning based on feedback | 🟢 Low |

---

*Document generated: 2026-05-27T21:08:00+08:00*  
*Sprint F2 — Frontend smoke test summary — Codex review passed*
