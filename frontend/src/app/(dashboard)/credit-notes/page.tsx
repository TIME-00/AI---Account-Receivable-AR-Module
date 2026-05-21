"use client";

import { CreditCard } from "lucide-react";

export default function CreditNotesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Credit Notes</h1>
        <p className="mt-1 text-sm text-slate-500">Linked / Standalone Credit Note Management</p>
      </div>
      <div className="glass-card flex flex-col items-center justify-center py-20">
        <CreditCard className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">Credit Notes module coming soon</p>
      </div>
    </div>
  );
}
