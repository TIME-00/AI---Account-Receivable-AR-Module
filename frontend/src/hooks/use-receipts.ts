// ============================================================================
// TSH Synergy AR — Receipt API Hooks (TanStack Query)
// CRUD operations, posting, cancel, and data queries for Receipt management.
// ============================================================================

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Receipt, Customer, BankAccount, MonetaryCollectionSummary, CurrencyTotal } from "@/types";
import type { ListPagination } from "@/hooks/use-invoices";
import { filterVisibleCustomers } from "@/lib/customer-visibility";
import { fetchCustomerAgingRow } from "@/lib/aging-lookup";

// ─── Query: List Receipts (with filters) ────────────────────────────────────

export function useReceipts(filters: {
  status?: string;
  customer_id?: string;
  payment_method?: string;
  search?: string;
  page?: number;
  page_size?: number;
}) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", filters],
    queryFn: async (): Promise<ReceiptListResult> => {
      const page = filters.page ?? 1;
      const pageSize = filters.page_size ?? 20;
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (filters.status) params.status = filters.status;
      if (filters.customer_id) params.customer_id = filters.customer_id;
      if (filters.payment_method) params.payment_method = filters.payment_method;
      if (filters.search) params.search = filters.search;

      // B9DD-FEIR-001: `ar_receipt_collection` (migration 027) builds its page
      // rows and its summary from the same `scoped_customers` CTE, which already
      // excludes is_deleted/is_hidden customers and applies assignment scoping.
      // The former capped `/customers` post-filter narrowed rows but not the
      // summary, so the two could describe different sets. Removed.
      const res = await api.getWithMeta<Receipt[]>("/receipts", { params });

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

/** Return shape of {@link useReceipts}. */
export interface ReceiptListResult {
  /** Rows for the CURRENT PAGE only. */
  rows: Receipt[];
  /** Authoritative summary over the ENTIRE filtered collection. */
  summary?: MonetaryCollectionSummary;
  pagination: ListPagination;
}

// ─── Query: Single Receipt ──────────────────────────────────────────────────

export function useReceipt(id: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", id],
    // B9DD-FEIR-001: receipt detail enforces customer visibility server-side
    // (404 for hidden/deleted customers); no capped client re-check.
    queryFn: () => api.get<Receipt>(`/receipts/${id}`),
    enabled: !!id,
  });
}

// ─── Query: Customers (for customer selector) ───────────────────────────────

export function useCustomers() {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", "list"],
    queryFn: async () => {
      // useApi() returns json.data = Customer[] (raw array).
      return filterVisibleCustomers(await api.get<Customer[]>("/customers", {
        // Name/selector lookup only (backend clamps page_size to 100).
        params: { page: 1, page_size: 100 },
      }));
    },
    staleTime: 60_000,
  });
}

// ─── Query: Bank Accounts ───────────────────────────────────────────────────

export function useBankAccounts() {
  const api = useApi();

  return useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      return api.get<BankAccount[]>("/bank-accounts");
    },
    staleTime: 60_000,
  });
}

// ─── Query: Customer Exposure (authoritative, multi-currency) ───────────────

/**
 * Authoritative outstanding exposure for one customer.
 *
 * B9DD-FEIR-005 — this replaces the previous `useCustomerOutstanding`, which:
 *   - fetched a page-capped `/invoices?page_size=200` (server-clamps to 100),
 *     so it silently under-reported exposure past 100 invoices;
 *   - summed `outstanding` ACROSS transaction currencies into one number; and
 *   - was then rendered labelled with the DRAFT RECEIPT's currency.
 *
 * The authority is `ar_aging_by_customer` (migration 027), which applies exactly
 * the intended filter server-side — `status IN ('Open','Overdue','Partially
 * Paid')`, `doc_type IN ('Invoice','Debit Note')`, `outstanding > 0` — and
 * returns per-customer `by_currency` (native amount + base_amount) plus a
 * company-base `base_total`. No client arithmetic is performed: the returned row
 * IS the answer.
 */
export interface CustomerExposure {
  /** Per-currency native outstanding (authoritative, never cross-summed). */
  byCurrency: CurrencyTotal[];
  /** Company-base total from stored booking snapshots. */
  baseTotal: number;
  baseCurrency: string;
  /** Number of outstanding documents across all currencies. */
  documentCount: number;
}

export function useCustomerExposure(customerId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", customerId, "exposure"],
    queryFn: async (): Promise<CustomerExposure | null> => {
      const row = await fetchCustomerAgingRow(api, customerId);
      // A customer with no outstanding documents is legitimately absent from the
      // aging report (`WHERE base_total > 0`) — that means zero exposure, which
      // is materially different from "we could not determine exposure".
      if (!row) return null;

      return {
        byCurrency: row.by_currency,
        baseTotal: row.base_total,
        baseCurrency: row.base_currency,
        documentCount: row.by_currency.reduce((sum, c) => sum + c.count, 0),
      };
    },
    enabled: !!customerId,
    staleTime: 15_000,
  });
}

// ─── Mutation: Create Receipt ───────────────────────────────────────────────

export function useCreateReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.post<Receipt>("/receipts", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Post Receipt ─────────────────────────────────────────────────

export function usePostReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, posting_period }: { id: string; posting_period?: string }) => {
      return api.post<Receipt & { je_no?: string }>(`/receipts/${id}/post`, {
        posting_period,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Cancel Receipt ───────────────────────────────────────────────

export function useCancelReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, cancel_reason }: { id: string; cancel_reason: string }) => {
      return api.post<Receipt>(`/receipts/${id}/cancel`, { cancel_reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
