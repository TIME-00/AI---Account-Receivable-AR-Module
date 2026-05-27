"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, CreditCard, FileText, Banknote, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAllCustomers,
  useAllInvoices,
  useAllReceipts,
  useAgingByCustomerF2,
  formatCurrency,
  formatDate,
} from "@/hooks/use-f2-data";
import type { CustomerAgingRow } from "@/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  Inactive: "bg-slate-50 text-slate-600 ring-slate-500/20",
  Blocked: "bg-red-50 text-red-700 ring-red-600/20",
  "On Hold": "bg-amber-50 text-amber-700 ring-amber-600/20",
};

const invoiceStatusColor: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Open: "bg-blue-50 text-blue-700",
  Overdue: "bg-red-50 text-red-700",
  "Partially Paid": "bg-amber-50 text-amber-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
};

const receiptStatusColor: Record<string, string> = {
  Draft: "bg-slate-100 text-slate-600",
  Posted: "bg-blue-50 text-blue-700",
  "Fully Allocated": "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
};

type Tab = "invoices" | "receipts" | "aging";

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const [tab, setTab] = useState<Tab>("invoices");

  const { data: allCustomers, isLoading: loadingCust, error: errorCust } = useAllCustomers();
  const { data: allInvoices } = useAllInvoices();
  const { data: allReceipts } = useAllReceipts();
  const { data: agingRaw } = useAgingByCustomerF2();

  // Find customer client-side — NO GET /customers/:id
  const customer = useMemo(
    () => allCustomers?.find((c) => c.id === customerId) ?? null,
    [allCustomers, customerId]
  );

  // Filter invoices/receipts client-side
  const customerInvoices = useMemo(
    () => (allInvoices ?? []).filter((inv) => inv.customer_id === customerId),
    [allInvoices, customerId]
  );

  const customerReceipts = useMemo(
    () => (allReceipts ?? []).filter((r) => r.customer_id === customerId),
    [allReceipts, customerId]
  );

  // Aging data — find this customer's row
  const agingRows: CustomerAgingRow[] = useMemo(() => {
    if (!agingRaw) return [];
    return Array.isArray(agingRaw) ? agingRaw : (agingRaw as any)?.rows ?? [];
  }, [agingRaw]);

  const customerAging = useMemo(
    () => agingRows.find((r) => r.customer_id === customerId) ?? null,
    [agingRows, customerId]
  );

  const totalOutstanding = customerAging?.total_outstanding ?? 0;
  const availableCredit = (customer?.credit_limit ?? 0) - totalOutstanding;
  const utilization = customer?.credit_limit
    ? Math.min(100, (totalOutstanding / customer.credit_limit) * 100)
    : 0;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loadingCust) {
    return (
      <div className="space-y-6">
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading customer…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (errorCust) {
    return (
      <div className="space-y-6">
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load customer data</p>
          <p className="text-xs text-slate-400">{(errorCust as Error).message}</p>
        </div>
      </div>
    );
  }

  // ── Not Found ──────────────────────────────────────────────────────────────
  if (!customer) {
    return (
      <div className="space-y-6">
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <Building2 className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">Customer not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/customers" className="hover:text-blue-600">Customers</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">{customer.customer_name}</span>
      </div>

      {/* Customer Info + Credit Summary */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Info Card */}
        <div className="glass-card space-y-4 lg:col-span-2 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{customer.customer_name}</h1>
              <p className="mt-0.5 font-mono text-xs text-slate-400">{customer.customer_id}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", statusColor[customer.status])}>
                {customer.status}
              </span>
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                {customer.credit_rating}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <div><span className="text-slate-500">Type:</span> <span className="text-slate-700">{customer.customer_type}</span></div>
              <div><span className="text-slate-500">Contact:</span> <span className="text-slate-700">{customer.contact_name}</span></div>
              <div><span className="text-slate-500">Email:</span> <span className="text-slate-700">{customer.contact_email}</span></div>
              <div><span className="text-slate-500">Phone:</span> <span className="text-slate-700">{customer.contact_phone}</span></div>
            </div>
            <div className="space-y-2 text-sm">
              <div><span className="text-slate-500">Registration:</span> <span className="text-slate-700">{customer.registration_no ?? "—"}</span></div>
              <div><span className="text-slate-500">Tax ID:</span> <span className="text-slate-700">{customer.tax_id ?? "—"}</span></div>
              <div><span className="text-slate-500">Currency:</span> <span className="text-slate-700">{customer.default_currency}</span></div>
              <div><span className="text-slate-500">Address:</span> <span className="text-slate-700">{customer.bill_addr_line1}, {customer.bill_city}</span></div>
            </div>
          </div>
        </div>

        {/* Credit Summary */}
        <div className="glass-card space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Credit Summary
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Credit Limit</span>
              <span className="font-mono font-medium text-slate-800">{formatCurrency(customer.credit_limit)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Outstanding</span>
              <span className="font-mono font-medium text-amber-600">{formatCurrency(totalOutstanding)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Available</span>
              <span className={cn("font-mono font-medium", availableCredit >= 0 ? "text-emerald-600" : "text-red-600")}>
                {formatCurrency(availableCredit)}
              </span>
            </div>
            {/* Utilization bar */}
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Utilization</span>
                <span>{utilization.toFixed(1)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", utilization > 90 ? "bg-red-500" : utilization > 70 ? "bg-amber-500" : "bg-blue-500")}
                  style={{ width: `${Math.min(100, utilization)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="glass-card overflow-hidden">
        <div className="flex border-b border-slate-200">
          {(["invoices", "receipts", "aging"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === t
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              )}
            >
              {t === "invoices" && <FileText className="h-4 w-4" />}
              {t === "receipts" && <Banknote className="h-4 w-4" />}
              {t === "aging" && <Clock className="h-4 w-4" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs">
                {t === "invoices" ? customerInvoices.length : t === "receipts" ? customerReceipts.length : ""}
              </span>
            </button>
          ))}
        </div>

        <div className="p-1">
          {/* ── Invoices Tab ──────────────────────────── */}
          {tab === "invoices" && (
            customerInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No invoices for this customer</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Invoice No</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Amount</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Outstanding</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {customerInvoices.map((inv) => (
                      <tr key={inv.id} className="group hover:bg-slate-50/80">
                        <td className="px-4 py-2.5">
                          <Link href={`/invoices/${inv.id}`} className="font-mono text-xs text-blue-600 hover:underline">{inv.invoice_no}</Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(inv.invoice_date)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(inv.total_amount)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(inv.outstanding)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", invoiceStatusColor[inv.status] ?? "bg-slate-100 text-slate-500")}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Receipts Tab ──────────────────────────── */}
          {tab === "receipts" && (
            customerReceipts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Banknote className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No receipts for this customer</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 bg-slate-50/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Receipt No</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Date</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Amount</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Status</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {customerReceipts.map((r) => (
                      <tr key={r.id} className="group hover:bg-slate-50/80">
                        <td className="px-4 py-2.5">
                          <Link href={`/receipts/${r.id}`} className="font-mono text-xs text-blue-600 hover:underline">{r.receipt_no}</Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(r.receipt_date)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(r.receipt_amount)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", receiptStatusColor[r.status] ?? "bg-slate-100 text-slate-500")}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── Aging Tab ─────────────────────────────── */}
          {tab === "aging" && (
            !customerAging ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Clock className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No aging data available for this customer</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Current", value: customerAging.current_amount, color: "text-emerald-600" },
                    { label: "1–30 Days", value: customerAging.bucket_1_30, color: "text-blue-600" },
                    { label: "31–60 Days", value: customerAging.bucket_31_60, color: "text-amber-600" },
                    { label: "61–90 Days", value: customerAging.bucket_61_90, color: "text-orange-600" },
                    { label: "90+ Days", value: customerAging.bucket_over_90, color: "text-red-600" },
                    { label: "Total", value: customerAging.total_outstanding, color: "text-slate-900" },
                  ].map((b) => (
                    <div key={b.label} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-center">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{b.label}</p>
                      <p className={cn("mt-1 font-mono text-sm font-semibold", b.color)}>{formatCurrency(b.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
