"use client";

import { cn, formatDate } from "@/lib/utils";
import { SUPPORTED_CURRENCY_OPTIONS } from "@/lib/currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { CustomerComboboxWithCreate } from "@/components/features/customers/customer-combobox-with-create";
import type { UseFormReturn } from "react-hook-form";
import type { InvoiceFormValues } from "@/lib/invoice-schema";
import type { PaymentTermOption } from "@/hooks/use-invoice-calculator";
import type { Customer } from "@/types";
import { FileText, CalendarDays, CreditCard } from "lucide-react";

interface InvoiceHeaderFormProps {
  form: UseFormReturn<InvoiceFormValues>;
  customers: Customer[];
  paymentTerms: PaymentTermOption[];
  /** Reserved for the customer search overlay; not read by this component. */
  _customerSearch?: string;
  setCustomerSearch: (q: string) => void;
  selectedCustomerName: string;
  setSelectedCustomerName: (n: string) => void;
  selectedTermId: string | null;
  setSelectedTermId: (id: string | null) => void;
  fieldErrors: Record<string, string>;
  calculatedDueDate: string | null;
}

export function InvoiceHeaderForm({
  form,
  customers,
  paymentTerms,
  setCustomerSearch,
  selectedCustomerName,
  setSelectedCustomerName,
  selectedTermId,
  setSelectedTermId,
  fieldErrors,
  calculatedDueDate,
}: InvoiceHeaderFormProps) {
  const docType = form.watch("doc_type");
  // Authoritative company base currency for the FX rate direction label.
  const { baseCurrency } = useBaseCurrency();

  return (
    <div className="glass-card p-6 animate-fade-in">
      <h2 className="mb-5 text-base font-semibold text-slate-900 flex items-center gap-2">
        <FileText className="h-4 w-4 text-brand-400" />
        Invoice Header
      </h2>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Doc Type */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Document Type <span className="text-red-400">*</span>
          </label>
          <select {...form.register("doc_type")} className="input-premium w-full">
            <option value="Invoice">Invoice</option>
            <option value="Credit Note">Credit Note</option>
            <option value="Debit Note">Debit Note</option>
          </select>
          {form.formState.errors.doc_type && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.doc_type.message}</p>
          )}
        </div>

        {/* Invoice Date */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            <CalendarDays className="mr-1 inline h-3 w-3" />
            Invoice Date <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            {...form.register("invoice_date")}
            className={cn(
              "input-premium w-full",
              fieldErrors["invoice_date"] && "!border-red-500 !ring-red-500/30"
            )}
          />
          {(form.formState.errors.invoice_date || fieldErrors["invoice_date"]) && (
            <p className="mt-1 text-xs text-red-400">
              {fieldErrors["invoice_date"] || form.formState.errors.invoice_date?.message}
            </p>
          )}
        </div>

        {/* Customer Selector */}
        <CustomerComboboxWithCreate
          customers={customers}
          onSearchChange={(q) => {
            setCustomerSearch(q);
            setSelectedCustomerName("");
            form.setValue("customer_id", "");
          }}
          selectedName={selectedCustomerName}
          onClearSelection={() => {
            setSelectedCustomerName("");
            form.setValue("customer_id", "");
          }}
          onSelect={(c) => {
            form.setValue("customer_id", c.id, { shouldValidate: true });
            form.setValue("currency", c.default_currency, { shouldValidate: true });
            setSelectedCustomerName(c.customer_name);
            if (c.payment_term_id) {
              setSelectedTermId(c.payment_term_id);
            }
          }}
          error={fieldErrors["customer_id"] || form.formState.errors.customer_id?.message}
        />

        {/* Currency */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Currency <span className="text-red-400">*</span>
          </label>
          <select {...form.register("currency")} className="input-premium w-full">
            {SUPPORTED_CURRENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Exchange Rate */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Exchange Rate ({baseCurrency
              ? `1 ${form.watch("currency")} = ? ${baseCurrency}`
              : `1 ${form.watch("currency")} → company base`})
          </label>
          <input
            type="number"
            step="0.0001"
            {...form.register("exchange_rate", { valueAsNumber: true })}
            className="input-premium w-full"
          />
        </div>

        {/* Payment Term */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            <CreditCard className="mr-1 inline h-3 w-3" />
            Payment Term
          </label>
          <select
            value={selectedTermId ?? ""}
            onChange={(e) => setSelectedTermId(e.target.value || null)}
            className="input-premium w-full"
          >
            <option value="">-- Select Term --</option>
            {paymentTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.term_code} — {t.term_name}
              </option>
            ))}
          </select>
          {paymentTerms.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">
              No payment terms are configured for this company yet.
            </p>
          )}
          {calculatedDueDate && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-500">
              <CalendarDays className="h-3 w-3" />
              Due Date: {formatDate(calculatedDueDate)}
            </p>
          )}
        </div>

        {/* Reference No */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Reference No.
          </label>
          <input
            type="text"
            {...form.register("reference_no")}
            placeholder="PO-2026-001"
            className="input-premium w-full"
            maxLength={50}
          />
        </div>
      </div>

      {/* CN-specific fields */}
      {docType === "Credit Note" && (
        <div className="mt-5 rounded-lg border border-purple-500/20 bg-purple-50 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-purple-600">
            Credit Note Fields
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">CN Type</label>
              <select {...form.register("cn_type")} className="input-premium w-full">
                <option value="">-- Select --</option>
                <option value="Linked">Linked (Reference Invoice)</option>
                <option value="Standalone">Standalone</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Reason Code</label>
              <select {...form.register("reason_code")} className="input-premium w-full">
                <option value="">-- Select --</option>
                <option value="Return">Return</option>
                <option value="Discount">Discount</option>
                <option value="Price Adjustment">Price Adjustment</option>
                <option value="Error Correction">Error Correction</option>
                <option value="Other">Other</option>
              </select>
            </div>
            {form.watch("reason_code") === "Other" && (
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Reason Description <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  {...form.register("reason_desc")}
                  className="input-premium w-full"
                  placeholder="Please specify the reason..."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
