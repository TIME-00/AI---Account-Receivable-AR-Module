// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Sprint F4 Import Service
// CSV/XLSX Invoice Import, Draft Only
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
import { validateUUID } from '../_shared/validators.ts';
import type { Customer, Invoice, PaginationParams } from '../_shared/types.ts';
import { InvoiceService } from '../invoices/service.ts';
import {
  validateCreateInvoice,
  validateInvoiceLines,
} from '../invoices/validators.ts';
import type {
  CreateInvoiceInput,
  CreateInvoiceLineInput,
} from '../invoices/validators.ts';
import { parseCsv } from './csv.ts';
import { parseXlsx } from './xlsx.ts';

const BUCKET = 'ar-imports';
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500;
const READ_ROLES = ['AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor'];
const WRITE_ROLES = ['AR Clerk', 'AR Supervisor', 'Finance Manager'];
const ALLOWED_IMPORT_FILE_TYPES = ['csv', 'xlsx'] as const;

type ImportFileType = typeof ALLOWED_IMPORT_FILE_TYPES[number];

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

type ImportRowStatus = 'Pending' | 'Valid' | 'Error' | 'Skipped' | 'Created';

interface ImportBatch {
  id: string;
  company_id: string;
  batch_name: string;
  import_type: 'invoice' | 'receipt';
  file_type: 'csv' | 'xlsx' | 'pdf' | 'image';
  file_name: string;
  file_path: string | null;
  status: ImportBatchStatus;
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
}

interface UploadInput {
  file: File;
  fileType: ImportFileType;
  batchName?: string;
}

interface RowValidationResult {
  mappedData?: Record<string, unknown>;
  errors: Array<Record<string, unknown>>;
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
  return typeof value === 'string' ? value.trim() : '';
}

function parseNumber(value: string, field: string): number {
  const normalized = value.replace(/,/g, '');
  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`Field "${field}" must be numeric.`, { field, value });
  }
  return num;
}

function rowError(field: string, message: string): Record<string, unknown> {
  return { field, message };
}

function isAllowedImportFileType(fileType: string): fileType is ImportFileType {
  return ALLOWED_IMPORT_FILE_TYPES.includes(fileType as ImportFileType);
}

function requireInvoiceImportFileType(batch: ImportBatch, stage: string): ImportFileType {
  if (batch.import_type !== 'invoice') {
    throw new ValidationError(`Phase B ${stage} supports invoice imports only.`);
  }

  if (!isAllowedImportFileType(batch.file_type)) {
    throw new ValidationError(`Phase B ${stage} supports csv and xlsx files only.`);
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

  constructor(client?: SupabaseClient) {
    this.client = client ?? getAdminClient();
    this.invoiceService = new InvoiceService(this.client);
  }

  async uploadFile(auth: AuthContext, input: UploadInput): Promise<ImportBatch> {
    requireImportWrite(auth);

    if (!isAllowedImportFileType(input.fileType)) {
      throw new ValidationError('Phase B only supports csv and xlsx invoice imports.', { file_type: input.fileType });
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
      throw new ValidationError(`Import file exceeds the ${mb} MB Phase B limit.`);
    }

    const batchName = input.batchName?.trim() || input.file.name.replace(/\.(csv|xlsx)$/i, '');

    const { data: batch, error: batchError } = await this.client
      .from('import_batches')
      .insert({
        company_id: auth.companyId,
        batch_name: batchName,
        import_type: 'invoice',
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
    const fileType = requireInvoiceImportFileType(batch, 'parse');

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
        throw new ValidationError(`${fileType.toUpperCase()} has ${parsed.rows.length} rows. Phase B limit is ${MAX_ROWS}.`);
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
    requireInvoiceImportFileType(batch, 'validate');

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
      const result = await this.validateRow(auth, row.raw_data);
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

  async executeDraftCreation(auth: AuthContext, batchId: string): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    requireInvoiceImportFileType(batch, 'execute');

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

    await this.updateBatch(batch.id, { status: 'Executing' });

    let createdCount = 0;
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
        const header = validateCreateInvoice(row.mapped_data);
        const lines = validateInvoiceLines(row.mapped_data.lines);
        const invoice = await this.invoiceService.createInvoice(auth, header, lines);
        createdCount += 1;

        await this.client.from('import_rows').update({
          status: 'Created',
          invoice_id: invoice.id,
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
    const finalValidRows = finalRows.filter((row) => row.status === 'Valid' || row.status === 'Created').length;
    const finalErrorRows = finalRows.filter((row) => row.status === 'Error').length;

    await this.updateBatch(batch.id, {
      status: 'Completed',
      completed_at: new Date().toISOString(),
      valid_rows: finalValidRows,
      error_rows: finalErrorRows,
      created_count: createdCount,
      posted_count: 0,
      allocated_count: 0,
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

  private async validateRow(auth: AuthContext, raw: Record<string, unknown>): Promise<RowValidationResult> {
    const errors: Array<Record<string, unknown>> = [];
    let mappedData: Record<string, unknown> | undefined;

    try {
      const customer = await this.resolveCustomer(auth, raw);
      await requireCustomerAccess(auth, customer.id);

      const invoiceDate = asString(raw, 'invoice_date');
      const currency = (asString(raw, 'currency') || customer.default_currency || 'MYR').toUpperCase();
      const description = asString(raw, 'description');
      const quantity = parseNumber(asString(raw, 'quantity') || '1', 'quantity');
      const unitPrice = parseNumber(asString(raw, 'unit_price'), 'unit_price');
      const referenceNo = asString(raw, 'reference_no') || undefined;
      const taxCodeId = await this.resolveTaxCode(auth.companyId, raw);

      mappedData = {
        doc_type: 'Invoice',
        invoice_date: invoiceDate,
        customer_id: customer.id,
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

      validateCreateInvoice(mappedData);
      validateInvoiceLines(mappedData.lines);

      if (referenceNo) {
        const { count, error } = await this.client
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', auth.companyId)
          .eq('customer_id', customer.id)
          .eq('reference_no', referenceNo)
          .neq('status', 'Cancelled');

        if (error) throw new Error(`Failed duplicate reference check: ${error.message}`);
        if ((count ?? 0) > 0) {
          errors.push(rowError('reference_no', `Duplicate invoice reference_no "${referenceNo}" for this customer.`));
        }
      }
    } catch (error) {
      errors.push(...errorToRowErrors(error));
    }

    return { mappedData, errors };
  }

  private async resolveCustomer(auth: AuthContext, raw: Record<string, unknown>): Promise<Customer> {
    const uuid = asString(raw, 'customer_id');
    const code = asString(raw, 'customer_code');
    const name = asString(raw, 'customer_name');

    if (uuid) {
      validateUUID(uuid, 'customer_id');
      const customer = await fetchById<Customer>(this.client, 'customers', uuid);
      if (customer.company_id !== auth.companyId || customer.is_deleted) {
        throw new NotFoundError('Customer', uuid);
      }
      return customer;
    }

    let query = this.client
      .from('customers')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('is_deleted', false);

    if (code) {
      query = query.eq('customer_id', code);
    } else if (name) {
      query = query.ilike('customer_name', name);
    } else {
      throw new ValidationError('One of customer_id, customer_code, or customer_name is required.');
    }

    const { data, error } = await query.limit(2);
    if (error) throw new Error(`Failed to resolve customer: ${error.message}`);
    if (!data || data.length === 0) {
      throw new ValidationError('Customer could not be resolved.', { customer_code: code, customer_name: name });
    }
    if (data.length > 1) {
      throw new ValidationError('Customer match is ambiguous. Use customer_id UUID or customer_code.', {
        customer_name: name,
        matches: data.length,
      });
    }
    return data[0] as Customer;
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
