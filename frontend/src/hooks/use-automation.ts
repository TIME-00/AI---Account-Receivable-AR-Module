// ============================================================================
// Gate E — Autonomous AR Operations — frontend hooks.
//
// Every query is company-scoped (see query-keys) and every response is parsed
// strictly against the gate-e.1 contract; malformed data fails closed rather
// than rendering unchecked. Each request also passes through the versioned
// envelope boundary (`contractVersion`), so a response that omits or drifts
// from `contract_version: "gate-e.1"` is rejected before its `data` is even
// unwrapped. Mutations invalidate the company automation root. The frontend
// supplies NO financial authority: allocation posts `{}`, and the backend
// re-derives receipt/invoice/amount/evidence/FX.
// ============================================================================

"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import { useApi } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import {
  type AllocationResult,
  allocationResultSchema,
  type Assignment,
  type AssignmentResult,
  assignmentResultSchema,
  type AssignmentWithRep,
  assignmentWithRepSchema,
  auditEventSchema,
  type AuditEvent,
  type AutomationOverview,
  type AutomationSettings,
  commandSchema,
  currentAssignmentSchema,
  type CurrentAssignment,
  documentDecisionSchema,
  exceptionSchema,
  GATE_E_CONTRACT_VERSION,
  type GateECollection,
  type InvoiceReminder,
  mailboxSchema,
  type OAuthStart,
  oauthStartSchema,
  overviewSchema,
  parseGateECollection,
  parseGateEData,
  reminderAttemptSchema,
  reminderSchema,
  salesRepresentativeSchema,
  settingsSchema,
  syncRunSchema,
  UUID_PATTERN,
} from "@/lib/automation/contract";
import {
  automationRoot,
  collectionKey,
  type CollectionName,
  customerAssignmentHistoryKey,
  customerAssignmentKey,
  invoiceRemindersKey,
  reminderAttemptsKey,
} from "@/lib/automation/query-keys";
import {
  type GateEReadCapability,
  hasAutomationReadCapability,
} from "@/lib/automation/navigation";
import { useUserRole } from "@/hooks/use-user-role";

const AUTOMATION_BASE = "/automation";

/**
 * Read-capability gate for Gate E requests. Returns false until the
 * authenticated role context has RESOLVED, so no operational or detail-page
 * query is ever issued before the role is known, and a role the frozen route
 * matrix excludes never fires a predictable 401/403 (the backend stays
 * authoritative). Mirrors docs/contracts GET matrix via navigation.ts.
 */
function useReadAllowed(capability: GateEReadCapability): boolean {
  const { roles, isResolved } = useUserRole();
  return isResolved && hasAutomationReadCapability(roles, capability);
}

/** Which read-capability governs each paginated collection. */
const COLLECTION_CAPABILITY: Record<CollectionName, GateEReadCapability> = {
  overview: "overview",
  settings: "settings",
  "sales-representatives": "salesRepresentatives",
  mailboxes: "mailboxes",
  runs: "runs",
  documents: "documents",
  commands: "commands",
  exceptions: "exceptions",
  reminders: "reminders",
  "reminder-attempts": "reminderAttempts",
  audit: "audit",
};

/**
 * Every Gate E request runs through the versioned envelope boundary: the
 * response MUST declare `contract_version: "gate-e.1"` before `data` is
 * unwrapped (see use-api). `silent` keeps error toasts owned by each surface.
 */
const GATE_E_OPTS = {
  silent: true,
  contractVersion: GATE_E_CONTRACT_VERSION,
} as const;

function withParams(params: Record<string, string | number>) {
  return { params, ...GATE_E_OPTS } as const;
}

function useCompanyId(): { companyId: string; ready: boolean } {
  const companyId = useCompanyStore((s) => s.companyId);
  return { companyId, ready: companyId.trim().length > 0 };
}

export interface PageParams {
  page?: number;
  page_size?: number;
  [key: string]: unknown;
}

function pageParams(params?: PageParams & Record<string, unknown>) {
  const clean: Record<string, string | number> = {};
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        clean[key] = value as string | number;
      }
    }
  }
  return clean;
}

// ─── Generic paginated collection ─────────────────────────────────────────────

function useCollection<T>(
  collection: CollectionName,
  path: string,
  schema: z.ZodType<T>,
  params?: PageParams & Record<string, unknown>,
  options?: { enabled?: boolean },
) {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed(COLLECTION_CAPABILITY[collection]);
  return useQuery<GateECollection<T>>({
    queryKey: collectionKey(companyId, collection, params),
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>(`${AUTOMATION_BASE}${path}`, {
        ...withParams(pageParams(params)),
        signal,
      });
      return parseGateECollection(schema, res.data, res.meta);
    },
    enabled: ready && roleAllowed && (options?.enabled ?? true),
    staleTime: 15_000,
  });
}

// ─── Overview + settings ──────────────────────────────────────────────────────

export function useAutomationOverview() {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("overview");
  return useQuery<AutomationOverview>({
    queryKey: collectionKey(companyId, "overview"),
    queryFn: async ({ signal }) => {
      const data = await api.get<unknown>(`${AUTOMATION_BASE}/overview`, {
        ...GATE_E_OPTS,
        signal,
      });
      return parseGateEData(overviewSchema, data);
    },
    enabled: ready && roleAllowed,
    staleTime: 15_000,
  });
}

export function useAutomationSettings() {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("settings");
  return useQuery<AutomationSettings>({
    queryKey: collectionKey(companyId, "settings"),
    queryFn: async ({ signal }) => {
      const data = await api.get<unknown>(`${AUTOMATION_BASE}/settings`, {
        ...GATE_E_OPTS,
        signal,
      });
      return parseGateEData(settingsSchema, data);
    },
    enabled: ready && roleAllowed,
    staleTime: 15_000,
  });
}

export interface SettingsPatch {
  operating_mode?: AutomationSettings["operating_mode"];
  activation_confirmation?: string;
  mailbox_sync_enabled?: boolean;
  document_intelligence_enabled?: boolean;
  invoice_automation_enabled?: boolean;
  receipt_automation_enabled?: boolean;
  auto_allocation_enabled?: boolean;
  reminder_evaluation_enabled?: boolean;
  reminder_delivery_enabled?: boolean;
  reminder_stage_offsets?: number[];
  reminder_timezone?: string;
}

export function useUpdateAutomationSettings() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const data = await api.patch<unknown>(
        `${AUTOMATION_BASE}/settings`,
        patch,
        GATE_E_OPTS,
      );
      return parseGateEData(settingsSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

// ─── Sales representatives ─────────────────────────────────────────────────────

export function useSalesRepresentatives(
  params?: PageParams & { is_active?: boolean },
) {
  return useCollection(
    "sales-representatives",
    "/sales-representatives",
    salesRepresentativeSchema,
    params,
  );
}

export interface SalesRepresentativeInput {
  name: string;
  email: string | null;
  phone: string | null;
  is_active?: boolean;
}

export function useCreateSalesRepresentative() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (input: SalesRepresentativeInput) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/sales-representatives`,
        input,
        GATE_E_OPTS,
      );
      return parseGateEData(salesRepresentativeSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

export function useUpdateSalesRepresentative() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<SalesRepresentativeInput>;
    }) => {
      const data = await api.patch<unknown>(
        `${AUTOMATION_BASE}/sales-representatives/${args.id}`,
        args.patch,
        GATE_E_OPTS,
      );
      return parseGateEData(salesRepresentativeSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

// ─── Mailboxes ────────────────────────────────────────────────────────────────

export function useMailboxes(params?: PageParams & Record<string, unknown>) {
  return useCollection("mailboxes", "/mailboxes", mailboxSchema, params);
}

export function useCreateMailbox() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/mailboxes`,
        input,
        GATE_E_OPTS,
      );
      return parseGateEData(mailboxSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

export function useUpdateMailbox() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Record<string, unknown> }) => {
      const data = await api.patch<unknown>(
        `${AUTOMATION_BASE}/mailboxes/${args.id}`,
        args.patch,
        GATE_E_OPTS,
      );
      return parseGateEData(mailboxSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

export function useSyncMailbox() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    // The manual-sync response is the completed run DTO — parse it strictly
    // rather than awaiting an opaque `unknown`, so a drifted run shape fails
    // closed like every other Gate E response.
    mutationFn: async (id: string) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/mailboxes/${id}/sync`,
        undefined,
        GATE_E_OPTS,
      );
      return parseGateEData(syncRunSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

/**
 * Start an OAuth consent flow. The DTO is strictly parsed; the caller is
 * responsible for validating the `authorization_url` origin against the
 * provider allowlist (see lib/automation/oauth) before any navigation.
 */
export function useBeginMailboxOAuth() {
  const api = useApi();
  return useMutation<OAuthStart, unknown, {
    id: string;
    capability: "ingestion" | "delivery";
  }>({
    mutationFn: async (args) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/mailboxes/${args.id}/oauth/start`,
        { capability: args.capability },
        GATE_E_OPTS,
      );
      return parseGateEData(oauthStartSchema, data);
    },
  });
}

// ─── Runs / documents / commands / audit ──────────────────────────────────────

export function useSyncRuns(params?: PageParams & Record<string, unknown>) {
  return useCollection("runs", "/runs", syncRunSchema, params);
}

export function useDocumentDecisions(
  params?: PageParams & Record<string, unknown>,
) {
  return useCollection("documents", "/documents", documentDecisionSchema, params);
}

export function useAutomationCommands(
  params?: PageParams & Record<string, unknown>,
) {
  return useCollection("commands", "/commands", commandSchema, params);
}

/**
 * Entity-scoped audit timeline. Pass `entity_type`/`entity_id` (+ optional
 * `event_type`/`actor_type`) to bind the timeline to one Gate E surface.
 */
export function useAuditEvents(params?: PageParams & Record<string, unknown>) {
  // Entity-scoped ONLY: the timeline is disabled until a valid entity_type AND
  // a UUID entity_id are both present. A missing/pending entity id must NEVER
  // fall through to an unfiltered tenant-wide audit request. (useCollection
  // additionally gates on the audit read-role.)
  const entityReady =
    typeof params?.entity_type === "string" &&
    params.entity_type.trim().length > 0 &&
    typeof params?.entity_id === "string" &&
    UUID_PATTERN.test(params.entity_id);
  return useCollection<AuditEvent>("audit", "/audit", auditEventSchema, params, {
    enabled: entityReady,
  });
}

// ─── Exceptions ────────────────────────────────────────────────────────────────

export function useExceptions(params?: PageParams & Record<string, unknown>) {
  return useCollection("exceptions", "/exceptions", exceptionSchema, params);
}

function useExceptionMutation(
  action: "retry" | "resolve" | "dismiss",
) {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation({
    mutationFn: async (args: { id: string; resolution_note?: string }) => {
      const body =
        action === "retry" ? undefined : { resolution_note: args.resolution_note };
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/exceptions/${args.id}/${action}`,
        body,
        GATE_E_OPTS,
      );
      return parseGateEData(exceptionSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

export const useRetryException = () => useExceptionMutation("retry");
export const useResolveException = () => useExceptionMutation("resolve");
export const useDismissException = () => useExceptionMutation("dismiss");

// ─── Commands: stored-command allocation (backend re-derives authority) ────────

export function useAllocateCommand() {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation<AllocationResult, unknown, string>({
    // The request body is EXACTLY `{}`; the frontend supplies no receipt,
    // invoice, amount, evidence, tenant, FX rate, or customer authority.
    mutationFn: async (commandId: string) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/commands/${commandId}/allocate`,
        {},
        GATE_E_OPTS,
      );
      return parseGateEData(allocationResultSchema, data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: automationRoot(companyId) }),
  });
}

// ─── Customer sales-representative assignment (customer detail integration) ────

export function useCustomerCurrentAssignment(customerId: string) {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("customerAssignment");
  return useQuery<CurrentAssignment>({
    queryKey: customerAssignmentKey(companyId, customerId),
    queryFn: async ({ signal }) => {
      const data = await api.get<unknown>(
        `${AUTOMATION_BASE}/customers/${customerId}/sales-representative`,
        { ...GATE_E_OPTS, signal },
      );
      return parseGateEData(currentAssignmentSchema, data);
    },
    enabled: ready && roleAllowed && customerId.trim().length > 0,
    staleTime: 15_000,
  });
}

export function useCustomerAssignmentHistory(
  customerId: string,
  params?: PageParams,
) {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("customerAssignment");
  // Each history element is the full `{assignment, sales_representative}` shape,
  // so the UI can show the HISTORICAL representative identity for every row.
  return useQuery<GateECollection<AssignmentWithRep>>({
    queryKey: customerAssignmentHistoryKey(companyId, customerId, params),
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>(
        `${AUTOMATION_BASE}/customers/${customerId}/sales-representative/history`,
        { ...withParams(pageParams(params)), signal },
      );
      return parseGateECollection(assignmentWithRepSchema, res.data, res.meta);
    },
    enabled: ready && roleAllowed && customerId.trim().length > 0,
    staleTime: 15_000,
  });
}

export interface AssignSalesRepInput {
  sales_representative_id: string;
  assignment_source: Assignment["assignment_source"];
  reason: string;
}

export function useAssignSalesRepresentative(customerId: string) {
  const api = useApi();
  const qc = useQueryClient();
  const { companyId } = useCompanyId();
  return useMutation<AssignmentResult, unknown, AssignSalesRepInput>({
    mutationFn: async (input) => {
      const data = await api.post<unknown>(
        `${AUTOMATION_BASE}/customers/${customerId}/sales-representative/assign`,
        input,
        GATE_E_OPTS,
      );
      return parseGateEData(assignmentResultSchema, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationRoot(companyId) });
      qc.invalidateQueries({
        queryKey: customerAssignmentKey(companyId, customerId),
      });
      qc.invalidateQueries({
        queryKey: customerAssignmentHistoryKey(companyId, customerId),
      });
    },
  });
}

// ─── Invoice reminders (invoice detail integration) ───────────────────────────

/**
 * Reminder rows for one invoice. Uses the frozen server-side `invoice_id`
 * filter — the backend enforces tenant + Invoice/customer access and returns
 * only that Invoice's reminders. The UI never fetches the tenant list and
 * filters client-side.
 */
export function useInvoiceReminders(invoiceId: string, params?: PageParams) {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("reminders");
  return useQuery<GateECollection<InvoiceReminder>>({
    queryKey: invoiceRemindersKey(companyId, invoiceId, params),
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>(
        `${AUTOMATION_BASE}/reminders`,
        {
          ...withParams(pageParams({ ...params, invoice_id: invoiceId })),
          signal,
        },
      );
      return parseGateECollection(reminderSchema, res.data, res.meta);
    },
    enabled:
      ready && roleAllowed && invoiceId.trim().length > 0 &&
      UUID_PATTERN.test(invoiceId),
    staleTime: 15_000,
  });
}

/**
 * Delivery attempts for one reminder, using the frozen server-side
 * `reminder_id` filter (tenant + customer-access enforced by the backend).
 */
export function useReminderAttempts(
  reminderId: string | undefined,
  params?: PageParams,
) {
  const api = useApi();
  const { companyId, ready } = useCompanyId();
  const roleAllowed = useReadAllowed("reminderAttempts");
  return useQuery<GateECollection<z.infer<typeof reminderAttemptSchema>>>({
    queryKey: reminderAttemptsKey(companyId, reminderId ?? "", params),
    queryFn: async ({ signal }) => {
      const res = await api.getWithMeta<unknown>(
        `${AUTOMATION_BASE}/reminder-attempts`,
        {
          ...withParams(pageParams({ ...params, reminder_id: reminderId })),
          signal,
        },
      );
      return parseGateECollection(reminderAttemptSchema, res.data, res.meta);
    },
    enabled:
      ready &&
      roleAllowed &&
      !!reminderId &&
      reminderId.trim().length > 0 &&
      UUID_PATTERN.test(reminderId),
    staleTime: 15_000,
  });
}
