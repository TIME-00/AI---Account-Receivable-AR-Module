// ============================================================================
// TSH Synergy AR — Report data hooks (Batch 9D-D remediation)
//
// B9DD-FEIR-002: the previous `useAllInvoices`/`useAllReceipts` requested
// `page_size=500` while the backend clamps to MAX_PAGE_SIZE=100 and neither
// hook paginated — so every report silently aggregated at most the first 100
// rows, in the browser, across transaction currencies.
//
// These hooks instead consume the AUTHORITATIVE backend contracts:
//
//   • `ar_invoice_collection` / `ar_receipt_collection` (migration 027) compute
//     `meta.summary` over the ENTIRE filtered collection (the `filtered` CTE),
//     independently of the requested page. A `page_size=1` request therefore
//     returns complete, exact totals for 1,001 rows — or 1,000,000 — without
//     downloading a single extra row.
//   • Report filters (status / date range / document type / payment method) are
//     pushed to the server, so each summary describes exactly the filtered set.
//
// No company-base rollup and no cross-currency summation happen here.
// ============================================================================

"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useApi, type ApiClient } from "@/hooks/use-api";
import { useAuthContext } from "@/hooks/use-auth-context";
import { useCompanyStore } from "@/stores/company-store";
import type {
  Invoice,
  Receipt,
  ARSummary,
  MonetaryCollectionSummary,
} from "@/types";
import { INVOICE_STATUSES, RECEIPT_STATUSES } from "@/types";

/**
 * `useQueries` widens its result union across heterogeneous queries, so each
 * entry's `data` is typed as the union of every queryFn's return. These helpers
 * narrow one entry back to its own known type without an `any` cast.
 */
function asType<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

// ─── Customers ──────────────────────────────────────────────────────────────
//
// B9DD-RR-002: `useAllCustomers` has been REMOVED. It fetched page 1 with
// `page_size=100` and presented it as the complete customer set, which made
// Customer Management silently omit customers beyond the first page and — worse
// — report false ZERO exposure for them. Server-paginated replacements live in
// `@/hooks/use-customers`: `useCustomerList`, `useCustomer` (the governed
// `GET /customers/:id`) and `useCustomerExposureMap`.

// ─── Authoritative collection summaries ─────────────────────────────────────

export interface CollectionSummaryResult {
  /** Authoritative totals over the entire server-filtered collection. */
  summary: MonetaryCollectionSummary;
  /** Row count of the entire server-filtered collection. */
  total: number;
}

/**
 * Minimal page size: we want the collection SUMMARY, not the rows. The backend
 * computes the summary over the whole filtered set regardless of page size, so
 * this fetches complete totals at minimum transfer cost.
 */
const SUMMARY_ONLY_PAGE_SIZE = 1;

export type ReportFilters = {
  date_from?: string;
  date_to?: string;
  status?: string;
  doc_type?: string;
  payment_method?: string;
  customer_id?: string;
};

function toParams(filters: ReportFilters, page: number, pageSize: number): Record<string, string | number> {
  const params: Record<string, string | number> = { page, page_size: pageSize };
  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }
  return params;
}

async function fetchCollectionSummary(
  api: ApiClient,
  path: "/invoices" | "/receipts",
  filters: ReportFilters,
): Promise<CollectionSummaryResult> {
  const res = await api.getWithMeta<Invoice[] | Receipt[]>(path, {
    params: toParams(filters, 1, SUMMARY_ONLY_PAGE_SIZE),
  });
  const summary = res.meta?.summary;
  if (!summary) {
    // The backend guarantees this envelope (`listInvoices` throws without it).
    // Fail loudly rather than degrading to a client-side approximation.
    throw new Error(`Authoritative monetary summary missing from ${path} response.`);
  }
  return { summary, total: res.meta?.total ?? 0 };
}

// ─── Invoice Summary report ─────────────────────────────────────────────────

export interface StatusSummaryEntry {
  status: string;
  summary: MonetaryCollectionSummary;
  total: number;
}

export interface InvoiceReportData {
  overall: CollectionSummaryResult;
  byStatus: StatusSummaryEntry[];
  recent: Invoice[];
}

/**
 * Invoice Summary report data, entirely from backend-authoritative contracts.
 *
 * One request per status yields that status's exact `by_currency` + `base_total`
 * over the whole filtered collection — correct regardless of row count, and
 * without a client-side rollup.
 */
export function useInvoiceReport(filters: { date_from?: string; date_to?: string }) {
  const api = useApi();
  const base: ReportFilters = { date_from: filters.date_from, date_to: filters.date_to };

  const queries = useQueries({
    queries: [
      {
        queryKey: ["reports", "invoices", "overall", base],
        queryFn: () => fetchCollectionSummary(api, "/invoices", base),
        staleTime: 30_000,
      },
      {
        queryKey: ["reports", "invoices", "recent", base],
        queryFn: async () =>
          (await api.getWithMeta<Invoice[]>("/invoices", { params: toParams(base, 1, 10) })).data,
        staleTime: 30_000,
      },
      ...INVOICE_STATUSES.map((status) => ({
        queryKey: ["reports", "invoices", "status", status, base],
        queryFn: async (): Promise<StatusSummaryEntry> => {
          const r = await fetchCollectionSummary(api, "/invoices", { ...base, status });
          return { status, summary: r.summary, total: r.total };
        },
        staleTime: 30_000,
      })),
    ],
  });

  const [overallQ, recentQ, ...statusQs] = queries;
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const error = queries.find((q) => q.isError)?.error;

  const data: InvoiceReportData | undefined =
    overallQ.data && recentQ.data
      ? {
          overall: asType<CollectionSummaryResult>(overallQ.data)!,
          recent: asType<Invoice[]>(recentQ.data)!,
          byStatus: statusQs
            .map((q) => asType<StatusSummaryEntry>(q.data))
            .filter((e): e is StatusSummaryEntry => e != null && e.total > 0),
        }
      : undefined;

  return { data, isLoading, isError, error };
}

// ─── Receipt Summary report ─────────────────────────────────────────────────

export interface MethodSummaryEntry {
  method: string;
  summary: MonetaryCollectionSummary;
  total: number;
}

export interface ReceiptReportData {
  overall: CollectionSummaryResult;
  byStatus: StatusSummaryEntry[];
  byMethod: MethodSummaryEntry[];
  recent: Receipt[];
}

/** Payment methods offered by the backend contract (`PAYMENT_METHOD_NAMES`). */
const PAYMENT_METHOD_CODES = ["CHQ", "TT", "CASH", "CC", "GIRO", "OFST", "ONLN"] as const;

export function useReceiptReport(filters: { date_from?: string; date_to?: string }) {
  const api = useApi();
  const base: ReportFilters = { date_from: filters.date_from, date_to: filters.date_to };

  const queries = useQueries({
    queries: [
      {
        queryKey: ["reports", "receipts", "overall", base],
        queryFn: () => fetchCollectionSummary(api, "/receipts", base),
        staleTime: 30_000,
      },
      {
        queryKey: ["reports", "receipts", "recent", base],
        queryFn: async () =>
          (await api.getWithMeta<Receipt[]>("/receipts", { params: toParams(base, 1, 10) })).data,
        staleTime: 30_000,
      },
      ...RECEIPT_STATUSES.map((status) => ({
        queryKey: ["reports", "receipts", "status", status, base],
        queryFn: async (): Promise<StatusSummaryEntry> => {
          const r = await fetchCollectionSummary(api, "/receipts", { ...base, status });
          return { status, summary: r.summary, total: r.total };
        },
        staleTime: 30_000,
      })),
      ...PAYMENT_METHOD_CODES.map((method) => ({
        queryKey: ["reports", "receipts", "method", method, base],
        queryFn: async (): Promise<MethodSummaryEntry> => {
          const r = await fetchCollectionSummary(api, "/receipts", { ...base, payment_method: method });
          return { method, summary: r.summary, total: r.total };
        },
        staleTime: 30_000,
      })),
    ],
  });

  const overallQ = queries[0];
  const recentQ = queries[1];
  const statusQs = queries.slice(2, 2 + RECEIPT_STATUSES.length);
  const methodQs = queries.slice(2 + RECEIPT_STATUSES.length);

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const error = queries.find((q) => q.isError)?.error;

  const data: ReceiptReportData | undefined =
    overallQ.data && recentQ.data
      ? {
          overall: asType<CollectionSummaryResult>(overallQ.data)!,
          recent: asType<Receipt[]>(recentQ.data)!,
          byStatus: statusQs
            .map((q) => asType<StatusSummaryEntry>(q.data))
            .filter((e): e is StatusSummaryEntry => e != null && e.total > 0),
          byMethod: methodQs
            .map((q) => asType<MethodSummaryEntry>(q.data))
            .filter((e): e is MethodSummaryEntry => e != null && e.total > 0),
        }
      : undefined;

  return { data, isLoading, isError, error };
}

// ─── Aging: Summary (NO as_of param) ────────────────────────────────────────

/**
 * Company-wide aging summary — already fully authoritative: `ARSummary` carries
 * `base_total`, `base_currency`, `by_currency` and per-bucket breakdowns. No
 * client aggregation is required or permitted.
 */
export function useAgingSummaryF2() {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth } = useAuthContext();
  const userId = auth?.user.id ?? "";
  const identityReady =
    companyId.trim().length > 0 && userId.trim().length > 0;

  return useQuery({
    queryKey: ["reports", "aging", "summary-f2", companyId, userId],
    queryFn: () => api.get<ARSummary>("/reports/aging"),
    enabled: identityReady,
    staleTime: 2 * 60_000,
  });
}

// ─── Aging: By Customer (server-paginated) ──────────────────────────────────

/**
 * One page of the aging-by-customer report.
 *
 * Server pagination is preserved (page_size clamps to 100). Company-wide totals
 * must come from {@link useAgingSummaryF2}, never from summing these rows.
 *
 * The rows are already visibility-scoped by `ar_aging_by_customer`'s
 * `scoped_customers` CTE (is_deleted / is_hidden / assignment), so no client-side
 * re-filter against a capped customer list is applied.
 */
export function useAgingByCustomerF2(
  page = 1,
  pageSize = 100,
  creditRating: string | null = null,
  options?: { enabled?: boolean },
) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth } = useAuthContext();
  const userId = auth?.user.id ?? "";
  const identityReady =
    companyId.trim().length > 0 && userId.trim().length > 0;

  return useQuery({
    // The rating is part of the cache identity: switching ratings must not reuse
    // another rating's page. Company and user are also authoritative because
    // role/assignment scope can differ within the same tenant.
    queryKey: [
      "reports",
      "aging",
      "by-customer-f2",
      companyId,
      userId,
      page,
      pageSize,
      creditRating,
    ],
    queryFn: () => fetchAgingByCustomerPage(api, page, pageSize, creditRating),
    // Keep the current page rendered while the next one loads, so paging does
    // not tear down and re-mount the whole report.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[7] === creditRating &&
        previousQuery.queryKey[3] === companyId &&
        previousQuery.queryKey[4] === userId
        ? previousData
        : undefined,
    enabled: identityReady && (options?.enabled ?? true),
    staleTime: 2 * 60_000,
  });
}

/**
 * One customer's authoritative aging row (buckets + by_currency + base_total).
 *
 * Returns `null` when the customer has no outstanding exposure —
 * `ar_aging_by_customer` filters `WHERE base_total > 0`, so such customers are
 * legitimately absent rather than missing.
 */
export function useCustomerAgingRow(customerId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "aging", "customer-row", customerId],
    queryFn: () => fetchCustomerAgingRow(api, customerId),
    enabled: !!customerId,
    staleTime: 2 * 60_000,
  });
}

// ─── Utility: Date formatter ────────────────────────────────────────────────

/**
 * Format a date string to locale display.
 *
 * NOTE: the former `formatCurrency` export lived here and hard-coded
 * `style: "currency", currency: "MYR"` — it mislabelled every non-MYR and
 * company-base figure. It has been removed (B9DD-FEIR-006); use `formatMoney` /
 * `formatMoneySafe` from `@/lib/currency`.
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

import { fetchAgingByCustomerPage, fetchCustomerAgingRow } from "@/lib/aging-lookup";
