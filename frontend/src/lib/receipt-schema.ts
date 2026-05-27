// ============================================================================
// TSH Synergy AR — Receipt Zod Schema
// 100% aligned with backend receipts/validators.ts (CreateReceiptInput)
// Used by react-hook-form for client-side validation.
// ============================================================================

import { z } from "zod";

// ─── Payment Methods (mirrors backend PAYMENT_METHODS constant) ─────────────

export const PAYMENT_METHODS = [
  { value: "CHQ",  label: "Cheque" },
  { value: "TT",   label: "Telegraphic Transfer (TT)" },
  { value: "CASH", label: "Cash" },
  { value: "CC",   label: "Credit Card" },
  { value: "GIRO", label: "Direct Debit / GIRO" },
  { value: "OFST", label: "Offset / Contra" },
  { value: "ONLN", label: "Online Payment" },
] as const;

export const PAYMENT_METHOD_VALUES = ["CHQ", "TT", "CASH", "CC", "GIRO", "OFST", "ONLN"] as const;

// ─── Receipt Schema ─────────────────────────────────────────────────────────

export const receiptFormSchema = z.object({
  // ── Required fields (match backend CreateReceiptInput exactly) ──
  receipt_date: z
    .string()
    .min(1, "Receipt date is required.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD."),
  customer_id: z
    .string()
    .min(1, "Please select a customer.")
    .uuid("Invalid customer ID format."),
  payment_method: z.enum(PAYMENT_METHOD_VALUES, {
    required_error: "Please select a payment method.",
  }),
  currency: z
    .string()
    .min(3, "Currency code must be 3 characters.")
    .max(3, "Currency code must be 3 characters."),
  receipt_amount: z
    .number({ invalid_type_error: "Receipt amount must be a number." })
    .positive("Receipt amount must be greater than 0."),
  // Sprint F1: bank_account_id is OPTIONAL because no real bank account
  // API exists. Mock IDs (ba-mock-*) are display-only and must not be sent
  // to backend. This field becomes required when a real GET /bank-accounts
  // Edge Function is deployed.
  bank_account_id: z
    .string()
    .optional()
    .or(z.literal("")),

  // ── Optional fields ──
  exchange_rate: z
    .number({ invalid_type_error: "Exchange rate must be a number." })
    .positive("Exchange rate must be greater than 0.")
    .optional(),
  reference_no: z
    .string()
    .max(50, "Reference number must not exceed 50 characters.")
    .optional()
    .or(z.literal("")),
  cheque_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
  value_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
  remarks: z.string().optional().or(z.literal("")),
}).refine(
  // CHQ-specific: cheque_date is required
  (data) => {
    if (data.payment_method === "CHQ" && !data.cheque_date) return false;
    return true;
  },
  { message: "Cheque payment method (CHQ) requires a cheque date.", path: ["cheque_date"] }
).refine(
  // CHQ-specific: reference_no (cheque number) is required
  (data) => {
    if (data.payment_method === "CHQ" && !data.reference_no) return false;
    return true;
  },
  { message: "Cheque payment method (CHQ) requires a cheque number (reference_no).", path: ["reference_no"] }
);

// ─── Derived Types ──────────────────────────────────────────────────────────

export type ReceiptFormValues = z.infer<typeof receiptFormSchema>;

// ─── Default Values ─────────────────────────────────────────────────────────

export function defaultReceiptValues(): ReceiptFormValues {
  return {
    receipt_date: new Date().toISOString().slice(0, 10),
    customer_id: "",
    payment_method: "TT",
    currency: "MYR",
    receipt_amount: 0,
    bank_account_id: "",  // Sprint F1: empty — no real bank account API
    exchange_rate: 1,
    reference_no: "",
    cheque_date: "",
    value_date: "",
    remarks: "",
  };
}
