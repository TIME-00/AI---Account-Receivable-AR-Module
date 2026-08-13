// ============================================================================
// TSH Synergy AR — Account Theme Preference (server authority)
//
// Thin, typed access to the reviewed auth Edge Function routes:
//
//   GET   /auth/ui-preferences   → { theme, source }
//   PATCH /auth/ui-preferences   ← { theme }
//
// The backend derives the account from the bearer token; no user id is ever
// sent from the browser. The query is keyed by the authenticated user id so a
// different account can never read a cached response belonging to another.
// ============================================================================

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import {
  readPreference,
  UI_PREFERENCE_PATH,
  type UiPreferenceDto,
  type UiTheme,
} from "@/lib/theme/contract";

export const themePreferenceKey = (userId: string | null) =>
  ["ui-preference", userId] as const;

/**
 * Loads the signed-in account's stored theme.
 *
 * `silent` suppresses the global error toast: a preference that cannot be read
 * is not an error the operator needs to act on — the UI simply stays on the
 * dark default. Retries are disabled for the same reason.
 */
export function useThemePreferenceQuery(userId: string | null) {
  const api = useApi();

  return useQuery<UiPreferenceDto>({
    queryKey: themePreferenceKey(userId),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const data = await api.get<unknown>(UI_PREFERENCE_PATH, {
        silent: true,
        signal,
      });
      return readPreference(data);
    },
  });
}

/**
 * Persists an explicit choice. The resolved value written back into the cache
 * is the server's echo, not the optimistic local value, so the client can never
 * believe it saved something the backend rejected.
 */
export function useThemePreferenceMutation(userId: string | null) {
  const api = useApi();
  const queryClient = useQueryClient();

  return useMutation<UiPreferenceDto, Error, UiTheme>({
    mutationFn: async (theme) => {
      const data = await api.patch<unknown>(
        UI_PREFERENCE_PATH,
        { theme },
        { silent: true },
      );
      return readPreference(data);
    },
    onSuccess: (preference) => {
      queryClient.setQueryData(themePreferenceKey(userId), preference);
    },
  });
}
