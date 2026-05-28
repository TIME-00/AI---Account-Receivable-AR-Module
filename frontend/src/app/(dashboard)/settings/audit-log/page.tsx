"use client";

import Link from "next/link";
import { Shield, FileText, Banknote, XCircle, UserCheck, Lock, Info } from "lucide-react";

const auditCapabilities = [
  {
    title: "Created By / Created At",
    description: "Every invoice, receipt, and allocation records who created it and when.",
    icon: FileText,
    iconBg: "bg-blue-50 text-blue-600",
  },
  {
    title: "Posted By / Posted At",
    description: "Invoice and receipt posting records the approver's identity and exact timestamp.",
    icon: UserCheck,
    iconBg: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Cancelled By / Cancelled At",
    description: "Invoice cancellations record who cancelled, when, and the mandatory reason (min 10 chars).",
    icon: XCircle,
    iconBg: "bg-red-50 text-red-600",
  },
  {
    title: "Optimistic Locking",
    description: "Every record has a version field. Concurrent modification attempts are rejected by the backend.",
    icon: Lock,
    iconBg: "bg-amber-50 text-amber-600",
  },
];

const exampleEntries = [
  { action: "Invoice Posted", user: "demo.finance@tsh.com", document: "INV-2026-0001", timestamp: "2026-05-27 09:15:22" },
  { action: "Receipt Created", user: "demo.finance@tsh.com", document: "RCT-2026-0001", timestamp: "2026-05-27 09:20:41" },
  { action: "Receipt Posted", user: "demo.finance@tsh.com", document: "RCT-2026-0001", timestamp: "2026-05-27 09:21:03" },
  { action: "Allocation Manual", user: "demo.finance@tsh.com", document: "RCT-2026-0001 → INV-2026-0001", timestamp: "2026-05-27 09:25:17" },
  { action: "Invoice Cancelled", user: "demo.finance@tsh.com", document: "INV-2026-0002", timestamp: "2026-05-27 10:05:33" },
];

export default function AuditLogPage() {
  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/settings" className="hover:text-blue-600">Settings</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Audit Trail</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit Trail</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Prototype Placeholder
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">System auditability and transaction tracking</p>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-sm font-medium text-blue-800">All financial transactions are fully audited</p>
          <p className="text-xs text-blue-600">
            Every create, post, cancel, and allocation action is recorded with the user&apos;s identity,
            timestamp, and full transaction details. The backend enforces audit columns via database
            triggers and RLS policies.
          </p>
        </div>
      </div>

      {/* Audit Capability Cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {auditCapabilities.map((cap) => {
          const Icon = cap.icon;
          return (
            <div key={cap.title} className="glass-card p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`rounded-lg p-2 ${cap.iconBg}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">{cap.title}</h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{cap.description}</p>
            </div>
          );
        })}
      </div>

      {/* Example Audit Entries */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Example Audit Entries</h2>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-600">
            ⚠️ Example data — for demonstration purposes only
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Action</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">User</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Document</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exampleEntries.map((entry, i) => (
                <tr key={i} className="text-slate-600">
                  <td className="px-4 py-2.5 text-xs font-medium">{entry.action}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{entry.user}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{entry.document}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-slate-400">{entry.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 bg-amber-50/50 px-4 py-2 text-center">
          <p className="text-[10px] text-amber-600">⚠️ The entries above are example data for demonstration purposes only. No live audit log API exists.</p>
        </div>
      </div>

      {/* Future Sprint Note */}
      <div className="glass-card flex flex-col items-center justify-center py-8">
        <Shield className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm text-slate-500">Full audit log viewer will be available in a future sprint.</p>
      </div>
    </div>
  );
}
