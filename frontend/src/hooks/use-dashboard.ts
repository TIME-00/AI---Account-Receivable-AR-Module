"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { ARSummary, CustomerAgingRow, LiveDashboardMetrics } from "@/types";

const DEFAULT_TREND_MONTHS = 6;

/**
 * Fetch the live AR dashboard metrics (Batch 7A).
 * Calls: GET /reports/dashboard?trend_months=<n>
 *
 * Returns the nested base-currency contract ({@link LiveDashboardMetrics}).
 * Polls in the foreground only so the dashboard stays current during a demo
 * without burning quota while the tab is hidden.
 *
 * `silent: true` suppresses the global error toast so the dashboard can render
 * its own inline error/empty states (e.g. 403 for System Admin-only users)
 * instead of surfacing a duplicate toast.
 */
export function useDashboardMetrics(trendMonths: number = DEFAULT_TREND_MONTHS) {
  const api = useApi();

  const query = useQuery({
    queryKey: ["dashboard", "metrics", trendMonths],
    queryFn: () =>
      api.get<LiveDashboardMetrics>("/reports/dashboard", {
        params: { trend_months: trendMonths },
        silent: true,
      }),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: false,
  });

  return {
    ...query,
    metrics: query.data,
    /** True only on the first load (no previously cached data shown). */
    isLoading: query.isLoading,
    /** True for background refreshes while previous data is still displayed. */
    isRefreshing: query.isFetching && !query.isLoading,
  };
}

/**
 * Fetch aging analysis summary.
 * Calls: GET /reports/aging
 */
export function useAgingSummary(asOfDate?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "aging", asOfDate],
    queryFn: () =>
      api.get<ARSummary>("/reports/aging", {
        params: asOfDate ? { as_of_date: asOfDate } : undefined,
      }),
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Fetch aging breakdown by customer.
 * Calls: GET /reports/aging/by-customer
 */
export function useAgingByCustomer(asOfDate?: string, page = 1, pageSize = 20) {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "aging", "by-customer", asOfDate, page, pageSize],
    queryFn: () =>
      api.get<{ rows: CustomerAgingRow[]; total: number }>("/reports/aging/by-customer", {
        params: {
          as_of_date: asOfDate,
          page,
          page_size: pageSize,
        },
      }),
    staleTime: 2 * 60 * 1000,
  });
}
