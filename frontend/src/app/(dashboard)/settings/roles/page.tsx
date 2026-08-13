"use client";

import Link from "next/link";
import { ShieldCheck, Info, CheckCircle2, XCircle } from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { cn } from "@/lib/utils";

const roles = ["AR Clerk", "AR Supervisor", "Finance Manager", "Auditor", "System Admin"] as const;

const permissions: { action: string; roles: Record<string, boolean> }[] = [
  {
    action: "View Dashboard",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": true, "System Admin": false },
  },
  {
    action: "View Customers",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": true, "System Admin": false },
  },
  {
    action: "View All Customers",
    roles: { "AR Clerk": false, "AR Supervisor": true, "Finance Manager": true, "Auditor": true, "System Admin": false },
  },
  {
    action: "Create Invoice",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "Post Invoice",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "Cancel Invoice",
    roles: { "AR Clerk": false, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "Create Receipt",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "Post Receipt",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "Manual Allocation",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": false, "System Admin": false },
  },
  {
    action: "View Reports",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": true, "System Admin": false },
  },
  {
    action: "View Journal Entries",
    roles: { "AR Clerk": true, "AR Supervisor": true, "Finance Manager": true, "Auditor": true, "System Admin": false },
  },
  {
    action: "System Configuration",
    roles: { "AR Clerk": false, "AR Supervisor": false, "Finance Manager": false, "Auditor": false, "System Admin": true },
  },
];

export default function RolesPage() {
  const { role: currentRole, isLoading: roleLoading } = useUserRole();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/settings" className="hover:text-blue-600">Settings</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Roles & Permissions</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Roles & Permissions</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Read-Only Reference
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">RBAC permission matrix for the AR module</p>
      </div>

      {/* Current User Card */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-purple-50 p-3">
            <ShieldCheck className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Your Current Role</p>
            <p className="text-lg font-bold text-purple-600">
              {roleLoading ? "Loading…" : currentRole ?? "Read-only"}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Source: authenticated context (GET /auth/me) — assigned by an administrator
            </p>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-sm font-medium text-blue-800">Backend enforces all permissions via RLS and Edge Function auth</p>
          <p className="text-xs text-blue-600">
            Frontend role gating is for UX only — hiding/showing buttons based on the user&apos;s role.
            The backend independently validates every operation through Row Level Security (RLS) policies
            and Edge Function authorization checks. Even if a frontend button is visible, the backend
            will reject unauthorized actions.
          </p>
        </div>
      </div>

      {/* Permission Matrix */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Permission Matrix</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 sticky left-0 bg-slate-50/50">Permission</th>
                {roles.map((role) => (
                  <th
                    key={role}
                    className={cn(
                      "px-3 py-3 text-center text-xs font-semibold uppercase text-slate-500 whitespace-nowrap",
                      role === currentRole && "bg-purple-50"
                    )}
                  >
                    {role}
                    {role === currentRole && (
                      <div className="mt-1">
                        <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[8px] font-medium text-purple-600">YOU</span>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {permissions.map((perm) => (
                <tr key={perm.action} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2.5 text-slate-700 font-medium sticky left-0 bg-surface">{perm.action}</td>
                  {roles.map((role) => (
                    <td
                      key={role}
                      className={cn("px-3 py-2.5 text-center", role === currentRole && "bg-purple-50/30")}
                    >
                      {perm.roles[role] ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-slate-300" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Role Descriptions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { role: "AR Clerk", desc: "Day-to-day AR operations: create/post invoices and receipts, manual allocations. Sees only assigned customers.", color: "bg-blue-50 text-blue-700" },
          { role: "AR Supervisor", desc: "Full operational access plus ability to cancel invoices and view all customers across the company.", color: "bg-indigo-50 text-indigo-700" },
          { role: "Finance Manager", desc: "Complete financial authority including all AR operations, reporting, and financial oversight.", color: "bg-purple-50 text-purple-700" },
          { role: "Auditor", desc: "Read-only access to all AR data, reports, and journal entries for audit and compliance purposes.", color: "bg-emerald-50 text-emerald-700" },
          { role: "System Admin", desc: "System configuration access only — GL account mapping, tax codes, company settings. No operational AR access.", color: "bg-amber-50 text-amber-700" },
        ].map((r) => (
          <div key={r.role} className="glass-card p-4">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", r.color)}>{r.role}</span>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">{r.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
