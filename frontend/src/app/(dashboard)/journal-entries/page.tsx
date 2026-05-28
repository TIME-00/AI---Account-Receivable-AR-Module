"use client";

import { BookOpen, FileText, Banknote, XCircle, ArrowRight, Info } from "lucide-react";

const jeTypes = [
  {
    title: "Invoice Posting",
    icon: FileText,
    iconBg: "bg-blue-50 text-blue-600",
    accent: "from-blue-500 to-indigo-600",
    entries: [
      { side: "Dr", account: "Accounts Receivable", desc: "Customer balance increases" },
      { side: "Cr", account: "Revenue", desc: "Sales revenue recognized" },
      { side: "Cr", account: "Tax Payable (if applicable)", desc: "Output tax recorded" },
    ],
    trigger: "When an invoice is posted via POST /invoices/:id/post",
  },
  {
    title: "Receipt Posting",
    icon: Banknote,
    iconBg: "bg-emerald-50 text-emerald-600",
    accent: "from-emerald-500 to-teal-600",
    entries: [
      { side: "Dr", account: "Cash / Bank", desc: "Cash received" },
      { side: "Cr", account: "Accounts Receivable", desc: "Customer balance decreases" },
    ],
    trigger: "When a receipt is posted via POST /receipts/:id/post",
  },
  {
    title: "Invoice Cancellation",
    icon: XCircle,
    iconBg: "bg-red-50 text-red-600",
    accent: "from-red-500 to-rose-600",
    entries: [
      { side: "Dr", account: "Revenue", desc: "Revenue reversed" },
      { side: "Cr", account: "Accounts Receivable", desc: "Customer balance reversed" },
    ],
    trigger: "When an invoice is cancelled via POST /invoices/:id/cancel",
  },
];

export default function JournalEntriesPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Journal Entries</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
            Prototype Placeholder
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">Auto-generated from AR transactions</p>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <div>
          <p className="text-sm font-medium text-blue-800">Journal entries are automatically created by the backend</p>
          <p className="text-xs text-blue-600">
            When invoices are posted, receipts are posted, or invoices are cancelled, the backend
            automatically generates the corresponding double-entry journal entries with proper
            debit/credit entries and GL account mapping. No manual JE creation is needed for AR transactions.
          </p>
        </div>
      </div>

      {/* JE Type Cards */}
      <div className="grid gap-5 lg:grid-cols-3">
        {jeTypes.map((je) => {
          const Icon = je.icon;
          return (
            <div key={je.title} className="glass-card relative overflow-hidden p-5">
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${je.accent}`} />
              <div className="flex items-center gap-3 mb-4">
                <div className={`rounded-xl p-2.5 ${je.iconBg}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-slate-800">{je.title}</h3>
              </div>

              <div className="space-y-2 mb-4">
                {je.entries.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`font-mono font-bold ${entry.side === "Dr" ? "text-blue-600" : "text-emerald-600"}`}>
                      {entry.side}
                    </span>
                    <span className="font-medium text-slate-700">{entry.account}</span>
                    <ArrowRight className="h-3 w-3 text-slate-300 flex-shrink-0" />
                    <span className="text-slate-400">{entry.desc}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[10px] text-slate-400">
                  <span className="font-semibold">Trigger:</span> {je.trigger}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reference Note */}
      <div className="glass-card p-5">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Where to find JE numbers</h3>
            <p className="mt-1 text-xs text-slate-500">
              Journal entry numbers (JE numbers) are displayed on the <strong>Invoice Detail</strong> and{" "}
              <strong>Receipt Detail</strong> pages after posting. The JE number is returned by the
              backend in the post response and shown in the transaction timeline.
            </p>
          </div>
        </div>
      </div>

      {/* Placeholder Note */}
      <div className="glass-card flex flex-col items-center justify-center py-10">
        <BookOpen className="h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm text-slate-500">Full journal entry listing and drill-down will be available in a future sprint</p>
        <p className="mt-1 text-[10px] text-slate-400">The GET /journal-entries API is not yet verified for frontend use.</p>
      </div>
    </div>
  );
}
