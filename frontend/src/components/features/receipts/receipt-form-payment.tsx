"use client";

import { cn } from "@/lib/utils";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import { PAYMENT_METHODS } from "@/lib/receipt-schema";
import { CreditCard, Info } from "lucide-react";

interface BankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  account_no: string;
  currency: string;
}

interface ReceiptFormPaymentProps {
  form: UseFormReturn<ReceiptFormValues>;
  bankAccounts: BankAccount[];
  isLoadingBankAccounts?: boolean;
  isCheque: boolean;
}

export function ReceiptFormPayment({
  form,
  bankAccounts,
  isLoadingBankAccounts = false,
  isCheque,
}: ReceiptFormPaymentProps) {
  const hasBankAccounts = bankAccounts.length > 0;
  const selectedBankAccountId = form.watch("bank_account_id");
  const selectedBankAccount = bankAccounts.find((account) => account.id === selectedBankAccountId);
  const bankNameCounts = bankAccounts.reduce<Record<string, number>>((counts, account) => {
    counts[account.bank_name] = (counts[account.bank_name] ?? 0) + 1;
    return counts;
  }, {});

  const getBankOptionLabel = (account: BankAccount) => {
    if ((bankNameCounts[account.bank_name] ?? 0) <= 1) return account.bank_name;
    return `${account.bank_name} - ${account.account_name}`;
  };

  const getMaskedAccountNo = (accountNo: string) => {
    const digits = accountNo.replace(/\D/g, "");
    const suffix = digits.slice(-4);
    return suffix ? `ending ${suffix}` : "number unavailable";
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-purple-400" />
          Payment Method & Bank
        </h2>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        {/* Payment Method */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Payment Method <span className="text-red-400">*</span>
          </label>
          <Controller
            control={form.control}
            name="payment_method"
            render={({ field }) => (
              <select
                {...field}
                className={cn(
                  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-800",
                  "focus:outline-none focus:ring-1 focus:ring-brand-500",
                  form.formState.errors.payment_method ? "border-red-500" : "border-slate-300"
                )}
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>{pm.value} — {pm.label}</option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Bank Account */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Deposit To <span className="text-red-400">*</span>
          </label>
          <Controller
            control={form.control}
            name="bank_account_id"
            render={({ field }) => (
              <select
                {...field}
                disabled={isLoadingBankAccounts || !hasBankAccounts}
                className={cn(
                  "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-800",
                  "focus:outline-none focus:ring-1 focus:ring-brand-500",
                  (isLoadingBankAccounts || !hasBankAccounts) && "cursor-not-allowed bg-slate-50 text-slate-400",
                  form.formState.errors.bank_account_id ? "border-red-500" : "border-slate-300"
                )}
              >
                <option value="">
                  {isLoadingBankAccounts
                    ? "Loading bank accounts..."
                    : hasBankAccounts
                      ? "Select receiving account"
                      : "No active bank accounts available"}
                </option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {getBankOptionLabel(account)}
                  </option>
                ))}
              </select>
            )}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            {hasBankAccounts
              ? "Select the company account that will receive this payment."
              : "Create or activate a company bank account before creating receipts."}
          </p>
          {selectedBankAccount && (
            <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
              <p>Account: {selectedBankAccount.account_name}</p>
              <p>
                Currency: {selectedBankAccount.currency}
                <span className="mx-1">·</span>
                Account no. {getMaskedAccountNo(selectedBankAccount.account_no)}
              </p>
              <p className="text-slate-400">This is the company receiving account, not the customer&apos;s payer bank.</p>
            </div>
          )}
          {form.formState.errors.bank_account_id && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.bank_account_id.message}</p>
          )}
        </div>

        {/* Reference No */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-600">
            Reference No. / Cheque No. {isCheque && <span className="text-red-400">*</span>}
          </label>
          <input
            {...form.register("reference_no")}
            placeholder={isCheque ? "Cheque number (required)" : "Bank reference (optional)"}
            className={cn(
              "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-800",
              "focus:outline-none focus:ring-1 focus:ring-brand-500",
              form.formState.errors.reference_no ? "border-red-500" : "border-slate-300"
            )}
          />
          {form.formState.errors.reference_no && (
            <p className="mt-1 text-xs text-red-400">{form.formState.errors.reference_no.message}</p>
          )}
        </div>

        {/* Cheque Date (conditional — CHQ only) */}
        {isCheque && (
          <div className="animate-fade-in">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Cheque Date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              {...form.register("cheque_date")}
              className={cn(
                "h-10 w-full rounded-lg border bg-white px-3 text-sm text-slate-800",
                "focus:outline-none focus:ring-1 focus:ring-brand-500",
                form.formState.errors.cheque_date ? "border-red-500" : "border-slate-300"
              )}
            />
            {form.formState.errors.cheque_date && (
              <p className="mt-1 text-xs text-red-400">{form.formState.errors.cheque_date.message}</p>
            )}
          </div>
        )}

        {/* CHQ Info Box */}
        {isCheque && (
          <div className="md:col-span-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
            <Info className="h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-xs text-amber-600">
              Cheque receipts generate a two-stage journal: On posting Dr. Cheques on Hand, on clearance Dr. Bank Account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
