// ============================================================================
// TSH Synergy AR — Customer Statement hook (Batch 9D-D, B9DD-FEIR-003)
//
// Consumes `GET /reports/statement/:customerId`, the authoritative multi-currency
// Customer Statement contract (migration 027 `ar_customer_statement`).
//
// The backend supplies EVERY figure, including both running balances:
//   • base_balance          — always valid (company-base running balance)
//   • transaction_balance   — NULL when the period spans >1 currency
// The browser therefore never computes a running balance, never converts, and
// never substitutes a current FX rate for a historical one.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { CustomerStatement } from "@/types";

export interface StatementPeriod {
  periodFrom: string;
  periodTo: string;
}

/**
 * Fetch a customer statement for a period.
 *
 * `period_from` and `period_to` are REQUIRED by the backend route (it throws a
 * ValidationError without them), so the query stays disabled until both are set.
 */
export function useCustomerStatement(customerId: string, period: StatementPeriod) {
  const api = useApi();

  return useQuery({
    queryKey: ["reports", "statement", customerId, period.periodFrom, period.periodTo],
    queryFn: () =>
      api.get<CustomerStatement>(`/reports/statement/${customerId}`, {
        params: { period_from: period.periodFrom, period_to: period.periodTo },
      }),
    enabled: Boolean(customerId && period.periodFrom && period.periodTo),
    staleTime: 60_000,
  });
}
