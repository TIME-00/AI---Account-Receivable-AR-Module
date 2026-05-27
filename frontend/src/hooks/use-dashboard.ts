"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { DashboardSummary, ARSummary, CustomerAgingRow } from "@/types";

/**
 * Fetch dashboard KPI summary.
 * Calls: GET /reports/dashboard
 */
export function useDashboardSummary() {
  const api = useApi();

  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.get<DashboardSummary>("/reports/dashboard"),
    staleTime: 60 * 1000, // 1 minute — dashboard data refreshes less frequently
  });
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
