import { SupabaseClient } from "supabase";
import { getAdminClient } from "../_shared/db.ts";
import {
  AuthorizationError,
  BusinessError,
  ValidationError,
} from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import type {
  CreateCustomerRequest,
  Customer,
  Invoice,
  PaginationParams,
} from "../_shared/types.ts";
import { InvoiceService } from "../invoices/service.ts";
import { ReceiptService } from "../receipts/service.ts";
import { AllocationService } from "../allocations/service.ts";
import { CustomerService } from "../customers/service.ts";

export const BUCKET = "ar-imports";
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_XLSX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 500;
export const READ_ROLES = [
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
  "Auditor",
];
export const WRITE_ROLES = ["AR Clerk", "AR Supervisor", "Finance Manager"];
export const ALLOWED_IMPORT_FILE_TYPES = ["csv", "xlsx"] as const;
export const ALLOWED_IMPORT_TYPES = ["invoice", "receipt"] as const;
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type ImportFileType = typeof ALLOWED_IMPORT_FILE_TYPES[number];
export type ImportType = typeof ALLOWED_IMPORT_TYPES[number];

export type ImportBatchStatus =
  | "Uploaded"
  | "Parsing"
  | "Parsed"
  | "Validating"
  | "Validated"
  | "Executing"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "PendingScan"
  | "Rejected"
  | "Quarantined"
  | "PendingOCR"
  | "OCRFailed"
  | "OCRCompleted"
  | "NeedsReview"
  | "ApprovedDraft";

export type ImportRowStatus =
  | "Pending"
  | "Valid"
  | "Error"
  | "Skipped"
  | "Created"
  | "Posted"
  | "Allocated"
  | "Unmatched"
  | "NeedsReview"
  | "ApprovedDraft"
  | "Rejected";

export interface ImportBatch {
  id: string;
  company_id: string;
  batch_name: string;
  import_type: "invoice" | "receipt";
  file_type: "csv" | "xlsx" | "pdf" | "image";
  file_name: string;
  file_path: string | null;
  status: ImportBatchStatus;
  auto_post: boolean;
  auto_allocate: boolean;
  created_by: string | null;
}

export interface ImportRow {
  id: string;
  batch_id: string;
  row_number: number;
  raw_data: Record<string, unknown>;
  mapped_data: Record<string, unknown> | null;
  status: ImportRowStatus;
  validation_errors: Array<Record<string, unknown>> | null;
  invoice_id: string | null;
  receipt_id: string | null;
}

export interface UploadInput {
  file: File;
  fileType: ImportFileType;
  importType: ImportType;
  batchName?: string;
}

export interface OcrUploadInput {
  file: File;
  fileType: string;
  importType: string;
  batchName?: string;
}

export interface ImportFileRecord {
  id: string;
  batch_id: string;
  file_name: string;
  file_path: string;
  file_type: "csv" | "xlsx" | "pdf" | "image";
  file_size_bytes: number | null;
  content_mime_type: string | null;
  detected_mime_type: string | null;
  file_sha256: string | null;
  page_count: number | null;
  scan_status: string | null;
  scan_result: Record<string, unknown> | null;
  ocr_status: string | null;
  ocr_provider: string | null;
  ocr_result: Record<string, unknown> | null;
}

export interface RowValidationResult {
  mappedData?: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
  status?: ImportRowStatus;
}

export interface ExecuteImportOptions {
  autoPost?: boolean;
}

export interface CustomerResolutionDetails {
  action: "Matched Existing" | "Create New" | "Review Required";
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  matched_by:
    | "customer_code"
    | "normalized_name"
    | "created_in_batch"
    | "fuzzy_suggestion"
    | null;
}

export interface ResolvedImportCustomer {
  customer: Customer;
  created: boolean;
  details: CustomerResolutionDetails;
}

export interface BankAccountResolutionDetails {
  bank_account_id: string;
  account_no: string;
  bank_name: string;
  matched_by: "bank_account_id" | "bank_account_code";
}

export type ReviewAction =
  | "approve_suggestion"
  | "reject_suggestion"
  | "edit_customer"
  | "edit_invoice_reference"
  | "retry_validation";

export interface ReviewRowResult {
  row: ImportRow;
  action: ReviewAction;
  review_result:
    | "approved_pending_retry"
    | "rejected"
    | "edited_pending_retry"
    | "revalidated_valid"
    | "revalidation_failed"
    | "rejected_invalid_selection";
  revalidated: boolean;
  messages: string[];
}

export const REVIEW_AUDIT_FIELDS = [
  "user_action",
  "approved_customer_id",
  "approved_customer_code",
  "approved_customer_name",
  "approved_invoice_id",
  "approved_invoice_no",
  "approved_by",
  "approved_at",
  "edited_customer_id",
  "edited_customer_code",
  "edited_customer_name",
  "edited_invoice_reference",
  "edited_by",
  "edited_at",
  "rejected_at",
  "review_note",
] as const;

export function requireSupervisorOrFinanceManager(auth: AuthContext): void {
  if (!hasAnyRole(auth, ["AR Supervisor", "Finance Manager"])) {
    throw new AuthorizationError(
      "High-risk or low-confidence OCR intake requires AR Supervisor or Finance Manager approval.",
    );
  }
}

export function safeStorageFileName(fileName: string): string {
  return fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function hasAnyRole(auth: AuthContext, allowed: string[]): boolean {
  return auth.roles.some((role) => allowed.includes(role));
}

export function requireImportRead(auth: AuthContext): void {
  if (!hasAnyRole(auth, READ_ROLES)) {
    throw new AuthorizationError(
      "Import data access requires an AR operational role or Auditor.",
    );
  }
}

export function requireImportWrite(auth: AuthContext): void {
  if (!hasAnyRole(auth, WRITE_ROLES)) {
    throw new AuthorizationError(
      "Import execution requires AR Clerk, AR Supervisor, or Finance Manager.",
    );
  }
}

export function asString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

export function parseNumber(value: string, field: string): number {
  const normalized = value.replace(/,/g, "");
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Field "${field}" must be numeric.`, {
      field,
      value,
    });
  }
  return num;
}

export function hasImportValue(
  row: Record<string, unknown>,
  key: string,
): boolean {
  return asString(row, key) !== "";
}

export function importFxGovernanceFields(raw: Record<string, unknown>): {
  exchange_rate?: number;
  fx_override_reason?: string;
} {
  const fields: { exchange_rate?: number; fx_override_reason?: string } = {};

  if (hasImportValue(raw, "exchange_rate")) {
    fields.exchange_rate = parseNumber(
      asString(raw, "exchange_rate"),
      "exchange_rate",
    );
    if (fields.exchange_rate <= 0) {
      throw new ValidationError(
        'Field "exchange_rate" must be greater than 0.',
        {
          field: "exchange_rate",
          value: asString(raw, "exchange_rate"),
        },
      );
    }
  }
  if (hasImportValue(raw, "fx_override_reason")) {
    fields.fx_override_reason = asString(raw, "fx_override_reason");
    if (fields.fx_override_reason.trim().length < 5) {
      throw new ValidationError(
        "fx_override_reason must be at least 5 characters.",
        {
          field: "fx_override_reason",
        },
      );
    }
    if (fields.fx_override_reason.length > 500) {
      throw new ValidationError(
        'Field "fx_override_reason" exceeds maximum length of 500.',
        {
          field: "fx_override_reason",
        },
      );
    }
  }

  return fields;
}

export function importOriginPayload(
  batch: ImportBatch,
  row: ImportRow,
): Record<string, unknown> {
  return {
    source: "csv_xlsx_import",
    batch_id: batch.id,
    row_id: row.id,
    row_number: row.row_number,
    batch_name: batch.batch_name,
    import_type: batch.import_type,
    file_type: batch.file_type,
    file_name: batch.file_name,
    file_path: batch.file_path,
  };
}

export function rowError(
  field: string,
  message: string,
): Record<string, unknown> {
  return { field, message };
}

export function preserveReviewAuditFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!previous) return next;
  const merged = { ...next };
  for (const field of REVIEW_AUDIT_FIELDS) {
    if (previous[field] !== undefined) {
      merged[field] = previous[field];
    }
  }
  return merged;
}

export function isAllowedImportFileType(
  fileType: string,
): fileType is ImportFileType {
  return ALLOWED_IMPORT_FILE_TYPES.includes(fileType as ImportFileType);
}

export function isAllowedImportType(
  importType: string,
): importType is ImportType {
  return ALLOWED_IMPORT_TYPES.includes(importType as ImportType);
}

export function requireSupportedImportBatch(
  batch: ImportBatch,
  stage: string,
): ImportFileType {
  if (!isAllowedImportType(batch.import_type)) {
    throw new ValidationError(
      `Sprint F4 ${stage} supports invoice and receipt imports only.`,
    );
  }
  if (!isAllowedImportFileType(batch.file_type)) {
    throw new ValidationError(
      `Sprint F4 ${stage} supports csv and xlsx files only.`,
    );
  }

  return batch.file_type;
}

export function mimeForImportFile(
  fileType: ImportFileType,
  browserMime: string,
): string {
  if (browserMime) return browserMime;
  return fileType === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
}

export function errorToRowErrors(
  error: unknown,
): Array<Record<string, unknown>> {
  if (error instanceof ValidationError) {
    return [rowError(String(error.details.field ?? "row"), error.message)];
  }
  if (error instanceof BusinessError) {
    return [rowError("business_rule", error.message)];
  }
  if (error instanceof AuthorizationError) {
    return [rowError("authorization", error.message)];
  }
  if (error instanceof Error) {
    return [rowError("row", error.message)];
  }
  return [rowError("row", "Unknown validation error")];
}
export abstract class ImportServiceBase {
  protected client: SupabaseClient;
  protected invoiceService: InvoiceService;
  protected receiptService: ReceiptService;
  protected allocationService: AllocationService;
  protected customerService: CustomerService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.invoiceService = new InvoiceService(this.client);
    this.receiptService = new ReceiptService(this.client);
    this.allocationService = new AllocationService(this.client);
    this.customerService = new CustomerService(this.client);
  }

  abstract uploadFile(
    auth: AuthContext,
    input: UploadInput,
  ): Promise<ImportBatch>;

  abstract uploadOcrIntakeFile(
    auth: AuthContext,
    input: OcrUploadInput,
  ): Promise<
    {
      batch: ImportBatch;
      file: ImportFileRecord;
      row: ImportRow;
      manual_fallback: boolean;
    }
  >;

  abstract createOcrPreviewUrl(
    auth: AuthContext,
    batchId: string,
    fileId: string,
  ): Promise<{ signed_url: string; expires_in_seconds: number }>;

  abstract startOcr(
    auth: AuthContext,
    batchId: string,
    fileId: string,
  ): Promise<Record<string, unknown>>;

  abstract listOcrReviewItems(
    auth: AuthContext,
    batchId: string,
  ): Promise<
    { batch: ImportBatch; files: ImportFileRecord[]; rows: ImportRow[] }
  >;

  abstract saveOcrReview(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<{ row: ImportRow; decisions_recorded: number }>;

  abstract approveOcrDraft(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<{ batch: ImportBatch; row: ImportRow; message: string }>;

  abstract parseBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }>;

  abstract validateBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }>;

  abstract executeDraftCreation(
    auth: AuthContext,
    batchId: string,
    options?: ExecuteImportOptions,
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }>;

  abstract listBatches(
    auth: AuthContext,
    pagination: PaginationParams,
  ): Promise<{ batches: ImportBatch[]; total: number }>;

  abstract getBatch(auth: AuthContext, batchId: string): Promise<ImportBatch>;

  abstract listRows(
    auth: AuthContext,
    batchId: string,
    pagination: PaginationParams,
  ): Promise<{ rows: ImportRow[]; total: number }>;

  protected abstract getImportFile(
    batchId: string,
    fileId: string,
  ): Promise<ImportFileRecord>;

  abstract reviewRow(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<ReviewRowResult>;

  protected abstract fetchReviewableRow(
    batchId: string,
    rowId: string,
  ): Promise<ImportRow>;

  protected abstract parseReviewAction(action: unknown): ReviewAction;

  protected abstract reviewNote(value: unknown): string | undefined;

  protected abstract reviewedFields(value: unknown): Record<string, unknown>;

  protected abstract insertOcrReviewDecisions(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    fileId: string | null,
    reviewedFields: Record<string, unknown>,
    decision: "reviewed" | "approved_draft" | "rejected",
    note?: string,
  ): Promise<void>;

  protected abstract applyApproveSuggestion(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult>;

  protected abstract applyRejectSuggestion(
    row: ImportRow,
    reviewNote?: string,
  ): Promise<ReviewRowResult>;

  protected abstract applyEditCustomer(
    auth: AuthContext,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult>;

  protected abstract applyEditInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult>;

  protected abstract revalidateReviewRow(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
  ): Promise<ReviewRowResult>;

  protected abstract updateReviewRow(
    rowId: string,
    patch: Record<string, unknown>,
  ): Promise<ImportRow>;

  protected abstract refreshBatchCounters(batchId: string): Promise<void>;

  protected abstract optionalUUID(
    value: unknown,
    field: string,
  ): string | undefined;

  protected abstract findCandidateById(
    mappedData: Record<string, unknown>,
    keys: string[],
    id: string,
    idField: string,
  ): Record<string, unknown> | null;

  protected abstract resolveVisibleCustomerById(
    auth: AuthContext,
    customerId: string,
  ): Promise<Customer>;

  protected abstract resolveVisibleCustomerByCode(
    auth: AuthContext,
    customerCode: string,
  ): Promise<Customer>;

  protected abstract resolveReviewCustomerFromRaw(
    auth: AuthContext,
    rawData: Record<string, unknown>,
  ): Promise<Customer>;

  protected abstract resolveReviewInvoice(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    rawData: Record<string, unknown>,
    invoiceId: string,
  ): Promise<Invoice>;

  protected abstract inspectEditedInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    invoiceReference: string,
  ): Promise<{ blocking: boolean; reason?: string; message?: string }>;

  protected abstract getWritableBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<ImportBatch>;

  protected abstract validateRow(
    auth: AuthContext,
    importType: ImportType,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult>;

  protected abstract validateInvoiceRow(
    auth: AuthContext,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult>;

  protected abstract validateReceiptRow(
    auth: AuthContext,
    raw: Record<string, unknown>,
  ): Promise<RowValidationResult>;

  protected abstract resolveOrCreateImportCustomer(
    auth: AuthContext,
    raw: Record<string, unknown>,
    cache: Map<string, ResolvedImportCustomer>,
  ): Promise<ResolvedImportCustomer>;

  protected abstract validateNewCustomerInput(
    raw: Record<string, unknown>,
  ): CreateCustomerRequest;

  protected abstract importCustomerCacheKey(
    raw: Record<string, unknown>,
  ): string;

  protected abstract toCustomerResolutionDetails(
    classification: Awaited<
      ReturnType<CustomerService["classifyImportCustomer"]>
    >,
  ): CustomerResolutionDetails;

  protected abstract customerSuggestionDiagnostics(
    classification: Awaited<
      ReturnType<CustomerService["classifyImportCustomer"]>
    >,
  ): Record<string, unknown>;

  protected abstract resolveBankAccount(
    companyId: string,
    raw: Record<string, unknown>,
  ): Promise<BankAccountResolutionDetails>;

  protected abstract invoiceReferenceSuggestionDiagnostics(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    { status: ImportRowStatus; mappedData: Record<string, unknown> } | null
  >;

  protected abstract invoiceCandidate(
    invoice: Pick<
      Invoice,
      "id" | "invoice_no" | "currency" | "status" | "outstanding"
    >,
    reason: string,
    confidence: number,
    receiptCurrency: string,
  ): Record<string, unknown>;

  protected abstract normalizedInvoiceSuggestionReason(
    invoice: Pick<Invoice, "currency" | "status" | "outstanding">,
    receiptCurrency: string,
  ): string;

  protected abstract invoiceSuggestionMappedData(
    mappedData: Record<string, unknown>,
    reason: string,
    candidates: Array<Record<string, unknown>>,
    message: string,
  ): Record<string, unknown>;

  protected abstract nonAllocatableSuggestionStatus(
    candidates: Array<Record<string, unknown>>,
  ): ImportRowStatus;

  protected abstract isAllocatableInvoice(
    invoice: Pick<Invoice, "status" | "outstanding">,
  ): boolean;

  protected abstract preflightReceiptImportAllocation(
    auth: AuthContext,
    customerId: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    { status: ImportRowStatus; mappedData: Record<string, unknown> } | null
  >;

  protected abstract importAllocationPreflightStatus(
    reason: string,
  ): ImportRowStatus;

  protected abstract allocateReceiptImportRow(
    auth: AuthContext,
    importRowId: string,
    receiptId: string,
    mappedData: Record<string, unknown>,
  ): Promise<
    {
      status: ImportRowStatus;
      mappedData: Record<string, unknown>;
      allocated: boolean;
    }
  >;

  protected abstract resolveAllocationInvoice(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
  ): Promise<Invoice>;

  protected abstract errorMessage(error: unknown): string;

  protected abstract rowHasPostingError(row: ImportRow): boolean;

  protected abstract assertNoDuplicateReference(
    companyId: string,
    customerId: string,
    referenceNo?: string,
  ): Promise<void>;

  protected abstract resolveTaxCode(
    companyId: string,
    raw: Record<string, unknown>,
  ): Promise<string | undefined>;

  protected abstract listRowsInternal(batchId: string): Promise<ImportRow[]>;

  protected abstract updateBatch(
    batchId: string,
    patch: Record<string, unknown>,
  ): Promise<void>;

  protected abstract markBatchFailed(
    batchId: string,
    errors: Array<Record<string, unknown>>,
  ): Promise<void>;
}
