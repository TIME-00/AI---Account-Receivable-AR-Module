// Truthful, phase-aware capability status used by the read-only Settings page.
// Gate A is deployed; Gate B remains local until separately authorized.
export const FEATURE_STATUS_ROWS = [
  { feature: "Dashboard", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Invoices (CRUD + Post + Cancel)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Receipts (CRUD + Post)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Manual Allocation", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Customer List & Detail", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "AR Reports (Aging, Invoice, Receipt, Outstanding)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Global Search / Profile", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  // Gate B capabilities: implemented locally, not yet deployed (migration 032 and
  // the Notifications/Reports Edge functions require separate authorization).
  {
    feature: "Import Notifications (Page, Dropdown & Unread Badge) — Import Alerts Only",
    status: "Implemented — Pending Deployment",
    color: "bg-indigo-50 text-indigo-700",
  },
  {
    feature: "Credit Rating Drill-Down (Dashboard → Aging by Customer)",
    status: "Implemented — Pending Deployment",
    color: "bg-indigo-50 text-indigo-700",
  },
  {
    feature: "Credit/Debit Note Visibility & Empty States",
    status: "Implemented — Pending Deployment",
    color: "bg-indigo-50 text-indigo-700",
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
  { feature: "Report Export (PDF/Excel) (Gate C)", status: "Planned", color: "bg-slate-50 text-slate-500" },
] as const;
