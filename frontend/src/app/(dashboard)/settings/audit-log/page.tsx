"use client";

import Link from "next/link";
import { Shield, FileText, XCircle, UserCheck, Lock, Info } from "lucide-react";

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
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-medium text-blue-600">
            Capability Reference
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

      {/* Viewer scope note (no fabricated data) */}
      <div className="glass-card flex flex-col items-center justify-center py-10 text-center">
        <Shield className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-600">No audit-log viewer is available yet.</p>
        <p className="mt-1 max-w-md text-xs text-slate-400">
          Audit columns are captured on every transaction by the backend (see the capabilities above).
          A searchable audit-log viewer requires a dedicated read API and is planned for a future batch.
          To keep this screen honest, no sample audit rows are shown.
        </p>
      </div>
    </div>
  );
}
