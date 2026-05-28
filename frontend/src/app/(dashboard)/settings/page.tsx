"use client";

import Link from "next/link";
import { Settings, Building2, Landmark, ShieldCheck, Clock, Cog, Info } from "lucide-react";
import { useCompanyStore } from "@/stores/company-store";

export default function SettingsPage() {
  const companyName = useCompanyStore((s) => s.companyName);
  const baseCurrency = useCompanyStore((s) => s.baseCurrency);
  const companyId = useCompanyStore((s) => s.companyId);

  const demoRole = process.env.NEXT_PUBLIC_DEMO_USER_ROLE ?? "Not configured";
  const demoBankAccount = process.env.NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID ?? "Not configured";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Settings</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Read-Only Display
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Read-only configuration view — no edits in Sprint F3</p>
      </div>

      {/* Navigation Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/roles" className="glass-card group p-5 transition-all hover:shadow-lg hover:-translate-y-0.5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-purple-50 p-2.5 text-purple-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-slate-800 group-hover:text-blue-600">Roles & Permissions</h3>
          </div>
          <p className="text-xs text-slate-500">View the RBAC permission matrix for all user roles.</p>
        </Link>

        <Link href="/settings/audit-log" className="glass-card group p-5 transition-all hover:shadow-lg hover:-translate-y-0.5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-emerald-50 p-2.5 text-emerald-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-slate-800 group-hover:text-blue-600">Audit Trail</h3>
          </div>
          <p className="text-xs text-slate-500">View system auditability and transaction tracking capabilities.</p>
        </Link>
      </div>

      {/* Company Information */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Building2 className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Company Information</h2>
        </div>
        <div className="p-5 space-y-3">
          {[
            { label: "Company Name", value: companyName },
            { label: "Company ID", value: companyId, mono: true },
            { label: "Base Currency", value: baseCurrency },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-500">{row.label}</span>
              <span className={`text-sm font-medium text-slate-800 ${row.mono ? "font-mono text-xs" : ""}`}>{row.value || "—"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AR Configuration */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Cog className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">AR Configuration</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">Default Configuration — read-only display for Sprint F3</span>
        </div>
        <div className="p-5 space-y-3">
          {[
            { label: "Default Payment Terms", value: "Net 30 Days" },
            { label: "Credit Limit Policy", value: "Enforced — orders blocked when exceeded" },
            { label: "Aging Brackets", value: "Current, 1–30, 31–60, 61–90, 90+ Days" },
            { label: "Fiscal Year", value: "January – December" },
            { label: "Invoice Numbering", value: "Auto-generated (INV-YYYY-NNNN)" },
            { label: "Receipt Numbering", value: "Auto-generated (RCT-YYYY-NNNN)" },
            { label: "JE Numbering", value: "Auto-generated (JE-YYYY-NNNN)" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-500">{row.label}</span>
              <span className="text-sm text-slate-700">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bank Account */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Landmark className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Bank Account</h2>
        </div>
        <div className="p-5">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">
              Bank account is configured through the Sprint F1 environment variable{" "}
              <code className="rounded bg-amber-100 px-1 font-mono text-[10px]">NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID</code>.
              No GET /bank-accounts API is available.
            </p>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-slate-500">Demo Bank Account ID</span>
            <span className="font-mono text-xs text-slate-600">{demoBankAccount}</span>
          </div>
        </div>
      </div>

      {/* Environment / Demo Info */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Clock className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Sprint Demo Environment</h2>
        </div>
        <div className="p-5 space-y-3">
          {[
            { label: "Demo User Role", value: demoRole },
            { label: "Demo Bank Account", value: demoBankAccount, mono: true },
            { label: "API Base URL", value: "Configured via NEXT_PUBLIC_SUPABASE_URL (masked)" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-500">{row.label}</span>
              <span className={`text-sm text-slate-700 ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Feature Status */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <Settings className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Feature Status</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Feature</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Sprint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { feature: "Dashboard", status: "Live", sprint: "F1", color: "bg-emerald-50 text-emerald-700" },
                { feature: "Invoices (CRUD + Post + Cancel)", status: "Live", sprint: "F1", color: "bg-emerald-50 text-emerald-700" },
                { feature: "Receipts (CRUD + Post)", status: "Live", sprint: "F1", color: "bg-emerald-50 text-emerald-700" },
                { feature: "Manual Allocation", status: "Live", sprint: "F1", color: "bg-emerald-50 text-emerald-700" },
                { feature: "Customer List & Detail", status: "Live", sprint: "F2", color: "bg-emerald-50 text-emerald-700" },
                { feature: "AR Reports (Aging, Invoice, Receipt, Outstanding)", status: "Live", sprint: "F2", color: "bg-emerald-50 text-emerald-700" },
                { feature: "Journal Entries", status: "Placeholder", sprint: "F3", color: "bg-amber-50 text-amber-700" },
                { feature: "Audit Trail", status: "Placeholder", sprint: "F3", color: "bg-amber-50 text-amber-700" },
                { feature: "Settings & Roles", status: "Read-Only", sprint: "F3", color: "bg-blue-50 text-blue-700" },
                { feature: "Credit Notes", status: "Coming Soon", sprint: "—", color: "bg-slate-50 text-slate-500" },
                { feature: "Auto-Allocation", status: "Coming Soon", sprint: "—", color: "bg-slate-50 text-slate-500" },
                { feature: "Report Export (PDF/Excel)", status: "Coming Soon", sprint: "—", color: "bg-slate-50 text-slate-500" },
              ].map((row) => (
                <tr key={row.feature}>
                  <td className="px-4 py-2.5 text-slate-700">{row.feature}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.color}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{row.sprint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
