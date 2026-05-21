// ============================================================================
// TSH Synergy AR — Receipt Creation Workbench
// Professional financial form with customer outstanding preview,
// CHQ-specific conditional fields, and real-time validation.
// ============================================================================

"use client";

import { useState } from "react";
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
  useCustomerOutstanding,
  useCreateReceipt,
  usePostReceipt,
} from "@/hooks/use-receipts";

import { ReceiptFormCustomer } from "@/components/features/receipts/receipt-form-customer";
import { ReceiptFormPayment } from "@/components/features/receipts/receipt-form-payment";
import { ReceiptFormAmount } from "@/components/features/receipts/receipt-form-amount";
import { ReceiptSummaryBar } from "@/components/features/receipts/receipt-summary-bar";
import { Receipt, FileText } from "lucide-react";

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function NewReceiptPage() {
  const router = useRouter();
  const [isPostMode, setIsPostMode] = useState(false);

  // ── Form ──────────────────────────────────────────────────────────
  const form = useForm<ReceiptFormValues>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: defaultReceiptValues(),
    mode: "onChange",
  });

  const watchCustomerId = form.watch("customer_id");
  const watchPaymentMethod = form.watch("payment_method");
  const watchCurrency = form.watch("currency");
  const watchAmount = form.watch("receipt_amount");
  const watchExchangeRate = form.watch("exchange_rate") ?? 1;

  // ── Data Queries ──────────────────────────────────────────────────
  const { data: customers = [] } = useCustomers();
  const { data: bankAccounts = [] } = useBankAccounts();
  const { data: outstanding } = useCustomerOutstanding(watchCustomerId);

  // ── Mutations ─────────────────────────────────────────────────────
  const createMutation = useCreateReceipt();
  const postMutation = usePostReceipt();

  // ── Derived State ─────────────────────────────────────────────────
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId);
  const isCheque = watchPaymentMethod === "CHQ";

  // ── Handlers ──────────────────────────────────────────────────────
  const onSubmit = async (values: ReceiptFormValues) => {
    try {
      const payload: Record<string, unknown> = {
        receipt_date: values.receipt_date,
        customer_id: values.customer_id,
        payment_method: values.payment_method,
        currency: values.currency,
        receipt_amount: values.receipt_amount,
        bank_account_id: values.bank_account_id,
      };

      if (values.exchange_rate && values.exchange_rate !== 1) payload.exchange_rate = values.exchange_rate;
      if (values.reference_no) payload.reference_no = values.reference_no;
      if (values.cheque_date) payload.cheque_date = values.cheque_date;
      if (values.value_date) payload.value_date = values.value_date;
      if (values.remarks) payload.remarks = values.remarks;

      const receipt = await createMutation.mutateAsync(payload);

      if (isPostMode && receipt?.id) {
        const posted = await postMutation.mutateAsync({ id: receipt.id });
        toast.success("Receipt Created & Posted", {
          description: `${(posted as any).receipt_no ?? receipt.receipt_no}${(posted as any).je_no ? ` · JE: ${(posted as any).je_no}` : ""}`,
        });
      } else {
        toast.success("Receipt Draft Saved", {
          description: `${(receipt as any).receipt_no ?? "Saved"}`,
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
        {/* Section 1: Customer & Date */}
        <ReceiptFormCustomer
          form={form}
          customers={customers}
          outstanding={outstanding}
          selectedCustomer={selectedCustomer}
          watchCustomerId={watchCustomerId}
          watchCurrency={watchCurrency}
        />

        {/* Section 2: Payment Method & Bank */}
        <ReceiptFormPayment form={form} bankAccounts={bankAccounts} isCheque={isCheque} />

        {/* Section 3: Amount & Currency */}
        <ReceiptFormAmount
          form={form}
          watchCurrency={watchCurrency}
          watchAmount={watchAmount}
          watchExchangeRate={watchExchangeRate}
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
