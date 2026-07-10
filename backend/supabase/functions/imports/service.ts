// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Sprint F4 Import Service
// CSV/XLSX Smart Invoice/Receipt Import with Customer Auto-Creation, Draft Only
// ============================================================================

import { SupabaseClient } from 'supabase';
import { getAdminClient, fetchById } from '../_shared/db.ts';
import {
  AuthorizationError,
  BusinessError,
  NotFoundError,
  ValidationError,
} from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireCustomerAccess } from '../_shared/auth.ts';
import { validateCurrency, validateDate, validateUUID } from '../_shared/validators.ts';
import type { BankAccount, Customer, CreateCustomerRequest, Invoice, PaginationParams, Receipt } from '../_shared/types.ts';
import { InvoiceService } from '../invoices/service.ts';
import { ReceiptService } from '../receipts/service.ts';
import { AllocationService } from '../allocations/service.ts';
import {
  validateCreateInvoice,
  validateInvoiceLines,
} from '../invoices/validators.ts';
import type {
  CreateInvoiceInput,
  CreateInvoiceLineInput,
} from '../invoices/validators.ts';
import { validateCreateReceipt } from '../receipts/validators.ts';
import { parseCsv } from './csv.ts';
import { parseXlsx } from './xlsx.ts';
import { CustomerService } from '../customers/service.ts';
import { validateCreateCustomer } from '../customers/validators.ts';
import { COUNTRY_DEFAULTS } from '../_shared/constants.ts';
import {
  FUZZY_CANDIDATE_LIMIT,
  FUZZY_INVOICE_REVIEW_THRESHOLD,
  normalizeIdentifier,
  topFuzzyCandidates,
} from '../_shared/fuzzy.ts';
import { validateOcrIntakeFile } from './file_validation.ts';
import { getOcrProvider } from './ocr_provider.ts';
import { validateOcrIntakeImportType } from './intake_validation.ts';

const BUCKET = 'ar-imports';
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500;
const READ_ROLES = ['AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor'];
const WRITE_ROLES = ['AR Clerk', 'AR Supervisor', 'Finance Manager'];
const ALLOWED_IMPORT_FILE_TYPES = ['csv', 'xlsx'] as const;
const ALLOWED_IMPORT_TYPES = ['invoice', 'receipt'] as const;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type ImportFileType = typeof ALLOWED_IMPORT_FILE_TYPES[number];
type ImportType = typeof ALLOWED_IMPORT_TYPES[number];

type ImportBatchStatus =
  | 'Uploaded'
  | 'Parsing'
  | 'Parsed'
  | 'Validating'
  | 'Validated'
  | 'Executing'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'PendingScan'
  | 'Rejected'
  | 'Quarantined'
  | 'PendingOCR'
  | 'OCRFailed'
  | 'OCRCompleted'
  | 'NeedsReview'
  | 'ApprovedDraft';

type ImportRowStatus =
  | 'Pending'
  | 'Valid'
  | 'Error'
  | 'Skipped'
  | 'Created'
  | 'Posted'
  | 'Allocated'
  | 'Unmatched'
  | 'NeedsReview'
  | 'ApprovedDraft'
  | 'Rejected';

interface ImportBatch {
  id: string;
  company_id: string;
  batch_name: string;
  import_type: 'invoice' | 'receipt';
  file_type: 'csv' | 'xlsx' | 'pdf' | 'image';
  file_name: string;
  file_path: string | null;
  status: ImportBatchStatus;
  auto_post: boolean;
  auto_allocate: boolean;
  created_by: string | null;
}

interface ImportRow {
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

interface UploadInput {
  file: File;
  fileType: ImportFileType;
  importType: ImportType;
  batchName?: string;
}

interface OcrUploadInput {
  file: File;
  fileType: string;
  importType: string;
  batchName?: string;
}

interface ImportFileRecord {
  id: string;
  batch_id: string;
  file_name: string;
  file_path: string;
  file_type: 'csv' | 'xlsx' | 'pdf' | 'image';
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

interface RowValidationResult {
  mappedData?: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
  status?: ImportRowStatus;
}

interface ExecuteImportOptions {
  autoPost?: boolean;
}

interface CustomerResolutionDetails {
  action: 'Matched Existing' | 'Create New' | 'Review Required';
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  matched_by: 'customer_code' | 'normalized_name' | 'created_in_batch' | 'fuzzy_suggestion' | null;
}

interface ResolvedImportCustomer {
  customer: Customer;
  created: boolean;
  details: CustomerResolutionDetails;
}

interface BankAccountResolutionDetails {
  bank_account_id: string;
  account_no: string;
  bank_name: string;
  matched_by: 'bank_account_id' | 'bank_account_code';
}

type ReviewAction =
  | 'approve_suggestion'
  | 'reject_suggestion'
  | 'edit_customer'
  | 'edit_invoice_reference'
  | 'retry_validation';

interface ReviewRowResult {
  row: ImportRow;
  action: ReviewAction;
  review_result:
    | 'approved_pending_retry'
    | 'rejected'
    | 'edited_pending_retry'
    | 'revalidated_valid'
    | 'revalidation_failed'
    | 'rejected_invalid_selection';
  revalidated: boolean;
  messages: string[];
}

const REVIEW_AUDIT_FIELDS = [
  'user_action',
  'approved_customer_id',
  'approved_customer_code',
  'approved_customer_name',
  'approved_invoice_id',
  'approved_invoice_no',
  'approved_by',
  'approved_at',
  'edited_customer_id',
  'edited_customer_code',
  'edited_customer_name',
  'edited_invoice_reference',
  'edited_by',
  'edited_at',
  'rejected_at',
  'review_note',
] as const;

function requireSupervisorOrFinanceManager(auth: AuthContext): void {
  if (!hasAnyRole(auth, ['AR Supervisor', 'Finance Manager'])) {
    throw new AuthorizationError('High-risk or low-confidence OCR intake requires AR Supervisor or Finance Manager approval.');
  }
}

function safeStorageFileName(fileName: string): string {
  return fileName.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
}

function hasAnyRole(auth: AuthContext, allowed: string[]): boolean {
  return auth.roles.some((role) => allowed.includes(role));
}

function requireImportRead(auth: AuthContext): void {
  if (!hasAnyRole(auth, READ_ROLES)) {
    throw new AuthorizationError('Import data access requires an AR operational role or Auditor.');
  }
}

function requireImportWrite(auth: AuthContext): void {
  if (!hasAnyRole(auth, WRITE_ROLES)) {
    throw new AuthorizationError('Import execution requires AR Clerk, AR Supervisor, or Finance Manager.');
  }
}

function asString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function parseNumber(value: string, field: string): number {
  const normalized = value.replace(/,/g, '');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Field "${field}" must be numeric.`, { field, value });
  }
  return num;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasImportValue(row: Record<string, unknown>, key: string): boolean {
  return asString(row, key) !== '';
}

function importFxGovernanceFields(raw: Record<string, unknown>): {
  exchange_rate?: number;
  fx_override_reason?: string;
} {
  const fields: { exchange_rate?: number; fx_override_reason?: string } = {};

  if (hasImportValue(raw, 'exchange_rate')) {
    fields.exchange_rate = parseNumber(asString(raw, 'exchange_rate'), 'exchange_rate');
    if (fields.exchange_rate <= 0) {
      throw new ValidationError('Field "exchange_rate" must be greater than 0.', {
        field: 'exchange_rate',
        value: asString(raw, 'exchange_rate'),
      });
    }
  }
  if (hasImportValue(raw, 'fx_override_reason')) {
    fields.fx_override_reason = asString(raw, 'fx_override_reason');
    if (fields.fx_override_reason.trim().length < 5) {
      throw new ValidationError('fx_override_reason must be at least 5 characters.', {
        field: 'fx_override_reason',
      });
    }
    if (fields.fx_override_reason.length > 500) {
      throw new ValidationError('Field "fx_override_reason" exceeds maximum length of 500.', {
        field: 'fx_override_reason',
      });
    }
  }

  return fields;
}

function importOriginPayload(batch: ImportBatch, row: ImportRow): Record<string, unknown> {
  return {
    source: 'csv_xlsx_import',
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

function rowError(field: string, message: string): Record<string, unknown> {
  return { field, message };
}

function preserveReviewAuditFields(
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

function isAllowedImportFileType(fileType: string): fileType is ImportFileType {
  return ALLOWED_IMPORT_FILE_TYPES.includes(fileType as ImportFileType);
}

function isAllowedImportType(importType: string): importType is ImportType {
  return ALLOWED_IMPORT_TYPES.includes(importType as ImportType);
}

function requireSupportedImportBatch(batch: ImportBatch, stage: string): ImportFileType {
  if (!isAllowedImportType(batch.import_type)) {
    throw new ValidationError(`Sprint F4 ${stage} supports invoice and receipt imports only.`);
  }
  if (!isAllowedImportFileType(batch.file_type)) {
    throw new ValidationError(`Sprint F4 ${stage} supports csv and xlsx files only.`);
  }

  return batch.file_type;
}

function mimeForImportFile(fileType: ImportFileType, browserMime: string): string {
  if (browserMime) return browserMime;
  return fileType === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
}

function errorToRowErrors(error: unknown): Array<Record<string, unknown>> {
  if (error instanceof ValidationError) {
    return [rowError(String(error.details.field ?? 'row'), error.message)];
  }
  if (error instanceof BusinessError) {
    return [rowError('business_rule', error.message)];
  }
  if (error instanceof AuthorizationError) {
    return [rowError('authorization', error.message)];
  }
  if (error instanceof Error) {
    return [rowError('row', error.message)];
  }
  return [rowError('row', 'Unknown validation error')];
}

export class ImportService {
  private client: SupabaseClient;
  private invoiceService: InvoiceService;
  private receiptService: ReceiptService;
  private allocationService: AllocationService;
  private customerService: CustomerService;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.invoiceService = new InvoiceService(this.client);
    this.receiptService = new ReceiptService(this.client);
    this.allocationService = new AllocationService(this.client);
    this.customerService = new CustomerService(this.client);
  }

  async uploadFile(auth: AuthContext, input: UploadInput): Promise<ImportBatch> {
    requireImportWrite(auth);

    if (!isAllowedImportType(input.importType)) {
      throw new ValidationError('Sprint F4 supports invoice and receipt imports only.', { import_type: input.importType });
    }
    if (!isAllowedImportFileType(input.fileType)) {
      throw new ValidationError('Sprint F4 only supports csv and xlsx imports.', { file_type: input.fileType });
    }

    const lowerName = input.file.name.toLowerCase();
    if (!lowerName.endsWith(`.${input.fileType}`)) {
      throw new ValidationError(`File extension must match file_type=${input.fileType}.`, {
        file_name: input.file.name,
        file_type: input.fileType,
      });
    }

    if (input.file.size <= 0) {
      throw new ValidationError('Import file is empty.');
    }

    const maxBytes = input.fileType === 'xlsx' ? MAX_XLSX_BYTES : MAX_CSV_BYTES;
    if (input.file.size > maxBytes) {
      const mb = maxBytes / 1024 / 1024;
      throw new ValidationError(`Import file exceeds the ${mb} MB Sprint F4 limit.`);
    }

    const batchName = input.batchName?.trim() || input.file.name.replace(/\.(csv|xlsx)$/i, '');

    const { data: batch, error: batchError } = await this.client
      .from('import_batches')
      .insert({
        company_id: auth.companyId,
        batch_name: batchName,
        import_type: input.importType,
        file_type: input.fileType,
        file_name: input.file.name,
        file_size_bytes: input.file.size,
        status: 'Uploaded',
        auto_post: false,
        auto_allocate: false,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (batchError || !batch) {
      throw new Error(`Failed to create import batch: ${batchError?.message ?? 'No row returned'}`);
    }

    const filePath = `${auth.companyId}/${batch.id}/${input.file.name}`;
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, input.file, {
        contentType: mimeForImportFile(input.fileType, input.file.type),
        upsert: false,
      });

    if (uploadError) {
      await this.markBatchFailed(batch.id, [{ stage: 'upload', message: uploadError.message }]);
      throw new Error(`Failed to upload import file: ${uploadError.message}`);
    }

    const { data: updated, error: updateError } = await this.client
      .from('import_batches')
      .update({ file_path: filePath })
      .eq('id', batch.id)
      .eq('company_id', auth.companyId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new Error(`Failed to update import file path: ${updateError?.message ?? 'No row returned'}`);
    }

    await this.client.from('import_files').insert({
      batch_id: batch.id,
      file_name: input.file.name,
      file_path: filePath,
      file_type: input.fileType,
      file_size_bytes: input.file.size,
    });

    return updated as ImportBatch;
  }

  async uploadOcrIntakeFile(
    auth: AuthContext,
    input: OcrUploadInput,
  ): Promise<{ batch: ImportBatch; file: ImportFileRecord; row: ImportRow; manual_fallback: boolean }> {
    requireImportWrite(auth);

    const importType = validateOcrIntakeImportType(input.importType);
    const validation = await validateOcrIntakeFile(input.file, input.fileType);
    const importLabel = importType === 'receipt' ? 'Receipt' : 'Invoice';
    const baseFileName = input.file.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '');
    const batchName = input.batchName?.trim() || `PDF/Image ${importLabel} Import - ${baseFileName}`;
    const safeName = safeStorageFileName(input.file.name);
    const reviewKind = importType === 'receipt' ? 'ocr_receipt_manual_entry' : 'ocr_invoice_manual_entry';

    const { data: batch, error: batchError } = await this.client
      .from('import_batches')
      .insert({
        company_id: auth.companyId,
        batch_name: batchName,
        import_type: importType,
        file_type: validation.fileType,
        file_name: input.file.name,
        file_size_bytes: input.file.size,
        status: 'NeedsReview',
        total_rows: 1,
        valid_rows: 0,
        error_rows: 0,
        created_count: 0,
        posted_count: 0,
        allocated_count: 0,
        auto_post: false,
        auto_allocate: false,
        created_by: auth.userId,
        error_summary: null,
      })
      .select()
      .single();

    if (batchError || !batch) {
      throw new Error(`Failed to create OCR import batch: ${batchError?.message ?? 'No row returned'}`);
    }

    const typedBatch = batch as ImportBatch;
    const filePath = `${auth.companyId}/${typedBatch.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, input.file, {
        contentType: validation.detectedMime,
        upsert: false,
      });

    if (uploadError) {
      await this.markBatchFailed(typedBatch.id, [{ stage: 'ocr_upload', message: uploadError.message }]);
      throw new Error(`Failed to upload OCR intake file: ${uploadError.message}`);
    }

    await this.updateBatch(typedBatch.id, { file_path: filePath });

    const ocrResult = {
      provider: 'disabled_manual_fallback',
      status: 'disabled',
      raw_text: null,
      fields: [],
      confidence: null,
      manual_fallback: true,
      validation: {
        detected_mime_type: validation.detectedMime,
        page_count: validation.pageCount,
        file_sha256: validation.sha256,
      },
    };

    const { data: fileRecord, error: fileError } = await this.client
      .from('import_files')
      .insert({
        batch_id: typedBatch.id,
        file_name: input.file.name,
        file_path: filePath,
        file_type: validation.fileType,
        file_size_bytes: input.file.size,
        content_mime_type: validation.contentMime,
        detected_mime_type: validation.detectedMime,
        file_sha256: validation.sha256,
        page_count: validation.pageCount,
        scan_status: validation.scanStatus,
        scan_result: validation.scanResult,
        ocr_status: 'disabled',
        ocr_provider: 'disabled_manual_fallback',
        ocr_result: ocrResult,
        retention_expires_at: validation.retentionExpiresAt,
      })
      .select()
      .single();

    if (fileError || !fileRecord) {
      await this.markBatchFailed(typedBatch.id, [{ stage: 'ocr_file_metadata', message: fileError?.message ?? 'No file row returned' }]);
      throw new Error(`Failed to create OCR import file metadata: ${fileError?.message ?? 'No row returned'}`);
    }

    const { data: row, error: rowError } = await this.client
      .from('import_rows')
      .insert({
        batch_id: typedBatch.id,
        row_number: 1,
        raw_data: {
          source: 'ocr_manual_fallback',
          import_type: importType,
          file_id: fileRecord.id,
          file_name: input.file.name,
          file_sha256: validation.sha256,
          ocr_status: 'disabled',
          ocr_fields: {},
        },
        mapped_data: {
          source: 'ocr_manual_fallback',
          review_required: true,
          review_kind: reviewKind,
          low_confidence: true,
          approval_required_role: 'AR Supervisor or Finance Manager',
          reviewed_fields: {},
          message: 'OCR is disabled. Enter and review the fields manually before creating a draft import.',
        },
        status: 'NeedsReview',
        validation_errors: [{
          field: 'ocr',
          message: 'OCR provider disabled; manual review is required.',
        }],
      })
      .select()
      .single();

    if (rowError || !row) {
      await this.markBatchFailed(typedBatch.id, [{ stage: 'ocr_review_row', message: rowError?.message ?? 'No row returned' }]);
      throw new Error(`Failed to create OCR review row: ${rowError?.message ?? 'No row returned'}`);
    }

    const updatedBatch = await this.getBatch(auth, typedBatch.id);
    return {
      batch: updatedBatch,
      file: fileRecord as ImportFileRecord,
      row: row as ImportRow,
      manual_fallback: true,
    };
  }

  async createOcrPreviewUrl(
    auth: AuthContext,
    batchId: string,
    fileId: string,
  ): Promise<{ signed_url: string; expires_in_seconds: number }> {
    requireImportRead(auth);
    const batch = await this.getBatch(auth, batchId);
    const file = await this.getImportFile(batch.id, fileId);
    const expiresIn = 120;

    const { data, error } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(file.file_path, expiresIn);

    if (error || !data?.signedUrl) {
      throw new Error(`Failed to create OCR preview URL: ${error?.message ?? 'No signed URL returned'}`);
    }

    return { signed_url: data.signedUrl, expires_in_seconds: expiresIn };
  }

  async startOcr(
    auth: AuthContext,
    batchId: string,
    fileId: string,
  ): Promise<Record<string, unknown>> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    const file = await this.getImportFile(batch.id, fileId);

    if (file.scan_status === 'rejected' || file.scan_status === 'quarantined') {
      throw new ValidationError('OCR cannot run on rejected or quarantined files.', {
        file_id: fileId,
        scan_status: file.scan_status,
      });
    }

    const provider = getOcrProvider();
    if (!provider.isEnabled()) {
      const result = await provider.extract();
      await this.client
        .from('import_files')
        .update({
          ocr_status: 'disabled',
          ocr_provider: provider.name,
          ocr_completed_at: new Date().toISOString(),
          ocr_result: {
            provider: result.provider,
            status: result.status,
            raw_text: result.rawText,
            fields: result.fields,
            confidence: result.confidence,
            metadata: result.metadata,
          },
        })
        .eq('id', file.id)
        .eq('batch_id', batch.id);

      return {
        status: 'disabled',
        provider: provider.name,
        manual_fallback: true,
        message: 'OCR provider is disabled. Continue with manual review/draft intake.',
      };
    }

    throw new BusinessError(
      'OCR_PROVIDER_NOT_CONFIGURED',
      'OCR provider activation requires a separately approved provider implementation.',
      503,
    );
  }

  async listOcrReviewItems(
    auth: AuthContext,
    batchId: string,
  ): Promise<{ batch: ImportBatch; files: ImportFileRecord[]; rows: ImportRow[] }> {
    const batch = await this.getBatch(auth, batchId);
    const { data: files, error: filesError } = await this.client
      .from('import_files')
      .select('*')
      .eq('batch_id', batch.id)
      .order('created_at');

    if (filesError) {
      throw new Error(`Failed to list OCR import files: ${filesError.message}`);
    }

    const rows = await this.listRowsInternal(batch.id);
    return {
      batch,
      files: (files ?? []) as ImportFileRecord[],
      rows: rows.filter((row) => ['NeedsReview', 'ApprovedDraft', 'Rejected', 'Error'].includes(row.status)),
    };
  }

  async saveOcrReview(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<{ row: ImportRow; decisions_recorded: number }> {
    const batch = await this.getWritableBatch(auth, batchId);
    const row = await this.fetchReviewableRow(batch.id, rowId);
    if (row.status !== 'NeedsReview' && row.status !== 'Error') {
      throw new ValidationError('Only OCR rows needing review can be updated.', {
        row_id: rowId,
        status: row.status,
      });
    }

    const reviewedFields = this.reviewedFields(payload.reviewed_fields);
    const note = this.reviewNote(payload.review_note);
    const previousMapped = row.mapped_data ?? {};
    const previousRaw = row.raw_data ?? {};
    const now = new Date().toISOString();

    const nextMappedData = {
      ...previousMapped,
      reviewed_fields: reviewedFields,
      review_result: 'reviewed',
      reviewed_by: auth.userId,
      reviewed_at: now,
      review_note: note,
      review_required: true,
      source: 'ocr_manual_fallback',
    };

    const updated = await this.updateReviewRow(row.id, {
      mapped_data: nextMappedData,
      validation_errors: null,
    });

    const fileId = typeof previousRaw.file_id === 'string' ? previousRaw.file_id : null;
    await this.insertOcrReviewDecisions(auth, batch, row, fileId, reviewedFields, 'reviewed', note);

    return { row: updated, decisions_recorded: Object.keys(reviewedFields).length };
  }

  async approveOcrDraft(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<{ batch: ImportBatch; row: ImportRow; message: string }> {
    const batch = await this.getWritableBatch(auth, batchId);
    const row = await this.fetchReviewableRow(batch.id, rowId);
    const mappedData = row.mapped_data ?? {};
    const reviewedFields = this.reviewedFields(mappedData.reviewed_fields);
    if (Object.keys(reviewedFields).length === 0) {
      throw new ValidationError('approve-draft requires reviewed OCR/manual fields first.', {
        row_id: rowId,
      });
    }

    if (mappedData.low_confidence !== false) {
      requireSupervisorOrFinanceManager(auth);
    }

    const note = this.reviewNote(payload.review_note);
    const approvedAt = new Date().toISOString();
    const nextMappedData = {
      ...mappedData,
      review_result: 'approved_draft',
      approved_by: auth.userId,
      approved_at: approvedAt,
      review_note: note ?? mappedData.review_note,
      financial_mutation: false,
      posting_status: 'not_posted',
      allocation_status: 'not_allocated',
    };

    const updated = await this.updateReviewRow(row.id, {
      status: 'ApprovedDraft',
      mapped_data: nextMappedData,
      validation_errors: null,
    });

    await this.updateBatch(batch.id, {
      status: 'ApprovedDraft',
      valid_rows: 0,
      error_rows: 0,
      created_count: 0,
      posted_count: 0,
      allocated_count: 0,
    });

    const fileId = typeof row.raw_data.file_id === 'string' ? row.raw_data.file_id : null;
    await this.insertOcrReviewDecisions(auth, batch, row, fileId, reviewedFields, 'approved_draft', note);

    return {
      batch: await this.getBatch(auth, batch.id),
      row: updated,
      message: 'OCR/manual intake approved as draft-only review data. No financial records were created; nothing was posted and no allocation was performed.',
    };
  }

  async parseBatch(auth: AuthContext, batchId: string): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    const fileType = requireSupportedImportBatch(batch, 'parse');

    if (batch.status !== 'Uploaded') {
      throw new ValidationError(`Only Uploaded batches can be parsed. Current status: ${batch.status}.`);
    }
    if (!batch.file_path) {
      throw new ValidationError('Import batch has no uploaded file path.');
    }

    await this.updateBatch(batch.id, { status: 'Parsing', error_summary: null });

    try {
      const { data, error } = await this.client.storage.from(BUCKET).download(batch.file_path);
      if (error || !data) {
        throw new Error(`Failed to download import file: ${error?.message ?? 'No file returned'}`);
      }

      const parsed = fileType === 'xlsx'
        ? parseXlsx(await data.arrayBuffer())
        : parseCsv(await data.text());

      if (parsed.rows.length > MAX_ROWS) {
        throw new ValidationError(`${fileType.toUpperCase()} has ${parsed.rows.length} rows. Sprint F4 limit is ${MAX_ROWS}.`);
      }

      const { count: existingRows, error: existingRowsError } = await this.client
        .from('import_rows')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch.id);

      if (existingRowsError) {
        throw new Error(`Failed to check existing import rows: ${existingRowsError.message}`);
      }
      if ((existingRows ?? 0) > 0) {
        throw new ValidationError('This batch has already been parsed. Create a new batch to re-import corrected data.');
      }

      const insertRows = parsed.rows.map((row, idx) => ({
        batch_id: batch.id,
        row_number: idx + 1,
        raw_data: row,
        status: 'Pending',
      }));

      const { data: rows, error: rowsError } = await this.client
        .from('import_rows')
        .insert(insertRows)
        .select()
        .order('row_number');

      if (rowsError) {
        throw new Error(`Failed to insert import rows: ${rowsError.message}`);
      }

      await this.updateBatch(batch.id, {
        status: 'Parsed',
        total_rows: parsed.rows.length,
        valid_rows: 0,
        error_rows: 0,
        created_count: 0,
        matched_customers_count: 0,
        created_customers_count: 0,
        posted_count: 0,
        allocated_count: 0,
        error_summary: null,
      });

      const updatedBatch = await this.getBatch(auth, batch.id);
      return { batch: updatedBatch, rows: (rows ?? []) as ImportRow[] };
    } catch (error) {
      await this.markBatchFailed(batch.id, [{ stage: 'parse', message: error instanceof Error ? error.message : 'Parse failed' }]);
      throw error;
    }
  }

  async validateBatch(auth: AuthContext, batchId: string): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    requireSupportedImportBatch(batch, 'validate');

    if (batch.status !== 'Parsed' && batch.status !== 'Validated') {
      throw new ValidationError(`Only Parsed or Validated batches can be validated. Current status: ${batch.status}.`);
    }
    await this.updateBatch(batch.id, { status: 'Validating', error_summary: null });

    const rows = await this.listRowsInternal(batch.id);
    if (rows.length === 0) {
      throw new ValidationError('Import batch has no parsed rows. Run parse first.');
    }

    let validRows = 0;
    let errorRows = 0;
    let skippedRows = 0;
    let unmatchedRows = 0;
    const errorSummary: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const result = await this.validateRow(auth, batch.import_type, row.raw_data);
      if (result.errors.length > 0) {
        errorRows += 1;
        errorSummary.push({ row: row.row_number, errors: result.errors });
        await this.client
          .from('import_rows')
          .update({
            status: 'Error',
            mapped_data: result.mappedData ?? null,
            validation_errors: result.errors,
          })
          .eq('id', row.id);
      } else {
        const rowStatus = result.status ?? 'Valid';
        if (rowStatus === 'Valid') {
          validRows += 1;
        } else if (rowStatus === 'Unmatched' || rowStatus === 'Skipped') {
          errorRows += 1;
          if (rowStatus === 'Unmatched') unmatchedRows += 1;
          if (rowStatus === 'Skipped') skippedRows += 1;
        }
        await this.client
          .from('import_rows')
          .update({
            status: rowStatus,
            mapped_data: result.mappedData,
            validation_errors: null,
          })
          .eq('id', row.id);
      }
    }

    await this.updateBatch(batch.id, {
      status: 'Validated',
      valid_rows: validRows,
      error_rows: errorRows,
      skipped_count: skippedRows,
      unmatched_count: unmatchedRows,
      error_summary: errorSummary.length > 0 ? errorSummary : null,
    });

    return { batch: await this.getBatch(auth, batch.id), rows: await this.listRowsInternal(batch.id) };
  }

  async executeDraftCreation(
    auth: AuthContext,
    batchId: string,
    options: ExecuteImportOptions = {},
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    requireSupportedImportBatch(batch, 'execute');
    const autoPost = options.autoPost === true;

    if (autoPost && batch.import_type !== 'receipt') {
      throw new ValidationError('auto_post is allowed only for receipt import batches.', {
        import_type: batch.import_type,
        auto_post: autoPost,
      });
    }

    if (batch.status !== 'Parsed' && batch.status !== 'Validated') {
      throw new ValidationError(`Only Parsed or Validated batches can be executed. Current status: ${batch.status}.`);
    }

    let rows = await this.listRowsInternal(batch.id);
    if (rows.length === 0) {
      throw new ValidationError('Import batch has no parsed rows. Run parse first.');
    }

    if (rows.some((row) => row.status === 'Pending')) {
      await this.validateBatch(auth, batch.id);
      rows = await this.listRowsInternal(batch.id);
    }

    await this.updateBatch(batch.id, {
      status: 'Executing',
      auto_post: autoPost,
      auto_allocate: false,
    });

    let createdCount = 0;
    let postedCount = 0;
    let allocatedCount = 0;
    const matchedCustomerIds = new Set<string>();
    const createdCustomerIds = new Set<string>();
    const resolvedCustomers = new Map<string, ResolvedImportCustomer>();
    let errorRows = rows.filter((row) => row.status === 'Error').length;
    const errorSummary: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      if (row.status !== 'Valid') continue;
      if (!row.mapped_data) {
        errorRows += 1;
        const errors = [rowError('mapped_data', 'Validated row is missing mapped_data.')];
        errorSummary.push({ row: row.row_number, errors });
        await this.client.from('import_rows').update({
          status: 'Error',
          validation_errors: errors,
        }).eq('id', row.id);
        continue;
      }

      try {
        const resolved = await this.resolveOrCreateImportCustomer(auth, row.raw_data, resolvedCustomers);
        const importOrigin = importOriginPayload(batch, row);
        if (resolved.created) {
          createdCustomerIds.add(resolved.customer.id);
        } else if (!createdCustomerIds.has(resolved.customer.id)) {
          matchedCustomerIds.add(resolved.customer.id);
        }

        let created: Invoice | Receipt;
        let mappedData: Record<string, unknown>;

        let rowStatus: ImportRowStatus = 'Created';
        const rowPatch = { invoice_id: null as string | null, receipt_id: null as string | null };

        if (batch.import_type === 'invoice') {
          mappedData = {
            ...row.mapped_data,
            customer_id: resolved.customer.id,
            customer_resolution: resolved.details,
          };
          await this.assertNoDuplicateReference(auth.companyId, resolved.customer.id, asString(mappedData, 'reference_no'));
          const header = validateCreateInvoice(mappedData);
          const lines = validateInvoiceLines(row.mapped_data.lines);
          created = await this.invoiceService.createInvoice(auth, header, lines, { importOrigin });
          rowPatch.invoice_id = created.id;
        } else {
          const bankAccount = await this.resolveBankAccount(auth.companyId, row.raw_data);
          mappedData = {
            ...row.mapped_data,
            customer_id: resolved.customer.id,
            customer_resolution: resolved.details,
            bank_account_id: bankAccount.bank_account_id,
            bank_account_resolution: bankAccount,
          };
          const receiptInput = validateCreateReceipt(mappedData);
          const preflight = await this.preflightReceiptImportAllocation(
            auth,
            resolved.customer.id,
            mappedData,
          );

          if (preflight) {
            await this.client.from('import_rows').update({
              status: preflight.status,
              invoice_id: null,
              receipt_id: null,
              mapped_data: preflight.mappedData,
              validation_errors: null,
            }).eq('id', row.id);
            continue;
          }

          created = await this.receiptService.createReceipt(auth, receiptInput, { importOrigin });
          rowPatch.receipt_id = created.id;

          if (autoPost) {
            const explicitRateSupplied = receiptInput.exchange_rate !== undefined;
            const { data: company } = await this.client
              .from('companies')
              .select('base_currency')
              .eq('id', auth.companyId)
              .single();
            const explicitSameCurrencyParity = explicitRateSupplied
              && receiptInput.currency === company?.base_currency
              && Number(receiptInput.exchange_rate) === 1;

            if (explicitRateSupplied && !explicitSameCurrencyParity) {
              rowStatus = 'Created';
              mappedData = {
                ...mappedData,
                posting_status: 'HeldGovernance',
                posting_error:
                  'Explicit imported FX rate is governed as MANUAL_OVERRIDE and requires review before posting.',
              };
            } else {
              try {
                await this.receiptService.postReceipt(auth, created.id);
                postedCount += 1;
                rowStatus = 'Posted';
                mappedData = {
                  ...mappedData,
                  posting_status: 'Posted',
                };
              } catch (postError) {
                rowStatus = 'Created';
                mappedData = {
                  ...mappedData,
                  posting_status: 'Error',
                  posting_error: this.errorMessage(postError),
                };
              }
            }

            if (rowStatus === 'Posted') {
              const allocationOutcome = await this.allocateReceiptImportRow(
                auth,
                row.id,
                created.id,
                mappedData,
              );
              mappedData = allocationOutcome.mappedData;
              rowStatus = allocationOutcome.status;
              if (allocationOutcome.allocated) allocatedCount += 1;
            }
          }
        }

        createdCount += 1;

        await this.client.from('import_rows').update({
          status: rowStatus,
          ...rowPatch,
          mapped_data: mappedData,
          validation_errors: null,
        }).eq('id', row.id);
      } catch (error) {
        errorRows += 1;
        const errors = errorToRowErrors(error);
        errorSummary.push({ row: row.row_number, errors });
        await this.client.from('import_rows').update({
          status: 'Error',
          validation_errors: errors,
        }).eq('id', row.id);
      }
    }

    const finalRows = await this.listRowsInternal(batch.id);
    const finalValidRows = finalRows.filter((row) =>
      row.status === 'Valid'
      || row.status === 'Created'
      || row.status === 'Posted'
      || row.status === 'Allocated'
    ).length;
    const finalErrorRows = finalRows.filter((row) =>
      row.status === 'Error'
      || row.status === 'Unmatched'
      || this.rowHasPostingError(row)
    ).length;
    const finalSkippedRows = finalRows.filter((row) => row.status === 'Skipped').length;
    const finalUnmatchedRows = finalRows.filter((row) => row.status === 'Unmatched').length;

    await this.updateBatch(batch.id, {
      status: 'Completed',
      completed_at: new Date().toISOString(),
      valid_rows: finalValidRows,
      error_rows: finalErrorRows,
      created_count: createdCount,
      matched_customers_count: matchedCustomerIds.size,
      created_customers_count: createdCustomerIds.size,
      posted_count: postedCount,
      allocated_count: allocatedCount,
      skipped_count: finalSkippedRows,
      unmatched_count: finalUnmatchedRows,
      error_summary: errorSummary.length > 0 ? errorSummary : null,
    });

    return { batch: await this.getBatch(auth, batch.id), rows: await this.listRowsInternal(batch.id) };
  }

  async listBatches(
    auth: AuthContext,
    pagination: PaginationParams,
  ): Promise<{ batches: ImportBatch[]; total: number }> {
    requireImportRead(auth);

    let query = this.client
      .from('import_batches')
      .select('*', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('created_at', { ascending: false });

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list import batches: ${error.message}`);
    return { batches: (data ?? []) as ImportBatch[], total: count ?? 0 };
  }

  async getBatch(auth: AuthContext, batchId: string): Promise<ImportBatch> {
    requireImportRead(auth);
    validateUUID(batchId, 'batch_id');
    const { data, error } = await this.client
      .from('import_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle();

    if (error) {
      throw new BusinessError(
        'IMPORT_BATCH_FETCH_FAILED',
        'Failed to fetch import batch.',
        500,
        { batch_id: batchId, db_message: error.message },
      );
    }
    if (!data) throw new NotFoundError('ImportBatch', batchId);

    const batch = data as ImportBatch;
    if (batch.company_id !== auth.companyId) throw new NotFoundError('ImportBatch', batchId);
    return batch;
  }

  async listRows(
    auth: AuthContext,
    batchId: string,
    pagination: PaginationParams,
  ): Promise<{ rows: ImportRow[]; total: number }> {
    await this.getBatch(auth, batchId);
    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;

    const selectColumns = [
      'id',
      'batch_id',
      'row_number',
      'raw_data',
      'mapped_data',
      'status',
      'validation_errors',
      'invoice_id',
      'receipt_id',
      'je_no',
      'duplicate_of',
      'created_at',
      'updated_at',
    ].join(',');

    const { data, error } = await this.client
      .from('import_rows')
      .select(selectColumns)
      .eq('batch_id', batchId)
      .order('row_number')
      .range(from, to);

    if (error) {
      throw new BusinessError(
        'IMPORT_ROWS_LIST_FAILED',
        'Failed to list import rows for this batch.',
        500,
        { batch_id: batchId, db_message: error.message },
      );
    }

    const { count, error: countError } = await this.client
      .from('import_rows')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId);

    if (countError) {
      console.error('[IMPORT_ROWS_COUNT_ERROR]', {
        batch_id: batchId,
        message: countError.message,
      });
    }

    const rows = (data ?? []) as unknown as ImportRow[];
    return { rows, total: count ?? rows.length };
  }

  private async getImportFile(batchId: string, fileId: string): Promise<ImportFileRecord> {
    validateUUID(fileId, 'file_id');
    const { data, error } = await this.client
      .from('import_files')
      .select('*')
      .eq('id', fileId)
      .eq('batch_id', batchId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch import file: ${error.message}`);
    if (!data) throw new NotFoundError('ImportFile', fileId);
    return data as ImportFileRecord;
  }

  async reviewRow(
    auth: AuthContext,
    batchId: string,
    rowId: string,
    payload: Record<string, unknown>,
  ): Promise<ReviewRowResult> {
    const batch = await this.getWritableBatch(auth, batchId);
    const row = await this.fetchReviewableRow(batch.id, rowId);
    const action = this.parseReviewAction(payload.action);
    const reviewNote = this.reviewNote(payload.review_note);

    let result: ReviewRowResult;
    switch (action) {
      case 'approve_suggestion':
        result = await this.applyApproveSuggestion(auth, batch, row, payload, reviewNote);
        break;
      case 'reject_suggestion':
        result = await this.applyRejectSuggestion(row, reviewNote);
        break;
      case 'edit_customer':
        result = await this.applyEditCustomer(auth, row, payload, reviewNote);
        break;
      case 'edit_invoice_reference':
        result = await this.applyEditInvoiceReference(auth, batch, row, payload, reviewNote);
        break;
      case 'retry_validation':
        result = await this.revalidateReviewRow(auth, batch, row);
        break;
    }

    await this.refreshBatchCounters(batch.id);
    return result;
  }

  private async fetchReviewableRow(batchId: string, rowId: string): Promise<ImportRow> {
    validateUUID(rowId, 'row_id');
    const { data, error } = await this.client
      .from('import_rows')
      .select('*')
      .eq('id', rowId)
      .eq('batch_id', batchId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch import row: ${error.message}`);
    if (!data) throw new NotFoundError('ImportRow', rowId);

    const row = data as ImportRow;
    if (['Created', 'Posted', 'Allocated'].includes(row.status)) {
      throw new ValidationError('Created, posted, or allocated import rows cannot be reviewed.', {
        row_id: rowId,
        status: row.status,
      });
    }
    return row;
  }

  private parseReviewAction(action: unknown): ReviewAction {
    const value = typeof action === 'string' ? action : '';
    const allowed: ReviewAction[] = [
      'approve_suggestion',
      'reject_suggestion',
      'edit_customer',
      'edit_invoice_reference',
      'retry_validation',
    ];
    if (!allowed.includes(value as ReviewAction)) {
      throw new ValidationError('Unsupported review action.', { action: value });
    }
    return value as ReviewAction;
  }

  private reviewNote(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw new ValidationError('review_note must be a string.', { field: 'review_note' });
    }
    const note = value.trim();
    if (note.length > 500) {
      throw new ValidationError('review_note must be 500 characters or fewer.', { field: 'review_note' });
    }
    return note || undefined;
  }

  private reviewedFields(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError('reviewed_fields must be an object of reviewed OCR/manual values.', {
        field: 'reviewed_fields',
      });
    }

    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).length === 0) {
      throw new ValidationError('reviewed_fields must include at least one field.', {
        field: 'reviewed_fields',
      });
    }
    if (Object.keys(fields).length > 50) {
      throw new ValidationError('reviewed_fields cannot include more than 50 fields.', {
        field: 'reviewed_fields',
      });
    }

    for (const key of Object.keys(fields)) {
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) {
        throw new ValidationError('reviewed_fields contains an unsupported field key.', {
          field: 'reviewed_fields',
          field_key: key,
        });
      }
      const valueForKey = fields[key];
      if (
        valueForKey !== null
        && typeof valueForKey !== 'string'
        && typeof valueForKey !== 'number'
        && typeof valueForKey !== 'boolean'
      ) {
        throw new ValidationError('reviewed_fields values must be scalar JSON values.', {
          field: 'reviewed_fields',
          field_key: key,
        });
      }
    }

    return fields;
  }

  private async insertOcrReviewDecisions(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    fileId: string | null,
    reviewedFields: Record<string, unknown>,
    decision: 'reviewed' | 'approved_draft' | 'rejected',
    note?: string,
  ): Promise<void> {
    const rawFields = row.raw_data?.ocr_fields;
    const rawValues = rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
      ? rawFields as Record<string, unknown>
      : row.raw_data;

    const rows = Object.entries(reviewedFields).map(([fieldKey, reviewedValue]) => ({
      company_id: auth.companyId,
      batch_id: batch.id,
      file_id: fileId,
      row_id: row.id,
      field_key: fieldKey,
      raw_value: rawValues[fieldKey] === undefined ? null : rawValues[fieldKey],
      reviewed_value: reviewedValue === undefined ? null : reviewedValue,
      confidence: null,
      decision,
      decided_by: auth.userId,
      note: note ?? null,
    }));

    const { error } = await this.client
      .from('ocr_review_decisions')
      .insert(rows);

    if (error) {
      throw new Error(`Failed to record OCR review decisions: ${error.message}`);
    }
  }

  private async applyApproveSuggestion(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const mappedData = row.mapped_data ?? {};
    if (mappedData.review_required !== true) {
      throw new ValidationError('Only review_required rows can approve a suggestion.', {
        row_id: row.id,
      });
    }

    const selectedCustomerId = this.optionalUUID(payload.suggested_customer_id, 'suggested_customer_id');
    const selectedInvoiceId = this.optionalUUID(payload.suggested_invoice_id, 'suggested_invoice_id');
    if (!selectedCustomerId && !selectedInvoiceId) {
      throw new ValidationError('approve_suggestion requires suggested_customer_id or suggested_invoice_id.', {
        action: 'approve_suggestion',
      });
    }
    if (selectedCustomerId && selectedInvoiceId && mappedData.review_kind !== 'both') {
      throw new ValidationError('Approving both customer and invoice suggestions is allowed only for review_kind=both.', {
        review_kind: mappedData.review_kind,
      });
    }

    const nextRawData = { ...row.raw_data };
    const nextMappedData = { ...mappedData };
    const messages: string[] = [];

    if (selectedCustomerId) {
      const candidate = this.findCandidateById(mappedData, ['suggested_customers', 'customer_candidates'], selectedCustomerId, 'customer_id');
      if (!candidate) {
        throw new ValidationError('Selected customer suggestion is not present in this row.', {
          field: 'suggested_customer_id',
          reason: 'rejected_invalid_selection',
        });
      }
      const customer = await this.resolveVisibleCustomerById(auth, selectedCustomerId);
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.approved_customer_id = customer.id;
      nextMappedData.approved_customer_code = customer.customer_id;
      nextMappedData.approved_customer_name = customer.customer_name;
      messages.push(`Approved customer ${customer.customer_id}.`);
    }

    if (selectedInvoiceId) {
      const candidate = this.findCandidateById(mappedData, ['suggested_invoices', 'invoice_candidates'], selectedInvoiceId, 'invoice_id');
      if (!candidate) {
        throw new ValidationError('Selected invoice suggestion is not present in this row.', {
          field: 'suggested_invoice_id',
          reason: 'rejected_invalid_selection',
        });
      }
      const invoice = await this.resolveReviewInvoice(auth, batch, row, nextRawData, selectedInvoiceId);
      nextRawData.invoice_reference = invoice.invoice_no;
      nextMappedData.approved_invoice_id = invoice.id;
      nextMappedData.approved_invoice_no = invoice.invoice_no;
      messages.push(`Approved invoice ${invoice.invoice_no}.`);
    }

    const now = new Date().toISOString();
    nextMappedData.user_action = 'approved';
    nextMappedData.review_result = 'approved_pending_retry';
    nextMappedData.approved_by = auth.userId;
    nextMappedData.approved_at = now;
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });

    return {
      row: updated,
      action: 'approve_suggestion',
      review_result: 'approved_pending_retry',
      revalidated: false,
      messages,
    };
  }

  private async applyRejectSuggestion(
    row: ImportRow,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const nextMappedData = { ...(row.mapped_data ?? {}) };
    delete nextMappedData.approved_customer_id;
    delete nextMappedData.approved_customer_code;
    delete nextMappedData.approved_customer_name;
    delete nextMappedData.approved_invoice_id;
    delete nextMappedData.approved_invoice_no;
    nextMappedData.user_action = 'rejected';
    nextMappedData.review_result = 'rejected';
    nextMappedData.rejected_at = new Date().toISOString();
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, { mapped_data: nextMappedData });
    return {
      row: updated,
      action: 'reject_suggestion',
      review_result: 'rejected',
      revalidated: false,
      messages: ['Suggestion rejected.'],
    };
  }

  private async applyEditCustomer(
    auth: AuthContext,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const nextRawData = { ...row.raw_data };
    const nextMappedData = { ...(row.mapped_data ?? {}) };
    const customerId = this.optionalUUID(payload.customer_id, 'customer_id');
    const customerCode = typeof payload.customer_code === 'string' ? payload.customer_code.trim() : '';
    const customerName = typeof payload.customer_name === 'string' ? payload.customer_name.trim() : '';

    if (!customerId && !customerCode && !customerName) {
      throw new ValidationError('edit_customer requires customer_id, customer_code, or customer_name.', {
        action: 'edit_customer',
      });
    }

    if (customerId) {
      const customer = await this.resolveVisibleCustomerById(auth, customerId);
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.edited_customer_id = customer.id;
      nextMappedData.edited_customer_code = customer.customer_id;
      nextMappedData.edited_customer_name = customer.customer_name;
    } else if (customerCode) {
      const customer = await this.resolveVisibleCustomerByCode(auth, customerCode);
      nextRawData.customer_code = customer.customer_id;
      nextRawData.customer_name = customer.customer_name;
      nextMappedData.edited_customer_id = customer.id;
      nextMappedData.edited_customer_code = customer.customer_id;
      nextMappedData.edited_customer_name = customer.customer_name;
    } else {
      nextRawData.customer_code = '';
      nextRawData.customer_name = customerName;
      nextMappedData.edited_customer_name = customerName;
    }

    nextMappedData.user_action = 'edited';
    nextMappedData.review_result = 'edited_pending_retry';
    nextMappedData.edited_by = auth.userId;
    nextMappedData.edited_at = new Date().toISOString();
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });
    return {
      row: updated,
      action: 'edit_customer',
      review_result: 'edited_pending_retry',
      revalidated: false,
      messages: ['Customer correction recorded. Run retry_validation to re-check the row.'],
    };
  }

  private async applyEditInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    payload: Record<string, unknown>,
    reviewNote?: string,
  ): Promise<ReviewRowResult> {
    const invoiceReference = typeof payload.invoice_reference === 'string'
      ? payload.invoice_reference.trim()
      : '';
    if (!invoiceReference) {
      throw new ValidationError('edit_invoice_reference requires invoice_reference.', {
        field: 'invoice_reference',
      });
    }

    const review = await this.inspectEditedInvoiceReference(auth, batch, row, invoiceReference);
    if (review.blocking) {
      throw new ValidationError(review.message ?? 'Corrected invoice_reference is not allocatable.', {
        field: 'invoice_reference',
        reason: review.reason,
      });
    }

    const nextRawData = {
      ...row.raw_data,
      invoice_reference: invoiceReference,
    };
    const nextMappedData: Record<string, unknown> = {
      ...(row.mapped_data ?? {}),
      user_action: 'edited',
      review_result: 'edited_pending_retry',
      edited_invoice_reference: invoiceReference,
      edited_by: auth.userId,
      edited_at: new Date().toISOString(),
    };
    if (reviewNote) nextMappedData.review_note = reviewNote;

    const updated = await this.updateReviewRow(row.id, {
      raw_data: nextRawData,
      mapped_data: nextMappedData,
    });
    return {
      row: updated,
      action: 'edit_invoice_reference',
      review_result: 'edited_pending_retry',
      revalidated: false,
      messages: ['Invoice reference correction recorded. Run retry_validation to re-check the row.'],
    };
  }

  private async revalidateReviewRow(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
  ): Promise<ReviewRowResult> {
    const result = await this.validateRow(auth, batch.import_type, row.raw_data);
    const status: ImportRowStatus = result.errors.length > 0 ? 'Error' : result.status ?? 'Valid';
    const reviewResult = status === 'Valid' ? 'revalidated_valid' : 'revalidation_failed';
    const validationMappedData = result.mappedData ?? {};
    const mappedData = {
      ...preserveReviewAuditFields(row.mapped_data, validationMappedData),
      review_result: reviewResult,
      revalidated_at: new Date().toISOString(),
      revalidated_by: auth.userId,
    };

    const updated = await this.updateReviewRow(row.id, {
      status,
      mapped_data: mappedData,
      validation_errors: result.errors.length > 0 ? result.errors : null,
    });

    return {
      row: updated,
      action: 'retry_validation',
      review_result: reviewResult,
      revalidated: true,
      messages: [status === 'Valid' ? 'Row revalidated successfully.' : 'Row still requires review.'],
    };
  }

  private async updateReviewRow(rowId: string, patch: Record<string, unknown>): Promise<ImportRow> {
    const { data, error } = await this.client
      .from('import_rows')
      .update(patch)
      .eq('id', rowId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update import review row: ${error.message}`);
    return data as ImportRow;
  }

  private async refreshBatchCounters(batchId: string): Promise<void> {
    const rows = await this.listRowsInternal(batchId);
    await this.updateBatch(batchId, {
      total_rows: rows.length,
      valid_rows: rows.filter((row) =>
        row.status === 'Valid'
        || row.status === 'Created'
        || row.status === 'Posted'
        || row.status === 'Allocated'
      ).length,
      error_rows: rows.filter((row) => ['Error', 'Unmatched', 'Skipped'].includes(row.status)).length,
      skipped_count: rows.filter((row) => row.status === 'Skipped').length,
      unmatched_count: rows.filter((row) => row.status === 'Unmatched').length,
    });
  }

  private optionalUUID(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
      throw new ValidationError(`${field} must be a UUID string.`, { field });
    }
    const trimmed = value.trim();
    validateUUID(trimmed, field);
    return trimmed;
  }

  private findCandidateById(
    mappedData: Record<string, unknown>,
    keys: string[],
    id: string,
    idField: string,
  ): Record<string, unknown> | null {
    for (const key of keys) {
      const candidates = mappedData[key];
      if (!Array.isArray(candidates)) continue;
      const candidate = candidates.find((item) =>
        item
        && typeof item === 'object'
        && String((item as Record<string, unknown>)[idField]) === id
      );
      if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
    }
    return null;
  }

  private async resolveVisibleCustomerById(auth: AuthContext, customerId: string): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .eq('company_id', auth.companyId)
      .eq('is_deleted', false)
      .eq('is_hidden', false)
      .maybeSingle();

    if (error) throw new Error(`Failed to resolve customer: ${error.message}`);
    if (!data) throw new NotFoundError('Customer', customerId);

    const customer = data as Customer;
    await requireCustomerAccess(auth, customer.id);
    return customer;
  }

  private async resolveVisibleCustomerByCode(auth: AuthContext, customerCode: string): Promise<Customer> {
    const { data, error } = await this.client
      .from('customers')
      .select('*')
      .eq('customer_id', customerCode)
      .eq('company_id', auth.companyId)
      .eq('is_deleted', false)
      .eq('is_hidden', false)
      .maybeSingle();

    if (error) throw new Error(`Failed to resolve customer_code: ${error.message}`);
    if (!data) {
      throw new ValidationError(`Visible customer_code "${customerCode}" could not be resolved.`, {
        field: 'customer_code',
      });
    }

    const customer = data as Customer;
    await requireCustomerAccess(auth, customer.id);
    return customer;
  }

  private async resolveReviewCustomerFromRaw(
    auth: AuthContext,
    rawData: Record<string, unknown>,
  ): Promise<Customer> {
    const classification = await this.customerService.classifyImportCustomer(auth, {
      customerCode: asString(rawData, 'customer_code') || undefined,
      customerName: asString(rawData, 'customer_name') || undefined,
      registrationNo: asString(rawData, 'registration_no') || undefined,
    });

    if (!classification.customer) {
      throw new ValidationError('A visible exact customer must be resolved before approving an invoice suggestion.', {
        field: 'customer_code',
        reason: 'customer_context_unresolved',
      });
    }
    await requireCustomerAccess(auth, classification.customer.id);
    return classification.customer;
  }

  private async resolveReviewInvoice(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    rawData: Record<string, unknown>,
    invoiceId: string,
  ): Promise<Invoice> {
    if (batch.import_type !== 'receipt') {
      throw new ValidationError('Invoice suggestion approval is supported only for receipt import rows.', {
        import_type: batch.import_type,
      });
    }

    const customer = await this.resolveReviewCustomerFromRaw(auth, rawData);
    const invoice = await fetchById<Invoice>(this.client, 'invoices', invoiceId);
    if (invoice.company_id !== auth.companyId || invoice.customer_id !== customer.id) {
      throw new NotFoundError('Invoice', invoiceId);
    }

    const currency = (
      asString(rawData, 'currency')
      || asString(row.mapped_data ?? {}, 'currency')
      || customer.default_currency
      || 'MYR'
    ).toUpperCase();
    if (invoice.currency !== currency) {
      throw new ValidationError('Selected invoice currency does not match the import row currency.', {
        field: 'suggested_invoice_id',
        reason: 'currency_mismatch',
        invoice_currency: invoice.currency,
        receipt_currency: currency,
      });
    }
    if (!this.isAllocatableInvoice(invoice)) {
      throw new ValidationError('Selected invoice is not currently allocatable.', {
        field: 'suggested_invoice_id',
        reason: Number(invoice.outstanding) <= 0 ? 'no_outstanding' : 'invoice_not_open',
        invoice_status: invoice.status,
        outstanding: invoice.outstanding,
      });
    }

    const mappedData = {
      ...(row.mapped_data ?? {}),
      currency,
      receipt_amount: hasImportValue(rawData, 'amount')
        ? parseNumber(asString(rawData, 'amount'), 'amount')
        : row.mapped_data?.receipt_amount,
      allocation_amount: hasImportValue(rawData, 'allocation_amount')
        ? parseNumber(asString(rawData, 'allocation_amount'), 'allocation_amount')
        : row.mapped_data?.allocation_amount,
      discount_amount: hasImportValue(rawData, 'discount_amount')
        ? parseNumber(asString(rawData, 'discount_amount'), 'discount_amount')
        : row.mapped_data?.discount_amount,
      invoice_reference: invoice.invoice_no,
    };

    const preflight = await this.preflightReceiptImportAllocation(auth, customer.id, mappedData);
    if (preflight) {
      throw new ValidationError(String(preflight.mappedData.allocation_error ?? preflight.mappedData.auto_post_block_reason ?? 'Selected invoice failed allocation preflight.'), {
        field: 'suggested_invoice_id',
        reason: preflight.mappedData.allocation_error_reason ?? 'allocation_preflight_failed',
      });
    }

    return invoice;
  }

  private async inspectEditedInvoiceReference(
    auth: AuthContext,
    batch: ImportBatch,
    row: ImportRow,
    invoiceReference: string,
  ): Promise<{ blocking: boolean; reason?: string; message?: string }> {
    if (batch.import_type !== 'receipt') return { blocking: false };

    let customer: Customer;
    try {
      customer = await this.resolveReviewCustomerFromRaw(auth, row.raw_data);
    } catch {
      return { blocking: false };
    }

    const currency = (
      asString(row.raw_data, 'currency')
      || asString(row.mapped_data ?? {}, 'currency')
      || customer.default_currency
      || 'MYR'
    ).toUpperCase();
    const diagnostics = await this.invoiceReferenceSuggestionDiagnostics(
      auth.companyId,
      customer.id,
      currency,
      invoiceReference,
      row.mapped_data ?? {},
    );

    if (!diagnostics) return { blocking: false };
    const reason = String(diagnostics.mappedData.allocation_error_reason ?? '');
    if (['currency_mismatch', 'no_outstanding', 'invoice_not_open'].includes(reason)) {
      return {
        blocking: true,
        reason,
        message: String(diagnostics.mappedData.allocation_error ?? 'Corrected invoice_reference is not allocatable.'),
      };
    }
    return { blocking: false };
  }

  private async getWritableBatch(auth: AuthContext, batchId: string): Promise<ImportBatch> {
    requireImportWrite(auth);
    const batch = await this.getBatch(auth, batchId);
    if (batch.created_by && batch.created_by !== auth.userId && auth.highestRole === 'AR Clerk') {
      throw new AuthorizationError('AR Clerk can only execute their own import batches.');
    }
    if (batch.status === 'Cancelled') {
      throw new BusinessError('IMPORT_CANCELLED', 'Cancelled import batches cannot be modified.', 400);
    }
    return batch;
  }

  private async validateRow(auth: AuthContext, importType: ImportType, raw: Record<string, unknown>): Promise<RowValidationResult> {
    return importType === 'receipt'
      ? await this.validateReceiptRow(auth, raw)
      : await this.validateInvoiceRow(auth, raw);
  }

  private async validateInvoiceRow(auth: AuthContext, raw: Record<string, unknown>): Promise<RowValidationResult> {
    const errors: Array<Record<string, unknown>> = [];
    let mappedData: Record<string, unknown> | undefined;

    try {
      const classification = await this.customerService.classifyImportCustomer(auth, {
        customerCode: asString(raw, 'customer_code') || undefined,
        customerName: asString(raw, 'customer_name') || undefined,
        registrationNo: asString(raw, 'registration_no') || undefined,
      });
      const customer = classification.customer;
      let customerInput: CreateCustomerRequest | undefined;
      const invoiceDate = asString(raw, 'invoice_date');
      const rawCurrency = asString(raw, 'currency');
      const description = asString(raw, 'description');
      const quantity = parseNumber(asString(raw, 'quantity') || '1', 'quantity');
      const unitPrice = parseNumber(asString(raw, 'unit_price'), 'unit_price');
      const referenceNo = asString(raw, 'reference_no') || undefined;
      const taxCodeId = await this.resolveTaxCode(auth.companyId, raw);
      const fxGovernanceFields = importFxGovernanceFields(raw);

      if (classification.action === 'Review Required') {
        const currency = (rawCurrency || 'MYR').toUpperCase();
        validateDate(invoiceDate, 'invoice_date');
        validateCurrency(currency, 'currency');
        validateInvoiceLines([{
          description,
          quantity,
          unit_price: unitPrice,
          tax_code_id: taxCodeId,
        }]);

        mappedData = {
          doc_type: 'Invoice',
          invoice_date: invoiceDate,
          customer_id: null,
          customer_input: null,
          customer_resolution: this.toCustomerResolutionDetails(classification),
          currency,
          ...fxGovernanceFields,
          reference_no: referenceNo,
          internal_remarks: 'Created by Sprint F4 import draft-only flow',
          invoice_remarks: asString(raw, 'invoice_remarks') || undefined,
          lines: [{
            description,
            quantity,
            unit_price: unitPrice,
            tax_code_id: taxCodeId,
          }],
          ...this.customerSuggestionDiagnostics(classification),
        };

        return { mappedData, errors, status: 'Unmatched' };
      }

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const currency = (
        rawCurrency
        || customer?.default_currency
        || COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency
        || 'MYR'
      ).toUpperCase();

      mappedData = {
        doc_type: 'Invoice',
        invoice_date: invoiceDate,
        customer_id: customer?.id,
        customer_input: customerInput,
        customer_resolution: this.toCustomerResolutionDetails(classification),
        currency,
        ...fxGovernanceFields,
        reference_no: referenceNo,
        internal_remarks: 'Created by Sprint F4 import draft-only flow',
        invoice_remarks: asString(raw, 'invoice_remarks') || undefined,
        lines: [{
          description,
          quantity,
          unit_price: unitPrice,
          tax_code_id: taxCodeId,
        }],
      };

      if (customer) {
        validateCreateInvoice(mappedData);
      } else {
        validateDate(invoiceDate, 'invoice_date');
        validateCurrency(currency, 'currency');
      }
      validateInvoiceLines(mappedData.lines);

      if (referenceNo && customer) {
        await this.assertNoDuplicateReference(auth.companyId, customer.id, referenceNo);
      }
    } catch (error) {
      errors.push(...errorToRowErrors(error));
    }

    return { mappedData, errors };
  }

  private async validateReceiptRow(auth: AuthContext, raw: Record<string, unknown>): Promise<RowValidationResult> {
    const errors: Array<Record<string, unknown>> = [];
    let mappedData: Record<string, unknown> | undefined;

    try {
      const classification = await this.customerService.classifyImportCustomer(auth, {
        customerCode: asString(raw, 'customer_code') || undefined,
        customerName: asString(raw, 'customer_name') || undefined,
        registrationNo: asString(raw, 'registration_no') || undefined,
      });
      const customer = classification.customer;
      let customerInput: CreateCustomerRequest | undefined;

      const bankAccount = await this.resolveBankAccount(auth.companyId, raw);
      const receiptDate = asString(raw, 'receipt_date');
      const rawCurrency = asString(raw, 'currency');
      const currency = (
        rawCurrency
        || customer?.default_currency
        || 'MYR'
      ).toUpperCase();
      const receiptAmount = parseNumber(asString(raw, 'amount'), 'amount');
      const fxGovernanceFields = importFxGovernanceFields(raw);
      const referenceNo = asString(raw, 'receipt_reference') || undefined;
      const chequeDate = asString(raw, 'cheque_date') || undefined;
      const valueDate = asString(raw, 'value_date') || undefined;
      const remarks = asString(raw, 'remarks') || undefined;
      const invoiceReference = asString(raw, 'invoice_reference') || undefined;
      const allocationAmountText = asString(raw, 'allocation_amount');
      const allocationAmount = allocationAmountText
        ? parseNumber(allocationAmountText, 'allocation_amount')
        : undefined;
      const discountAmount = hasImportValue(raw, 'discount_amount')
        ? parseNumber(asString(raw, 'discount_amount'), 'discount_amount')
        : undefined;
      const bankChargeAmount = hasImportValue(raw, 'bank_charge_amount')
        ? parseNumber(asString(raw, 'bank_charge_amount'), 'bank_charge_amount')
        : undefined;
      const shortPaymentReason = asString(raw, 'short_payment_reason').toLowerCase() || undefined;

      if (classification.action === 'Review Required') {
        validateDate(receiptDate, 'receipt_date');
        validateCurrency(currency, 'currency');

        mappedData = {
          receipt_date: receiptDate,
          customer_id: null,
          customer_input: null,
          customer_resolution: this.toCustomerResolutionDetails(classification),
          payment_method: asString(raw, 'payment_method'),
          currency,
          ...fxGovernanceFields,
          receipt_amount: receiptAmount,
          bank_account_id: bankAccount.bank_account_id,
          bank_account_resolution: bankAccount,
          reference_no: referenceNo,
          cheque_date: chequeDate,
          value_date: valueDate,
          remarks,
          invoice_reference: invoiceReference,
          allocation_amount: allocationAmount,
          discount_amount: discountAmount,
          bank_charge_amount: bankChargeAmount,
          short_payment_reason: shortPaymentReason,
          allocation_status: invoiceReference ? 'Pending Review' : 'None',
          internal_remarks: 'Created by Sprint F4 receipt import flow',
          ...this.customerSuggestionDiagnostics(classification),
        };

        validateCreateReceipt({
          ...mappedData,
          customer_id: NIL_UUID,
        });

        return { mappedData, errors, status: 'Unmatched' };
      }

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const resolvedCurrency = (
        rawCurrency
        || customer?.default_currency
        || COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency
        || 'MYR'
      ).toUpperCase();

      if (!invoiceReference && allocationAmount !== undefined) {
        throw new ValidationError('allocation_amount requires invoice_reference.', {
          field: 'allocation_amount',
        });
      }
      if (!invoiceReference && discountAmount !== undefined) {
        throw new ValidationError('discount_amount requires invoice_reference.', {
          field: 'discount_amount',
        });
      }
      if (allocationAmount !== undefined && allocationAmount <= 0) {
        throw new ValidationError('allocation_amount must be greater than 0.', {
          field: 'allocation_amount',
        });
      }
      if (discountAmount !== undefined && discountAmount < 0) {
        throw new ValidationError('discount_amount cannot be negative.', {
          field: 'discount_amount',
        });
      }
      if (bankChargeAmount !== undefined && bankChargeAmount < 0) {
        throw new ValidationError('bank_charge_amount cannot be negative.', {
          field: 'bank_charge_amount',
        });
      }
      if (allocationAmount !== undefined && allocationAmount > receiptAmount + 0.01) {
        throw new ValidationError('allocation_amount cannot exceed receipt amount.', {
          field: 'allocation_amount',
          allocation_amount: allocationAmount,
          receipt_amount: receiptAmount,
        });
      }

      mappedData = {
        receipt_date: receiptDate,
        customer_id: customer?.id,
        customer_input: customerInput,
        customer_resolution: this.toCustomerResolutionDetails(classification),
        payment_method: asString(raw, 'payment_method'),
        currency: resolvedCurrency,
        ...fxGovernanceFields,
        receipt_amount: receiptAmount,
        bank_account_id: bankAccount.bank_account_id,
        bank_account_resolution: bankAccount,
        reference_no: referenceNo,
        cheque_date: chequeDate,
        value_date: valueDate,
        remarks,
        invoice_reference: invoiceReference,
        allocation_amount: allocationAmount,
        discount_amount: discountAmount,
        bank_charge_amount: bankChargeAmount,
        short_payment_reason: shortPaymentReason,
        allocation_status: invoiceReference ? 'Pending' : 'None',
        internal_remarks: 'Created by Sprint F4 receipt import flow',
      };

      validateCreateReceipt({
        ...mappedData,
        customer_id: customer?.id ?? NIL_UUID,
      });

      if (invoiceReference && customer) {
        const invoiceReview = await this.invoiceReferenceSuggestionDiagnostics(
          auth.companyId,
          customer.id,
          resolvedCurrency,
          invoiceReference,
          mappedData,
        );
        if (invoiceReview) {
          return { mappedData: invoiceReview.mappedData, errors, status: invoiceReview.status };
        }
      }
    } catch (error) {
      errors.push(...errorToRowErrors(error));
    }

    return { mappedData, errors };
  }

  private async resolveOrCreateImportCustomer(
    auth: AuthContext,
    raw: Record<string, unknown>,
    cache: Map<string, ResolvedImportCustomer>,
  ): Promise<ResolvedImportCustomer> {
    const cacheKey = this.importCustomerCacheKey(raw);
    const classification = await this.customerService.classifyImportCustomer(auth, {
      customerCode: asString(raw, 'customer_code') || undefined,
      customerName: asString(raw, 'customer_name') || undefined,
      registrationNo: asString(raw, 'registration_no') || undefined,
    });

    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        created: false,
        details: {
          ...cached.details,
          action: 'Matched Existing',
          matched_by: cached.created ? 'created_in_batch' : cached.details.matched_by,
        },
      };
    }

    if (classification.customer) {
      await requireCustomerAccess(auth, classification.customer.id);
      const resolved = {
        customer: classification.customer,
        created: false,
        details: this.toCustomerResolutionDetails(classification),
      };
      cache.set(cacheKey, resolved);
      return resolved;
    }

    if (classification.action === 'Review Required') {
      throw new ValidationError('Customer fuzzy match requires manual review before import execution.', {
        field: 'customer_name',
        reason: 'customer_suggestion_review_required',
        suggestions: classification.suggestions,
      });
    }

    const customerInput = this.validateNewCustomerInput(raw);
    const result = await this.customerService.createInlineCustomer(auth, customerInput);
    await requireCustomerAccess(auth, result.customer.id);
    const resolved = {
      customer: result.customer,
      created: result.created,
      details: {
        action: result.created ? 'Create New' as const : 'Matched Existing' as const,
        customer_id: result.customer.id,
        customer_code: result.customer.customer_id,
        customer_name: result.customer.customer_name,
        matched_by: result.created ? null : 'normalized_name' as const,
      },
    };
    cache.set(cacheKey, resolved);
    return resolved;
  }

  private validateNewCustomerInput(raw: Record<string, unknown>): CreateCustomerRequest {
    return validateCreateCustomer({
      customer_name: asString(raw, 'customer_name'),
      customer_type: 'Corporate',
      registration_no: asString(raw, 'registration_no'),
      bill_addr_line1: asString(raw, 'bill_addr_line1'),
      bill_city: asString(raw, 'bill_city'),
      bill_state: asString(raw, 'bill_state'),
      bill_postal: asString(raw, 'bill_postal'),
      bill_country: asString(raw, 'bill_country'),
      contact_name: asString(raw, 'contact_name'),
      contact_phone: asString(raw, 'contact_phone'),
      contact_email: asString(raw, 'contact_email'),
    });
  }

  private importCustomerCacheKey(raw: Record<string, unknown>): string {
    const code = asString(raw, 'customer_code');
    if (code) return `code:${code.toLocaleUpperCase()}`;
    return `name:${asString(raw, 'customer_name').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
  }

  private toCustomerResolutionDetails(classification: Awaited<ReturnType<CustomerService['classifyImportCustomer']>>): CustomerResolutionDetails {
    return {
      action: classification.action,
      customer_id: classification.customer?.id ?? null,
      customer_code: classification.customer?.customer_id ?? null,
      customer_name: classification.customer?.customer_name ?? classification.normalizedCustomerName,
      matched_by: classification.matchedBy,
    };
  }

  private customerSuggestionDiagnostics(
    classification: Awaited<ReturnType<CustomerService['classifyImportCustomer']>>,
  ): Record<string, unknown> {
    const suggestions = classification.suggestions ?? [];
    if (suggestions.length === 0) return {};

    return {
      review_required: true,
      review_kind: 'customer_suggestion',
      confidence: classification.confidence ?? suggestions[0].confidence,
      suggestion_reason: classification.suggestionReason ?? suggestions[0].reason,
      match_confidence: classification.confidence ?? suggestions[0].confidence,
      match_reason_codes: [classification.suggestionReason ?? suggestions[0].reason],
      suggested_customer_id: suggestions[0].customer_id,
      suggested_customer_code: suggestions[0].customer_code,
      suggested_customer_name: suggestions[0].customer_name,
      suggested_customers: suggestions,
      customer_candidates: suggestions,
      user_action: 'pending',
    };
  }

  private async resolveBankAccount(companyId: string, raw: Record<string, unknown>): Promise<BankAccountResolutionDetails> {
    const bankAccountId = asString(raw, 'bank_account_id');
    const bankAccountCode = asString(raw, 'bank_account_code');

    if (!bankAccountId && !bankAccountCode) {
      throw new ValidationError('Either bank_account_id or bank_account_code is required for receipt import.', {
        field: 'bank_account_id',
      });
    }

    let bankAccount: BankAccount | null = null;
    let matchedBy: BankAccountResolutionDetails['matched_by'] = 'bank_account_code';

    if (bankAccountId) {
      validateUUID(bankAccountId, 'bank_account_id');
      bankAccount = await fetchById<BankAccount>(this.client, 'bank_accounts', bankAccountId);
      matchedBy = 'bank_account_id';
    } else {
      const { data, error } = await this.client
        .from('bank_accounts')
        .select('*')
        .eq('company_id', companyId)
        .eq('account_no', bankAccountCode)
        .limit(2);

      if (error) throw new Error(`Failed to resolve bank_account_code: ${error.message}`);
      if (!data || data.length === 0) {
        throw new ValidationError(`Active bank_account_code "${bankAccountCode}" could not be resolved.`, {
          field: 'bank_account_code',
          bank_account_code: bankAccountCode,
        });
      }
      if (data.length > 1) {
        throw new ValidationError(`Multiple bank accounts found for bank_account_code "${bankAccountCode}". Use bank_account_id.`, {
          field: 'bank_account_code',
          bank_account_code: bankAccountCode,
        });
      }
      bankAccount = data[0] as BankAccount;
    }

    if (bankAccount.company_id !== companyId) {
      throw new NotFoundError('BankAccount', bankAccount.id);
    }
    if (!bankAccount.is_active) {
      throw new ValidationError('Selected bank account is inactive.', { field: 'bank_account_id', bank_account_id: bankAccount.id });
    }
    if (bankAccountCode && bankAccount.account_no !== bankAccountCode) {
      throw new ValidationError('bank_account_code conflicts with resolved bank_account_id.', {
        field: 'bank_account_code',
        bank_account_id: bankAccount.id,
        bank_account_code: bankAccountCode,
      });
    }

    return {
      bank_account_id: bankAccount.id,
      account_no: bankAccount.account_no,
      bank_name: bankAccount.bank_name,
      matched_by: matchedBy,
    };
  }

  private async invoiceReferenceSuggestionDiagnostics(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
    mappedData: Record<string, unknown>,
  ): Promise<{ status: ImportRowStatus; mappedData: Record<string, unknown> } | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select('id, invoice_no, currency, status, outstanding')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .limit(250);

    if (error) throw new Error(`Failed to inspect invoice_reference suggestions: ${error.message}`);

    const invoices = (data ?? []) as Array<Pick<Invoice, 'id' | 'invoice_no' | 'currency' | 'status' | 'outstanding'>>;
    const rawMatch = invoices.find((invoice) => invoice.invoice_no === invoiceReference);
    if (rawMatch) {
      if (rawMatch.currency !== currency) {
        return {
          status: 'Unmatched',
          mappedData: this.invoiceSuggestionMappedData(mappedData, 'currency_mismatch', [{
            invoice_id: rawMatch.id,
            invoice_no: rawMatch.invoice_no,
            confidence: 1,
            reason: 'exact_invoice_no_currency_mismatch',
            outstanding: Number(rawMatch.outstanding),
            currency: rawMatch.currency,
            status: rawMatch.status,
            allocatable: false,
          }], 'Invoice reference matches an invoice, but its currency does not match the receipt currency.'),
        };
      }
      if (!this.isAllocatableInvoice(rawMatch)) {
        return {
          status: 'Skipped',
          mappedData: this.invoiceSuggestionMappedData(mappedData, Number(rawMatch.outstanding) <= 0 ? 'no_outstanding' : 'invoice_not_open', [{
            invoice_id: rawMatch.id,
            invoice_no: rawMatch.invoice_no,
            confidence: 1,
            reason: Number(rawMatch.outstanding) <= 0 ? 'no_outstanding' : 'invoice_not_open',
            outstanding: Number(rawMatch.outstanding),
            currency: rawMatch.currency,
            status: rawMatch.status,
            allocatable: false,
          }], 'Invoice reference matches an invoice, but it is not currently allocatable.'),
        };
      }
      return null;
    }

    const normalizedReference = normalizeIdentifier(invoiceReference);
    const normalizedMatches = invoices
      .filter((invoice) => normalizeIdentifier(invoice.invoice_no) === normalizedReference)
      .slice(0, FUZZY_CANDIDATE_LIMIT)
      .map((invoice) => this.invoiceCandidate(invoice, this.normalizedInvoiceSuggestionReason(invoice, currency), 0.97, currency));

    if (normalizedMatches.length > 0) {
      return {
        status: normalizedMatches.some((candidate) => candidate.allocatable) ? 'Unmatched' : this.nonAllocatableSuggestionStatus(normalizedMatches),
        mappedData: this.invoiceSuggestionMappedData(
          mappedData,
          'normalized_invoice_no',
          normalizedMatches,
          'Invoice reference differs from an existing invoice number only by spacing, case, or punctuation. Review is required before allocation.',
        ),
      };
    }

    const allocatableInvoices = invoices.filter((invoice) => invoice.currency === currency && this.isAllocatableInvoice(invoice));
    const fuzzyMatches = topFuzzyCandidates(
      invoiceReference,
      allocatableInvoices,
      (invoice) => invoice.invoice_no,
      FUZZY_INVOICE_REVIEW_THRESHOLD,
    ).map((candidate) => this.invoiceCandidate(candidate.item, candidate.reason, candidate.confidence, currency));

    if (fuzzyMatches.length > 0) {
      return {
        status: 'Unmatched',
        mappedData: this.invoiceSuggestionMappedData(
          mappedData,
          fuzzyMatches.length > 1 ? 'multiple_invoice_candidates' : String(fuzzyMatches[0].reason),
          fuzzyMatches,
          'Invoice reference did not match exactly. Review the suggested invoice before allocation.',
        ),
      };
    }

    return {
      status: 'Unmatched',
      mappedData: this.invoiceSuggestionMappedData(
        mappedData,
        'invoice_not_found',
        [],
        'No invoice found for this invoice_reference. Review is required before posting/allocation.',
      ),
    };
  }

  private invoiceCandidate(
    invoice: Pick<Invoice, 'id' | 'invoice_no' | 'currency' | 'status' | 'outstanding'>,
    reason: string,
    confidence: number,
    receiptCurrency: string,
  ): Record<string, unknown> {
    return {
      invoice_id: invoice.id,
      invoice_no: invoice.invoice_no,
      confidence,
      reason,
      outstanding: Number(invoice.outstanding),
      currency: invoice.currency,
      status: invoice.status,
      allocatable: invoice.currency === receiptCurrency && this.isAllocatableInvoice(invoice),
    };
  }

  private normalizedInvoiceSuggestionReason(
    invoice: Pick<Invoice, 'currency' | 'status' | 'outstanding'>,
    receiptCurrency: string,
  ): string {
    if (invoice.currency !== receiptCurrency) return 'currency_mismatch';
    if (Number(invoice.outstanding) <= 0) return 'no_outstanding';
    if (!['Open', 'Overdue', 'Partially Paid'].includes(invoice.status)) return 'invoice_not_open';
    return 'normalized_invoice_no';
  }

  private invoiceSuggestionMappedData(
    mappedData: Record<string, unknown>,
    reason: string,
    candidates: Array<Record<string, unknown>>,
    message: string,
  ): Record<string, unknown> {
    const top = candidates[0];
    const autoRejected = candidates.length === 0 && reason === 'invoice_not_found';
    return {
      ...mappedData,
      review_required: true,
      review_kind: mappedData.review_kind === 'customer_suggestion' ? 'both' : 'invoice_suggestion',
      allocation_status: 'Review Required',
      allocation_error: message,
      allocation_error_reason: reason,
      confidence: top?.confidence,
      suggestion_reason: reason,
      match_confidence: top?.confidence,
      match_reason_codes: [reason],
      suggested_invoice_id: top?.invoice_id ?? null,
      suggested_invoice_no: top?.invoice_no ?? null,
      suggested_invoices: candidates,
      invoice_candidates: candidates,
      user_action: autoRejected ? 'auto_rejected' : 'pending',
      ...(autoRejected ? {
        review_result: 'rejected',
        rejected_at: new Date().toISOString(),
        auto_rejected: true,
        auto_reject_reason: reason,
      } : {}),
    };
  }

  private nonAllocatableSuggestionStatus(candidates: Array<Record<string, unknown>>): ImportRowStatus {
    return candidates.some((candidate) => candidate.reason === 'no_outstanding' || candidate.reason === 'invoice_not_open')
      ? 'Skipped'
      : 'Unmatched';
  }

  private isAllocatableInvoice(invoice: Pick<Invoice, 'status' | 'outstanding'>): boolean {
    return ['Open', 'Overdue', 'Partially Paid'].includes(invoice.status) && Number(invoice.outstanding) > 0;
  }

  private async preflightReceiptImportAllocation(
    auth: AuthContext,
    customerId: string,
    mappedData: Record<string, unknown>,
  ): Promise<{ status: ImportRowStatus; mappedData: Record<string, unknown> } | null> {
    const invoiceReference = asString(mappedData, 'invoice_reference');
    if (!invoiceReference) return null;

    const explicitAmount = mappedData.allocation_amount !== undefined
      ? Number(mappedData.allocation_amount)
      : undefined;
    const discountAmount = mappedData.discount_amount !== undefined
      ? Number(mappedData.discount_amount)
      : 0;
    if (explicitAmount !== undefined && (!Number.isFinite(explicitAmount) || explicitAmount <= 0)) {
      throw new ValidationError('allocation_amount must be greater than 0.', {
        field: 'allocation_amount',
        invoice_reference: invoiceReference,
      });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new ValidationError('discount_amount cannot be negative.', {
        field: 'discount_amount',
        invoice_reference: invoiceReference,
      });
    }

    let invoice: Invoice;
    try {
      invoice = await this.resolveAllocationInvoice(
        auth.companyId,
        customerId,
        asString(mappedData, 'currency'),
        invoiceReference,
      );
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const reason = typeof error.details.reason === 'string'
        ? error.details.reason
        : 'allocation_preflight_failed';
      return {
        status: this.importAllocationPreflightStatus(reason),
        mappedData: {
          ...mappedData,
          allocation_status: reason === 'invoice_not_found_for_customer' || reason === 'currency_mismatch' || reason === 'multiple_matches'
            ? 'Unmatched'
            : 'Review Required',
          review_required: true,
          auto_post_eligible: false,
          auto_post_block_reason: error.message,
          allocation_error: error.message,
          allocation_error_reason: reason,
          invoice_status: error.details.invoice_status,
          invoice_currency: error.details.invoice_currency,
          receipt_currency: error.details.receipt_currency,
          outstanding: error.details.outstanding,
        },
      };
    }

    const invoiceOutstanding = Number(invoice.outstanding);
    const allocationAmount = explicitAmount ?? Math.min(Number(mappedData.receipt_amount), invoiceOutstanding);
    const settlementAmount = allocationAmount + discountAmount;
    if (settlementAmount <= invoiceOutstanding + 0.01) return null;

    const receiptAmount = Number(mappedData.receipt_amount);
    const allocationSuggestion = roundMoney(Math.min(receiptAmount, invoiceOutstanding));
    const unappliedAmount = roundMoney(Math.max(receiptAmount - allocationSuggestion, 0));
    const reason = discountAmount > 0
      ? 'allocation_amount plus discount_amount exceeds invoice outstanding'
      : 'allocation_amount exceeds invoice outstanding';

    return {
      status: 'Skipped',
      mappedData: {
        ...mappedData,
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        allocation_status: 'Review Required',
        review_required: true,
        auto_post_eligible: false,
        auto_post_block_reason: reason,
        overpayment_detected: discountAmount === 0,
        discount_validation_error: discountAmount > 0 ? reason : undefined,
        excess_settlement_amount: discountAmount > 0 ? roundMoney(settlementAmount - invoiceOutstanding) : undefined,
        suggested_reason: discountAmount > 0 ? 'discount' : mappedData.suggested_reason,
        unapplied_amount: unappliedAmount,
        allocation_suggestion: allocationSuggestion,
      },
    };
  }

  private importAllocationPreflightStatus(reason: string): ImportRowStatus {
    return ['invoice_not_open', 'no_outstanding'].includes(reason) ? 'Skipped' : 'Unmatched';
  }

  private async allocateReceiptImportRow(
    auth: AuthContext,
    importRowId: string,
    receiptId: string,
    mappedData: Record<string, unknown>,
  ): Promise<{ status: ImportRowStatus; mappedData: Record<string, unknown>; allocated: boolean }> {
    const invoiceReference = asString(mappedData, 'invoice_reference');

    if (!invoiceReference) {
      return {
        status: 'Posted',
        allocated: false,
        mappedData: {
          ...mappedData,
          allocation_status: 'Skipped',
          allocation_error: 'No invoice_reference provided.',
        },
      };
    }

    try {
      const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
      const invoice = await this.resolveAllocationInvoice(
        auth.companyId,
        receipt.customer_id,
        receipt.currency,
        invoiceReference,
      );
      const explicitAmount = mappedData.allocation_amount !== undefined
        ? Number(mappedData.allocation_amount)
        : undefined;
      const discountAmount = mappedData.discount_amount !== undefined
        ? Number(mappedData.discount_amount)
        : 0;
      const bankChargeAmount = mappedData.bank_charge_amount !== undefined
        ? Number(mappedData.bank_charge_amount)
        : undefined;
      const shortPaymentReason = asString(mappedData, 'short_payment_reason');
      const allocationAmount = explicitAmount ?? Math.min(Number(receipt.unallocated_amount), Number(invoice.outstanding));
      const overpaymentDetected = explicitAmount === undefined
        && Number(receipt.unallocated_amount) > Number(invoice.outstanding) + 0.005;
      const settlementAmount = allocationAmount + discountAmount;
      const shortPaymentDifference = roundMoney(Math.max(Number(invoice.outstanding) - settlementAmount, 0));
      const bankChargeDetected = bankChargeAmount !== undefined || shortPaymentReason === 'bank_charge';
      const shortPaymentDetected = shortPaymentDifference > 0.005 || bankChargeDetected;

      if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
        throw new ValidationError('allocation_amount must be greater than 0.', {
          field: 'allocation_amount',
          invoice_reference: invoiceReference,
        });
      }
      if (!Number.isFinite(discountAmount) || discountAmount < 0) {
        throw new ValidationError('discount_amount cannot be negative.', {
          field: 'discount_amount',
          invoice_reference: invoiceReference,
        });
      }

      const allocations = await this.allocationService.manualAllocate(auth, {
        receipt_id: receiptId,
        allocations: [{
          invoice_id: invoice.id,
          amount: allocationAmount,
          ...(discountAmount > 0 ? { discount_amount: discountAmount } : {}),
        }],
      });

      const allocation = allocations[0];
      if (!allocation?.id) {
        throw new Error('Allocation RPC completed but no allocation_details row was returned.');
      }
      const updatedReceipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);

      const allocatedMappedData: Record<string, unknown> = {
        ...mappedData,
        allocation_status: 'Allocated',
        allocation_id: allocation.id,
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        allocated_amount: allocation.allocated_amount,
        ...(discountAmount > 0 ? {
          discount_amount: discountAmount,
          discount_applied: true,
        } : {}),
        ...(shortPaymentDetected ? {
          short_payment_detected: true,
          difference_amount: shortPaymentDifference > 0.005
            ? shortPaymentDifference
            : roundMoney(bankChargeAmount ?? 0),
          suggested_reason: bankChargeDetected ? 'bank_charge' : 'underpayment',
          review_required: bankChargeDetected ? true : false,
        } : {}),
        ...(bankChargeDetected ? {
          bank_charge_amount: bankChargeAmount,
          bank_charge_posting_required: true,
          bank_charge_review_reason: 'Bank charge accounting is not automated in Batch 5. The received amount was allocated only; classify and post bank charges through a future GL-safe flow.',
        } : {}),
        ...(overpaymentDetected ? {
          overpayment_detected: true,
          unapplied_amount: Number(updatedReceipt.unallocated_amount),
          allocation_suggestion: allocationAmount,
        } : {}),
      };

      const { error: auditError } = await this.client.from('import_row_allocations').insert({
        import_row_id: importRowId,
        allocation_id: allocation.id,
        invoice_id: invoice.id,
        allocated_amount: allocation.allocated_amount,
      });
      if (auditError) {
        return {
          status: 'Allocated',
          allocated: true,
          mappedData: {
            ...allocatedMappedData,
            allocation_evidence_status: 'Error',
            allocation_evidence_error: `Failed to record import allocation evidence: ${auditError.message}`,
          },
        };
      }

      return {
        status: 'Allocated',
        allocated: true,
        mappedData: {
          ...allocatedMappedData,
          allocation_evidence_status: 'Recorded',
        },
      };
    } catch (error) {
      const details = error instanceof ValidationError ? error.details : {};
      return {
        status: 'Unmatched',
        allocated: false,
        mappedData: {
          ...mappedData,
          allocation_status: 'Error',
          allocation_error: this.errorMessage(error),
          allocation_error_reason: typeof details.reason === 'string' ? details.reason : 'allocation_failed',
        },
      };
    }
  }

  private async resolveAllocationInvoice(
    companyId: string,
    customerId: string,
    currency: string,
    invoiceReference: string,
  ): Promise<Invoice> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .eq('invoice_no', invoiceReference)
      .eq('customer_id', customerId)
      .limit(2);

    if (error) throw new Error(`Failed to resolve invoice_reference: ${error.message}`);
    if (!data || data.length === 0) {
      throw new ValidationError(`No invoice found for invoice_reference "${invoiceReference}" for this customer.`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
        reason: 'invoice_not_found_for_customer',
      });
    }
    if (data.length > 1) {
      throw new ValidationError(`Multiple invoices matched invoice_reference "${invoiceReference}".`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
        reason: 'multiple_matches',
      });
    }

    const invoice = data[0] as Invoice;
    if (invoice.currency !== currency) {
      throw new ValidationError(`Invoice ${invoice.invoice_no} currency (${invoice.currency}) does not match receipt currency (${currency}).`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
        reason: 'currency_mismatch',
        invoice_currency: invoice.currency,
        receipt_currency: currency,
      });
    }

    if (!['Open', 'Overdue', 'Partially Paid'].includes(invoice.status)) {
      throw new ValidationError(`Invoice ${invoice.invoice_no} status (${invoice.status}) does not allow allocation.`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
        reason: 'invoice_not_open',
        invoice_status: invoice.status,
      });
    }

    if (Number(invoice.outstanding) <= 0) {
      throw new ValidationError(`Invoice ${invoice.invoice_no} has no outstanding balance to allocate.`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
        reason: 'no_outstanding',
        outstanding: invoice.outstanding,
      });
    }

    return invoice;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private rowHasPostingError(row: ImportRow): boolean {
    return Boolean(row.mapped_data && row.mapped_data.posting_status === 'Error');
  }

  private async assertNoDuplicateReference(
    companyId: string,
    customerId: string,
    referenceNo?: string,
  ): Promise<void> {
    if (!referenceNo) return;
    const { count, error } = await this.client
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('reference_no', referenceNo)
      .neq('status', 'Cancelled');

    if (error) throw new Error(`Failed duplicate reference check: ${error.message}`);
    if ((count ?? 0) > 0) {
      throw new ValidationError(`Duplicate invoice reference_no "${referenceNo}" for this customer.`, {
        field: 'reference_no',
        reference_no: referenceNo,
      });
    }
  }

  private async resolveTaxCode(companyId: string, raw: Record<string, unknown>): Promise<string | undefined> {
    const explicitTaxCodeId = asString(raw, 'tax_code_id');
    if (explicitTaxCodeId) {
      validateUUID(explicitTaxCodeId, 'tax_code_id');
      return explicitTaxCodeId;
    }

    const taxRateText = asString(raw, 'tax_rate');
    if (!taxRateText) return undefined;
    const taxRate = parseNumber(taxRateText, 'tax_rate');
    if (taxRate <= 0) return undefined;

    const { data, error } = await this.client
      .from('tax_codes')
      .select('id')
      .eq('company_id', companyId)
      .eq('tax_type', 'Output')
      .eq('is_active', true)
      .eq('rate', taxRate)
      .limit(2);

    if (error) throw new Error(`Failed to resolve tax code: ${error.message}`);
    if (!data || data.length === 0) {
      throw new ValidationError(`No active output tax code found for tax_rate ${taxRate}.`, { tax_rate: taxRate });
    }
    if (data.length > 1) {
      throw new ValidationError(`Multiple output tax codes found for tax_rate ${taxRate}. Use tax_code_id.`, { tax_rate: taxRate });
    }
    return data[0].id;
  }

  private async listRowsInternal(batchId: string): Promise<ImportRow[]> {
    const { data, error } = await this.client
      .from('import_rows')
      .select('*')
      .eq('batch_id', batchId)
      .order('row_number');

    if (error) throw new Error(`Failed to list import rows: ${error.message}`);
    return (data ?? []) as ImportRow[];
  }

  private async updateBatch(batchId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.client
      .from('import_batches')
      .update(patch)
      .eq('id', batchId);
    if (error) throw new Error(`Failed to update import batch: ${error.message}`);
  }

  private async markBatchFailed(batchId: string, errors: Array<Record<string, unknown>>): Promise<void> {
    await this.updateBatch(batchId, {
      status: 'Failed',
      error_summary: errors,
      completed_at: new Date().toISOString(),
    });
  }
}
