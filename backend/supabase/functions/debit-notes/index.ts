// ============================================================================
// TSH Synergy ERP — Edge Function: debit-notes
// REST API for Debit Note operations
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination } from '../_shared/validators.ts';
import { DebitNoteService } from './service.ts';
import { validateCreateInvoice, validateInvoiceLines } from '../invoices/validators.ts';

const ROUTES: Record<string, RegExp> = {
  collection: /^\/?$/,
  single:     /^\/([0-9a-f\-]{36})\/?$/i,
  post:       /^\/([0-9a-f\-]{36})\/post\/?$/i,
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/debit-notes');
  if (idx !== -1) {
    return pathname.slice(idx + '/debit-notes'.length) || '/';
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
    const service = new DebitNoteService();

    if (route === 'collection') {
      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const header = validateCreateInvoice(body as Record<string, unknown>);
        const lines = (body as Record<string, unknown>).lines
          ? validateInvoiceLines((body as Record<string, unknown>).lines)
          : undefined;
        const dn = await service.createDebitNote(auth, header, lines);
        return jsonResponse(successResponse(dn), 201);
      }
      if (req.method === 'GET') {
        const pagination = parsePagination(url);
        const filters: Record<string, string | undefined> = {
          status: url.searchParams.get('status') ?? undefined,
          customer_id: url.searchParams.get('customer_id') ?? undefined,
          date_from: url.searchParams.get('date_from') ?? undefined,
          date_to: url.searchParams.get('date_to') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
        };
        const { debitNotes, total } = await service.listDebitNotes(auth, filters, pagination);
        return jsonResponse(successResponse(debitNotes, { total, page: pagination.page, page_size: pagination.page_size }));
      }
    }

    if (route === 'single' && req.method === 'GET') {
      const dn = await service.getDebitNote(auth, params.id);
      return jsonResponse(successResponse(dn));
    }

    if (route === 'post' && req.method === 'POST') {
      const result = await service.postDebitNote(auth, params.id);
      return jsonResponse(successResponse(result));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route: ${req.method} ${url.pathname}` } }, 404);

  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
