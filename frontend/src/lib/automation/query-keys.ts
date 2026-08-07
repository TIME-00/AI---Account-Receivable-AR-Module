// ============================================================================
// Gate E — TanStack Query keys. Every key is scoped to the authenticated
// company id so a company switch can never surface another tenant's cached
// automation data. Filters/pagination are part of the key so distinct views
// never collide and are individually invalidated.
// ============================================================================

export const AUTOMATION_ROOT = "automation" as const;

export type CollectionName =
  | "overview"
  | "settings"
  | "sales-representatives"
  | "mailboxes"
  | "runs"
  | "documents"
  | "commands"
  | "exceptions"
  | "reminders"
  | "reminder-attempts"
  | "audit";

/** Root key for a company — invalidating it refreshes all automation views. */
export function automationRoot(companyId: string) {
  return [AUTOMATION_ROOT, companyId] as const;
}

export function collectionKey(
  companyId: string,
  collection: CollectionName,
  params?: Record<string, unknown>,
) {
  return [AUTOMATION_ROOT, companyId, collection, params ?? {}] as const;
}

export function customerAssignmentKey(companyId: string, customerId: string) {
  return [AUTOMATION_ROOT, companyId, "customer-assignment", customerId] as const;
}

export function customerAssignmentHistoryKey(
  companyId: string,
  customerId: string,
  params?: Record<string, unknown>,
) {
  return [
    AUTOMATION_ROOT,
    companyId,
    "customer-assignment-history",
    customerId,
    params ?? {},
  ] as const;
}

export function invoiceRemindersKey(
  companyId: string,
  invoiceId: string,
  params?: Record<string, unknown>,
) {
  return [
    AUTOMATION_ROOT,
    companyId,
    "invoice-reminders",
    invoiceId,
    params ?? {},
  ] as const;
}

export function reminderAttemptsKey(
  companyId: string,
  reminderId: string,
  params?: Record<string, unknown>,
) {
  return [
    AUTOMATION_ROOT,
    companyId,
    "reminder-attempts",
    reminderId,
    params ?? {},
  ] as const;
}
