# Sprint F1 — Frontend Prototype Smoke Test Summary

**Date**: 2026-05-27  
**Tester**: Manual local testing  
**Environment**: Development (`npm run dev` / `next build`)  
**Verdict**: ✅ **PASS** — All Sprint F1 pages functional and locally verified

---

## 1. Sprint F1 Scope Completed

| Page | Route | Status |
|------|-------|--------|
| Dashboard | `/` | ✅ Completed |
| Invoice List | `/invoices` | ✅ Completed |
| New Invoice | `/invoices/new` | ✅ Completed |
| Invoice Detail | `/invoices/[id]` | ✅ Completed |
| Receipt List | `/receipts` | ✅ Completed |
| New Receipt | `/receipts/new` | ✅ Completed |
| Receipt Detail | `/receipts/[id]` | ✅ Completed |

All pages include loading, empty, and error states.

---

## 2. Manual Test Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Header displays effective role | ✅ Pass | Shows "Finance Manager" from `NEXT_PUBLIC_DEMO_USER_ROLE` |
| New Invoice → Create & Post | ✅ Pass | Creates draft, auto-posts, returns `invoice_no` and `je_no` |
| New Receipt → Create & Post | ✅ Pass | Creates draft with `bank_account_id` from env, auto-posts |
| Invoice Cancel | ✅ Pass | Validates cancel reason ≥ 10 chars, cancels Open invoice |
| Receipt List updates after create | ✅ Pass | New receipt appears in list with correct status |
| Invoice List updates after create | ✅ Pass | New invoice appears in list with correct status |
| Invoice Detail shows line items | ✅ Pass | Line items render with amounts, tax, totals |
| Receipt Detail shows allocation progress | ✅ Pass | Allocation bar, amounts, and status badge display correctly |
| Role gating — mutation buttons visible | ✅ Pass | Post, Cancel, New buttons visible for Finance Manager |
| Step 2 validation blocks empty descriptions | ✅ Pass | Toast error shown if line description is missing |
| Validation feedback on Save Draft | ✅ Pass | Toast shows first validation error instead of silent failure |
| Cancel reason < 10 chars rejected | ✅ Pass | Toast: "Cancel reason must be at least 10 characters." |
| Bank account display in New Receipt | ✅ Pass | Shows configured Maybank account (disabled selector) |

---

## 3. Environment Configuration

```env
# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://kusseuycqgdilychphpq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_***
NEXT_PUBLIC_API_BASE_URL=https://kusseuycqgdilychphpq.supabase.co/functions/v1
NEXT_PUBLIC_DEFAULT_COMPANY_ID=00000000-0000-0000-0000-000000000001
NEXT_PUBLIC_DEMO_USER_ROLE=Finance Manager
NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID=3635be7b-50db-4942-a8e6-5714c4235372
```

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_DEMO_USER_ROLE` | Frontend-only UX role fallback. Controls mutation button visibility. |
| `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` | Real bank account UUID for receipt creation. Required by backend. |
| `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | Default company for the demo scenario. |

> **Note**: `NEXT_PUBLIC_DEMO_USER_ROLE` is purely for UX button visibility.
> Backend RLS and Edge Function auth remain the final security authority.

---

## 4. APIs Used (Verified Sprint F1 Endpoints)

| Method | Endpoint | Purpose | Tested |
|--------|----------|---------|--------|
| `GET` | `/invoices` | List invoices (returns `Invoice[]`) | ✅ |
| `GET` | `/invoices/:id` | Invoice detail with lines | ✅ |
| `POST` | `/invoices` | Create draft invoice with lines | ✅ |
| `POST` | `/invoices/:id/post` | Post draft → Open, generates JE | ✅ |
| `POST` | `/invoices/:id/cancel` | Cancel Open invoice with reason | ✅ |
| `GET` | `/receipts` | List receipts (returns `Receipt[]`) | ✅ |
| `GET` | `/receipts/:id` | Receipt detail | ✅ |
| `POST` | `/receipts` | Create draft receipt | ✅ |
| `POST` | `/receipts/:id/post` | Post draft → Posted, generates JE | ✅ |
| `GET` | `/customers` | Customer list (returns `Customer[]`) | ✅ |
| `POST` | `/allocations/manual` | Manual receipt-to-invoice allocation | ⚠️ Available but not smoke-tested in this session |

### Endpoints NOT Called

| Endpoint | Reason |
|----------|--------|
| `GET /bank-accounts` | Does not exist. Bank account from env var. |
| `POST /allocations/auto` | Disabled in Sprint F1. Hook throws error. |
| `GET /reports/aging/by-customer` | Dashboard widget — not part of core smoke test. |

---

## 5. Known Prototype Limitations

| Area | Limitation |
|------|-----------|
| **Bank Account Selection** | Config-based via `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID`. No bank account API or selector. Disabled `<select>` in UI. |
| **Role System** | Frontend-only fallback via `NEXT_PUBLIC_DEMO_USER_ROLE`. No real role API/Edge Function exists yet. |
| **AI Assistant** | Placeholder — not implemented in Sprint F1. |
| **Journal Entry Drill-Down** | Placeholder — JE number shown as badge but no detailed JE view page. |
| **Dashboard Widgets** | Aging report and some summary cards may be partially loading or placeholder. |
| **Export Features** | Not in Sprint F1 scope. No PDF/Excel export. |
| **Pagination** | Client-side only. `useApi()` discards `meta.total` from backend response. |
| **Tax Codes** | Display-only in invoice form. `tax_code_id` is not sent to backend. |
| **Credit Notes / Debit Notes** | Stub pages only. Not functional in Sprint F1. |
| **Customer Management** | List page exists but no create/edit. |
| **Reports** | Stub page. Aging report hook exists but full reporting is Sprint F2. |
| **Settings** | Stub page. |
| **ESLint** | Not configured. `npm run lint` prompts interactively. |

---

## 6. Confirmation — No Backend Changes

| Scope | Modified? |
|-------|-----------|
| Backend Edge Functions (`backend/supabase/functions/`) | ❌ No changes |
| SQL Migrations (`backend/supabase/migrations/`) | ❌ No changes |
| Database schema or RLS policies | ❌ No changes |
| P2–P5 features | ❌ Not implemented |
| Production deployment | ❌ Not deployed |

All changes are exclusively in the `frontend/` directory.

---

## 7. Build Verification

```
✓ Compiled successfully
✓ Generating static pages (15/15)

Route (app)                              Size     First Load JS
┌ ○ /                                    113 kB          301 kB
├ ○ /invoices                            4.82 kB         203 kB
├ ƒ /invoices/[id]                       4.93 kB         203 kB
├ ○ /invoices/new                        9.09 kB         228 kB
├ ○ /receipts                            4.5 kB          199 kB
├ ƒ /receipts/[id]                       4.28 kB         203 kB
├ ○ /receipts/new                        5.53 kB         225 kB
└ ... (15 pages total, 0 errors)
```

---

## 8. Next Recommended Phase

| Step | Description | Priority |
|------|-------------|----------|
| **Sprint F1 Final Codex Review** | Submit current frontend for final automated Codex review to confirm all integration issues are resolved. | 🔴 High |
| **Client Demo Preparation** | Prepare demo script, seed data, and walkthrough for client presentation of the AR module prototype. | 🔴 High |
| **Sprint F2: Reports & Customer Pages** | Refine reporting pages (aging report), customer detail pages, and dashboard widgets based on client feedback. | 🟡 Medium |
| **Sprint F3: Allocation UX** | Polish allocation workflow, add auto-allocation UI when backend endpoint is verified. | 🟡 Medium |
| **Sprint F4: Credit Notes & Settings** | Implement credit note creation, settings page, and remaining stub pages. | 🟢 Low |
| **ESLint Configuration** | Set up ESLint with Next.js recommended config for code quality enforcement. | 🟢 Low |
| **Real Role API** | Replace `NEXT_PUBLIC_DEMO_USER_ROLE` fallback with a real role endpoint (e.g., `GET /auth/me`). | 🟢 Future |
| **Real Bank Account API** | Replace `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` with a real `GET /bank-accounts` Edge Function. | 🟢 Future |

---

*Document generated: 2026-05-27T19:30:00+08:00*  
*Sprint F1 frontend prototype — locally verified and ready for Codex final review.*
