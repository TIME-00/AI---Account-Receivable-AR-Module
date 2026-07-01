// ============================================================================
// TSH Synergy AR - Derived Notifications Hook
// Contract for GET /notifications; read-only, no fake notification records.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { NotificationItem } from "@/types";

export function useNotifications(limit = 10) {
  const api = useApi();

  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: () => api.get<NotificationItem[]>("/notifications", {
      params: { limit },
    }),
    staleTime: 60 * 1000,
  });
}
