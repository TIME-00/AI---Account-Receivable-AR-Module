// ============================================================================
// TSH Synergy AR - Authenticated Role/Context Hook
// Contract for GET /auth/me. Replaces demo/env role assumptions when wired.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import type { AuthContextResponse } from "@/types";

export function useAuthContext() {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery({
    // /auth/me is tenant-specific because useApi sends X-Company-Id. Never
    // reuse one company's role/base-currency context after a company switch.
    queryKey: ["auth", "me", companyId],
    queryFn: () => api.get<AuthContextResponse>("/auth/me"),
    enabled: companyId.trim().length > 0,
    staleTime: 60 * 1000,
  });
}
