"use client";

import { formatMoneySafe } from "@/lib/currency";
import { Users } from "lucide-react";
import type { DashboardTopCustomer } from "@/types";

interface TopCustomersProps {
  data: DashboardTopCustomer[];
  /** Company base currency (values are company-base); null when unavailable. */
  currency: string | null;
  isLoading?: boolean;
}

export function TopCustomers({ data, currency, isLoading = false }: TopCustomersProps) {
  return (
    <div className="chart-container">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Top Outstanding Customers</h3>
          <p className="text-xs text-slate-500">By outstanding balance (company base{currency ? ` — ${currency}` : ""})</p>
        </div>
        <Users className="h-4 w-4 text-slate-400" />
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-medium text-slate-500">No outstanding customers</p>
          <p className="text-xs text-slate-400">Customers with open balances will appear here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Customer</th>
                <th className="px-2 py-2 text-right">Outstanding</th>
                <th className="px-2 py-2 text-right">Overdue</th>
                <th className="px-2 py-2 text-right">Overdue Inv.</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.customer_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-2 py-2.5">
                    <p className="font-medium text-slate-900">{row.customer_name}</p>
                    <p className="text-xs text-slate-400">{row.customer_code}</p>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold text-slate-900">
                    {formatMoneySafe(row.outstanding_base, currency)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-red-600">
                    {row.overdue_base > 0 ? formatMoneySafe(row.overdue_base, currency) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-slate-600">
                    {row.overdue_invoice_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
