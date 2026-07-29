// ============================================================================
// TSH Synergy AR — Receipt API Hooks (TanStack Query)
// CRUD operations, posting, cancel, and data queries for Receipt management.
// ============================================================================

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type {
  Receipt,
  Customer,
  BankAccount,
  NormalizedMonetaryCollectionSummary,
  CurrencyTotal,
} from "@/types";
import type { ListPagination } from "@/hooks/use-invoices";
import type { ReceiptFormValues } from "@/lib/receipt-schema";
import { filterVisibleCustomers } from "@/lib/customer-visibility";
import { fetchCustomerAgingRow } from "@/lib/aging-lookup";
import { normalizeCurrency } from "@/lib/currency";
import { useCompanyStore } from "@/stores/company-store";
import {
  parseCollectionSummary,
  SUMMARY_UNAVAILABLE_MESSAGE,
} from "@/lib/monetary-summary";

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
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    queryKey: ["receipts", companyId, filters],
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
      let summary: NormalizedMonetaryCollectionSummary | null = null;
      let summaryUnavailable: string | null = null;
      try {
        summary = parseCollectionSummary(res.meta?.summary, {
          currentAmountBasis: "current_unallocated",
        });
      } catch {
        summaryUnavailable = SUMMARY_UNAVAILABLE_MESSAGE;
      }

      return {
        rows: res.data,
        summary,
        summaryUnavailable,
        pagination: {
          total: res.meta?.total ?? res.data.length,
          page: res.meta?.page ?? page,
          page_size: res.meta?.page_size ?? pageSize,
        },
      };
    },
    enabled: companyId.trim().length > 0,
    staleTime: 30_000,
  });
}

/** Return shape of {@link useReceipts}. */
export interface ReceiptListResult {
  /** Rows for the CURRENT PAGE only. */
  rows: Receipt[];
  /** Strictly validated v1/v2 summary over the entire filtered collection. */
  summary: NormalizedMonetaryCollectionSummary | null;
  /** Sanitized, non-leaking fail-closed state for a missing/invalid summary. */
  summaryUnavailable: string | null;
  pagination: ListPagination;
}

// ─── Query: Single Receipt ──────────────────────────────────────────────────

export function useReceipt(id: string) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    queryKey: ["receipts", companyId, id],
    // B9DD-FEIR-001: receipt detail enforces customer visibility server-side
    // (404 for hidden/deleted customers); no capped client re-check.
    queryFn: () => api.get<Receipt>(`/receipts/${id}`),
    enabled: companyId.trim().length > 0 && !!id,
  });
}

// ─── Query: Customers (for customer selector) ───────────────────────────────

export function useCustomers() {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    queryKey: ["customers", "list", companyId],
    queryFn: async () => {
      // useApi() returns json.data = Customer[] (raw array).
      return filterVisibleCustomers(await api.get<Customer[]>("/customers", {
        // Name/selector lookup only (backend clamps page_size to 100).
        params: { page: 1, page_size: 100 },
      }));
    },
    enabled: companyId.trim().length > 0,
    staleTime: 60_000,
  });
}

// ─── Query: Bank Accounts ───────────────────────────────────────────────────

export function useBankAccounts() {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    queryKey: ["bank-accounts", companyId],
    queryFn: async () => {
      return api.get<BankAccount[]>("/bank-accounts");
    },
    enabled: companyId.trim().length > 0,
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
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    queryKey: ["customers", companyId, customerId, "exposure"],
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
    enabled: companyId.trim().length > 0 && !!customerId,
    staleTime: 15_000,
  });
}

// ─── Mutation: Create Receipt ───────────────────────────────────────────────

export interface CreateReceiptCommand {
  values: ReceiptFormValues;
  baseCurrency: string;
}

/**
 * Build the exact governed create payload. Company/user context and booked
 * base amounts remain server authority and are never accepted from the form.
 */
export function buildCreateReceiptPayload({
  values,
  baseCurrency,
}: CreateReceiptCommand): Record<string, unknown> {
  const currency = normalizeCurrency(values.currency);
  const base = normalizeCurrency(baseCurrency);
  if (!currency || !base) {
    throw new Error("Authoritative company and transaction currencies are required before saving.");
  }

  const payload: Record<string, unknown> = {
    receipt_date: values.receipt_date,
    customer_id: values.customer_id,
    payment_method: values.payment_method,
    currency,
    receipt_amount: values.receipt_amount,
    bank_account_id: values.bank_account_id,
  };

  const parity = currency === base;
  const overrideReason = values.fx_override_reason?.trim() ?? "";
  const hasManualOverride =
    !parity
    && !values.fx_reference_rate_id
    && values.exchange_rate !== undefined
    && Number.isFinite(values.exchange_rate)
    && values.exchange_rate > 0
    && overrideReason.length >= 5;

  if (parity) {
    payload.exchange_rate = 1;
  } else if (values.fx_reference_rate_id) {
    payload.fx_reference_rate_id = values.fx_reference_rate_id;
  } else if (hasManualOverride) {
    // Rate 1 can be an intentional foreign manual override; it must not be
    // dropped merely because it equals the base-parity rate.
    payload.exchange_rate = values.exchange_rate;
    payload.fx_override_reason = overrideReason;
  } else {
    throw new Error("Foreign-currency receipts require a fresh reference rate or governed manual override.");
  }

  if (values.reference_no) payload.reference_no = values.reference_no;
  if (values.cheque_date) payload.cheque_date = values.cheque_date;
  if (values.value_date) payload.value_date = values.value_date;
  if (values.remarks) payload.remarks = values.remarks;

  return payload;
}

export function useCreateReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (command: CreateReceiptCommand) => {
      return api.post<Receipt>("/receipts", buildCreateReceiptPayload(command));
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
