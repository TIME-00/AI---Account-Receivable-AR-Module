"use client";

import { CreditCard, Info } from "lucide-react";

export default function CreditNotesPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Credit Notes</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Coming Soon
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Linked & Standalone Credit Note Management</p>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-sm font-medium text-blue-800">Credit Notes will be available in a future sprint</p>
          <p className="text-xs text-blue-600">
            The credit note module will support linked credit notes (reversal of specific invoices)
            and standalone credit notes (customer credits). Backend support for credit notes
            already exists — the frontend implementation is pending.
          </p>
        </div>
      </div>

      {/* Placeholder */}
      <div className="glass-card flex flex-col items-center justify-center py-16">
        <div className="rounded-full bg-slate-50 p-4">
          <CreditCard className="h-10 w-10 text-slate-300" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-500">Credit note management is not yet available</p>
        <p className="mt-1 text-[10px] text-slate-400">This feature will be implemented in a future sprint.</p>
      </div>
    </div>
  );
}
