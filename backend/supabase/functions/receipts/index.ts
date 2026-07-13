// ============================================================================
// TSH Synergy ERP — Edge Function: receipts
// REST API for Receipt Management
// Force redeploy: 2026-04-14T03:02 — ensure latest CORS + route logic
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { getUserClient } from '../_shared/db.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination, validateUUID } from '../_shared/validators.ts';
import { ReceiptService } from './service.ts';
import {
  validateCreateReceipt,
  validatePostReceipt,
  validateCancelReceipt,
  validateBounceReceipt,
} from './validators.ts';

const ROUTES: Record<string, RegExp> = {
  collection: /^\/?$/,
  single: /^\/([0-9a-f\-]{36})\/?$/i,
  post: /^\/([0-9a-f\-]{36})\/post\/?$/i,
  cancel: /^\/([0-9a-f\-]{36})\/cancel\/?$/i,
  bounce: /^\/([0-9a-f\-]{36})\/bounce\/?$/i,
  clearCheque: /^\/([0-9a-f\-]{36})\/clear\/?$/i,
  unallocated: /^\/unallocated\/([0-9a-f\-]{36})\/?$/i,
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/receipts');
  if (idx !== -1) {
    return pathname.slice(idx + '/receipts'.length) || '/';
  }
  return pathname;
}

function matchRoute(url: URL): { route: string; params: Record<string, string> } {
  const subPath = getSubPath(url.pathname);
  for (const [name, pattern] of Object.entries(ROUTES)) {
    const match = subPath.match(pattern);
    if (match) return { route: name, params: match[1] ? { id: match[1] } : {} };
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
    const service = new ReceiptService(
      undefined,
      getUserClient(req.headers.get('Authorization')!),
    );

    if (route === 'collection') {
      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const data = validateCreateReceipt(body as Record<string, unknown>);
        const receipt = await service.createReceipt(auth, data);
        return jsonResponse(successResponse(receipt), 201);
      }
      if (req.method === 'GET') {
        const pagination = parsePagination(url);
        const filters: Record<string, string | undefined> = {
          status: url.searchParams.get('status') ?? undefined,
          customer_id: url.searchParams.get('customer_id') ?? undefined,
          payment_method: url.searchParams.get('payment_method') ?? undefined,
          posting_period: url.searchParams.get('posting_period') ?? undefined,
          date_from: url.searchParams.get('date_from') ?? undefined,
          date_to: url.searchParams.get('date_to') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
        };
        const { receipts, total, summary } = await service.listReceipts(auth, filters, pagination);
        return jsonResponse(successResponse(receipts, { total, page: pagination.page, page_size: pagination.page_size, summary }));
      }
    }

    if (route === 'single' && req.method === 'GET') {
      const receipt = await service.getReceiptById(auth, params.id);
      return jsonResponse(successResponse(receipt));
    }

    if (route === 'post' && req.method === 'POST') {
      const body = await parseRequestBody(req);
      const input = validatePostReceipt(body as Record<string, unknown>);
      const result = await service.postReceipt(auth, params.id, input);
      return jsonResponse(successResponse(result));
    }

    if (route === 'cancel' && req.method === 'POST') {
      const body = await parseRequestBody(req);
      const input = validateCancelReceipt(body as Record<string, unknown>);
      const result = await service.cancelReceipt(auth, params.id, input);
      return jsonResponse(successResponse(result));
    }

    if (route === 'bounce' && req.method === 'POST') {
      const body = await parseRequestBody(req);
      const input = validateBounceReceipt(body as Record<string, unknown>);
      const result = await service.handleBouncedCheque(auth, params.id, input);
      return jsonResponse(successResponse(result));
    }

    if (route === 'clearCheque' && req.method === 'POST') {
      const body = await parseRequestBody(req);
      const clearanceDate = (body as Record<string, unknown>).clearance_date
        ? String((body as Record<string, unknown>).clearance_date) : undefined;
      const result = await service.clearCheque(auth, params.id, clearanceDate);
      return jsonResponse(successResponse(result));
    }

    if (route === 'unallocated' && req.method === 'GET') {
      const receipts = await service.getUnallocatedReceipts(auth, params.id);
      return jsonResponse(successResponse(receipts));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route: ${req.method} ${url.pathname}` } }, 404);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
