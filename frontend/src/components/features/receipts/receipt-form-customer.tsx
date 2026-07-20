"use client";

import { cn } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import type { Customer } from "@/types";
import type { CustomerExposure } from "@/hooks/use-receipts";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import { CustomerComboboxWithCreate } from "@/components/features/customers/customer-combobox-with-create";
import { User, CalendarDays, FileText } from "lucide-react";

interface ReceiptFormCustomerProps {
  form: UseFormReturn<ReceiptFormValues>;
  customers: Customer[];
  /**
   * Authoritative customer exposure. `null` means the backend reports no
   * outstanding documents (zero exposure); `undefined` means not yet loaded.
   */
  exposure: CustomerExposure | null | undefined;
  exposureLoading: boolean;
  exposureError: boolean;
  selectedCustomer: Customer | undefined;
  watchCustomerId: string;
}

/**
 * B9DD-FEIR-005: customer exposure is presented in its OWN currencies —
 * per-currency native outstanding plus a separately-labelled company-base total.
 * It is deliberately NOT relabelled with the draft receipt's currency, and the
 * receipt's currency selection has no effect on this panel.
 */
export function ReceiptFormCustomer({
  form, customers, exposure, exposureLoading, exposureError, selectedCustomer, watchCustomerId,
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
          <CustomerComboboxWithCreate
            customers={customers}
            selectedName={selectedCustomer?.customer_name}
            onClearSelection={() => {
              form.setValue("customer_id", "", { shouldValidate: true });
            }}
            onSelect={(customer) => {
              form.setValue("customer_id", customer.id, { shouldValidate: true });
              form.setValue("currency", customer.default_currency, { shouldValidate: true });
            }}
            error={form.formState.errors.customer_id?.message}
          />

          {/* Customer exposure — authoritative, in the customer's own currencies */}
          {watchCustomerId && (
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              {exposureLoading ? (
                <p className="text-xs text-slate-400">Loading customer exposure…</p>
              ) : exposureError ? (
                <p className="text-xs text-amber-700">
                  Customer exposure is unavailable. No outstanding figure is shown rather than an
                  incomplete one.
                </p>
              ) : (
                <div className="flex flex-wrap items-start gap-4">
                  <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                  <div>
                    <p className="text-xs text-slate-500">
                      Outstanding by currency
                      {exposure && (
                        <span className="ml-1 text-slate-400">
                          ({exposure.documentCount} document{exposure.documentCount === 1 ? "" : "s"})
                        </span>
                      )}
                    </p>
                    {exposure ? (
                      <CurrencyTotals byCurrency={exposure.byCurrency} color="text-amber-600" className="mt-0.5 text-sm" />
                    ) : (
                      <p className="mt-0.5 font-mono text-sm text-slate-500">No outstanding documents</p>
                    )}
                  </div>

                  {exposure && (
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Company-base exposure</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-slate-800">
                        {formatMoneySafe(exposure.baseTotal, exposure.baseCurrency)}
                      </p>
                    </div>
                  )}

                  {selectedCustomer && (
                    <div className="ml-auto text-right">
                      <p className="text-xs text-slate-500">
                        Credit limit
                        <span className="ml-1 text-slate-400">({selectedCustomer.default_currency})</span>
                      </p>
                      <p className="font-mono text-sm text-slate-600">
                        {formatMoneySafe(selectedCustomer.credit_limit ?? 0, selectedCustomer.default_currency)}
                      </p>
                    </div>
                  )}
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
