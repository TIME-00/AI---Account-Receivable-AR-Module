"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, CreditCard, FileText, Banknote, Clock, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCustomerAgingRow,
  formatDate,
} from "@/hooks/use-f2-data";
import { useCustomer } from "@/hooks/use-customers";
import { ApiError } from "@/hooks/use-api";
import { useInvoiceList, totalPagesFrom } from "@/hooks/use-invoices";
import { useReceipts, useCustomerExposure } from "@/hooks/use-receipts";
import { formatMoney, formatMoneySafe, normalizeCurrency } from "@/lib/currency";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { CustomerSalesRepPanel } from "@/components/features/automation/customer-sales-rep-panel";
import { useRegisterCopilotEntity } from "@/providers/copilot-entity-provider";

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

/** Server page size for the customer's Invoice/Receipt tabs. */
const TAB_PAGE_SIZE = 20;

export default function CustomerDetailPage() {
  const params = useParams();
  const customerId = params.id as string;
  const [tab, setTab] = useState<Tab>("invoices");

  // B9DD-RR-002: the GOVERNED detail endpoint. The previous code searched for
  // the customer inside a capped 100-row list, so any valid customer beyond the
  // first page rendered a false "Customer not found". `GET /customers/:id`
  // (customers/service.ts::getCustomerById) enforces is_deleted / is_hidden and
  // assignment scope, and 404s when the customer is genuinely inaccessible.
  const { data: customer, isLoading: loadingCust, error: errorCust } = useCustomer(customerId);

  // AR Copilot shows the customer name rather than the UUID from the URL.
  useRegisterCopilotEntity(
    customer
      ? {
          entityType: "customer",
          entityId: customerId,
          displayNumber: customer.customer_name,
        }
      : null,
  );

  // B9DD-FEIR-002 / RR-002: invoices/receipts are filtered BY THE SERVER on
  // customer_id, with authoritative collection totals, and each tab keeps its
  // own server page.
  const [invoicePage, setInvoicePage] = useState(1);
  const [receiptPage, setReceiptPage] = useState(1);
  const { data: invoiceData, isFetching: invoicesFetching } = useInvoiceList({
    customer_id: customerId,
    page: invoicePage,
    page_size: TAB_PAGE_SIZE,
  });
  const { data: receiptData, isFetching: receiptsFetching } = useReceipts({
    customer_id: customerId,
    page: receiptPage,
    page_size: TAB_PAGE_SIZE,
  });

  // Authoritative multi-currency exposure + aging buckets for this customer.
  const { data: exposure } = useCustomerExposure(customerId);
  const { data: customerAging } = useCustomerAgingRow(customerId);

  // Current page of rows, kept clearly distinct from the backend COLLECTION
  // totals (which drive the tab labels and pagination).
  const customerInvoices = invoiceData?.rows ?? [];
  const invoiceTotal = invoiceData?.pagination.total ?? 0;
  const invoicePages = totalPagesFrom(
    invoiceData?.pagination ?? { total: 0, page: 1, page_size: TAB_PAGE_SIZE },
  );
  const customerReceipts = receiptData?.rows ?? [];
  const receiptTotal = receiptData?.pagination.total ?? 0;
  const receiptPages = totalPagesFrom(
    receiptData?.pagination ?? { total: 0, page: 1, page_size: TAB_PAGE_SIZE },
  );

  // Company base currency for the base-denominated exposure figures.
  const baseCurrency = exposure?.baseCurrency ?? null;
  const totalOutstanding = exposure?.baseTotal ?? 0;

  // A credit limit and a company-base exposure may be denominated differently:
  // the backend declares no currency for `customers.credit_limit` (its own
  // credit view pairs it with `default_currency` while summing outstanding
  // across currencies without FX conversion — a legacy pre-9D-D behaviour).
  // Available credit / utilisation are therefore only shown when the two are
  // provably the same currency; otherwise the subtraction would be meaningless.
  const creditLimitCurrency = normalizeCurrency(customer?.default_currency);
  const creditComparable =
    creditLimitCurrency !== null && baseCurrency !== null && creditLimitCurrency === baseCurrency;
  const availableCredit = creditComparable ? (customer?.credit_limit ?? 0) - totalOutstanding : null;
  const utilization =
    creditComparable && customer?.credit_limit
      ? Math.min(100, (totalOutstanding / customer.credit_limit) * 100)
      : null;

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

  // ── Not Found: the GOVERNED 404 from GET /customers/:id ───────────────────
  // This is the backend's authoritative decision (deleted / hidden / out of
  // assignment scope), not an artefact of client-side paging.
  if (errorCust instanceof ApiError && errorCust.status === 404) {
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

  // ── Error ──────────────────────────────────────────────────────────────────
  // Any other failure is reported as a failure — never as "not found", which
  // would misrepresent a transient error as an authorization/existence fact.
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

      {/* Gate E — responsible sales representative + assignment history */}
      <CustomerSalesRepPanel customerId={customerId} />

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
              <Link
                href={`/customers/${customerId}/statement`}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-blue-600"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Statement
              </Link>
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
              <span className="font-mono font-medium text-slate-800">
                {formatMoneySafe(customer.credit_limit, customer.default_currency)}
              </span>
            </div>

            {/* Outstanding by transaction currency (authoritative) */}
            <div className="text-sm">
              <p className="mb-1 text-slate-500">Outstanding by currency</p>
              {exposure ? (
                <CurrencyTotals byCurrency={exposure.byCurrency} color="text-amber-600" className="text-sm" />
              ) : (
                <p className="font-mono text-slate-400">No outstanding documents</p>
              )}
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Outstanding (company base)</span>
              <span className="font-mono font-medium text-amber-600">{formatMoneySafe(totalOutstanding, baseCurrency)}</span>
            </div>

            {creditComparable && availableCredit !== null ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Available</span>
                <span className={cn("font-mono font-medium", availableCredit >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {formatMoneySafe(availableCredit, baseCurrency)}
                </span>
              </div>
            ) : (
              <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
                Available credit is not shown: the credit limit
                {creditLimitCurrency ? ` (${creditLimitCurrency})` : ""} and the company-base exposure
                {baseCurrency ? ` (${baseCurrency})` : ""} are not in the same currency, and the backend
                supplies no FX-normalised credit figure.
              </p>
            )}
            {/* Utilization bar — only when the comparison is currency-valid */}
            {creditComparable && utilization !== null && (
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
            )}
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
              {/* Backend COLLECTION totals, not this page's row count. */}
              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs">
                {t === "invoices" ? invoiceTotal : t === "receipts" ? receiptTotal : ""}
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
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatMoney(inv.total_amount, inv.currency)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatMoney(inv.outstanding, inv.currency)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", invoiceStatusColor[inv.status] ?? "bg-slate-100 text-slate-500")}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TabPagination
                  total={invoiceTotal}
                  page={invoiceData?.pagination.page ?? invoicePage}
                  pageSize={invoiceData?.pagination.page_size ?? TAB_PAGE_SIZE}
                  totalPages={invoicePages}
                  busy={invoicesFetching}
                  onPage={setInvoicePage}
                  noun="invoices"
                />
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
                        <td className="px-4 py-2.5 text-right font-mono text-xs">{formatMoney(r.receipt_amount, r.currency)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", receiptStatusColor[r.status] ?? "bg-slate-100 text-slate-500")}>{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TabPagination
                  total={receiptTotal}
                  page={receiptData?.pagination.page ?? receiptPage}
                  pageSize={receiptData?.pagination.page_size ?? TAB_PAGE_SIZE}
                  totalPages={receiptPages}
                  busy={receiptsFetching}
                  onPage={setReceiptPage}
                  noun="receipts"
                />
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
                      <p className={cn("mt-1 font-mono text-sm font-semibold", b.color)}>{formatMoneySafe(b.value, baseCurrency)}</p>
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

// ─── Tab pagination (B9DD-RR-002) ───────────────────────────────────────────
//
// Server pagination for the customer's Invoice/Receipt tabs. The COLLECTION
// total comes from backend metadata and is stated separately from the rows on
// screen, so the current page is never mistaken for the whole history.
function TabPagination({
  total,
  page,
  pageSize,
  totalPages,
  busy,
  onPage,
  noun,
}: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  busy: boolean;
  onPage: (updater: (p: number) => number) => void;
  noun: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
      <p className="text-xs text-slate-500">
        Showing {first}–{last} of {total} {noun}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs tabular-nums text-slate-600" aria-live="polite">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => onPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || busy}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
