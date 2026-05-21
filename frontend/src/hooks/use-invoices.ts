// ============================================================================
// TSH Synergy AR — Invoice API Hooks (TanStack Query)
// Handles all CRUD operations for invoices via useApi.
// ============================================================================

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Invoice, InvoiceLine, Customer } from "@/types";
import type { TaxCodeOption, PaymentTermOption } from "@/hooks/use-invoice-calculator";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CreateInvoicePayload {
  doc_type: string;
  invoice_date: string;
  customer_id: string;
  currency: string;
  exchange_rate: number;
  reference_no?: string;
  internal_remarks?: string;
  invoice_remarks?: string;
  ref_invoice_id?: string;
  cn_type?: string;
  reason_code?: string;
  reason_desc?: string;
  lines: Array<{
    description: string;
    item_code?: string;
    quantity: number;
    uom?: string;
    unit_price: number;
    discount_pct?: number;
    discount_amt?: number;
    tax_code_id?: string;
    gl_account_id?: string;
    cost_center?: string;
    line_remarks?: string;
  }>;
}

// ─── Query: Fetch Customer List (for selector) ─────────────────────────────

export function useCustomers(search?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", "list", search],
    queryFn: () =>
      api.get<{ customers: Customer[]; total: number }>("/customers", {
        params: {
          page: 1,
          page_size: 50,
          search: search || undefined,
          status: "Active",
        },
      }),
    staleTime: 60 * 1000,
  });
}

// ─── Query: Fetch Tax Codes ─────────────────────────────────────────────────

export function useTaxCodes() {
  const api = useApi();

  return useQuery({
    queryKey: ["config", "tax-codes"],
    queryFn: async () => {
      // Tax codes are fetched via the Supabase client directly
      // since there's no dedicated Edge Function for config lookups.
      // We'll mock this for now with known seed data.
      const mockTaxCodes: TaxCodeOption[] = [
        { id: "tc-sr6",  tax_code: "SR-6",  tax_name: "Sales Tax 6%",          rate: 6,  country: "MY" },
        { id: "tc-st10", tax_code: "ST-10", tax_name: "Service Tax 10%",       rate: 10, country: "MY" },
        { id: "tc-sr8",  tax_code: "SR-8",  tax_name: "GST Standard Rate 8%",  rate: 8,  country: "SG" },
        { id: "tc-sr9",  tax_code: "SR-9",  tax_name: "GST Standard Rate 9%",  rate: 9,  country: "SG" },
        { id: "tc-zrl",  tax_code: "ZRL",   tax_name: "Zero Rated (Local)",     rate: 0,  country: "MY" },
        { id: "tc-zre",  tax_code: "ZRE",   tax_name: "Zero Rated (Export)",    rate: 0,  country: "MY" },
        { id: "tc-es",   tax_code: "ES",    tax_name: "Exempt Supply",          rate: 0,  country: "MY" },
        { id: "tc-os",   tax_code: "OS",    tax_name: "Out of Scope",           rate: 0,  country: "MY" },
        { id: "tc-ajs",  tax_code: "AJS",   tax_name: "Adjustment (Special)",   rate: 0,  country: "MY" },
      ];
      return mockTaxCodes;
    },
    staleTime: Infinity, // Tax codes rarely change
  });
}

// ─── Query: Fetch Payment Terms ─────────────────────────────────────────────

export function usePaymentTerms() {
  const api = useApi();

  return useQuery({
    queryKey: ["config", "payment-terms"],
    queryFn: async () => {
      // Mock with known seed data
      const mockTerms: PaymentTermOption[] = [
        { id: "pt-net7",    term_code: "NET7",    term_name: "Net 7 Days",        term_type: "Fixed Days",   days: 7 },
        { id: "pt-net14",   term_code: "NET14",   term_name: "Net 14 Days",       term_type: "Fixed Days",   days: 14 },
        { id: "pt-net30",   term_code: "NET30",   term_name: "Net 30 Days",       term_type: "Fixed Days",   days: 30 },
        { id: "pt-net45",   term_code: "NET45",   term_name: "Net 45 Days",       term_type: "Fixed Days",   days: 45 },
        { id: "pt-net60",   term_code: "NET60",   term_name: "Net 60 Days",       term_type: "Fixed Days",   days: 60 },
        { id: "pt-net90",   term_code: "NET90",   term_name: "Net 90 Days",       term_type: "Fixed Days",   days: 90 },
        { id: "pt-eom",     term_code: "EOM",     term_name: "End of Month",      term_type: "End of Month", days: 0 },
        { id: "pt-eom15",   term_code: "EOM15",   term_name: "End of Month + 15", term_type: "End of Month", days: 15 },
        { id: "pt-eom30",   term_code: "EOM30",   term_name: "End of Month + 30", term_type: "End of Month", days: 30 },
        { id: "pt-eom60",   term_code: "EOM60",   term_name: "End of Month + 60", term_type: "End of Month", days: 60 },
        { id: "pt-cod",     term_code: "COD",     term_name: "Cash on Delivery",  term_type: "COD",          days: 0 },
        { id: "pt-prepaid", term_code: "PREPAID", term_name: "Prepaid",           term_type: "Prepaid",      days: null },
        { id: "pt-cia",     term_code: "CIA",     term_name: "Cash in Advance",   term_type: "Custom",       days: -7 },
      ];
      return mockTerms;
    },
    staleTime: Infinity,
  });
}

// ─── Mutation: Create Invoice + Lines ───────────────────────────────────────

export function useCreateInvoice() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateInvoicePayload) => {
      // Clean up empty optional strings → undefined
      const cleaned = {
        ...payload,
        reference_no: payload.reference_no || undefined,
        internal_remarks: payload.internal_remarks || undefined,
        invoice_remarks: payload.invoice_remarks || undefined,
        ref_invoice_id: payload.ref_invoice_id || undefined,
        cn_type: payload.cn_type || undefined,
        reason_code: payload.reason_code || undefined,
        reason_desc: payload.reason_desc || undefined,
        lines: payload.lines.map((line) => ({
          ...line,
          item_code: line.item_code || undefined,
          uom: line.uom || undefined,
          tax_code_id: line.tax_code_id || undefined,
          gl_account_id: line.gl_account_id || undefined,
          cost_center: line.cost_center || undefined,
          line_remarks: line.line_remarks || undefined,
        })),
      };

      return api.post<Invoice & { lines: InvoiceLine[] }>("/invoices", cleaned);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Post Invoice ─────────────────────────────────────────────────

export function usePostInvoice() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoiceId, postingPeriod }: { invoiceId: string; postingPeriod?: string }) => {
      return api.post<Invoice & { je_no?: string }>(`/invoices/${invoiceId}/post`, {
        posting_period: postingPeriod,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
