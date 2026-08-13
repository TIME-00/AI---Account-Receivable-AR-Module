"use client";

import Link from "next/link";
import { BarChart3, FileText, Banknote, Users, Clock, ArrowRight } from "lucide-react";

const reports = [
  {
    title: "AR Aging Report",
    description: "Analyze outstanding receivables by aging brackets — Current, 1–30, 31–60, 61–90, and 90+ days.",
    icon: Clock,
    href: "/reports/aging",
    color: "from-blue-500 to-indigo-600",
    iconBg: "bg-blue-50 text-blue-600",
  },
  {
    title: "Invoice Summary",
    description: "Invoice status breakdown, amounts, and trends across all invoice types.",
    icon: FileText,
    href: "/reports/invoices",
    color: "from-emerald-500 to-teal-600",
    iconBg: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Receipt Summary",
    description: "Payment collection summary with method analysis and allocation status.",
    icon: Banknote,
    href: "/reports/receipts",
    color: "from-amber-500 to-orange-600",
    iconBg: "bg-amber-50 text-amber-600",
  },
  {
    title: "Customer Outstanding",
    description: "Customer outstanding balance rankings and overdue analysis.",
    icon: Users,
    href: "/reports/outstanding",
    color: "from-purple-500 to-violet-600",
    iconBg: "bg-purple-50 text-purple-600",
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Report Center</h1>
        <p className="mt-1 text-sm text-slate-500">AR Reports &amp; Analytics</p>
      </div>

      {/* Report Cards Grid */}
      <div className="grid gap-5 sm:grid-cols-2">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Link
              key={report.href}
              href={report.href}
              className="glass-card group relative overflow-hidden p-6 transition-all hover:shadow-lg hover:-translate-y-0.5"
            >
              {/* Gradient accent bar */}
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${report.color}`} />

              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 rounded-xl p-3 ${report.iconBg}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {report.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">{report.description}</p>
                  <div className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    View Report <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Export availability.
          Export is implemented and live, but it is offered per report via the
          Export control on each report page — there is no global one-click
          export here. The copy says exactly that rather than promising a
          capability this page does not have. */}
      <div className="glass-card flex items-center gap-3 p-4">
        <BarChart3 className="h-5 w-5 shrink-0 text-slate-400" />
        <div>
          <p className="text-sm font-medium text-slate-700">Export Reports</p>
          <p className="text-xs text-slate-500">
            PDF and Excel exports are available within each report.
          </p>
        </div>
      </div>
    </div>
  );
}
