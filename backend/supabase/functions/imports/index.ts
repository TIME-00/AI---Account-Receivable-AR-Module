// ============================================================================
// TSH Synergy ERP - Accounts Receivable Module
// Edge Function: imports
// Sprint F4 - CSV/XLSX Smart Invoice/Receipt Import, Draft Only
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';
import { parsePagination, validateUUID } from '../_shared/validators.ts';
import { ImportService } from './service.ts';

const UUID = '([0-9a-f\\-]{36})';
const ALLOWED_FILE_TYPES = ['csv', 'xlsx'];
const ALLOWED_IMPORT_TYPES = ['invoice', 'receipt'];

const ROUTES: Record<string, RegExp> = {
  ocrUpload:  /^\/ocr\/upload\/?$/i,
  ocrReview: new RegExp(`^\\/${UUID}\\/ocr-review\\/?$`, 'i'),
  previewUrl: new RegExp(`^\\/${UUID}\\/files\\/${UUID}\\/preview-url\\/?$`, 'i'),
  ocrStart: new RegExp(`^\\/${UUID}\\/files\\/${UUID}\\/ocr\\/start\\/?$`, 'i'),
  ocrRowReview: new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/ocr-review\\/?$`, 'i'),
  approveDraft: new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/approve-draft\\/?$`, 'i'),
  upload:     /^\/upload\/?$/i,
  parse:      new RegExp(`^\\/${UUID}\\/parse\\/?$`, 'i'),
  validate:   new RegExp(`^\\/${UUID}\\/validate\\/?$`, 'i'),
  execute:    new RegExp(`^\\/${UUID}\\/execute\\/?$`, 'i'),
  review:     new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/review\\/?$`, 'i'),
  rows:       new RegExp(`^\\/${UUID}\\/rows\\/?$`, 'i'),
  single:     new RegExp(`^\\/${UUID}\\/?$`, 'i'),
  collection: /^\/?$/i,
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/imports');
  if (idx !== -1) {
    return pathname.slice(idx + '/imports'.length) || '/';
  }
  return pathname;
}

function matchRoute(url: URL): { route: string; params: Record<string, string> } {
  const subPath = getSubPath(url.pathname);
  for (const [name, pattern] of Object.entries(ROUTES)) {
    const match = subPath.match(pattern);
    if (match) {
      if (name === 'review') {
        return { route: name, params: { id: match[1], batchId: match[1], rowId: match[2] } };
      }
      if (name === 'previewUrl' || name === 'ocrStart') {
        return { route: name, params: { id: match[1], batchId: match[1], fileId: match[2] } };
      }
      if (name === 'ocrRowReview' || name === 'approveDraft') {
        return { route: name, params: { id: match[1], batchId: match[1], rowId: match[2] } };
      }
      return { route: name, params: match[1] ? { id: match[1] } : {} };
    }
  }
  return { route: 'notFound', params: {} };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const { route, params } = matchRoute(url);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const service = new ImportService();

    if (route === 'ocrUpload' && req.method === 'POST') {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new ValidationError('Multipart field "file" is required.');
      }

      const importType = String(form.get('import_type') ?? 'invoice');
      const fileType = String(form.get('file_type') ?? '');
      const batchNameRaw = form.get('batch_name');
      const result = await service.uploadOcrIntakeFile(auth, {
        file,
        fileType,
        importType,
        batchName: typeof batchNameRaw === 'string' ? batchNameRaw : undefined,
      });
      return jsonResponse(successResponse(result), 201);
    }

    if (route === 'upload' && req.method === 'POST') {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new ValidationError('Multipart field "file" is required.');
      }

      const importType = String(form.get('import_type') ?? 'invoice');
      if (!ALLOWED_IMPORT_TYPES.includes(importType)) {
        throw new ValidationError('Sprint F4 only supports import_type=invoice or import_type=receipt.');
      }

      const fileType = String(form.get('file_type') ?? 'csv');
      if (!ALLOWED_FILE_TYPES.includes(fileType)) {
        throw new ValidationError('Sprint F4 only supports file_type=csv or file_type=xlsx.');
      }

      const batchNameRaw = form.get('batch_name');
      const batch = await service.uploadFile(auth, {
        file,
        fileType: fileType as 'csv' | 'xlsx',
        importType: importType as 'invoice' | 'receipt',
        batchName: typeof batchNameRaw === 'string' ? batchNameRaw : undefined,
      });
      return jsonResponse(successResponse(batch), 201);
    }

    if (route === 'parse' && req.method === 'POST') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      const result = await service.parseBatch(auth, id);
      return jsonResponse(successResponse(result));
    }

    if (route === 'previewUrl' && req.method === 'GET') {
      const { batchId, fileId } = params;
      validateUUID(batchId, 'batch_id');
      validateUUID(fileId, 'file_id');
      const result = await service.createOcrPreviewUrl(auth, batchId, fileId);
      return jsonResponse(successResponse(result));
    }

    if (route === 'ocrStart' && req.method === 'POST') {
      const { batchId, fileId } = params;
      validateUUID(batchId, 'batch_id');
      validateUUID(fileId, 'file_id');
      const result = await service.startOcr(auth, batchId, fileId);
      return jsonResponse(successResponse(result));
    }

    if (route === 'ocrReview' && req.method === 'GET') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      const result = await service.listOcrReviewItems(auth, id);
      return jsonResponse(successResponse(result));
    }

    if (route === 'ocrRowReview' && req.method === 'PATCH') {
      const { batchId, rowId } = params;
      validateUUID(batchId, 'batch_id');
      validateUUID(rowId, 'row_id');
      let body: Record<string, unknown> = {};
      if (req.headers.get('Content-Type')?.includes('application/json')) {
        const parsed = await req.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        }
      }
      const result = await service.saveOcrReview(auth, batchId, rowId, body);
      return jsonResponse(successResponse(result));
    }

    if (route === 'approveDraft' && req.method === 'POST') {
      const { batchId, rowId } = params;
      validateUUID(batchId, 'batch_id');
      validateUUID(rowId, 'row_id');
      let body: Record<string, unknown> = {};
      if (req.headers.get('Content-Type')?.includes('application/json')) {
        const parsed = await req.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        }
      }
      const result = await service.approveOcrDraft(auth, batchId, rowId, body);
      return jsonResponse(successResponse(result));
    }

    if (route === 'validate' && req.method === 'POST') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      const result = await service.validateBatch(auth, id);
      return jsonResponse(successResponse(result));
    }

    if (route === 'execute' && req.method === 'POST') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      let body: Record<string, unknown> = {};
      if (req.headers.get('Content-Type')?.includes('application/json')) {
        const parsed = await req.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        }
      }
      const result = await service.executeDraftCreation(auth, id, {
        autoPost: body.auto_post === true,
      });
      return jsonResponse(successResponse(result));
    }

    if (route === 'review' && req.method === 'POST') {
      const { batchId, rowId } = params;
      validateUUID(batchId, 'batch_id');
      validateUUID(rowId, 'row_id');
      let body: Record<string, unknown> = {};
      if (req.headers.get('Content-Type')?.includes('application/json')) {
        const parsed = await req.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        }
      }
      const result = await service.reviewRow(auth, batchId, rowId, body);
      return jsonResponse(successResponse(result));
    }

    if (route === 'collection' && req.method === 'GET') {
      const pagination = parsePagination(url);
      const { batches, total } = await service.listBatches(auth, pagination);
      return jsonResponse(successResponse(batches, {
        total,
        page: pagination.page,
        page_size: pagination.page_size,
      }));
    }

    if (route === 'single' && req.method === 'GET') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      const batch = await service.getBatch(auth, id);
      return jsonResponse(successResponse(batch));
    }

    if (route === 'rows' && req.method === 'GET') {
      const { id } = params;
      validateUUID(id, 'batch_id');
      const pagination = parsePagination(url);
      const { rows, total } = await service.listRows(auth, id, pagination);
      return jsonResponse(successResponse(rows, {
        total,
        page: pagination.page,
        page_size: pagination.page_size,
      }));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
      404,
    );
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
