"use client";

import Link from "next/link";
import { useAuthContext } from "@/hooks/use-auth-context";
import { cn } from "@/lib/utils";
import {
  User,
  Building2,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Info,
  Lock,
} from "lucide-react";
import type { AuthCapabilities } from "@/types";

// Human-readable labels for the capability flags returned by GET /auth/me.
const CAPABILITY_LABELS: { key: keyof AuthCapabilities; label: string }[] = [
  { key: "can_read_operational_data", label: "View operational AR data" },
  { key: "can_create_customer", label: "Create customers" },
  { key: "can_update_customer", label: "Update customers" },
  { key: "can_create_invoice", label: "Create invoices" },
  { key: "can_update_draft_invoice", label: "Update draft invoices" },
  { key: "can_post_invoice", label: "Post invoices" },
  { key: "can_cancel_invoice", label: "Cancel invoices" },
  { key: "can_create_receipt", label: "Create receipts" },
  { key: "can_post_receipt", label: "Post receipts" },
  { key: "can_cancel_receipt", label: "Cancel receipts" },
  { key: "can_allocate_receipt", label: "Allocate receipts" },
  { key: "can_reverse_allocation", label: "Reverse allocations" },
  { key: "can_handle_bounced_cheque", label: "Handle bounced cheques" },
  { key: "can_read_reports", label: "View reports" },
  { key: "can_execute_imports", label: "Execute imports" },
  { key: "can_review_import_rows", label: "Review import rows" },
  { key: "can_read_config", label: "View configuration" },
  { key: "can_write_config", label: "Edit configuration" },
];

export default function ProfilePage() {
  const { data, isLoading, isError } = useAuthContext();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-blue-600">Dashboard</Link>
        <span>/</span>
        <span className="font-medium text-slate-800">My Profile</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Profile</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Read-Only
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Your authenticated account, company, and effective permissions.
        </p>
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your profile…
        </div>
      ) : isError || !data ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-red-300" />
          <p className="text-sm text-slate-500">Your profile context could not be loaded.</p>
          <p className="text-[11px] text-slate-400">Please refresh the page to try again.</p>
        </div>
      ) : (
        <>
          {/* Identity + Company */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="glass-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <User className="h-4 w-4" />
                </div>
                <h2 className="text-sm font-semibold text-slate-700">Account</h2>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-medium text-slate-800">{data.user.email ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-slate-500">User ID</dt>
                  <dd className="font-mono text-xs text-slate-600">{data.user.id}</dd>
                </div>
              </dl>
            </div>

            <div className="glass-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                  <Building2 className="h-4 w-4" />
                </div>
                <h2 className="text-sm font-semibold text-slate-700">Company</h2>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-slate-800">{data.company.name ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <dt className="text-slate-500">Code</dt>
                  <dd className="text-slate-700">{data.company.code ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
                  <dt className="text-slate-500">Base Currency</dt>
                  <dd className="text-slate-700">{data.company.base_currency ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-slate-500">Company ID</dt>
                  <dd className="font-mono text-xs text-slate-600">{data.company.id}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Roles */}
          <div className="glass-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-slate-700">Roles</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-700">
                {data.highest_role}
              </span>
              {data.roles
                .filter((r) => r !== data.highest_role)
                .map((r) => (
                  <span key={r} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                    {r}
                  </span>
                ))}
              <span className="ml-1 text-[11px] text-slate-400">
                Highest role determines your effective permissions.
              </span>
            </div>
          </div>

          {/* Capabilities */}
          <div className="glass-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
              <Lock className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Effective Permissions</h2>
            </div>
            <div className="grid gap-x-8 gap-y-1 p-5 sm:grid-cols-2">
              {CAPABILITY_LABELS.map(({ key, label }) => {
                const allowed = data.capabilities[key];
                return (
                  <div key={key} className="flex items-center justify-between border-b border-slate-100 py-1.5">
                    <span className="text-sm text-slate-600">{label}</span>
                    {allowed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-slate-300" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Read-only notice */}
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">
              This profile is read-only. Role, company, and permission assignments are managed by an
              administrator and enforced by the backend (RLS and Edge Function authorization). The flags
              above reflect the server&apos;s authoritative view of your access via{" "}
              <code className="rounded bg-blue-100 px-1 font-mono text-[10px]">GET /auth/me</code>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
