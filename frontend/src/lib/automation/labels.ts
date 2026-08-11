// ============================================================================
// Gate E — human-readable labels, badge tones, and truthful status wording.
//
// The current backend is provider-ready but FAIL-CLOSED: no real document
// intelligence, no real OAuth token writer, no real mailbox, no real delivery,
// no scheduler, no Production straight-through. UI copy never implies real
// autonomous processing is operating.
// ============================================================================

import type {
  AssignmentSource,
  AttachmentProcessingStatus,
  ClassificationStatus,
  CommandStatus,
  CommandType,
  ConnectionStatus,
  DocumentType,
  ExceptionLifecycle,
  ExceptionReasonCode,
  OperatingMode,
  ProviderType,
  RecoveryActionType,
  ReminderAttemptStatus,
  ReminderMode,
  ReminderStatus,
  RunStatus,
} from "./contract";

/** Tones map onto the existing status-badge colour semantics. */
export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-50 text-blue-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  muted: "bg-slate-50 text-slate-500",
};

export const TONE_DOT: Record<BadgeTone, string> = {
  neutral: "bg-slate-400",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  muted: "bg-slate-300",
};

export const OPERATING_MODE_LABEL: Record<OperatingMode, string> = {
  disabled: "Disabled",
  observe_only: "Observe Only",
  draft_only: "Draft Only",
  straight_through: "Straight-Through",
};

export const OPERATING_MODE_TONE: Record<OperatingMode, BadgeTone> = {
  disabled: "muted",
  observe_only: "info",
  draft_only: "warning",
  straight_through: "success",
};

export const OPERATING_MODE_DESCRIPTION: Record<OperatingMode, string> = {
  disabled: "No mailbox synchronization, document processing, or reminders run. Nothing is created.",
  observe_only:
    "Mailboxes and documents may be observed and classified, but no invoices, receipts, allocations, or reminder deliveries are created.",
  draft_only:
    "Valid documents create unposted Draft invoices and receipts for human review. Nothing is posted and no allocation is executed automatically.",
  straight_through:
    "Valid documents create and post invoices and receipts, and eligible receipts are auto-allocated by the database. Highest financial impact.",
};

/** Financial-impact wording shown before a mode change is confirmed. */
export const OPERATING_MODE_FINANCIAL_IMPACT: Record<OperatingMode, string> = {
  disabled: "No financial records are created.",
  observe_only: "No financial records are created. Monitoring only.",
  draft_only:
    "Unposted Draft records may be created automatically. Posting still requires a person.",
  straight_through:
    "Invoices and receipts may be created AND posted, and receipts auto-allocated, without a person. Requires explicit confirmation and ready providers.",
};

export const REMINDER_MODE_LABEL: Record<ReminderMode, string> = {
  off: "Off",
  evaluate_only: "Evaluate Only",
  automatic_delivery: "Automatic Delivery",
};

export const REMINDER_MODE_TONE: Record<ReminderMode, BadgeTone> = {
  off: "muted",
  evaluate_only: "info",
  automatic_delivery: "success",
};

export const REMINDER_MODE_DESCRIPTION: Record<ReminderMode, string> = {
  off: "No reminder evaluation or email delivery.",
  evaluate_only:
    "The system determines which invoices require reminders but does not send email.",
  automatic_delivery:
    "The system evaluates reminders and sends approved automated reminder emails when delivery readiness is available.",
};

/**
 * Capabilities are derived, read-only status — NOT user controls. The label map
 * is shared with the (removed) kill-switch wording so the same seven capability
 * names render consistently on Overview and Settings.
 */
export const CAPABILITY_LABEL: Record<string, string> = {
  mailbox_sync_enabled: "Mailbox Synchronization",
  document_intelligence_enabled: "Document Intelligence",
  invoice_automation_enabled: "Invoice Automation",
  receipt_automation_enabled: "Receipt Automation",
  auto_allocation_enabled: "Auto-Allocation",
  reminder_evaluation_enabled: "Reminder Evaluation",
  reminder_delivery_enabled: "Reminder Delivery",
};

export const RECOVERY_ACTION_LABEL: Record<RecoveryActionType, string> = {
  correct_invoice_external_reference: "Correct Invoice External Reference",
  confirm_receipt_invoice_match: "Confirm Receipt-to-Invoice Match",
};

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  disabled: "Disabled",
  pending_consent: "Pending Consent",
  connected: "Connected",
  reconnect_required: "Reconnect Required",
  error: "Error",
};

export const CONNECTION_STATUS_TONE: Record<ConnectionStatus, BadgeTone> = {
  disabled: "muted",
  pending_consent: "info",
  connected: "success",
  reconnect_required: "warning",
  error: "danger",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  reconnect_required: "Reconnect Required",
};

export const RUN_STATUS_TONE: Record<RunStatus, BadgeTone> = {
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
  reconnect_required: "warning",
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  invoice: "Invoice",
  receipt: "Receipt",
  payment_advice: "Payment Advice",
  unsupported: "Unsupported",
  ambiguous: "Ambiguous",
};

export const DOCUMENT_TYPE_TONE: Record<DocumentType, BadgeTone> = {
  invoice: "info",
  receipt: "info",
  payment_advice: "neutral",
  unsupported: "muted",
  ambiguous: "warning",
};

export const CLASSIFICATION_STATUS_LABEL: Record<ClassificationStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const CLASSIFICATION_STATUS_TONE: Record<ClassificationStatus, BadgeTone> = {
  proposed: "info",
  accepted: "success",
  rejected: "danger",
};

export const PROCESSING_STATUS_LABEL: Record<AttachmentProcessingStatus, string> = {
  pending: "Pending",
  retryable: "Retryable",
  processed: "Processed",
};

export const PROCESSING_STATUS_TONE: Record<AttachmentProcessingStatus, BadgeTone> = {
  pending: "neutral",
  retryable: "warning",
  processed: "success",
};

export const COMMAND_TYPE_LABEL: Record<CommandType, string> = {
  create_invoice: "Create Invoice",
  create_receipt: "Create Receipt",
  allocate_receipt: "Allocate Receipt",
};

export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  proposed: "Proposed",
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  refused: "Refused",
};

export const COMMAND_STATUS_TONE: Record<CommandStatus, BadgeTone> = {
  proposed: "neutral",
  pending: "neutral",
  running: "info",
  completed: "success",
  failed: "danger",
  refused: "warning",
};

export const EXCEPTION_LIFECYCLE_LABEL: Record<ExceptionLifecycle, string> = {
  open: "Open",
  retryable: "Retryable",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const EXCEPTION_LIFECYCLE_TONE: Record<ExceptionLifecycle, BadgeTone> = {
  open: "danger",
  retryable: "warning",
  resolved: "success",
  dismissed: "muted",
};

/** Readable label for every frozen exception reason code. */
export const EXCEPTION_REASON_LABEL: Record<ExceptionReasonCode, string> = {
  mailbox_not_configured: "Mailbox Not Configured",
  mailbox_reconnect_required: "Mailbox Reconnect Required",
  provider_unavailable: "Provider Unavailable",
  message_duplicate: "Duplicate Message",
  attachment_duplicate: "Duplicate Attachment",
  unsupported_file: "Unsupported File",
  unsafe_file: "Unsafe File",
  encrypted_document: "Encrypted Document",
  oversized_document: "Oversized Document",
  ambiguous_classification: "Ambiguous Classification",
  unsupported_document: "Unsupported Document",
  low_confidence: "Low Confidence",
  extraction_schema_invalid: "Extraction Schema Invalid",
  arithmetic_mismatch: "Arithmetic Mismatch",
  currency_unsupported: "Unsupported Currency",
  fx_reference_unavailable: "FX Reference Unavailable",
  customer_unresolved: "Customer Unresolved",
  customer_ambiguous: "Customer Ambiguous",
  invoice_conflict: "Invoice Conflict",
  receipt_conflict: "Receipt Conflict",
  critical_identifier_unverified: "Critical Identifier Unverified",
  missing_salesman: "Missing Sales Representative",
  invalid_salesman_email: "Invalid Sales Representative Email",
  allocation_evidence_insufficient: "Allocation Evidence Insufficient",
  allocation_currency_mismatch: "Allocation Currency Mismatch",
  allocation_conflict: "Allocation Conflict",
  concurrency_conflict: "Concurrency Conflict",
  provider_delivery_failed: "Provider Delivery Failed",
  internal_processing_failure: "Internal Processing Failure",
};

/**
 * Safe label for an exception reason code. The DTO returns `reason_code` as a
 * bounded string (not a strict enum), so an unknown/new code is humanized
 * rather than rendered raw or crashing.
 */
export function exceptionReasonLabel(code: string): string {
  const known = (EXCEPTION_REASON_LABEL as Record<string, string>)[code];
  if (known) return known;
  return code
    .split(/[_.]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export const REMINDER_STATUS_LABEL: Record<ReminderStatus, string> = {
  pending: "Pending",
  sending: "Sending",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const REMINDER_STATUS_TONE: Record<ReminderStatus, BadgeTone> = {
  pending: "neutral",
  sending: "info",
  delivered: "success",
  failed: "danger",
  cancelled: "muted",
};

export const REMINDER_ATTEMPT_STATUS_LABEL: Record<ReminderAttemptStatus, string> = {
  pending: "Pending",
  sending: "Sending",
  sent: "Sent",
  retryable_failure: "Retryable Failure",
  permanent_failure: "Permanent Failure",
};

export const REMINDER_ATTEMPT_STATUS_TONE: Record<ReminderAttemptStatus, BadgeTone> = {
  pending: "neutral",
  sending: "info",
  sent: "success",
  retryable_failure: "warning",
  permanent_failure: "danger",
};

export const ASSIGNMENT_SOURCE_LABEL: Record<AssignmentSource, string> = {
  customer_acquisition: "Customer Acquisition",
  customer_onboarding: "Customer Onboarding",
  manual_assignment: "Manual Assignment",
  import: "Import",
};

export const PROVIDER_LABEL: Record<ProviderType, string> = {
  gmail: "Gmail / Google Workspace",
  microsoft: "Microsoft Outlook / 365",
};

/** Kill-switch keys → readable names shown on the Overview and Settings pages. */
export const KILL_SWITCH_LABEL: Record<string, string> = {
  mailbox_sync_enabled: "Mailbox Synchronization",
  document_intelligence_enabled: "Document Intelligence",
  invoice_automation_enabled: "Invoice Automation",
  receipt_automation_enabled: "Receipt Automation",
  auto_allocation_enabled: "Auto-Allocation",
  reminder_evaluation_enabled: "Reminder Evaluation",
  reminder_delivery_enabled: "Reminder Delivery",
};

/** Truthful enabled/disabled wording for a boolean kill switch. */
export function switchStatusLabel(enabled: boolean): {
  label: string;
  tone: BadgeTone;
} {
  return enabled
    ? { label: "Enabled", tone: "success" }
    : { label: "Disabled", tone: "muted" };
}
