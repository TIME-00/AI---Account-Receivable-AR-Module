"use client";

import Link from "next/link";
import { Settings, Building2, Landmark, ShieldCheck, Cog, Loader2, User } from "lucide-react";
import { useCompanyStore } from "@/stores/company-store";
import { useUserRole } from "@/hooks/use-user-role";
import { useBankAccounts } from "@/hooks/use-receipts";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { FEATURE_STATUS_ROWS } from "@/lib/feature-status";

export default function SettingsPage() {
  const companyName = useCompanyStore((s) => s.companyName);
  const companyId = useCompanyStore((s) => s.companyId);
  // Batch 9D-D: base currency comes from authoritative company context, and is
  // shown as an explicit loading/unavailable state rather than a default.
  const { baseCurrency, isLoading: baseCurrencyLoading } = useBaseCurrency();

  const { role, isLoading: roleLoading, email } = useUserRole();
  const { data: bankAccounts, isLoading: bankLoading, isError: bankError } = useBankAccounts();

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
        <p className="mt-1 text-sm text-slate-500">Read-only configuration view</p>
      </div>

      {/* Navigation Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/roles" className="glass-card group p-5 transition-all hover:shadow-lg hover:-translate-y-0.5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-purple-50 p-2.5 text-purple-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-slate-800 group-hover:text-blue-600">Roles &amp; Permissions</h3>
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
          <p className="text-xs text-slate-500">Review system auditability and transaction tracking capabilities.</p>
        </Link>
      </div>

      {/* Session Context (authenticated) */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <User className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Session Context</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
            <span className="text-sm text-slate-500">Signed in as</span>
            <span className="text-sm font-medium text-slate-800">{email ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-slate-500">Your Role</span>
            <span className="text-sm font-medium text-slate-800">
              {roleLoading ? "Loading…" : role ?? "Read-only"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Source: authenticated context (<code className="font-mono">GET /auth/me</code>). Roles and
            permissions are assigned by an administrator and enforced by the backend.
          </p>
        </div>
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
            {
              label: "Base Currency",
              value: baseCurrencyLoading
                ? "Loading…"
                : baseCurrency ?? "Not available",
            },
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
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">Default configuration — read-only display</span>
        </div>
        <div className="p-5 space-y-3">
          {[
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

      {/* Bank Accounts (real, read-only) */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Bank Accounts</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">
            GET /bank-accounts — read-only
          </span>
        </div>
        <div className="p-5">
          {bankLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading bank accounts…
            </div>
          ) : bankError ? (
            <p className="py-4 text-sm text-red-500">Bank accounts are unavailable right now.</p>
          ) : !bankAccounts || bankAccounts.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No active bank accounts are configured for this company.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-xs font-semibold uppercase text-slate-500">
                    <th className="px-3 py-2">Account Name</th>
                    <th className="px-3 py-2">Bank</th>
                    <th className="px-3 py-2">Account No.</th>
                    <th className="px-3 py-2">Currency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankAccounts.map((b) => (
                    <tr key={b.id} className="text-slate-700">
                      <td className="px-3 py-2 font-medium">{b.account_name}</td>
                      <td className="px-3 py-2">{b.bank_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{b.account_no}</td>
                      <td className="px-3 py-2">{b.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {FEATURE_STATUS_ROWS.map((row) => (
                <tr key={row.feature}>
                  <td className="px-4 py-2.5 text-slate-700">{row.feature}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.color}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
