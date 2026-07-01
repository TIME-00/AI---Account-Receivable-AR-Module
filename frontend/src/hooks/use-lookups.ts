// ============================================================================
// TSH Synergy AR - Read-only Lookup Hooks
// Contract for GET /lookups/tax-codes and /lookups/payment-terms.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { PaymentTerm, TaxCode } from "@/types";

export function useTaxCodeLookups(params?: {
  country?: string;
  tax_type?: "Output" | "Input";
  effective_date?: string;
}) {
  const api = useApi();

  return useQuery({
    queryKey: ["lookups", "tax-codes", params],
    queryFn: () => api.get<TaxCode[]>("/lookups/tax-codes", { params }),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePaymentTermLookups() {
  const api = useApi();

  return useQuery({
    queryKey: ["lookups", "payment-terms"],
    queryFn: () => api.get<PaymentTerm[]>("/lookups/payment-terms"),
    staleTime: 5 * 60 * 1000,
  });
}
