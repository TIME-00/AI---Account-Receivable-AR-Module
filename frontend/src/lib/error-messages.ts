// ============================================================================
// TSH Synergy AR — BR-xxx Error Code → User Message Map
// Maps backend business rule error codes to human-friendly English messages
// ============================================================================

import { SUPPORTED_TRANSACTION_CURRENCIES } from "@/lib/currency";

export const BR_ERROR_MAP: Record<string, string> = {
  // ── Customer (Part 1) ──
  "BR-CUS-001": "Customer is Inactive. New invoices or sales orders are not permitted.",
  "BR-CUS-002": "Customer is Blocked. All new transactions are frozen. View-only access allowed.",
  "BR-CUS-003": "Customer has outstanding balances and cannot be deleted.",
  "BR-CUS-STATUS": "Invalid customer status transition.",
  "BR-CUS-UNBLOCK": "Unblocking a customer requires Finance Manager authorization.",

  // ── Credit Management (Part 1 §3) ──
  "BR-CM-001": "Credit limit exceeded. Please contact Finance Manager for override approval.",
  "BR-CM-002": "Credit limit adjustment exceeds AR Supervisor authority (±20%). Please escalate to Finance Manager.",
  "BR-CM-003": "Customer credit rating is D (Frozen). New invoices and order confirmations are blocked.",

  // ── Invoice (Part 2) ──
  "BR-INV-001": "Posted invoices are immutable. Only remarks and reference number may be modified.",
  "BR-INV-002": "Invoice posting validation failed. Please review line items and GL account configuration.",
  "BR-INV-003": "Invoice has active allocations and cannot be cancelled.",
  "BR-INV-004": "Invoice is partially allocated. Please reverse allocations first, or issue a Credit Note.",

  // ── Credit Note (Part 2 §4) ──
  "BR-CN-001": "Credit Note amount exceeds the original invoice outstanding balance.",
  "BR-CN-002": "Cumulative Credit Note total exceeds the original invoice amount.",
  "BR-CN-REF": "Original invoice status is invalid for issuing a Linked Credit Note.",
  "BR-CN-STATUS": "Only Draft Credit Notes can be posted.",

  // ── Receipt (Part 3) ──
  "BR-RCT-001": "Receipt posting validation failed. Please check all required fields.",

  // ── Allocation (Part 3 §4) ──
  "BR-REC-001": "Allocation prerequisites not met. Please verify receipt and invoice statuses.",
  "BR-REC-002": "Allocation amount validation failed.",
  "BR-REC-003": "Receipt currency does not match invoice currency. Cross-currency allocation requires manual processing.",

  // ── Account Mapping (Part 1 §5) ──
  "BR-AM-001": "AR control account is not configured. Please contact your system administrator.",
  "BR-AM-004": "Referenced GL account is closed or does not exist.",

  // ── Payment Terms (Part 1 §4) ──
  "BR-PT-004": "Customer has prepaid terms. Unapplied receipt balance is insufficient for this invoice.",

  // ── Journal Entry (Part 5) ──
  "BR-JE-007": "Fiscal period is not open. Cannot post. Please contact Finance Manager to open the period.",

  // ── Currency & FX (Post-Gate-E) ──
  // Codes are read from the currency-policy module so this message can never
  // disagree with the allow-list the selectors and the backend enforce.
  "UNSUPPORTED_TRANSACTION_CURRENCY":
    `New AR documents can only be created in ${SUPPORTED_TRANSACTION_CURRENCIES.join(" or ")}. ` +
    "Existing records in other currencies remain viewable and reportable.",
  "FX_REFERENCE_UNAVAILABLE":
    "An authoritative reference exchange rate is not available for this transaction date. Try a different date, or use a governed manual override if permitted.",

  // ── Generic ──
  "VALIDATION_ERROR": "Request validation failed. Please check your input.",
  "AUTHORIZATION_ERROR": "Insufficient permissions. Your role cannot perform this action.",
  "AUTHENTICATION_ERROR": "Session expired. Please sign in again.",
  "NOT_FOUND": "The requested record does not exist or has been deleted.",
  "CONFLICT": "This record was modified by another user. Please refresh and try again.",
  "INTERNAL_ERROR": "Internal server error. Please try again later.",
  "DUPLICATE_CUSTOMER": "Customer ID conflict. Please retry.",
};

/**
 * Get a user-friendly error message for a given error code.
 * Falls back to the raw message if no mapping exists.
 */
export function getErrorMessage(code: string, fallbackMessage?: string): string {
  return BR_ERROR_MAP[code] ?? fallbackMessage ?? `Operation failed (${code})`;
}
