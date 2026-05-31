// ============================================================================
// TSH Synergy AR — Sprint F2 Shared Hooks
// Hooks for customer list/detail, report data, and client-side aggregation.
// All data fetching uses verified GET endpoints only.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Customer, Invoice, Receipt, CustomerAgingRow, ARSummary } from "@/types";
import {
  filterVisibleCustomerRecords,
  filterVisibleCustomers,
} from "@/lib/customer-visibility";

// ─── Customers: Full List (all statuses, large page) ────────────────────────

/**
 * Fetch ALL customers (all statuses) for listing and client-side lookup.
 * Uses: GET /customers (no customer_id param)
 */
export function useAllCustomers() {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", "all"],
    queryFn: async () =>
      filterVisibleCustomers(await api.get<Customer[]>("/customers", {
        params: { page: 1, page_size: 500 },
      })),
    staleTime: 60_000,
  });
}

// ─── Invoices: Full List (no date params to backend) ────────────────────────

/**
 * Fetch ALL invoices for client-side aggregation and filtering.
 * Does NOT send date_from/date_to or customer_id to backend.
 * Uses: GET /invoices
 */
export function useAllInvoices() {
  const api = useApi();

  return useQuery({
    queryKey: ["invoices", "all-f2"],
    queryFn: async () => {
      const [invoices, customers] = await Promise.all([
        api.get<Invoice[]>("/invoices", { params: { page: 1, page_size: 500 } }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);
      return filterVisibleCustomerRecords(invoices, customers);
    },
    staleTime: 30_000,
  });
}

// ─── Receipts: Full List (no date params to backend) ────────────────────────

/**
 * Fetch ALL receipts for client-side aggregation and filtering.
 * Does NOT send date_from/date_to or customer_id to backend.
 * Uses: GET /receipts
 */
export function useAllReceipts() {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", "all-f2"],
    queryFn: async () => {
      const [receipts, customers] = await Promise.all([
        api.get<Receipt[]>("/receipts", { params: { page: 1, page_size: 500 } }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);
      return filterVisibleCustomerRecords(receipts, customers);
    },
    staleTime: 30_000,
  });
}

// ─── Aging: Summary (NO as_of param) ────────────────────────────────────────

/**
 * Fetch aging summary — current aging only.
 * Does NOT send as_of_date to backend (unverified).
 * Uses: GET /reports/aging
 */
export function useAgingSummaryF2() {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "aging", "summary-f2"],
    queryFn: () => api.get<ARSummary>("/reports/aging"),
    staleTime: 2 * 60_000,
  });
}

// ─── Aging: By Customer (NO as_of param) ────────────────────────────────────

/**
 * Fetch aging grouped by customer — current aging only.
 * Does NOT send as_of_date to backend (unverified).
 * Uses: GET /reports/aging/by-customer
 */
export function useAgingByCustomerF2() {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "aging", "by-customer-f2"],
    queryFn: async () => {
      const [rows, customers] = await Promise.all([
        api.get<CustomerAgingRow[]>("/reports/aging/by-customer", {
        params: { page: 1, page_size: 500 },
        }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);
      return filterVisibleCustomerRecords(rows, customers);
    },
    staleTime: 2 * 60_000,
  });
}

// ─── Utility: Currency Formatter ────────────────────────────────────────────

const currencyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

/**
 * Format a date string to locale display.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-MY", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}
