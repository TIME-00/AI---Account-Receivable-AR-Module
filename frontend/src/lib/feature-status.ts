// Truthful, phase-aware capability status used by the read-only Settings page.
// Gate A implementation is local until its separately authorized deployment.
export const FEATURE_STATUS_ROWS = [
  { feature: "Dashboard", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Invoices (CRUD + Post + Cancel)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Receipts (CRUD + Post)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Manual Allocation", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Customer List & Detail", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "AR Reports (Aging, Invoice, Receipt, Outstanding)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Global Search / Profile", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Notifications", status: "Degraded — Import Alerts Only", color: "bg-amber-50 text-amber-700" },
  { feature: "Credit & Debit Notes", status: "Read-Only List", color: "bg-blue-50 text-blue-700" },
  { feature: "Journal Entries", status: "Reference Guide", color: "bg-blue-50 text-blue-700" },
  { feature: "Audit Trail", status: "Capability Reference", color: "bg-blue-50 text-blue-700" },
  { feature: "Settings & Roles", status: "Read-Only (Authenticated)", color: "bg-blue-50 text-blue-700" },
  { feature: "Auto-Allocation", status: "Disabled", color: "bg-slate-50 text-slate-500" },
  { feature: "PDF/Image Import (Invoice & Receipt)", status: "Live", color: "bg-emerald-50 text-emerald-700" },
  {
    feature: "Governed FX Reference Rate (Invoice & Receipt lookup + selection)",
    status: "Implemented — Pending Deployment",
    color: "bg-blue-50 text-blue-700",
  },
  {
    feature: "Booked-Rate & Legacy-Unverified Presentation",
    status: "Implemented — Pending Deployment",
    color: "bg-blue-50 text-blue-700",
  },
  {
    feature: "Bounded Invoice/Receipt Pagination (15/page)",
    status: "Implemented — Pending Deployment",
    color: "bg-blue-50 text-blue-700",
  },
  { feature: "Daily FX Sync", status: "Live (Automated)", color: "bg-emerald-50 text-emerald-700" },
  { feature: "Report Export (PDF/Excel) (Gate C)", status: "Planned", color: "bg-slate-50 text-slate-500" },
] as const;
