// ============================================================================
// TSH Synergy AR - Authenticated Role/Context Hook
// Contract for GET /auth/me. Replaces demo/env role assumptions when wired.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { AuthContextResponse } from "@/types";

export function useAuthContext() {
  const api = useApi();

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthContextResponse>("/auth/me"),
    staleTime: 60 * 1000,
  });
}
