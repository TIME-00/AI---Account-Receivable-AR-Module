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
  | 'Cancelled';

type ImportRowStatus = 'Pending' | 'Valid' | 'Error' | 'Skipped' | 'Created' | 'Posted' | 'Allocated' | 'Unmatched';

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

interface RowValidationResult {
  mappedData?: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
}

interface ExecuteImportOptions {
  autoPost?: boolean;
}

interface CustomerResolutionDetails {
  action: 'Matched Existing' | 'Create New';
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  matched_by: 'customer_code' | 'normalized_name' | 'created_in_batch' | null;
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

function rowError(field: string, message: string): Record<string, unknown> {
  return { field, message };
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
        validRows += 1;
        await this.client
          .from('import_rows')
          .update({
            status: 'Valid',
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
          created = await this.invoiceService.createInvoice(auth, header, lines);
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
          if (autoPost) {
            const preflight = await this.preflightExplicitReceiptImportOverAllocation(
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
          }

          created = await this.receiptService.createReceipt(auth, receiptInput);
          rowPatch.receipt_id = created.id;

          if (autoPost) {
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
    const batch = await fetchById<ImportBatch>(this.client, 'import_batches', batchId);
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

    const { data, error, count } = await this.client
      .from('import_rows')
      .select('*', { count: 'exact' })
      .eq('batch_id', batchId)
      .order('row_number')
      .range(from, to);

    if (error) throw new Error(`Failed to list import rows: ${error.message}`);
    return { rows: (data ?? []) as ImportRow[], total: count ?? 0 };
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

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const invoiceDate = asString(raw, 'invoice_date');
      const currency = (
        asString(raw, 'currency')
        || customer?.default_currency
        || COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency
        || 'MYR'
      ).toUpperCase();
      const description = asString(raw, 'description');
      const quantity = parseNumber(asString(raw, 'quantity') || '1', 'quantity');
      const unitPrice = parseNumber(asString(raw, 'unit_price'), 'unit_price');
      const referenceNo = asString(raw, 'reference_no') || undefined;
      const taxCodeId = await this.resolveTaxCode(auth.companyId, raw);

      mappedData = {
        doc_type: 'Invoice',
        invoice_date: invoiceDate,
        customer_id: customer?.id,
        customer_input: customerInput,
        customer_resolution: this.toCustomerResolutionDetails(classification),
        currency,
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

      if (customer) {
        await requireCustomerAccess(auth, customer.id);
      } else {
        customerInput = this.validateNewCustomerInput(raw);
      }

      const bankAccount = await this.resolveBankAccount(auth.companyId, raw);
      const receiptDate = asString(raw, 'receipt_date');
      const currency = (
        asString(raw, 'currency')
        || customer?.default_currency
        || COUNTRY_DEFAULTS[customerInput!.bill_country]?.currency
        || 'MYR'
      ).toUpperCase();
      const receiptAmount = parseNumber(asString(raw, 'amount'), 'amount');
      const referenceNo = asString(raw, 'receipt_reference') || undefined;
      const chequeDate = asString(raw, 'cheque_date') || undefined;
      const valueDate = asString(raw, 'value_date') || undefined;
      const remarks = asString(raw, 'remarks') || undefined;
      const invoiceReference = asString(raw, 'invoice_reference') || undefined;
      const allocationAmountText = asString(raw, 'allocation_amount');
      const allocationAmount = allocationAmountText
        ? parseNumber(allocationAmountText, 'allocation_amount')
        : undefined;

      if (!invoiceReference && allocationAmount !== undefined) {
        throw new ValidationError('allocation_amount requires invoice_reference.', {
          field: 'allocation_amount',
        });
      }
      if (allocationAmount !== undefined && allocationAmount <= 0) {
        throw new ValidationError('allocation_amount must be greater than 0.', {
          field: 'allocation_amount',
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
        currency,
        receipt_amount: receiptAmount,
        bank_account_id: bankAccount.bank_account_id,
        bank_account_resolution: bankAccount,
        reference_no: referenceNo,
        cheque_date: chequeDate,
        value_date: valueDate,
        remarks,
        invoice_reference: invoiceReference,
        allocation_amount: allocationAmount,
        allocation_status: invoiceReference ? 'Pending' : 'None',
        internal_remarks: 'Created by Sprint F4 receipt import flow',
      };

      validateCreateReceipt({
        ...mappedData,
        customer_id: customer?.id ?? NIL_UUID,
      });
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

  private async preflightExplicitReceiptImportOverAllocation(
    auth: AuthContext,
    customerId: string,
    mappedData: Record<string, unknown>,
  ): Promise<{ status: ImportRowStatus; mappedData: Record<string, unknown> } | null> {
    const invoiceReference = asString(mappedData, 'invoice_reference');
    if (!invoiceReference || mappedData.allocation_amount === undefined) return null;

    const explicitAmount = Number(mappedData.allocation_amount);
    if (!Number.isFinite(explicitAmount) || explicitAmount <= 0) return null;

    let invoice: Invoice;
    try {
      invoice = await this.resolveAllocationInvoice(
        auth.companyId,
        customerId,
        asString(mappedData, 'currency'),
        invoiceReference,
      );
    } catch {
      return null;
    }

    const invoiceOutstanding = Number(invoice.outstanding);
    if (explicitAmount <= invoiceOutstanding + 0.01) return null;

    const receiptAmount = Number(mappedData.receipt_amount);
    const allocationSuggestion = roundMoney(Math.min(receiptAmount, invoiceOutstanding));
    const unappliedAmount = roundMoney(Math.max(receiptAmount - allocationSuggestion, 0));

    return {
      status: 'Skipped',
      mappedData: {
        ...mappedData,
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        allocation_status: 'Review Required',
        review_required: true,
        auto_post_eligible: false,
        auto_post_block_reason: 'allocation_amount exceeds invoice outstanding',
        overpayment_detected: true,
        unapplied_amount: unappliedAmount,
        allocation_suggestion: allocationSuggestion,
      },
    };
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
      const allocationAmount = explicitAmount ?? Math.min(Number(receipt.unallocated_amount), Number(invoice.outstanding));
      const overpaymentDetected = explicitAmount === undefined
        && Number(receipt.unallocated_amount) > Number(invoice.outstanding) + 0.005;

      if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
        throw new ValidationError('allocation_amount must be greater than 0.', {
          field: 'allocation_amount',
          invoice_reference: invoiceReference,
        });
      }

      const allocations = await this.allocationService.manualAllocate(auth, {
        receipt_id: receiptId,
        allocations: [{
          invoice_id: invoice.id,
          amount: allocationAmount,
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
      return {
        status: 'Unmatched',
        allocated: false,
        mappedData: {
          ...mappedData,
          allocation_status: 'Error',
          allocation_error: this.errorMessage(error),
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
      .eq('currency', currency)
      .in('status', ['Open', 'Overdue', 'Partially Paid'])
      .limit(2);

    if (error) throw new Error(`Failed to resolve invoice_reference: ${error.message}`);
    if (!data || data.length === 0) {
      throw new ValidationError(`No matching open invoice found for invoice_reference "${invoiceReference}".`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
      });
    }
    if (data.length > 1) {
      throw new ValidationError(`Multiple open invoices matched invoice_reference "${invoiceReference}".`, {
        field: 'invoice_reference',
        invoice_reference: invoiceReference,
      });
    }

    return data[0] as Invoice;
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
