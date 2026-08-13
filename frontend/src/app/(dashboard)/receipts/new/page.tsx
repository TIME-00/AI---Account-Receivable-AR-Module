// ============================================================================
// TSH Synergy AR — Receipt Creation Workbench
// Professional financial form with customer outstanding preview,
// CHQ-specific conditional fields, and real-time validation.
// ============================================================================

"use client";

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  receiptFormSchema,
  defaultReceiptValues,
  type ReceiptFormValues,
} from "@/lib/receipt-schema";
import {
  useCustomers,
  useBankAccounts,
  useCustomerExposure,
  useCreateReceipt,
  usePostReceipt,
} from "@/hooks/use-receipts";
import { useSeedBaseCurrency } from "@/hooks/use-seed-base-currency";
import { useBaseCurrency } from "@/hooks/use-base-currency";

import { ReceiptFormCustomer } from "@/components/features/receipts/receipt-form-customer";
import { ReceiptFormPayment } from "@/components/features/receipts/receipt-form-payment";
import { ReceiptFormAmount } from "@/components/features/receipts/receipt-form-amount";
import { ReceiptSummaryBar } from "@/components/features/receipts/receipt-summary-bar";
import { Receipt, FileText, Info } from "lucide-react";

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function NewReceiptPage() {
  const router = useRouter();
  const [isPostMode, setIsPostMode] = useState(false);
  const [fxSubmittable, setFxSubmittable] = useState(false);

  // ── Form ──────────────────────────────────────────────────────────
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: defaultReceiptValues(),
    mode: "onChange",
  });

  // B9DD-RR-003: seed the currency from the authenticated company base once it
  // is known. The form default is "" — never a fabricated "MYR" — and a user's
  // own selection is never overwritten.
  // Only the availability flag is needed here: the child components read the
  // base currency itself from `useBaseCurrency()` where they render it.
  const { isUnavailable: baseCurrencyUnavailable } = useSeedBaseCurrency(
    useMemo(
      () => ({
        getCurrency: () => form.getValues("currency"),
        setCurrency: (currency: string) =>
          form.setValue("currency", currency, { shouldValidate: true, shouldDirty: false }),
      }),
      [form],
    ),
  );

  const watchCustomerId = form.watch("customer_id");
  const watchPaymentMethod = form.watch("payment_method");
  const watchCurrency = form.watch("currency");
  const watchAmount = form.watch("receipt_amount");
  const watchExchangeRate = form.watch("exchange_rate") ?? 1;
  const { baseCurrency } = useBaseCurrency();

  // ── Data Queries ──────────────────────────────────────────────────
  const { data: customers = [] } = useCustomers();
  const { data: bankAccounts = [], isLoading: isLoadingBankAccounts } = useBankAccounts();
  // B9DD-FEIR-005: authoritative, multi-currency customer exposure.
  const {
    data: exposure,
    isLoading: exposureLoading,
    isError: exposureError,
  } = useCustomerExposure(watchCustomerId);

  // ── Mutations ─────────────────────────────────────────────────────
  const createMutation = useCreateReceipt();
  const postMutation = usePostReceipt();

  // ── Derived State ─────────────────────────────────────────────────
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId);
  const isCheque = watchPaymentMethod === "CHQ";

  // ── Handlers ──────────────────────────────────────────────────────
  const onSubmit = async (values: ReceiptFormValues) => {
    if (!values.bank_account_id) {
      toast.error("Receipt creation unavailable", {
        description: "Please select an active company bank account before creating a receipt.",
      });
      return;
    }

    if (!baseCurrency) {
      toast.error("Company base currency unavailable", {
        description: "Resolve the authenticated company context before creating a receipt.",
      });
      return;
    }

    // Governed FX submit gate (Gate A): a foreign-currency receipt may only be
    // saved when its FX authority is resolved — a reference rate was selected or
    // an explicit manual override (rate + reason ≥5) was completed. No silent
    // rate-1 fallback for a foreign currency.
    if (baseCurrency && values.currency && values.currency !== baseCurrency) {
      const hasReference = !!values.fx_reference_rate_id;
      const hasValidOverride =
        (values.exchange_rate ?? 0) > 0 && (values.fx_override_reason ?? "").trim().length >= 5;
      if (!fxSubmittable || (!hasReference && !hasValidOverride)) {
        toast.error("Exchange rate required", {
          description:
            "Resolve the foreign-currency exchange rate (select the reference rate or complete a manual override) before saving.",
        });
        return;
      }
    }

    try {
      const receipt = await createMutation.mutateAsync({ values, baseCurrency });

      if (isPostMode && receipt?.id) {
        const posted = await postMutation.mutateAsync({ id: receipt.id });
        toast.success("Receipt Created & Posted", {
          description: `${posted.receipt_no ?? receipt.receipt_no}${posted.je_no ? ` · JE: ${posted.je_no}` : ""}`,
        });
      } else {
        toast.success("Receipt Draft Saved", {
          description: `${receipt.receipt_no ?? "Saved"}`,
        });
      }

      router.push("/receipts");
    } catch {
      // Error toast handled by useApi
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Receipt className="h-6 w-6 text-emerald-500" />
          Receipt Entry
        </h1>
        <p className="mt-1 text-sm text-slate-500">Create new receipt → Save as draft or post directly</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* B9DD-RR-003: when the company base currency cannot be resolved we say
            so plainly. Nothing is defaulted to MYR, and the schema keeps the
            form unsubmittable until a supported currency is chosen. */}
        {baseCurrencyUnavailable && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-800">Company base currency unavailable</p>
              <p className="text-xs text-amber-600">
                The receipt currency has not been pre-filled. Select a currency before saving; the
                company-base preview stays hidden until the base currency is known.
              </p>
            </div>
          </div>
        )}

        {/* Section 1: Customer & Date */}
        <ReceiptFormCustomer
          form={form}
          customers={customers}
          exposure={exposure}
          exposureLoading={exposureLoading}
          exposureError={exposureError}
          selectedCustomer={selectedCustomer}
          watchCustomerId={watchCustomerId}
        />

        {/* Section 2: Payment Method & Bank */}
        <ReceiptFormPayment
          form={form}
          bankAccounts={bankAccounts}
          isLoadingBankAccounts={isLoadingBankAccounts}
          isCheque={isCheque}
        />

        {/* Section 3: Amount & Currency */}
        <ReceiptFormAmount
          form={form}
          watchCurrency={watchCurrency}
          watchAmount={watchAmount}
          onFxSubmittableChange={setFxSubmittable}
        />

        {/* Section 4: Remarks */}
        <div className="glass-card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              Remarks
            </h2>
          </div>
          <div className="p-5">
            <textarea
              {...form.register("remarks")}
              rows={3}
              placeholder="Internal remarks (optional)..."
              className="w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Summary & Actions */}
        <ReceiptSummaryBar
          watchAmount={watchAmount}
          watchCurrency={watchCurrency}
          watchExchangeRate={watchExchangeRate}
          selectedCustomer={selectedCustomer}
          isPostMode={isPostMode}
          setIsPostMode={setIsPostMode}
          isCreating={createMutation.isPending}
          isPosting={postMutation.isPending}
        />
      </form>
    </div>
  );
}
