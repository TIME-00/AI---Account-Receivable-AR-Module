// ============================================================================
// TSH Synergy ERP — Edge Function: credit-notes
// REST API for Credit Note operations
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination } from '../_shared/validators.ts';
import { CreditNoteService } from './service.ts';
import { validateCreateInvoice, validateInvoiceLines } from '../invoices/validators.ts';

const ROUTES: Record<string, RegExp> = {
  collection: /^\/?$/,
  single:     /^\/([0-9a-f\-]{36})\/?$/i,
  post:       /^\/([0-9a-f\-]{36})\/post\/?$/i,
  unused:     /^\/unused\/([0-9a-f\-]{36})\/?$/i,
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/credit-notes');
  if (idx !== -1) {
    return pathname.slice(idx + '/credit-notes'.length) || '/';
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
    const service = new CreditNoteService();

    if (route === 'collection') {
      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const header = validateCreateInvoice(body as Record<string, unknown>);
        const lines = (body as Record<string, unknown>).lines
          ? validateInvoiceLines((body as Record<string, unknown>).lines)
          : undefined;
        const cn = await service.createCreditNote(auth, header, lines);
        return jsonResponse(successResponse(cn), 201);
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
        const { creditNotes, total } = await service.listCreditNotes(auth, filters, pagination);
        return jsonResponse(successResponse(creditNotes, { total, page: pagination.page, page_size: pagination.page_size }));
      }
    }

    if (route === 'single' && req.method === 'GET') {
      const cn = await service.getCreditNote(auth, params.id);
      return jsonResponse(successResponse(cn));
    }

    if (route === 'post' && req.method === 'POST') {
      const result = await service.postCreditNote(auth, params.id);
      return jsonResponse(successResponse(result));
    }

    if (route === 'unused' && req.method === 'GET') {
      const unused = await service.getUnusedCreditNotes(auth, params.id);
      return jsonResponse(successResponse(unused));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route: ${req.method} ${url.pathname}` } }, 404);

  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
