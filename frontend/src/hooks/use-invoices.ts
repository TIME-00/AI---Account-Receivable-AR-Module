// ============================================================================
// TSH Synergy AR — Invoice API Hooks (TanStack Query)
// Handles all CRUD operations for invoices via useApi.
// ============================================================================

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Invoice, InvoiceLine, Customer, TaxCode, PaymentTerm, MonetaryCollectionSummary } from "@/types";
import type { TaxCodeOption, PaymentTermOption } from "@/hooks/use-invoice-calculator";
import { filterVisibleCustomers } from "@/lib/customer-visibility";

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
    // Batch 9A: tax_code_id is a REAL tax_codes.id sourced from
    // GET /lookups/tax-codes. The backend validates it against the company's
    // tax_codes table and resolves the rate server-side. (Previously omitted
    // only because the old options were mock IDs.)
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
    queryFn: async () =>
      // useApi() returns json.data which is the raw Customer[] array.
      // meta (total, page, page_size) is discarded by useApi().
      filterVisibleCustomers(await api.get<Customer[]>("/customers", {
        params: {
          page: 1,
          page_size: 50,
          search: search || undefined,
          status: "Active",
        },
      })),
    staleTime: 60 * 1000,
  });
}

// ─── Query: Fetch Tax Codes ─────────────────────────────────────────────────

export function useTaxCodes() {
  const api = useApi();

  return useQuery({
    queryKey: ["lookups", "tax-codes", "invoice-options"],
    // Real read-only lookup (GET /lookups/tax-codes) returning the company's
    // active tax codes with real tax_codes.id values.
    queryFn: () => api.get<TaxCode[]>("/lookups/tax-codes"),
    // Map the lookup rows to the shape the invoice calculator/selector expects.
    select: (rows): TaxCodeOption[] =>
      rows.map((tc) => ({
        id: tc.id,
        tax_code: tc.tax_code,
        tax_name: tc.tax_name,
        rate: tc.rate,
        country: tc.country,
      })),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Query: Fetch Payment Terms ─────────────────────────────────────────────

export function usePaymentTerms() {
  const api = useApi();

  return useQuery({
    queryKey: ["lookups", "payment-terms", "invoice-options"],
    // Real read-only lookup (GET /lookups/payment-terms).
    queryFn: () => api.get<PaymentTerm[]>("/lookups/payment-terms"),
    select: (rows): PaymentTermOption[] =>
      rows.map((pt) => ({
        id: pt.id,
        term_code: pt.term_code,
        term_name: pt.term_name,
        term_type: pt.term_type,
        days: pt.days,
      })),
    staleTime: 5 * 60 * 1000,
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
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          item_code: line.item_code || undefined,
          uom: line.uom || undefined,
          discount_pct: line.discount_pct || undefined,
          discount_amt: line.discount_amt || undefined,
          // Batch 9A: forward the selected REAL tax_code_id (from
          // GET /lookups/tax-codes). Empty string → undefined (No Tax).
          // The backend validates the id and resolves the rate server-side,
          // so the persisted invoice tax matches the on-screen calculation.
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

// ─── Query: Invoice List (with filters) ─────────────────────────────────────

export function useInvoiceList(filters: {
  status?: string;
  customer_id?: string;
  search?: string;
  doc_type?: string;
  page?: number;
  page_size?: number;
}) {
  const api = useApi();

  return useQuery({
    queryKey: ["invoices", "list", filters],
    queryFn: async (): Promise<InvoiceListResult> => {
      const page = filters.page ?? 1;
      const pageSize = filters.page_size ?? 20;
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (filters.status) params.status = filters.status;
      if (filters.customer_id) params.customer_id = filters.customer_id;
      if (filters.search) params.search = filters.search;
      if (filters.doc_type) params.doc_type = filters.doc_type;

      // Batch 9D-D / B9DD-FEIR-001: the backend response is the authoritative
      // visible row set AND the authoritative summary, produced together.
      //
      // `ar_invoice_collection` (migration 027) derives both its page rows and
      // its summary from one `scoped_customers` CTE that already excludes
      // is_deleted/is_hidden customers and applies user assignment scoping. The
      // previous code additionally post-filtered these rows against a separate,
      // capped `/customers?page_size=500` request (server-clamped to 100). That
      // filter was redundant with the backend scope, and because it narrowed
      // ROWS but not the SUMMARY, the two could describe different sets. It is
      // removed rather than reproduced client-side.
      const res = await api.getWithMeta<Invoice[]>("/invoices", { params });

      return {
        rows: res.data,
        summary: res.meta?.summary,
        pagination: {
          total: res.meta?.total ?? res.data.length,
          page: res.meta?.page ?? page,
          page_size: res.meta?.page_size ?? pageSize,
        },
      };
    },
    staleTime: 30_000,
  });
}

/** Backend pagination envelope, preserved verbatim (never synthesized). */
export interface ListPagination {
  /** Total rows in the FILTERED COLLECTION (not just this page). */
  total: number;
  page: number;
  page_size: number;
}

/** Return shape of {@link useInvoiceList}. */
export interface InvoiceListResult {
  /** Rows for the CURRENT PAGE only. */
  rows: Invoice[];
  /** Authoritative summary over the ENTIRE filtered collection. */
  summary?: MonetaryCollectionSummary;
  pagination: ListPagination;
}

/** Derive total page count from backend pagination metadata. */
export function totalPagesFrom(pagination: ListPagination | undefined): number {
  if (!pagination || pagination.page_size <= 0) return 1;
  return Math.max(1, Math.ceil(pagination.total / pagination.page_size));
}

// ─── Query: Single Invoice (with Lines) ─────────────────────────────────────

export function useInvoice(id: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["invoices", id],
    // B9DD-FEIR-001: `getInvoiceById` calls `assertCustomerVisible`, which 404s
    // when the customer is deleted or hidden — server-side and uncapped. The
    // previous client-side re-check against a capped `/customers` page could
    // only ever be weaker, so it is removed rather than duplicated here.
    queryFn: () => api.get<Invoice & { lines: InvoiceLine[] }>(`/invoices/${id}`),
    enabled: !!id,
  });
}

// ─── Mutation: Cancel Invoice ───────────────────────────────────────────────

export function useCancelInvoice() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ invoiceId, cancel_reason }: { invoiceId: string; cancel_reason: string }) => {
      return api.post<Invoice>(`/invoices/${invoiceId}/cancel`, { cancel_reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
