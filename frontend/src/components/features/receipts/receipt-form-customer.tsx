"use client";

import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import { User, CalendarDays, FileText } from "lucide-react";

interface Customer {
  id: string;
  customer_id: string;
  customer_name: string;
  credit_limit?: number;
}

interface Outstanding {
  totalOutstanding: number;
  invoiceCount: number;
}

interface ReceiptFormCustomerProps {
  form: UseFormReturn<ReceiptFormValues>;
  customers: Customer[];
  outstanding: Outstanding | undefined;
  selectedCustomer: Customer | undefined;
  watchCustomerId: string;
  watchCurrency: string;
}

export function ReceiptFormCustomer({
  form, customers, outstanding, selectedCustomer, watchCustomerId, watchCurrency,
}: ReceiptFormCustomerProps) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <User className="h-4 w-4 text-brand-400" />
          Customer & Date
        </h2>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        {/* Customer Select */}
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Customer <span className="text-red-400">*</span>
          </label>
          <Controller
            control={form.control}
            name="customer_id"
            render={({ field }) => (
              <select
                {...field}
                className={cn(
                  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-800 transition-colors",
                  "focus:outline-none focus:ring-1 focus:ring-brand-500",
                  form.formState.errors.customer_id ? "border-red-500" : "border-slate-300"
                )}
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.customer_name} ({c.customer_id})</option>
                ))}
              </select>
            )}
          />
          {form.formState.errors.customer_id && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.customer_id.message}</p>
          )}

          {/* Customer Outstanding Preview */}
          {watchCustomerId && outstanding && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
              <FileText className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-xs text-slate-500">Outstanding Invoices</p>
                <p className="font-mono text-sm font-semibold text-amber-500">
                  {formatCurrency(outstanding.totalOutstanding, watchCurrency)}{" "}
                  <span className="text-xs font-normal text-slate-500">({outstanding.invoiceCount} invoices)</span>
                </p>
              </div>
              {selectedCustomer && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-slate-500">Credit Limit</p>
                  <p className="font-mono text-sm text-slate-600">{formatCurrency(selectedCustomer.credit_limit ?? 0, watchCurrency)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Receipt Date */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Receipt Date <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="date"
              {...form.register("receipt_date")}
              className={cn(
                "h-10 w-full rounded-lg border bg-white pl-10 pr-3 text-sm text-slate-800",
                "focus:outline-none focus:ring-1 focus:ring-brand-500",
                form.formState.errors.receipt_date ? "border-red-500" : "border-slate-300"
              )}
            />
          </div>
          {form.formState.errors.receipt_date && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.receipt_date.message}</p>
          )}
        </div>

        {/* Value Date */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">Value Date</label>
          <input
            type="date"
            {...form.register("value_date")}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>
    </div>
  );
}
