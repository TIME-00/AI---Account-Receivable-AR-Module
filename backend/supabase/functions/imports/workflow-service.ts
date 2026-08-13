import {
  BusinessError,
  NotFoundError,
  ValidationError,
} from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { validateUUID } from "../_shared/validators.ts";
import type { Invoice, PaginationParams, Receipt } from "../_shared/types.ts";
import {
  validateCreateInvoice,
  validateInvoiceLines,
} from "../invoices/validators.ts";
import { validateCreateReceipt } from "../receipts/validators.ts";
import { parseCsv } from "./csv.ts";
import { parseXlsx } from "./xlsx.ts";
import {
  asString,
  BUCKET,
  errorToRowErrors,
  type ExecuteImportOptions,
  type ImportBatch,
  type ImportFileRecord,
  importOriginPayload,
  type ImportRow,
  type ImportRowStatus,
  MAX_ROWS,
  requireImportRead,
  requireImportWrite,
  requireSupportedImportBatch,
  type ResolvedImportCustomer,
  rowError,
} from "./service-base.ts";
import { ImportIntakeService } from "./intake-service.ts";
export abstract class ImportWorkflowService extends ImportIntakeService {
  async parseBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    const fileType = requireSupportedImportBatch(batch, "parse");

    if (batch.status !== "Uploaded") {
      throw new ValidationError(
        `Only Uploaded batches can be parsed. Current status: ${batch.status}.`,
      );
    }
    if (!batch.file_path) {
      throw new ValidationError("Import batch has no uploaded file path.");
    }

    await this.updateBatch(batch.id, {
      status: "Parsing",
      error_summary: null,
    });

    try {
      const { data, error } = await this.client.storage.from(BUCKET).download(
        batch.file_path,
      );
      if (error || !data) {
        throw new Error(
          `Failed to download import file: ${
            error?.message ?? "No file returned"
          }`,
        );
      }

      const parsed = fileType === "xlsx"
        ? parseXlsx(await data.arrayBuffer())
        : parseCsv(await data.text());

      if (parsed.rows.length > MAX_ROWS) {
        throw new ValidationError(
          `${fileType.toUpperCase()} has ${parsed.rows.length} rows. Sprint F4 limit is ${MAX_ROWS}.`,
        );
      }

      const { count: existingRows, error: existingRowsError } = await this
        .client
        .from("import_rows")
        .select("id", { count: "exact", head: true })
        .eq("batch_id", batch.id);

      if (existingRowsError) {
        throw new Error(
          `Failed to check existing import rows: ${existingRowsError.message}`,
        );
      }
      if ((existingRows ?? 0) > 0) {
        throw new ValidationError(
          "This batch has already been parsed. Create a new batch to re-import corrected data.",
        );
      }

      const insertRows = parsed.rows.map((row, idx) => ({
        batch_id: batch.id,
        row_number: idx + 1,
        raw_data: row,
        status: "Pending",
      }));

      const { data: rows, error: rowsError } = await this.client
        .from("import_rows")
        .insert(insertRows)
        .select()
        .order("row_number");

      if (rowsError) {
        throw new Error(`Failed to insert import rows: ${rowsError.message}`);
      }

      await this.updateBatch(batch.id, {
        status: "Parsed",
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
      await this.markBatchFailed(batch.id, [{
        stage: "parse",
        message: error instanceof Error ? error.message : "Parse failed",
      }]);
      throw error;
    }
  }

  async validateBatch(
    auth: AuthContext,
    batchId: string,
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    requireSupportedImportBatch(batch, "validate");

    if (batch.status !== "Parsed" && batch.status !== "Validated") {
      throw new ValidationError(
        `Only Parsed or Validated batches can be validated. Current status: ${batch.status}.`,
      );
    }
    await this.updateBatch(batch.id, {
      status: "Validating",
      error_summary: null,
    });

    const rows = await this.listRowsInternal(batch.id);
    if (rows.length === 0) {
      throw new ValidationError(
        "Import batch has no parsed rows. Run parse first.",
      );
    }

    let validRows = 0;
    let errorRows = 0;
    let skippedRows = 0;
    let unmatchedRows = 0;
    const errorSummary: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      const result = await this.validateRow(
        auth,
        batch.import_type,
        row.raw_data,
      );
      if (result.errors.length > 0) {
        errorRows += 1;
        errorSummary.push({ row: row.row_number, errors: result.errors });
        await this.client
          .from("import_rows")
          .update({
            status: "Error",
            mapped_data: result.mappedData ?? null,
            validation_errors: result.errors,
          })
          .eq("id", row.id);
      } else {
        const rowStatus = result.status ?? "Valid";
        if (rowStatus === "Valid") {
          validRows += 1;
        } else if (rowStatus === "Unmatched" || rowStatus === "Skipped") {
          errorRows += 1;
          if (rowStatus === "Unmatched") unmatchedRows += 1;
          if (rowStatus === "Skipped") skippedRows += 1;
        }
        await this.client
          .from("import_rows")
          .update({
            status: rowStatus,
            mapped_data: result.mappedData,
            validation_errors: null,
          })
          .eq("id", row.id);
      }
    }

    await this.updateBatch(batch.id, {
      status: "Validated",
      valid_rows: validRows,
      error_rows: errorRows,
      skipped_count: skippedRows,
      unmatched_count: unmatchedRows,
      error_summary: errorSummary.length > 0 ? errorSummary : null,
    });

    return {
      batch: await this.getBatch(auth, batch.id),
      rows: await this.listRowsInternal(batch.id),
    };
  }

  async executeDraftCreation(
    auth: AuthContext,
    batchId: string,
    options: ExecuteImportOptions = {},
  ): Promise<{ batch: ImportBatch; rows: ImportRow[] }> {
    requireImportWrite(auth);
    const batch = await this.getWritableBatch(auth, batchId);
    requireSupportedImportBatch(batch, "execute");
    const autoPost = options.autoPost === true;

    if (autoPost && batch.import_type !== "receipt") {
      throw new ValidationError(
        "auto_post is allowed only for receipt import batches.",
        {
          import_type: batch.import_type,
          auto_post: autoPost,
        },
      );
    }

    if (batch.status !== "Parsed" && batch.status !== "Validated") {
      throw new ValidationError(
        `Only Parsed or Validated batches can be executed. Current status: ${batch.status}.`,
      );
    }

    let rows = await this.listRowsInternal(batch.id);
    if (rows.length === 0) {
      throw new ValidationError(
        "Import batch has no parsed rows. Run parse first.",
      );
    }

    if (rows.some((row) => row.status === "Pending")) {
      await this.validateBatch(auth, batch.id);
      rows = await this.listRowsInternal(batch.id);
    }

    await this.updateBatch(batch.id, {
      status: "Executing",
      auto_post: autoPost,
      auto_allocate: false,
    });

    let createdCount = 0;
    let postedCount = 0;
    let allocatedCount = 0;
    const matchedCustomerIds = new Set<string>();
    const createdCustomerIds = new Set<string>();
    const resolvedCustomers = new Map<string, ResolvedImportCustomer>();
    let errorRows = rows.filter((row) => row.status === "Error").length;
    const errorSummary: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      if (row.status !== "Valid") continue;
      if (!row.mapped_data) {
        errorRows += 1;
        const errors = [
          rowError("mapped_data", "Validated row is missing mapped_data."),
        ];
        errorSummary.push({ row: row.row_number, errors });
        await this.client.from("import_rows").update({
          status: "Error",
          validation_errors: errors,
        }).eq("id", row.id);
        continue;
      }

      try {
        const resolved = await this.resolveOrCreateImportCustomer(
          auth,
          row.raw_data,
          resolvedCustomers,
        );
        const importOrigin = importOriginPayload(batch, row);
        if (resolved.created) {
          createdCustomerIds.add(resolved.customer.id);
        } else if (!createdCustomerIds.has(resolved.customer.id)) {
          matchedCustomerIds.add(resolved.customer.id);
        }

        let created: Invoice | Receipt;
        let mappedData: Record<string, unknown>;

        let rowStatus: ImportRowStatus = "Created";
        const rowPatch = {
          invoice_id: null as string | null,
          receipt_id: null as string | null,
        };

        if (batch.import_type === "invoice") {
          mappedData = {
            ...row.mapped_data,
            customer_id: resolved.customer.id,
            customer_resolution: resolved.details,
          };
          await this.assertNoDuplicateReference(
            auth.companyId,
            resolved.customer.id,
            asString(mappedData, "reference_no"),
          );
          const header = validateCreateInvoice(mappedData);
          const lines = validateInvoiceLines(row.mapped_data.lines);
          created = await this.invoiceService.createInvoice(
            auth,
            header,
            lines,
            { importOrigin },
          );
          rowPatch.invoice_id = created.id;
        } else {
          const bankAccount = await this.resolveBankAccount(
            auth.companyId,
            row.raw_data,
          );
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
            await this.client.from("import_rows").update({
              status: preflight.status,
              invoice_id: null,
              receipt_id: null,
              mapped_data: preflight.mappedData,
              validation_errors: null,
            }).eq("id", row.id);
            continue;
          }

          created = await this.receiptService.createReceipt(
            auth,
            receiptInput,
            { importOrigin },
          );
          rowPatch.receipt_id = created.id;

          if (autoPost) {
            const explicitRateSupplied =
              receiptInput.exchange_rate !== undefined;
            const { data: company } = await this.client
              .from("companies")
              .select("base_currency")
              .eq("id", auth.companyId)
              .single();
            const explicitSameCurrencyParity = explicitRateSupplied &&
              receiptInput.currency === company?.base_currency &&
              Number(receiptInput.exchange_rate) === 1;

            if (explicitRateSupplied && !explicitSameCurrencyParity) {
              rowStatus = "Created";
              mappedData = {
                ...mappedData,
                posting_status: "HeldGovernance",
                posting_error:
                  "Explicit imported FX rate is governed as MANUAL_OVERRIDE and requires review before posting.",
              };
            } else {
              try {
                await this.receiptService.postReceipt(auth, created.id);
                postedCount += 1;
                rowStatus = "Posted";
                mappedData = {
                  ...mappedData,
                  posting_status: "Posted",
                };
              } catch (postError) {
                rowStatus = "Created";
                mappedData = {
                  ...mappedData,
                  posting_status: "Error",
                  posting_error: this.errorMessage(postError),
                };
              }
            }

            if (rowStatus === "Posted") {
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

        await this.client.from("import_rows").update({
          status: rowStatus,
          ...rowPatch,
          mapped_data: mappedData,
          validation_errors: null,
        }).eq("id", row.id);
      } catch (error) {
        errorRows += 1;
        const errors = errorToRowErrors(error);
        errorSummary.push({ row: row.row_number, errors });
        await this.client.from("import_rows").update({
          status: "Error",
          validation_errors: errors,
        }).eq("id", row.id);
      }
    }

    const finalRows = await this.listRowsInternal(batch.id);
    const finalValidRows = finalRows.filter((row) =>
      row.status === "Valid" ||
      row.status === "Created" ||
      row.status === "Posted" ||
      row.status === "Allocated"
    ).length;
    const finalErrorRows = finalRows.filter((row) =>
      row.status === "Error" ||
      row.status === "Unmatched" ||
      this.rowHasPostingError(row)
    ).length;
    const finalSkippedRows =
      finalRows.filter((row) => row.status === "Skipped").length;
    const finalUnmatchedRows =
      finalRows.filter((row) => row.status === "Unmatched").length;

    await this.updateBatch(batch.id, {
      status: "Completed",
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

    return {
      batch: await this.getBatch(auth, batch.id),
      rows: await this.listRowsInternal(batch.id),
    };
  }

  async listBatches(
    auth: AuthContext,
    pagination: PaginationParams,
  ): Promise<{ batches: ImportBatch[]; total: number }> {
    requireImportRead(auth);

    let query = this.client
      .from("import_batches")
      .select("*", { count: "exact" })
      .eq("company_id", auth.companyId)
      .order("created_at", { ascending: false });

    const from = (pagination.page - 1) * pagination.page_size;
    const to = from + pagination.page_size - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) {
      throw new Error(`Failed to list import batches: ${error.message}`);
    }
    return { batches: (data ?? []) as ImportBatch[], total: count ?? 0 };
  }

  async getBatch(auth: AuthContext, batchId: string): Promise<ImportBatch> {
    requireImportRead(auth);
    validateUUID(batchId, "batch_id");
    const { data, error } = await this.client
      .from("import_batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();

    if (error) {
      throw new BusinessError(
        "IMPORT_BATCH_FETCH_FAILED",
        "Failed to fetch import batch.",
        500,
        { batch_id: batchId, db_message: error.message },
      );
    }
    if (!data) throw new NotFoundError("ImportBatch", batchId);

    const batch = data as ImportBatch;
    if (batch.company_id !== auth.companyId) {
      throw new NotFoundError("ImportBatch", batchId);
    }
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
      "id",
      "batch_id",
      "row_number",
      "raw_data",
      "mapped_data",
      "status",
      "validation_errors",
      "invoice_id",
      "receipt_id",
      "je_no",
      "duplicate_of",
      "created_at",
      "updated_at",
    ].join(",");

    const { data, error } = await this.client
      .from("import_rows")
      .select(selectColumns)
      .eq("batch_id", batchId)
      .order("row_number")
      .range(from, to);

    if (error) {
      throw new BusinessError(
        "IMPORT_ROWS_LIST_FAILED",
        "Failed to list import rows for this batch.",
        500,
        { batch_id: batchId, db_message: error.message },
      );
    }

    const { count, error: countError } = await this.client
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId);

    if (countError) {
      console.error("[IMPORT_ROWS_COUNT_ERROR]", {
        batch_id: batchId,
        message: countError.message,
      });
    }

    const rows = (data ?? []) as unknown as ImportRow[];
    return { rows, total: count ?? rows.length };
  }

  protected async getImportFile(
    batchId: string,
    fileId: string,
  ): Promise<ImportFileRecord> {
    validateUUID(fileId, "file_id");
    const { data, error } = await this.client
      .from("import_files")
      .select("*")
      .eq("id", fileId)
      .eq("batch_id", batchId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch import file: ${error.message}`);
    if (!data) throw new NotFoundError("ImportFile", fileId);
    return data as ImportFileRecord;
  }
}
