// Truthful, phase-aware capability status used by the read-only Settings page.
// Gates A, B, C and D are deployed. Gate D is closed.
export const FEATURE_STATUS_ROWS = [
  { feature: "Dashboard", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Invoices (CRUD + Post + Cancel)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Receipts (CRUD + Post)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Manual Allocation", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Customer List & Detail", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "AR Reports (Aging, Invoice, Receipt, Outstanding)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Global Search / Profile", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  // Gate B capabilities: deployed after Migration 032 and the
  // Notifications/Reports Edge functions passed Production verification.
  {
    feature: "Import Notifications (Page, Dropdown & Unread Badge) — Import Alerts Only",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Credit Rating Drill-Down (Dashboard → Aging by Customer)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Credit/Debit Note Visibility & Empty States",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  { feature: "Journal Entries", status: "Reference Guide", color: "bg-blue-50 text-blue-700" },
  { feature: "Audit Trail", status: "Capability Reference", color: "bg-blue-50 text-blue-700" },
  { feature: "Settings & Roles", status: "Read-Only (Authenticated)", color: "bg-blue-50 text-blue-700" },
  { feature: "Auto-Allocation", status: "Disabled", color: "bg-slate-50 text-slate-500" },
  { feature: "PDF/Image Import (Invoice & Receipt)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  {
    feature: "Governed FX Reference Rate (Invoice & Receipt lookup + selection)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Booked-Rate & Legacy-Unverified Presentation",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Bounded Invoice/Receipt Pagination (15/page)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  { feature: "Daily FX Sync", status: "Live (Automated)", color: "bg-emerald-50 text-emerald-700" },
  {
    feature: "Report Export (PDF/Excel) (Gate C)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Dashboard Customer Credit-Rating Drill-Down (Gate D)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Invoice Provenance-Aware Monetary Summary (Gate D)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Receipt Provenance-Aware Monetary Summary (Gate D)",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  {
    feature: "Gate D Production Rollout",
    status: "Live",
    color: "bg-emerald-50 text-emerald-700",
  },
  // Gate E — Autonomous AR Operations. Frontend implemented against the frozen
  // gate-e.1 contract; the backend is local/unstaged and fail-closed. Nothing
  // below is Live: no real provider, mailbox, email, scheduler, or Production
  // straight-through processing is active.
  {
    feature: "Automation Overview & Monitoring (Gate E)",
    status: "Frontend Implemented — Pending Backend Deployment",
    color: "bg-amber-50 text-amber-700",
  },
  {
    feature: "Automation Settings & Kill Switches (Gate E)",
    status: "Implemented — Disabled by Default",
    color: "bg-amber-50 text-amber-700",
  },
  {
    feature: "Sales Representatives & Customer Assignment (Gate E)",
    status: "Frontend Implemented — Pending Backend Deployment",
    color: "bg-amber-50 text-amber-700",
  },
  {
    feature: "Mailbox Connections (Gmail & Microsoft) (Gate E)",
    status: "Provider Configuration Required",
    color: "bg-amber-50 text-amber-700",
  },
  {
    feature: "Document Intelligence & Auto-Allocation Monitoring (Gate E)",
    status: "Provider Configuration Required",
    color: "bg-amber-50 text-amber-700",
  },
  {
    feature: "Invoice Reminder Monitoring (Gate E)",
    status: "Frontend Implemented — Delivery Disabled",
    color: "bg-amber-50 text-amber-700",
  },
] as const;
