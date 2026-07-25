// ============================================================================
// TSH Synergy AR — Invoice Zod Schema
// 100% aligned with backend validators.ts (CreateInvoiceInput + CreateInvoiceLineInput)
// Used by react-hook-form for client-side validation.
// ============================================================================

import { z } from "zod";

// ─── Line Item Schema ───────────────────────────────────────────────────────

export const invoiceLineSchema = z.object({
  description: z
    .string()
    .min(1, "Description is required.")
    .max(200, "Description must not exceed 200 characters."),
  item_code: z
    .string()
    .max(30, "Item code must not exceed 30 characters.")
    .optional()
    .or(z.literal("")),
  quantity: z
    .number({ invalid_type_error: "Quantity must be a number." })
    .positive("Quantity must be greater than 0."),
  uom: z
    .string()
    .max(10, "UOM must not exceed 10 characters.")
    .optional()
    .or(z.literal("")),
  unit_price: z
    .number({ invalid_type_error: "Unit price must be a number." })
    .min(0, "Unit price cannot be negative."),
  discount_pct: z
    .number()
    .min(0, "Discount % cannot be negative.")
    .max(100, "Discount % cannot exceed 100%.")
    .default(0),
  discount_amt: z
    .number()
    .min(0, "Discount amount cannot be negative.")
    .default(0),
  tax_code_id: z.string().optional().or(z.literal("")),
  gl_account_id: z.string().optional().or(z.literal("")),
  cost_center: z
    .string()
    .max(20, "Cost center must not exceed 20 characters.")
    .optional()
    .or(z.literal("")),
  line_remarks: z
    .string()
    .max(200, "Line remarks must not exceed 200 characters.")
    .optional()
    .or(z.literal("")),
}).refine(
  (data) => !(data.discount_pct > 0 && data.discount_amt > 0),
  {
    message: "Discount % and fixed discount amount cannot be used simultaneously (BR-INV-CALC-003).",
    path: ["discount_pct"],
  }
);

// ─── Invoice Header Schema ──────────────────────────────────────────────────

export const invoiceFormSchema = z.object({
  // ── Required fields (match backend CreateInvoiceInput exactly) ──
  doc_type: z.enum(["Invoice", "Credit Note", "Debit Note"], {
    required_error: "Please select a document type.",
  }),
  invoice_date: z
    .string()
    .min(1, "Invoice date is required.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date format must be YYYY-MM-DD."),
  customer_id: z
    .string()
    .min(1, "Please select a customer.")
    .uuid("Invalid customer ID format."),
  currency: z
    .string()
    .min(1, "Please select a currency.")
    .min(3, "Currency code must be 3 characters.")
    .max(3, "Currency code must be 3 characters."),
  exchange_rate: z
    .number({ invalid_type_error: "Exchange rate must be a number." })
    .positive("Exchange rate must be greater than 0.")
    .default(1),

  // ── Governed FX authority (Gate A) ──
  // Mutually exclusive with a manual exchange_rate/override reason. The shared
  // FxRateField sets exactly one authority; the submit payload forwards
  // fx_reference_rate_id for REFERENCE_SELECTED, or exchange_rate +
  // fx_override_reason for a governed manual override. Never both.
  fx_reference_rate_id: z.string().uuid().optional().or(z.literal("")),
  fx_override_reason: z.string().max(500).optional().or(z.literal("")),

  // ── Optional fields ──
  reference_no: z
    .string()
    .max(50, "Reference number must not exceed 50 characters.")
    .optional()
    .or(z.literal("")),
  internal_remarks: z.string().optional().or(z.literal("")),
  invoice_remarks: z.string().optional().or(z.literal("")),

  // ── CN-specific fields ──
  ref_invoice_id: z.string().uuid().optional().or(z.literal("")),
  cn_type: z.enum(["Linked", "Standalone"]).optional(),
  reason_code: z
    .enum(["Return", "Discount", "Price Adjustment", "Error Correction", "Other"])
    .optional(),
  reason_desc: z.string().optional().or(z.literal("")),

  // ── Line items (at least 1 required) ──
  lines: z
    .array(invoiceLineSchema)
    .min(1, "Invoice must have at least 1 line item."),
});

// ─── Derived Types ──────────────────────────────────────────────────────────

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;
export type InvoiceLineFormValues = z.infer<typeof invoiceLineSchema>;

// ─── Default Values ─────────────────────────────────────────────────────────

export function defaultLineValues(): InvoiceLineFormValues {
  return {
    description: "",
    item_code: "",
    quantity: 1,
    uom: "pcs",
    unit_price: 0,
    discount_pct: 0,
    discount_amt: 0,
    tax_code_id: "",
    gl_account_id: "",
    cost_center: "",
    line_remarks: "",
  };
}

/**
 * B9DD-RR-003: currency starts UNSELECTED — never a fabricated "MYR".
 *
 * The form initializes it from the authenticated company's base currency once
 * `/auth/me` resolves (see `use-invoice-form.ts`). If the base currency is
 * unavailable the field stays empty, and the `min(3)` validator above blocks
 * submission until the user picks a supported currency. An empty string is
 * therefore a real "not yet known" state, not a silent default.
 */
export function defaultInvoiceValues(): InvoiceFormValues {
  return {
    doc_type: "Invoice",
    invoice_date: new Date().toISOString().slice(0, 10),
    customer_id: "",
    currency: "",
    exchange_rate: 1,
    fx_reference_rate_id: "",
    fx_override_reason: "",
    reference_no: "",
    internal_remarks: "",
    invoice_remarks: "",
    ref_invoice_id: "",
    reason_desc: "",
    lines: [defaultLineValues()],
  };
}
