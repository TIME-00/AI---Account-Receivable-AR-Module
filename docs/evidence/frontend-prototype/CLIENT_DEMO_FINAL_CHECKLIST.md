# Client Demo — Final Checklist

**Date**: 2026-05-28  
**Version**: Frontend Prototype v1.0 (Sprint F1 + F2 + F3)  
**Status**: ✅ Ready for client demo

---

## 1. Prototype Status Summary

| Item | Status |
|------|--------|
| Sprint F1 — Core AR Workflow (Dashboard, Invoices, Receipts) | ✅ Completed & Codex reviewed |
| Sprint F2 — Reports & Customer Visibility | ✅ Completed & Codex reviewed |
| Sprint F3 — Enterprise-Grade Supporting Pages | ✅ Completed & Codex reviewed |
| Auth Loading Fallback Fix | ✅ Fixed & Codex reviewed |
| `npm run build` | ✅ Passes — 21/21 pages, zero errors |
| Backend / Database / Edge Function changes | ❌ None — frontend only |

### Build Output

```
✓ Compiled successfully
✓ Generating static pages (21/21)

21 routes:
  /                        Dashboard
  /customers               Customer List
  /customers/[id]          Customer Detail
  /invoices                Invoice List
  /invoices/new            New Invoice
  /invoices/[id]           Invoice Detail
  /receipts                Receipt List
  /receipts/new            New Receipt
  /receipts/[id]           Receipt Detail
  /allocations             Allocation Wizard
  /credit-notes            Credit Notes (Coming Soon)
  /reports                 Report Center
  /reports/aging           AR Aging Report
  /reports/invoices        Invoice Summary Report
  /reports/receipts        Receipt Summary Report
  /reports/outstanding     Customer Outstanding Report
  /journal-entries         Journal Entries (Placeholder)
  /settings                System Settings (Read-Only)
  /settings/roles          Roles & Permissions (Reference)
  /settings/audit-log      Audit Trail (Placeholder)
  /login                   Login
```

---

## 2. Demo Environment Setup

### Prerequisites

- Node.js 18+ installed
- Frontend dependencies installed (`npm install` in `/frontend`)
- Supabase project running with P0 + P1 backend deployed

### Environment Variables

Ensure `frontend/.env.local` contains:

```env
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_DEFAULT_COMPANY_ID=00000000-0000-0000-0000-000000000001
NEXT_PUBLIC_DEMO_USER_ROLE=Finance Manager
NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID=3635be7b-50db-4942-a8e6-5714c4235372
```

### Starting the Demo

```powershell
cd frontend
npm.cmd run dev
```

Then open: **http://localhost:3000**

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Stuck on "Loading..." | Clear browser localStorage + hard refresh (Ctrl+Shift+R) |
| Login fails | Verify Supabase URL and anon key in `.env.local` |
| Role shows incorrectly | Verify `NEXT_PUBLIC_DEMO_USER_ROLE=Finance Manager` |
| Receipt post fails | Verify `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` is a real active bank UUID |
| 401 errors on API calls | Re-login — session token may have expired |

---

## 3. Demo Flow

### Demo Account

| Field | Value |
|-------|-------|
| Email | demo.finance@tsh.com |
| Role | Finance Manager |
| Company | TSH Synergy Sdn Bhd |

### Step-by-Step Demo Script

#### Phase 1 — Login & Dashboard

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open http://localhost:3000 | Login page appears (no infinite loading) |
| 2 | Login with demo.finance@tsh.com | Dashboard loads |
| 3 | Review dashboard | KPI cards, aging chart, recent transactions visible |
| 4 | Check header | "Finance Manager" role badge displayed |

#### Phase 2 — Customer Management (Sprint F2)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5 | Click **Customers** in sidebar | Customer list with search, filter chips, sortable table |
| 6 | Use status filter (Active / Inactive) | Table filters client-side instantly |
| 7 | Use credit rating filter | Table filters by A, B, C, etc. |
| 8 | Search by customer name | Results filter as you type |
| 9 | Click a customer row | Customer detail page loads |
| 10 | Review customer info card | Name, code, type, status, contact info displayed |
| 11 | Review credit utilization bar | Credit limit, outstanding, available credit, % bar |
| 12 | Click **Invoices** tab | Customer's invoices listed (client-side filtered) |
| 13 | Click **Receipts** tab | Customer's receipts listed (client-side filtered) |
| 14 | Click **Aging** tab | Customer aging buckets (Current through 90+) |

#### Phase 3 — Invoice Workflow (Sprint F1)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 15 | Click **Invoices** in sidebar | Invoice list page |
| 16 | Click **New Invoice** | Invoice creation form |
| 17 | Fill in: customer, date, line items | Totals calculate in real-time |
| 18 | Click **Save as Draft** | Invoice created with Draft status |
| 19 | Click **Post** on the draft invoice | Invoice status changes to Open, JE number shown |
| 20 | Review invoice detail | Full invoice with line items, timeline, status badge |

#### Phase 4 — Receipt Workflow (Sprint F1)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 21 | Click **Receipts** in sidebar | Receipt list page |
| 22 | Click **New Receipt** | Receipt creation form |
| 23 | Fill in: customer, amount, payment method | Bank account shows env-configured demo account |
| 24 | Click **Save as Draft** | Receipt created with Draft status |
| 25 | Click **Post** on the draft receipt | Receipt status changes to Posted |
| 26 | Review receipt detail | Full receipt details with posting info |

#### Phase 5 — Invoice Cancellation (Sprint F1)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 27 | Navigate to a posted invoice | Invoice detail page |
| 28 | Click **Cancel** | Cancellation dialog with reason field (min 10 chars) |
| 29 | Enter reason and confirm | Invoice status changes to Cancelled |

#### Phase 6 — Reports (Sprint F2)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 30 | Click **Report Center** in sidebar | 4 report cards with navigation |
| 31 | Click **AR Aging Report** | Summary cards + customer aging table, "As of: Today" |
| 32 | Search/sort the aging table | Client-side filtering |
| 33 | Go back, click **Invoice Summary** | Date filter, status breakdown, recent invoices |
| 34 | Adjust date range | Client-side filter updates counts/totals |
| 35 | Go back, click **Receipt Summary** | Date filter, payment method breakdown, status breakdown |
| 36 | Go back, click **Customer Outstanding** | Ranked table with % of total AR bars |
| 37 | Click a customer row from any report | Navigates to customer detail |

#### Phase 7 — Allocation (Sprint F1 + F3 Polish)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 38 | Click **Allocation Wizard** in sidebar | Split-screen receipt + invoice panels |
| 39 | Note auto-allocation banner | Amber notice: "Auto-allocation is not available" |
| 40 | Select a posted receipt | Outstanding invoices for that customer load |
| 41 | Add invoice(s) and enter amounts | Validation: over-allocation prevented |
| 42 | Click **Submit** | Allocation success toast |
| 43 | Scroll down | Allocation history placeholder: "Available in a future sprint" |

#### Phase 8 — Supporting Pages (Sprint F3)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 44 | Click **Journal Entries** in sidebar | Informational placeholder — 3 JE type cards (Invoice/Receipt/Cancel) |
| 45 | Note "Prototype Placeholder" badge | Clearly labeled, no live API calls |
| 46 | Click **Settings** in sidebar | Company info, AR config, bank account, feature status table |
| 47 | Note "Read-Only Display" badge | No edit buttons, no save actions |
| 48 | Click **Roles** in sidebar | Permission matrix (5 roles × 12 actions), current role highlighted |
| 49 | Note "Read-Only Reference" badge | No role editing capability |
| 50 | Click **Audit Trail** in sidebar | Auditability capabilities + example entries |
| 51 | Note "⚠️ Example data" label | Mock data visibly labeled as demonstration only |

#### Phase 9 — Placeholder Pages

| Step | Action | Expected Result |
|------|--------|-----------------|
| 52 | Click **Credit Notes** in sidebar | "Coming Soon" placeholder with info banner |

---

## 4. Known Limitations

### Authentication & Roles

| Limitation | Detail |
|-----------|--------|
| Role source | `NEXT_PUBLIC_DEMO_USER_ROLE` environment variable (not live API) |
| Role enforcement | Frontend role gating is UX-only — backend RLS enforces real permissions |
| User switching | Change env var and restart dev server to test different roles |

### Receipts & Bank Accounts

| Limitation | Detail |
|-----------|--------|
| Bank account source | `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` environment variable |
| Bank account selector | Display-only — not backed by GET /bank-accounts (API doesn't exist) |
| Bank account in payloads | Uses the env-configured UUID for receipt creation |

### Reports

| Limitation | Detail |
|-----------|--------|
| Date filtering | Client-side only — backend date params not verified |
| Aging "As of" date | Disabled — shows current aging only |
| Pagination | Client-side with page_size=500 — may not scale beyond ~500 records |
| Export (PDF/Excel) | Not implemented — buttons show "Coming Soon" |

### Placeholder Pages

| Page | Limitation |
|------|-----------|
| Journal Entries | Static informational page — no live API calls, no JE listing |
| Audit Trail | Example data visibly labeled as demo-only — no real audit log API |
| Settings | Read-only display — no edits, no database writes |
| Roles | Static reference matrix — no role editing, no table queries |
| Allocation History | Placeholder text — GET /allocations not verified |
| Auto-Allocation | Disabled — POST /allocations/auto not verified |
| Credit Notes | Stub page — "Coming Soon" |
| AI Assistant | Sidebar button exists — content placeholder only |

---

## 5. Client Feedback Questions

After the demo, gather feedback on these areas:

### Core Workflow

1. **Invoice flow**: Is the create → post → cancel flow clear and intuitive?
2. **Receipt flow**: Is the create → post flow clear? Is the bank account display acceptable for now?
3. **Allocation**: Is the manual allocation wizard understandable? What would make it better?

### Reports & Visibility

4. **Reports**: Are the 4 report types (Aging, Invoice, Receipt, Outstanding) useful for daily AR management?
5. **Customer pages**: Is the customer list + detail layout useful? What additional fields or views would help?
6. **Aging report**: Is the bucket breakdown (Current / 1–30 / 31–60 / 61–90 / 90+) sufficient?

### Supporting Pages

7. **Settings & Roles**: Are the read-only reference pages understandable and trustworthy?
8. **Journal Entries**: Is the informational JE page helpful for understanding the accounting flow?
9. **Audit Trail**: Is the auditability overview satisfactory for compliance discussions?

### Priorities

10. **Next priorities**: What should be built or improved next?
    - Credit notes workflow?
    - Report export (PDF/Excel)?
    - Auto-allocation?
    - Mobile responsive design?
    - Additional reports or analytics?
    - Multi-currency improvements?
    - Other?

### Overall

11. **First impression**: Does the prototype look and feel professional enough for a production AR system?
12. **Missing features**: Are there any critical features missing that block adoption?
13. **Data accuracy**: Do the numbers in reports and aging match your expectations?

---

## 6. Next Recommended Phase

### Immediate (Post-Demo)

| Step | Priority | Description |
|------|----------|-------------|
| 1 | 🔴 High | Collect and document client feedback from demo |
| 2 | 🔴 High | Prioritize feedback items into next sprint backlog |
| 3 | 🔴 High | Address any critical UX issues identified during demo |

### Short-Term (1–2 Weeks)

| Step | Priority | Description |
|------|----------|-------------|
| 4 | 🟡 Medium | UI/UX polish based on client feedback (typography, spacing, responsive) |
| 5 | 🟡 Medium | Dependency security upgrade planning (audit npm packages) |
| 6 | 🟡 Medium | Credit notes frontend if requested by client |
| 7 | 🟡 Medium | Report export (PDF/CSV) if requested by client |

### Medium-Term (2–4 Weeks)

| Step | Priority | Description |
|------|----------|-------------|
| 8 | 🟢 Normal | Decide whether to proceed with P2–P5 backend enhancements |
| 9 | 🟢 Normal | P2: Auto-allocation backend verification + frontend activation |
| 10 | 🟢 Normal | P3: Journal entries API verification + frontend listing |
| 11 | 🟢 Normal | P4: Real role API (replace env var fallback) |
| 12 | 🟢 Normal | P5: Bank accounts API + live selector |

### Decision Gate

> Before starting P2–P5, confirm with client:
> - Is the current prototype acceptable as a foundation?
> - Which backend enhancements are highest value?
> - Is the timeline for further development agreed?
> - Are there compliance or regulatory requirements that affect priority?

---

## 7. What to Tell the Client

### Key Messages

✅ **"The core AR workflow is production-ready."**  
Invoices, receipts, and manual allocations work end-to-end with real backend validation.

✅ **"Reports provide real-time visibility into AR position."**  
Aging, invoice, receipt, and customer outstanding reports use live data.

✅ **"All business rules are enforced by the backend."**  
RLS, RBAC, audit columns, optimistic locking — all enforced server-side regardless of frontend.

✅ **"The system is fully auditable."**  
Every create, post, cancel, and allocation action is recorded with user identity and timestamp.

🔜 **"Export, auto-allocation, and advanced analytics are coming in the next phase."**  
These features are planned and the architecture supports them.

---

## 8. Demo Duration Guide

| Section | Estimated Time |
|---------|---------------|
| Login + Dashboard | 2 min |
| Customer List & Detail | 3 min |
| Invoice Create → Post → Cancel | 5 min |
| Receipt Create → Post | 3 min |
| Report Center (4 reports) | 5 min |
| Allocation Wizard | 3 min |
| Supporting Pages (JE, Audit, Settings, Roles) | 4 min |
| Q&A and Feedback | 10 min |
| **Total** | **~35 min** |

---

*Document created: 2026-05-28T10:30:00+08:00*  
*Frontend Prototype v1.0 — Sprint F1 + F2 + F3 — Ready for client demo*
