// ============================================================================
// Post-Gate-E — Journal Entries + Audit Trail READ hooks.
//
// Both viewers are keyset (cursor) paginated, so there is deliberately NO page
// number and no total count: the backend returns `has_more` + `next_cursor` and
// nothing else, and inventing a page count would be a fabrication.
//
// Race safety comes from TanStack Query rather than hand-rolled bookkeeping:
// the cursor and every filter are part of the `queryKey`, so a superseded
// request resolves into ITS OWN cache entry and can never overwrite the newer
// filter's rows. The abort `signal` is forwarded so the superseded request is
// actually cancelled on the wire.
//
// These hooks call the authenticated Edge Function boundary through the shared
// `useApi` client (JWT + `X-Company-Id`). No protected RPC is ever invoked from
// the browser and no service-role credential exists in this app.
// ============================================================================

"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import type {
  JournalDetail,
} from "@/lib/journal-audit/contract";
import {
  parseAuditEvent,
  parseAuditList,
  parseJournalDetail,
  parseJournalList,
} from "@/lib/journal-audit/contract";
import type { AuditEvent, CursorMeta, JournalListItem } from "@/lib/journal-audit/contract";

// ─── Journal Entries ────────────────────────────────────────────────────────

export interface JournalFilters {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  sourceType?: string;
  currency?: string;
  accountCode?: string;
}

export interface JournalListResult {
  rows: JournalListItem[];
  meta: CursorMeta;
}

const PAGE_SIZE = 25;

/** Only send parameters the backend contract accepts; blanks are omitted. */
function journalParams(filters: JournalFilters, cursor: string | null) {
  const params: Record<string, string | number> = { limit: PAGE_SIZE };
  if (cursor) params.cursor = cursor;
  if (filters.q) params.q = filters.q;
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  if (filters.sourceType) params.source_type = filters.sourceType;
  if (filters.currency) params.currency = filters.currency;
  if (filters.accountCode) params.account_code = filters.accountCode;
  return params;
}

export function useJournalEntries(
  filters: JournalFilters,
  cursor: string | null,
  enabled: boolean,
) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery<JournalListResult>({
    queryKey: ["journal-entries", "list", companyId, filters, cursor],
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>("/journal-entries", {
        params: journalParams(filters, cursor),
        signal,
        silent: true,
      });
      return parseJournalList(res.data, res.meta);
    },
    enabled: enabled && companyId.trim().length > 0,
    // A superseded filter/cursor must never be served from cache as if current.
    staleTime: 0,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

export function useJournalEntryDetail(id: string, enabled: boolean) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery<JournalDetail>({
    queryKey: ["journal-entries", "detail", companyId, id],
    queryFn: async ({ signal }) =>
      parseJournalDetail(await api.get<unknown>(`/journal-entries/${encodeURIComponent(id)}`, {
        signal,
        silent: true,
      })),
    enabled: enabled && id.length > 0 && companyId.trim().length > 0,
    staleTime: 0,
    retry: false,
  });
}

// ─── Audit Trail ────────────────────────────────────────────────────────────

export interface AuditFilters {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  action?: string;
  entityType?: string;
  actorType?: string;
  result?: string;
}

export interface AuditListResult {
  rows: AuditEvent[];
  meta: CursorMeta;
}

function auditParams(filters: AuditFilters, cursor: string | null) {
  const params: Record<string, string | number> = { limit: PAGE_SIZE };
  if (cursor) params.cursor = cursor;
  if (filters.q) params.q = filters.q;
  if (filters.dateFrom) params.date_from = filters.dateFrom;
  if (filters.dateTo) params.date_to = filters.dateTo;
  if (filters.action) params.action = filters.action;
  if (filters.entityType) params.entity_type = filters.entityType;
  if (filters.actorType) params.actor_type = filters.actorType;
  if (filters.result) params.result = filters.result;
  return params;
}

export function useAuditTrail(
  filters: AuditFilters,
  cursor: string | null,
  enabled: boolean,
) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery<AuditListResult>({
    queryKey: ["audit-trail", "list", companyId, filters, cursor],
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>("/audit-trail", {
        params: auditParams(filters, cursor),
        signal,
        silent: true,
      });
      return parseAuditList(res.data, res.meta);
    },
    enabled: enabled && companyId.trim().length > 0,
    staleTime: 0,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

/**
 * Direct audit lookup uses the exact same strict event parser as the list.
 * The current dialog already receives the complete normalized list DTO, so it
 * does not need a second request; this hook preserves the canonical direct-read
 * contract for deep links and future clients without allowing schema drift.
 */
export function useAuditEventDetail(eventId: string, enabled: boolean) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);

  return useQuery<AuditEvent>({
    queryKey: ["audit-trail", "detail", companyId, eventId],
    queryFn: async ({ signal }) =>
      parseAuditEvent(await api.get<unknown>(`/audit-trail/${encodeURIComponent(eventId)}`, {
        signal,
        silent: true,
      })),
    enabled: enabled && eventId.length > 0 && companyId.trim().length > 0,
    staleTime: 0,
    retry: false,
  });
}
