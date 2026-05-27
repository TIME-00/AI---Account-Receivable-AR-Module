# Sprint F1 — Client Demo Checklist

**Prepared**: 2026-05-27  
**Sprint**: F1 — Frontend Prototype  
**Module**: Accounts Receivable (AR)  
**Status**: ✅ Ready for client demo

---

## 1. Demo Environment Setup

### Pre-Demo Checklist

- [ ] Ensure `frontend/.env.local` contains:
  ```env
  NEXT_PUBLIC_SUPABASE_URL=https://kusseuycqgdilychphpq.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_***
  NEXT_PUBLIC_API_BASE_URL=https://kusseuycqgdilychphpq.supabase.co/functions/v1
  NEXT_PUBLIC_DEFAULT_COMPANY_ID=00000000-0000-0000-0000-000000000001
  NEXT_PUBLIC_DEMO_USER_ROLE=Finance Manager
  NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID=3635be7b-50db-4942-a8e6-5714c4235372
  ```
- [ ] Pull latest from GitHub: `git pull origin main`
- [ ] Install dependencies: `npm install` (in `frontend/`)
- [ ] Start dev server: `npm run dev` (in `frontend/`)
- [ ] Verify app loads at `http://localhost:3000`
- [ ] Clear browser cache if previous session had stale data
- [ ] Prepare test customer(s) in the system (at least 1 Active customer)
- [ ] Have Supabase dashboard open in a separate tab (optional — for showing backend data)

---

## 2. Demo Account

| Field | Value |
|-------|-------|
| **Username** | `demo.finance` |
| **Role** | Finance Manager |
| **Company** | TSH Synergy Sdn Bhd (default) |
| **Permissions** | Full operational — Create, Post, Cancel invoices and receipts |

> **Note to presenter**: The Finance Manager role is the highest operational role.
> It can perform all AR Clerk and AR Supervisor actions plus additional oversight.

---

## 3. Demo Flow — Step by Step

### 🔐 Step 1: Login
- [ ] Navigate to `http://localhost:3000/login`
- [ ] Login with demo.finance credentials
- [ ] **Point out**: Header shows "Finance Manager" as the effective role
- [ ] **Point out**: Company name in the header bar

### 📊 Step 2: Dashboard Overview
- [ ] Land on the Dashboard (`/`)
- [ ] **Walk through**: Summary cards showing AR statistics
- [ ] **Walk through**: Recent activity and quick action buttons
- [ ] **Mention**: "Dashboard widgets will be enhanced in Sprint F2 with aging reports and charts"

### 📄 Step 3: Invoice List
- [ ] Navigate to Invoice List (`/invoices`)
- [ ] **Show**: Table with columns — Invoice No., Customer, Date, Amount, Status, etc.
- [ ] **Demonstrate**: Status filter chips (Draft, Open, Paid, Cancelled, etc.)
- [ ] **Demonstrate**: Search bar — type a customer name or invoice number
- [ ] **Point out**: "New Invoice" button (visible because role is Finance Manager)

### ✏️ Step 4: Create & Post Invoice
- [ ] Click "New Invoice"
- [ ] **Step 1 — Header**: Select customer, set invoice date, currency
- [ ] **Step 2 — Line Items**: Add 1–2 line items with description, qty, unit price
- [ ] **Point out**: Live calculation of subtotal, tax, grand total
- [ ] **Step 3 — Review**: Show the invoice summary
- [ ] Click **"Create & Post"**
- [ ] **Point out**: Success toast with invoice number and JE number
- [ ] **Point out**: "This just created a draft, validated all business rules, posted it to Open status, and generated a journal entry — all in one click"
- [ ] Verify: Redirected back to Invoice List with new invoice showing status "Open"

### 🔍 Step 5: Invoice Detail
- [ ] Click on the newly created invoice in the list
- [ ] **Walk through**: Invoice header — status badge, customer, dates, amounts
- [ ] **Walk through**: Line items table with full financial breakdown
- [ ] **Walk through**: Totals footer — subtotal, tax, grand total, base currency
- [ ] **Point out**: Journal Entry reference badge
- [ ] **Point out**: "Cancel" button (available for Open invoices)

### 💰 Step 6: Receipt List
- [ ] Navigate to Receipt List (`/receipts`)
- [ ] **Show**: Table with allocation progress bars
- [ ] **Point out**: Payment method badges and amount formatting
- [ ] **Point out**: "New Receipt" button

### 💳 Step 7: Create & Post Receipt
- [ ] Click "New Receipt"
- [ ] **Fill in**: Select the same customer from Step 4
- [ ] **Fill in**: Payment method (e.g., TT), amount, currency
- [ ] **Point out**: Bank account shows as "Maybank — Operating Account" (env-configured)
- [ ] Click **"Create & Post"**
- [ ] **Point out**: Success toast with receipt number and JE number
- [ ] Verify: Redirected back to Receipt List with new receipt

### 🧾 Step 8: Receipt Detail
- [ ] Click on the newly created receipt
- [ ] **Walk through**: Receipt header — status, customer, payment method
- [ ] **Walk through**: Three amount cards — Receipt Amount / Allocated / Unallocated
- [ ] **Walk through**: Allocation progress bar (should show 0% if not yet allocated)
- [ ] **Mention**: "The Allocation page allows matching this receipt to invoices"

### ❌ Step 9: Cancel Invoice
- [ ] Navigate back to Invoice List
- [ ] Click on the posted invoice from Step 4
- [ ] Click **"Cancel Invoice"**
- [ ] Enter reason: "Demo cancellation for client walkthrough" (≥ 10 characters)
- [ ] **Point out**: Invoice status changes to "Cancelled"
- [ ] **Point out**: "A reversal journal entry was automatically generated"
- [ ] Navigate back to list — invoice shows Cancelled status

---

## 4. What to Tell the Client

### Opening Statement
> "This is the Sprint F1 prototype of the Accounts Receivable module. It demonstrates the core AR workflow — creating invoices, posting them, receiving payments, and cancelling invoices. All business rules from the PRD are enforced by the backend, including credit checks, fiscal period validation, and automatic journal entry generation."

### Key Messages
- ✅ **Core AR flow is fully working** — create, post, cancel invoices; create, post receipts
- ✅ **Backend is production-grade** — RLS, tenant isolation, audit trails, atomic transactions
- ✅ **Journal entries are auto-generated** — every post/cancel creates proper accounting entries
- ✅ **Business rules are enforced** — customer credit checks, status transitions, validation
- ⚠️ **Some advanced features are placeholders** — these are planned for Sprint F2+

### If Asked About Missing Features
> "Features like detailed reporting, AI-assisted matching, and export are planned for upcoming sprints. We wanted to get the core workflow right first and get your feedback before building on top of it."

---

## 5. Known Limitations (Do Not Demo These)

| Area | Current State | Future Plan |
|------|--------------|-------------|
| **Bank Account Selector** | Uses env-configured demo UUID; selector is disabled | Sprint F2: Real `GET /bank-accounts` API |
| **Journal Entry Detail** | Shows JE number badge only; no drill-down page | Sprint F2: Full JE viewer |
| **AI Assistant** | Placeholder in sidebar | Sprint F3+: AI-powered features |
| **Export (PDF/Excel)** | Not implemented | Sprint F2: Invoice PDF, aging Excel |
| **Role System** | Frontend demo fallback via env var | Future: Real `GET /auth/me` endpoint |
| **Tax Codes** | Display-only in form; not sent to backend | Sprint F2: Real tax code integration |
| **Credit Notes** | Stub page only | Sprint F3: Full CN workflow |
| **Reports** | Stub page; aging hook exists but UI not complete | Sprint F2: Aging report, AR summary |
| **Customer Management** | List page exists; no create/edit | Sprint F2: Customer CRUD |
| **Pagination** | Client-side (no server total) | Sprint F2: Server-side pagination |
| **Settings** | Stub page | Sprint F3: Company config |

> **Presenter tip**: If a client asks about any of these, acknowledge it and say it's in the roadmap.
> Do not navigate to stub pages (Credit Notes, Reports, Settings, Journal Entries) during the demo.

---

## 6. After-Demo Feedback Questions

Ask the client these questions and record their responses:

### Workflow & UX

- [ ] **Q1**: Is the invoice creation flow (3-step wizard) clear and intuitive?
  - _Response_: _______________________________________________

- [ ] **Q2**: Is the receipt creation flow easy to understand?
  - _Response_: _______________________________________________

- [ ] **Q3**: Are the table layouts (Invoice List, Receipt List) useful? Any columns to add or remove?
  - _Response_: _______________________________________________

- [ ] **Q4**: Is the status flow (Draft → Open → Paid / Cancelled) clear?
  - _Response_: _______________________________________________

### Priorities

- [ ] **Q5**: What reports do you need first? (Aging, AR Summary, Customer Statement, etc.)
  - _Response_: _______________________________________________

- [ ] **Q6**: What fields should be added, removed, or renamed in the forms?
  - _Response_: _______________________________________________

- [ ] **Q7**: Are there any workflow changes needed before we proceed to Sprint F2?
  - _Response_: _______________________________________________

### Data & Integration

- [ ] **Q8**: Do you need multi-currency support from Day 1, or is MYR sufficient initially?
  - _Response_: _______________________________________________

- [ ] **Q9**: What payment methods does your team use most? (TT, Cheque, GIRO, etc.)
  - _Response_: _______________________________________________

- [ ] **Q10**: Do you have specific bank accounts that need to be pre-configured?
  - _Response_: _______________________________________________

### General

- [ ] **Q11**: Overall, does this match your expectation of what the AR module should do?
  - _Response_: _______________________________________________

- [ ] **Q12**: Any immediate blockers or concerns before we continue development?
  - _Response_: _______________________________________________

---

## 7. Post-Demo Actions

| Action | Owner | Deadline |
|--------|-------|----------|
| Record all client feedback in this document | Presenter | Same day |
| Submit Sprint F1 for final Codex review | Developer | Within 1 day |
| Update implementation plan based on feedback | Developer | Within 2 days |
| Begin Sprint F2 planning (reports, customer pages) | Team | Within 3 days |
| Share demo recording with stakeholders (if recorded) | Presenter | Within 1 day |

---

*Document created: 2026-05-27T19:47:00+08:00*  
*Sprint F1 — Frontend prototype demo checklist*
