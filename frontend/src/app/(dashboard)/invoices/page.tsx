"use client";

import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Invoice Management</h1>
          <p className="mt-1 text-sm text-slate-500">Manage Invoices, Debit Notes & Credit Notes</p>
        </div>
        <Link href="/invoices/new">
          <LoadingButton variant="primary" size="md">
            <Plus className="h-4 w-4" />
            New Invoice
          </LoadingButton>
        </Link>
      </div>

      <div className="glass-card flex flex-col items-center justify-center py-20">
        <FileText className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">Invoice list coming soon</p>
        <p className="mt-1 text-xs text-slate-600">Supports status filtering, date range, and customer search</p>
        <Link
          href="/invoices/new"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand-900/30 transition-all hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" />
          Create Your First Invoice
        </Link>
      </div>
    </div>
  );
}
