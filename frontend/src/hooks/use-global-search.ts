// ============================================================================
// TSH Synergy AR - Scoped Global Search Hook
// Contract for GET /search?q=...; read-only and tenant/role scoped server-side.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { GlobalSearchResult } from "@/types";

export function useGlobalSearch(query: string, limit = 10) {
  const api = useApi();
  const normalized = query.trim();

  return useQuery({
    queryKey: ["search", normalized, limit],
    queryFn: () => api.get<GlobalSearchResult[]>("/search", {
      params: { q: normalized, limit },
      silent: true,
    }),
    enabled: normalized.length >= 2,
    staleTime: 30 * 1000,
  });
}
