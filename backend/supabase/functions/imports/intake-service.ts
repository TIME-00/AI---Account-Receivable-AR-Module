import { BusinessError, ValidationError } from "../_shared/errors.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { validateOcrIntakeFile } from "./file_validation.ts";
import { getOcrProvider } from "./ocr_provider.ts";
import { validateOcrIntakeImportType } from "./intake_validation.ts";
import {
  BUCKET,
  type ImportBatch,
  type ImportFileRecord,
  type ImportRow,
  isAllowedImportFileType,
  isAllowedImportType,
  MAX_CSV_BYTES,
  MAX_XLSX_BYTES,
  mimeForImportFile,
  type OcrUploadInput,
  requireImportRead,
  requireImportWrite,
  requireSupervisorOrFinanceManager,
  safeStorageFileName,
  type UploadInput,
} from "./service-base.ts";
import { ImportServiceBase } from "./service-base.ts";
export abstract class ImportIntakeService extends ImportServiceBase {
  async uploadFile(
    auth: AuthContext,
    input: UploadInput,
  ): Promise<ImportBatch> {
    requireImportWrite(auth);

    if (!isAllowedImportType(input.importType)) {
      throw new ValidationError(
        "Sprint F4 supports invoice and receipt imports only.",
        { import_type: input.importType },
      );
    }
    if (!isAllowedImportFileType(input.fileType)) {
      throw new ValidationError(
        "Sprint F4 only supports csv and xlsx imports.",
        { file_type: input.fileType },
      );
    }

    const lowerName = input.file.name.toLowerCase();
    if (!lowerName.endsWith(`.${input.fileType}`)) {
      throw new ValidationError(
        `File extension must match file_type=${input.fileType}.`,
        {
          file_name: input.file.name,
          file_type: input.fileType,
        },
      );
    }

    if (input.file.size <= 0) {
      throw new ValidationError("Import file is empty.");
    }

    const maxBytes = input.fileType === "xlsx" ? MAX_XLSX_BYTES : MAX_CSV_BYTES;
    if (input.file.size > maxBytes) {
      const mb = maxBytes / 1024 / 1024;
      throw new ValidationError(
        `Import file exceeds the ${mb} MB Sprint F4 limit.`,
      );
    }

    const batchName = input.batchName?.trim() ||
      input.file.name.replace(/\.(csv|xlsx)$/i, "");

    const { data: batch, error: batchError } = await this.client
      .from("import_batches")
      .insert({
        company_id: auth.companyId,
        batch_name: batchName,
        import_type: input.importType,
        file_type: input.fileType,
        file_name: input.file.name,
        file_size_bytes: input.file.size,
        status: "Uploaded",
        auto_post: false,
        auto_allocate: false,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (batchError || !batch) {
      throw new Error(
        `Failed to create import batch: ${
          batchError?.message ?? "No row returned"
        }`,
      );
    }

    const filePath = `${auth.companyId}/${batch.id}/${input.file.name}`;
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, input.file, {
        contentType: mimeForImportFile(input.fileType, input.file.type),
        upsert: false,
      });

    if (uploadError) {
      await this.markBatchFailed(batch.id, [{
        stage: "upload",
        message: uploadError.message,
      }]);
      throw new Error(`Failed to upload import file: ${uploadError.message}`);
    }

    const { data: updated, error: updateError } = await this.client
      .from("import_batches")
      .update({ file_path: filePath })
      .eq("id", batch.id)
      .eq("company_id", auth.companyId)
      .select()
      .single();

    if (updateError || !updated) {
      throw new Error(
        `Failed to update import file path: ${
          updateError?.message ?? "No row returned"
        }`,
      );
    }

    await this.client.from("import_files").insert({
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
  ): Promise<
    {
      batch: ImportBatch;
      file: ImportFileRecord;
      row: ImportRow;
      manual_fallback: boolean;
    }
  > {
    requireImportWrite(auth);

    const importType = validateOcrIntakeImportType(input.importType);
    const validation = await validateOcrIntakeFile(input.file, input.fileType);
    const importLabel = importType === "receipt" ? "Receipt" : "Invoice";
    const baseFileName = input.file.name.replace(
      /\.(pdf|png|jpe?g|webp)$/i,
      "",
    );
    const batchName = input.batchName?.trim() ||
      `PDF/Image ${importLabel} Import - ${baseFileName}`;
    const safeName = safeStorageFileName(input.file.name);
    const reviewKind = importType === "receipt"
      ? "ocr_receipt_manual_entry"
      : "ocr_invoice_manual_entry";

    const { data: batch, error: batchError } = await this.client
      .from("import_batches")
      .insert({
        company_id: auth.companyId,
        batch_name: batchName,
        import_type: importType,
        file_type: validation.fileType,
        file_name: input.file.name,
        file_size_bytes: input.file.size,
        status: "NeedsReview",
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
      throw new Error(
        `Failed to create OCR import batch: ${
          batchError?.message ?? "No row returned"
        }`,
      );
    }

    const typedBatch = batch as ImportBatch;
    const filePath =
      `${auth.companyId}/${typedBatch.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(filePath, input.file, {
        contentType: validation.detectedMime,
        upsert: false,
      });

    if (uploadError) {
      await this.markBatchFailed(typedBatch.id, [{
        stage: "ocr_upload",
        message: uploadError.message,
      }]);
      throw new Error(
        `Failed to upload OCR intake file: ${uploadError.message}`,
      );
    }

    await this.updateBatch(typedBatch.id, { file_path: filePath });

    const ocrResult = {
      provider: "disabled_manual_fallback",
      status: "disabled",
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
      .from("import_files")
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
        ocr_status: "disabled",
        ocr_provider: "disabled_manual_fallback",
        ocr_result: ocrResult,
        retention_expires_at: validation.retentionExpiresAt,
      })
      .select()
      .single();

    if (fileError || !fileRecord) {
      await this.markBatchFailed(typedBatch.id, [{
        stage: "ocr_file_metadata",
        message: fileError?.message ?? "No file row returned",
      }]);
      throw new Error(
        `Failed to create OCR import file metadata: ${
          fileError?.message ?? "No row returned"
        }`,
      );
    }

    const { data: row, error: rowError } = await this.client
      .from("import_rows")
      .insert({
        batch_id: typedBatch.id,
        row_number: 1,
        raw_data: {
          source: "ocr_manual_fallback",
          import_type: importType,
          file_id: fileRecord.id,
          file_name: input.file.name,
          file_sha256: validation.sha256,
          ocr_status: "disabled",
          ocr_fields: {},
        },
        mapped_data: {
          source: "ocr_manual_fallback",
          review_required: true,
          review_kind: reviewKind,
          low_confidence: true,
          approval_required_role: "AR Supervisor or Finance Manager",
          reviewed_fields: {},
          message:
            "OCR is disabled. Enter and review the fields manually before creating a draft import.",
        },
        status: "NeedsReview",
        validation_errors: [{
          field: "ocr",
          message: "OCR provider disabled; manual review is required.",
        }],
      })
      .select()
      .single();

    if (rowError || !row) {
      await this.markBatchFailed(typedBatch.id, [{
        stage: "ocr_review_row",
        message: rowError?.message ?? "No row returned",
      }]);
      throw new Error(
        `Failed to create OCR review row: ${
          rowError?.message ?? "No row returned"
        }`,
      );
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
      throw new Error(
        `Failed to create OCR preview URL: ${
          error?.message ?? "No signed URL returned"
        }`,
      );
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

    if (file.scan_status === "rejected" || file.scan_status === "quarantined") {
      throw new ValidationError(
        "OCR cannot run on rejected or quarantined files.",
        {
          file_id: fileId,
          scan_status: file.scan_status,
        },
      );
    }

    const provider = getOcrProvider();
    if (!provider.isEnabled()) {
      const result = await provider.extract();
      await this.client
        .from("import_files")
        .update({
          ocr_status: "disabled",
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
        .eq("id", file.id)
        .eq("batch_id", batch.id);

      return {
        status: "disabled",
        provider: provider.name,
        manual_fallback: true,
        message:
          "OCR provider is disabled. Continue with manual review/draft intake.",
      };
    }

    throw new BusinessError(
      "OCR_PROVIDER_NOT_CONFIGURED",
      "OCR provider activation requires a separately approved provider implementation.",
      503,
    );
  }

  async listOcrReviewItems(
    auth: AuthContext,
    batchId: string,
  ): Promise<
    { batch: ImportBatch; files: ImportFileRecord[]; rows: ImportRow[] }
  > {
    const batch = await this.getBatch(auth, batchId);
    const { data: files, error: filesError } = await this.client
      .from("import_files")
      .select("*")
      .eq("batch_id", batch.id)
      .order("created_at");

    if (filesError) {
      throw new Error(`Failed to list OCR import files: ${filesError.message}`);
    }

    const rows = await this.listRowsInternal(batch.id);
    return {
      batch,
      files: (files ?? []) as ImportFileRecord[],
      rows: rows.filter((row) =>
        ["NeedsReview", "ApprovedDraft", "Rejected", "Error"].includes(
          row.status,
        )
      ),
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
    if (row.status !== "NeedsReview" && row.status !== "Error") {
      throw new ValidationError(
        "Only OCR rows needing review can be updated.",
        {
          row_id: rowId,
          status: row.status,
        },
      );
    }

    const reviewedFields = this.reviewedFields(payload.reviewed_fields);
    const note = this.reviewNote(payload.review_note);
    const previousMapped = row.mapped_data ?? {};
    const previousRaw = row.raw_data ?? {};
    const now = new Date().toISOString();

    const nextMappedData = {
      ...previousMapped,
      reviewed_fields: reviewedFields,
      review_result: "reviewed",
      reviewed_by: auth.userId,
      reviewed_at: now,
      review_note: note,
      review_required: true,
      source: "ocr_manual_fallback",
    };

    const updated = await this.updateReviewRow(row.id, {
      mapped_data: nextMappedData,
      validation_errors: null,
    });

    const fileId = typeof previousRaw.file_id === "string"
      ? previousRaw.file_id
      : null;
    await this.insertOcrReviewDecisions(
      auth,
      batch,
      row,
      fileId,
      reviewedFields,
      "reviewed",
      note,
    );

    return {
      row: updated,
      decisions_recorded: Object.keys(reviewedFields).length,
    };
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
      throw new ValidationError(
        "approve-draft requires reviewed OCR/manual fields first.",
        {
          row_id: rowId,
        },
      );
    }

    if (mappedData.low_confidence !== false) {
      requireSupervisorOrFinanceManager(auth);
    }

    const note = this.reviewNote(payload.review_note);
    const approvedAt = new Date().toISOString();
    const nextMappedData = {
      ...mappedData,
      review_result: "approved_draft",
      approved_by: auth.userId,
      approved_at: approvedAt,
      review_note: note ?? mappedData.review_note,
      financial_mutation: false,
      posting_status: "not_posted",
      allocation_status: "not_allocated",
    };

    const updated = await this.updateReviewRow(row.id, {
      status: "ApprovedDraft",
      mapped_data: nextMappedData,
      validation_errors: null,
    });

    await this.updateBatch(batch.id, {
      status: "ApprovedDraft",
      valid_rows: 0,
      error_rows: 0,
      created_count: 0,
      posted_count: 0,
      allocated_count: 0,
    });

    const fileId = typeof row.raw_data.file_id === "string"
      ? row.raw_data.file_id
      : null;
    await this.insertOcrReviewDecisions(
      auth,
      batch,
      row,
      fileId,
      reviewedFields,
      "approved_draft",
      note,
    );

    return {
      batch: await this.getBatch(auth, batch.id),
      row: updated,
      message:
        "OCR/manual intake approved as draft-only review data. No financial records were created; nothing was posted and no allocation was performed.",
    };
  }
}
