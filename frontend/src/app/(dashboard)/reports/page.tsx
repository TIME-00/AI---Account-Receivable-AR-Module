"use client";

import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Report Center</h1>
        <p className="mt-1 text-sm text-slate-500">Aging Analysis, Customer Statements & AR Summary Reports</p>
      </div>
      <div className="glass-card flex flex-col items-center justify-center py-20">
        <BarChart3 className="h-12 w-12 text-slate-600" />
        <p className="mt-4 text-sm text-slate-500">Report Center coming soon</p>
      </div>
    </div>
  );
}
