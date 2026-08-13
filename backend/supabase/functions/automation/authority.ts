// Pure, deterministic Automation authority and provider-boundary helpers.
// Kept outside the orchestration service so financial/reference/OAuth validation
// remains independently testable and cannot be mixed with persistence code.

import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { validateUUID } from "../_shared/validators.ts";
import {
  isSemanticIsoTimestamp,
  type MailboxProviderType,
} from "./contract.ts";
import type { ProviderMessage } from "./providers.ts";

type Row = Record<string, unknown>;

const MAX_ATTACHMENTS_PER_MESSAGE = 100;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function customerResolutionFailureMayRecover(
  validationCodes: readonly string[],
): boolean {
  return validationCodes.some((code) =>
    code === "customer_unresolved" ||
    code === "customer_ambiguous" ||
    code === "internal_processing_failure"
  );
}

export function isAutomationExceptionIdempotencyConflict(
  error: unknown,
): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "23505" &&
    typeof record.message === "string" &&
    record.message.includes("uq_automation_exception_idempotency");
}

export function assertProviderMessageBounded(message: ProviderMessage): void {
  const bounded = (value: string | null, max: number) =>
    value === null || (value.length > 0 && value.length <= max);
  const received = new Date(message.received_at);
  if (
    !bounded(message.provider_message_id, 512) ||
    !bounded(message.provider_thread_id, 512) ||
    !bounded(message.internet_message_id, 998) ||
    !bounded(message.sender_address, 512) ||
    !bounded(message.subject, 998) ||
    !bounded(message.mime_type, 255) ||
    !bounded(message.revision, 512) ||
    Number.isNaN(received.getTime()) ||
    received.toISOString() !== message.received_at ||
    !Array.isArray(message.attachments) ||
    message.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE ||
    message.attachments.some((attachment) =>
      !bounded(attachment.provider_attachment_id, 512) ||
      !bounded(attachment.file_name, 255) ||
      !bounded(attachment.content_type, 255) ||
      !Number.isInteger(attachment.size) ||
      attachment.size < 0 ||
      attachment.size > MAX_ATTACHMENT_BYTES ||
      (attachment.bytes !== undefined &&
        attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    )
  ) {
    throw new BusinessError(
      "PROVIDER_RESPONSE_INVALID",
      "Mailbox provider message metadata was invalid.",
      502,
    );
  }
}

export function deliverySecretReference(mailboxId: string): string {
  validateUUID(mailboxId, "mailbox_id");
  return `AR_DELIVERY_${mailboxId.replaceAll("-", "").toUpperCase()}`;
}

export function tokenExpiryIsCurrent(value: unknown, now: Date): boolean {
  if (!isSemanticIsoTimestamp(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function mailboxCapabilityIsReady(
  row: Row,
  capability: "ingestion" | "delivery",
  now: Date,
  adapterReady: boolean,
): boolean {
  return adapterReady &&
    (capability === "delivery" || row.is_enabled === true) &&
    (capability === "delivery"
      ? row.delivery_reconnect_required === false
      : row.connection_status === "connected" &&
        row.reconnect_required === false) &&
    row[`${capability}_enabled`] === true &&
    typeof row[`${capability}_secret_ref`] === "string" &&
    String(row[`${capability}_secret_ref`]).trim().length > 0 &&
    tokenExpiryIsCurrent(row[`${capability}_token_expires_at`], now);
}

export function monetaryMinorUnits(value: unknown): bigint {
  const text = String(value);
  if (!/^-?(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(text)) {
    throw new BusinessError(
      "FINANCIAL_AMOUNT_INVALID",
      "Authoritative monetary value was invalid.",
      500,
    );
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -minor : minor;
}

export function minorUnitsDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${
    (absolute % 100n).toString().padStart(2, "0")
  }`;
}

export function exactAutomationDecimalNumber(
  value: string,
  scale: number,
  field: string,
): number {
  if (
    !Number.isInteger(scale) || scale < 0 || scale > 6 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  ) {
    throw new ValidationError(`${field} is not an exact decimal value.`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw new ValidationError(`${field} exceeds supported precision.`);
  }
  const canonical = scale === 0
    ? BigInt(whole).toString()
    : `${BigInt(whole)}.${fraction.padEnd(scale, "0")}`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric.toFixed(scale) !== canonical) {
    throw new ValidationError(
      `${field} cannot be represented exactly by the authoritative creation contract.`,
    );
  }
  return numeric;
}

export type AutomaticAllocationPlan =
  | {
    ok: true;
    evidence_type:
      | "exact_invoice_reference"
      | "exact_amount_single_invoice"
      | "explicit_partial_reference"
      | "explicit_multi_invoice_references";
    evidence: {
      invoice_references: string[];
      payment_reference: string | null;
      source: "document_extraction_v1";
    };
    allocations: Array<
      { invoice_id: string; amount: string; discount_amount: "0.00" }
    >;
  }
  | { ok: false; error_code: string };

type AutomaticAllocationEvidenceType =
  | "exact_invoice_reference"
  | "exact_amount_single_invoice"
  | "explicit_partial_reference"
  | "explicit_multi_invoice_references";

export type ReceiptInvoiceReferenceAuthorityResult =
  | { ok: true; status: "not_required" | "corroborated"; invoices: Row[] }
  | {
    ok: false;
    status: "unverified";
    unverified_fields: ["invoice_reference"];
    error_code:
      | "INVOICE_REFERENCE_NOT_FOUND"
      | "INVOICE_REFERENCE_AMBIGUOUS"
      | "INVOICE_REFERENCE_DUPLICATE_TARGET"
      | "INVOICE_REFERENCE_CANDIDATE_LIMIT_EXCEEDED";
  };

export function resolveReceiptInvoiceReferenceAuthority(
  invoiceReferences: readonly string[],
  eligibleInvoices: readonly Row[],
  boundary: { company_id: string; customer_id: string; currency: string },
): ReceiptInvoiceReferenceAuthorityResult {
  const references = [
    ...new Set(invoiceReferences.map((value) => value.trim()).filter(Boolean)),
  ];
  if (references.length === 0) {
    return { ok: true, status: "not_required", invoices: [] };
  }
  const candidates = [...new Map(
    eligibleInvoices.filter((invoice) =>
      String(invoice.company_id) === boundary.company_id &&
      String(invoice.customer_id) === boundary.customer_id &&
      String(invoice.currency) === boundary.currency &&
      ["Open", "Overdue", "Partially Paid"].includes(String(invoice.status)) &&
      monetaryMinorUnits(invoice.outstanding) > 0n
    ).map((invoice) => [String(invoice.id), invoice]),
  ).values()];
  const resolvedInvoiceIds = new Set<string>();
  const resolved: Row[] = [];
  for (const reference of references) {
    const matches = candidates.filter((invoice) =>
      String(invoice.invoice_no ?? "") === reference ||
      String(invoice.reference_no ?? "") === reference
    );
    if (matches.length === 0) {
      return {
        ok: false,
        status: "unverified",
        unverified_fields: ["invoice_reference"],
        error_code: "INVOICE_REFERENCE_NOT_FOUND",
      };
    }
    if (matches.length !== 1) {
      return {
        ok: false,
        status: "unverified",
        unverified_fields: ["invoice_reference"],
        error_code: "INVOICE_REFERENCE_AMBIGUOUS",
      };
    }
    const invoiceId = String(matches[0].id);
    if (resolvedInvoiceIds.has(invoiceId)) {
      return {
        ok: false,
        status: "unverified",
        unverified_fields: ["invoice_reference"],
        error_code: "INVOICE_REFERENCE_DUPLICATE_TARGET",
      };
    }
    resolvedInvoiceIds.add(invoiceId);
    resolved.push({ ...matches[0], matched_reference: reference });
  }
  return { ok: true, status: "corroborated", invoices: resolved };
}

export function assertAutomaticAllocationCommandEligible(command: Row): void {
  if (
    command.command_type !== "create_receipt" ||
    command.status !== "completed" || !command.resulting_receipt_id
  ) {
    throw new BusinessError(
      "ALLOCATION_EVIDENCE_INSUFFICIENT",
      "Only a completed automated Receipt command can be allocated.",
      409,
    );
  }
}

export function buildAutomaticAllocationPlan(input: {
  receipt_unallocated: unknown;
  invoice_references: readonly string[];
  payment_reference?: string;
  invoices: readonly Row[];
}): AutomaticAllocationPlan {
  const available = monetaryMinorUnits(input.receipt_unallocated);
  if (available <= 0n) {
    return { ok: false, error_code: "NO_UNALLOCATED_AMOUNT" };
  }
  const references = [
    ...new Set(
      input.invoice_references.map((value) => value.trim()).filter(Boolean),
    ),
  ];
  let evidenceType: AutomaticAllocationEvidenceType;
  if (references.length > 0) {
    const matched = new Set(
      input.invoices.map((invoice) =>
        String(invoice.matched_reference ?? invoice.invoice_no)
      ),
    );
    if (
      input.invoices.length !== references.length ||
      references.some((reference) => !matched.has(reference))
    ) {
      return { ok: false, error_code: "INVOICE_REFERENCE_NOT_EXACT" };
    }
    if (input.invoices.length === 1) {
      const outstanding = monetaryMinorUnits(input.invoices[0].outstanding);
      if (available > outstanding) {
        return { ok: false, error_code: "RECEIPT_EXCEEDS_REFERENCED_INVOICE" };
      }
      evidenceType = available === outstanding
        ? "exact_invoice_reference"
        : "explicit_partial_reference";
    } else {
      const total = input.invoices.reduce(
        (sum, invoice) => sum + monetaryMinorUnits(invoice.outstanding),
        0n,
      );
      if (total !== available) {
        return { ok: false, error_code: "MULTI_REFERENCE_AMOUNT_MISMATCH" };
      }
      evidenceType = "explicit_multi_invoice_references";
    }
  } else {
    if (
      input.invoices.length !== 1 ||
      monetaryMinorUnits(input.invoices[0].outstanding) !== available
    ) {
      return { ok: false, error_code: "EXACT_AMOUNT_NOT_UNAMBIGUOUS" };
    }
    evidenceType = "exact_amount_single_invoice";
  }
  return {
    ok: true,
    evidence_type: evidenceType,
    evidence: {
      invoice_references: references.length > 0
        ? references
        : [String(input.invoices[0].invoice_no)],
      payment_reference: input.payment_reference?.trim() || null,
      source: "document_extraction_v1",
    },
    allocations: input.invoices.map((invoice) => ({
      invoice_id: String(invoice.id),
      amount: references.length === 1
        ? minorUnitsDecimal(available)
        : minorUnitsDecimal(monetaryMinorUnits(invoice.outstanding)),
      discount_amount: "0.00",
    })),
  };
}

export function boundedOAuthAuthorizationUrl(
  provider: MailboxProviderType,
  authorizationUrl: string,
): string {
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    throw new BusinessError(
      "OAUTH_AUTHORIZATION_URL_INVALID",
      "OAuth authorization could not be started safely.",
      500,
    );
  }
  const valid = url.protocol === "https:" &&
    (provider === "gmail"
      ? url.origin === "https://accounts.google.com" &&
        url.pathname === "/o/oauth2/v2/auth"
      : url.origin === "https://login.microsoftonline.com" &&
        /^\/[A-Za-z0-9._~-]+\/oauth2\/v2\.0\/authorize$/.test(url.pathname));
  if (!valid || authorizationUrl.length > 8192) {
    throw new BusinessError(
      "OAUTH_AUTHORIZATION_URL_INVALID",
      "OAuth authorization could not be started safely.",
      500,
    );
  }
  return authorizationUrl;
}
