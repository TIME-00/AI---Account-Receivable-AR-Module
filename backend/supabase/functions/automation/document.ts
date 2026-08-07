import { BusinessError, ValidationError } from "../_shared/errors.ts";
import { validateOperationalCurrencyForWrite } from "../_shared/validators.ts";
import type {
  ClassificationCandidate,
  FinancialExtraction,
  InvoiceExtraction,
  ReceiptExtraction,
} from "./contract.ts";
import { assertExactKeys } from "./contract.ts";

export interface DocumentInput {
  file_name: string;
  detected_mime_type: string;
  sha256: string;
  bytes: Uint8Array;
  untrusted_text?: string;
}

export interface DocumentIntelligenceResult {
  classification: ClassificationCandidate;
  extraction: FinancialExtraction | null;
  field_confidence: Record<string, number>;
}

export interface DocumentIntelligenceProvider {
  readonly name: string;
  readonly enabled: boolean;
  analyze(input: DocumentInput): Promise<DocumentIntelligenceResult>;
}

export class DisabledDocumentIntelligenceProvider
  implements DocumentIntelligenceProvider {
  readonly name = "disabled";
  readonly enabled = false;
  analyze(_input: DocumentInput): Promise<DocumentIntelligenceResult> {
    return Promise.reject(
      new BusinessError(
        "DOCUMENT_INTELLIGENCE_DISABLED",
        "Document intelligence is disabled.",
        409,
      ),
    );
  }
}

export class FixtureDocumentIntelligenceProvider
  implements DocumentIntelligenceProvider {
  readonly name = "deterministic_fixture";
  readonly enabled = true;
  constructor(private readonly result: DocumentIntelligenceResult) {}
  analyze(_input: DocumentInput): Promise<DocumentIntelligenceResult> {
    return Promise.resolve(structuredClone(this.result));
  }
}

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function decimal(
  value: unknown,
  field: string,
  options: {
    maximumIntegerDigits: number;
    maximumFractionDigits: number;
    minimum: "positive" | "non_negative";
  },
): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new ValidationError(`${field} must be a decimal string.`, { field });
  }
  const [whole, fraction = ""] = value.split(".");
  if (
    whole.replace("-", "").length > options.maximumIntegerDigits ||
    fraction.length > options.maximumFractionDigits
  ) {
    throw new ValidationError(`${field} exceeds supported precision.`, {
      field,
    });
  }
  const scale = 10n ** BigInt(fraction.length);
  const minor = BigInt(whole) * scale +
    BigInt(`${whole.startsWith("-") ? "-" : ""}${fraction || "0"}`);
  if (options.minimum === "positive" && minor <= 0n) {
    throw new ValidationError(`${field} must be positive.`, { field });
  }
  if (options.minimum === "non_negative" && minor < 0n) {
    throw new ValidationError(`${field} must not be negative.`, { field });
  }
  return value;
}

function minorUnits(value: string, scale = 4): bigint {
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = normalized.split(".");
  const units = BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, "0").slice(0, scale));
  return negative ? -units : units;
}

function roundedLineTotalMinorUnits(
  quantity: string,
  unitPrice: string,
): bigint {
  // Quantity permits 3 decimals and unit price permits 4. Their positive
  // product therefore has scale 7. PostgreSQL NUMERIC and the governed
  // Invoice calculator round the resulting line amount half-up to 2 decimals.
  const product = minorUnits(quantity, 3) * minorUnits(unitPrice, 4);
  return (product + 50_000n) / 100_000n;
}

function date(value: unknown, field: string): string {
  const parsed = typeof value === "string"
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (
    typeof value !== "string" || !DATE.test(value) ||
    !parsed || Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date.`, {
      field,
    });
  }
  return value;
}

function customerCandidate(value: unknown, allowEmpty = false): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("customer candidate must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  assertExactKeys(candidate, [
    "customer_code",
    "registration_identifier",
    "email",
    "company_name",
    "invoice_reference",
  ]);
  const fields = [
    candidate.customer_code,
    candidate.registration_identifier,
    candidate.email,
    candidate.company_name,
    candidate.invoice_reference,
  ].filter((item) => typeof item === "string" && item.trim().length > 0);
  if (fields.length === 0 && !allowEmpty) {
    throw new ValidationError(
      "At least one deterministic customer identifier is required.",
    );
  }
  for (
    const [field, item] of Object.entries(candidate)
  ) {
    if (
      item !== undefined &&
      (typeof item !== "string" || item.trim().length === 0 ||
        item.trim().length > 254)
    ) {
      throw new ValidationError(`${field} is invalid.`);
    }
  }
}

function validateInvoice(extraction: InvoiceExtraction): InvoiceExtraction {
  assertExactKeys(extraction as unknown as Record<string, unknown>, [
    "schema_version",
    "document_type",
    "customer",
    "invoice_date",
    "due_date",
    "currency",
    "reference_no",
    "subtotal",
    "tax_total",
    "total",
    "lines",
  ]);
  if (
    extraction.schema_version !== 1 || extraction.document_type !== "invoice"
  ) {
    throw new ValidationError("Invoice extraction schema is unsupported.");
  }
  customerCandidate(extraction.customer);
  date(extraction.invoice_date, "invoice_date");
  date(extraction.due_date, "due_date");
  if (extraction.due_date < extraction.invoice_date) {
    throw new ValidationError("due_date must not precede invoice_date.");
  }
  if (!CURRENCY.test(extraction.currency)) {
    throw new ValidationError("currency is invalid.");
  }
  validateOperationalCurrencyForWrite(extraction.currency);
  decimal(extraction.subtotal, "subtotal", {
    maximumIntegerDigits: 16,
    maximumFractionDigits: 2,
    minimum: "non_negative",
  });
  decimal(extraction.tax_total, "tax_total", {
    maximumIntegerDigits: 16,
    maximumFractionDigits: 2,
    minimum: "non_negative",
  });
  decimal(extraction.total, "total", {
    maximumIntegerDigits: 16,
    maximumFractionDigits: 2,
    minimum: "positive",
  });
  if (
    !Array.isArray(extraction.lines) || extraction.lines.length === 0 ||
    extraction.lines.length > 500
  ) {
    throw new ValidationError(
      "Invoice extraction requires 1 to 500 line items.",
    );
  }
  if (
    extraction.reference_no !== undefined &&
    (typeof extraction.reference_no !== "string" ||
      extraction.reference_no.trim().length === 0 ||
      extraction.reference_no.trim().length > 100)
  ) {
    throw new ValidationError("reference_no is invalid.");
  }
  let linesTotal = 0n;
  for (const line of extraction.lines) {
    assertExactKeys(line as unknown as Record<string, unknown>, [
      "description",
      "quantity",
      "unit_price",
      "line_total",
    ]);
    if (
      !line || typeof line.description !== "string" ||
      !line.description.trim() || line.description.trim().length > 500
    ) {
      throw new ValidationError("Invoice line description is required.");
    }
    decimal(line.quantity, "quantity", {
      maximumIntegerDigits: 9,
      maximumFractionDigits: 3,
      minimum: "positive",
    });
    decimal(line.unit_price, "unit_price", {
      maximumIntegerDigits: 14,
      maximumFractionDigits: 4,
      minimum: "non_negative",
    });
    decimal(line.line_total, "line_total", {
      maximumIntegerDigits: 16,
      maximumFractionDigits: 2,
      minimum: "non_negative",
    });
    if (
      roundedLineTotalMinorUnits(line.quantity, line.unit_price) !==
        minorUnits(line.line_total, 2)
    ) {
      throw new BusinessError(
        "ARITHMETIC_MISMATCH",
        "Invoice line quantity and unit price do not reconcile.",
      );
    }
    linesTotal += minorUnits(line.line_total);
  }
  if (
    minorUnits(extraction.subtotal) + minorUnits(extraction.tax_total) !==
      minorUnits(extraction.total)
  ) {
    throw new BusinessError(
      "ARITHMETIC_MISMATCH",
      "Invoice subtotal, tax, and total do not reconcile.",
    );
  }
  if (linesTotal !== minorUnits(extraction.subtotal)) {
    throw new BusinessError(
      "ARITHMETIC_MISMATCH",
      "Invoice lines do not reconcile to subtotal.",
    );
  }
  return extraction;
}

function validateReceipt(extraction: ReceiptExtraction): ReceiptExtraction {
  assertExactKeys(extraction as unknown as Record<string, unknown>, [
    "schema_version",
    "document_type",
    "customer",
    "receipt_date",
    "currency",
    "amount",
    "payment_method",
    "reference_no",
    "invoice_references",
  ]);
  if (
    extraction.schema_version !== 1 || extraction.document_type !== "receipt"
  ) {
    throw new ValidationError("Receipt extraction schema is unsupported.");
  }
  customerCandidate(
    extraction.customer,
    Array.isArray(extraction.invoice_references) &&
      extraction.invoice_references.length > 0,
  );
  date(extraction.receipt_date, "receipt_date");
  if (!CURRENCY.test(extraction.currency)) {
    throw new ValidationError("currency is invalid.");
  }
  validateOperationalCurrencyForWrite(extraction.currency);
  decimal(extraction.amount, "amount", {
    maximumIntegerDigits: 16,
    maximumFractionDigits: 2,
    minimum: "positive",
  });
  if (
    extraction.reference_no !== undefined &&
    (typeof extraction.reference_no !== "string" ||
      extraction.reference_no.trim().length === 0 ||
      extraction.reference_no.trim().length > 100)
  ) {
    throw new ValidationError("reference_no is invalid.");
  }
  if (
    !["CHQ", "TT", "CASH", "CC", "GIRO", "OFST", "ONLN"].includes(
      extraction.payment_method,
    )
  ) {
    throw new ValidationError("payment_method is unsupported.");
  }
  if (
    !Array.isArray(extraction.invoice_references) ||
    extraction.invoice_references.length > 100 ||
    extraction.invoice_references.some((reference) =>
      typeof reference !== "string" || reference.trim().length === 0 ||
      reference.trim().length > 100
    )
  ) {
    throw new ValidationError("invoice_references must be a bounded array.");
  }
  extraction.invoice_references = [
    ...new Set(
      extraction.invoice_references.map((reference) => reference.trim()),
    ),
  ];
  if (extraction.reference_no !== undefined) {
    extraction.reference_no = extraction.reference_no.trim();
  }
  return extraction;
}

export function validateDocumentResult(
  result: DocumentIntelligenceResult,
  thresholds = { overall: 0.95, critical: 0.99 },
): DocumentIntelligenceResult {
  assertExactKeys(result as unknown as Record<string, unknown>, [
    "classification",
    "extraction",
    "field_confidence",
  ], ["classification", "extraction", "field_confidence"]);
  const classification = result.classification;
  if (!classification || typeof classification !== "object") {
    throw new BusinessError(
      "EXTRACTION_SCHEMA_INVALID",
      "Document provider returned an invalid classification.",
    );
  }
  assertExactKeys(classification as unknown as Record<string, unknown>, [
    "schema_version",
    "document_type",
    "confidence",
    "critical_field_confidence",
    "provider",
    "model",
    "provider_version",
    "trace_id",
  ]);
  if (
    classification.schema_version !== 1 ||
    !["invoice", "receipt", "payment_advice", "unsupported", "ambiguous"]
      .includes(
        classification.document_type,
      ) ||
    !Number.isFinite(classification.confidence) ||
    !Number.isFinite(classification.critical_field_confidence) ||
    classification.confidence < 0 ||
    classification.confidence > 1 ||
    classification.critical_field_confidence < 0 ||
    classification.critical_field_confidence > 1
  ) {
    throw new BusinessError(
      "EXTRACTION_SCHEMA_INVALID",
      "Document provider returned an invalid classification.",
    );
  }
  if (
    typeof classification.provider !== "string" ||
    classification.provider.length === 0 ||
    classification.provider.length > 100 ||
    typeof classification.model !== "string" ||
    classification.model.length === 0 ||
    classification.model.length > 100 ||
    typeof classification.provider_version !== "string" ||
    classification.provider_version.length === 0 ||
    classification.provider_version.length > 100 ||
    typeof classification.trace_id !== "string" ||
    classification.trace_id.length === 0 ||
    classification.trace_id.length > 200 ||
    !result.field_confidence ||
    typeof result.field_confidence !== "object" ||
    Array.isArray(result.field_confidence) ||
    Object.keys(result.field_confidence).length > 200 ||
    Object.keys(result.field_confidence).some((field) =>
      field.length === 0 || field.length > 100
    ) ||
    Object.values(result.field_confidence).some((confidence) =>
      !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    )
  ) {
    throw new BusinessError(
      "EXTRACTION_SCHEMA_INVALID",
      "Document provider traceability or confidence data was invalid.",
    );
  }
  if (
    classification.confidence < thresholds.overall ||
    classification.critical_field_confidence < thresholds.critical
  ) {
    throw new BusinessError(
      "LOW_CONFIDENCE",
      "Document confidence is below the automation threshold.",
    );
  }
  if (classification.document_type === "invoice") {
    if (!result.extraction || result.extraction.document_type !== "invoice") {
      throw new BusinessError(
        "EXTRACTION_SCHEMA_INVALID",
        "Invoice extraction is missing.",
      );
    }
    validateInvoice(result.extraction);
  } else if (classification.document_type === "receipt") {
    if (!result.extraction || result.extraction.document_type !== "receipt") {
      throw new BusinessError(
        "EXTRACTION_SCHEMA_INVALID",
        "Receipt extraction is missing.",
      );
    }
    validateReceipt(result.extraction);
  } else if (result.extraction !== null) {
    throw new BusinessError(
      "EXTRACTION_SCHEMA_INVALID",
      "Unsupported or ambiguous documents must not contain a financial command extraction.",
    );
  }
  return result;
}

export interface CustomerResolutionCandidate {
  id: string;
  customer_code: string;
  registration_identifier: string | null;
  email: string | null;
  customer_name: string;
}

export function resolveCustomerDeterministically(
  extracted: FinancialExtraction["customer"],
  candidates: readonly CustomerResolutionCandidate[],
): { customer_id: string; method: string } {
  const normalizedName = extracted.company_name?.trim().toLocaleLowerCase("en");
  const rules: Array<
    [string, (candidate: CustomerResolutionCandidate) => boolean]
  > = [
    ["customer_code", (c) =>
      Boolean(extracted.customer_code) &&
      c.customer_code === extracted.customer_code?.trim()],
    [
      "registration_identifier",
      (c) =>
        Boolean(extracted.registration_identifier) &&
        c.registration_identifier === extracted.registration_identifier?.trim(),
    ],
    ["known_email", (c) =>
      Boolean(extracted.email) &&
      c.email?.toLowerCase() === extracted.email?.trim().toLowerCase()],
    ["unique_normalized_name", (c) =>
      Boolean(normalizedName) &&
      c.customer_name.trim().toLocaleLowerCase("en") === normalizedName],
  ];
  for (const [method, predicate] of rules) {
    const matches = candidates.filter(predicate);
    if (matches.length === 1) return { customer_id: matches[0].id, method };
    if (matches.length > 1) {
      throw new BusinessError(
        "CUSTOMER_AMBIGUOUS",
        "Customer resolution is ambiguous.",
      );
    }
  }
  throw new BusinessError(
    "CUSTOMER_UNRESOLVED",
    "Customer could not be resolved.",
  );
}

export function assertProviderTextIsDataOnly(input: DocumentInput): void {
  if (input.untrusted_text && input.untrusted_text.length > 2_000_000) {
    throw new ValidationError(
      "Document text exceeds the bounded extraction input.",
    );
  }
  // Deliberately no instruction parsing or tool execution. Untrusted text is
  // passed only to schema-bound providers and deterministic validators.
}
