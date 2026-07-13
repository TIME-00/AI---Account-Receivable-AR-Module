// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Edge Function: invoices
// REST API for Invoice / Credit Note / Debit Note operations
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { getUserClient } from '../_shared/db.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination, validateUUID } from '../_shared/validators.ts';
import { InvoiceService } from './service.ts';
import {
  validateCreateInvoice,
  validateInvoiceLines,
  validateCreateInvoiceLine,
  validatePostInvoice,
  validateCancelInvoice,
} from './validators.ts';

// ─── Route Patterns ─────────────────────────────────────────────────────────
// Prefix-agnostic: match only the sub-path after "invoices".

const UUID = '([0-9a-f\\-]{36})';

const ROUTES: Record<string, RegExp> = {
  collection: /^\/?$/,
  single:     new RegExp(`^\\/${UUID}\\/?$`, 'i'),
  lines:      new RegExp(`^\\/${UUID}\\/lines\\/?$`, 'i'),
  singleLine: new RegExp(`^\\/${UUID}\\/lines\\/${UUID}\\/?$`, 'i'),
  post:       new RegExp(`^\\/${UUID}\\/post\\/?$`, 'i'),
  cancel:     new RegExp(`^\\/${UUID}\\/cancel\\/?$`, 'i'),
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/invoices');
  if (idx !== -1) {
    return pathname.slice(idx + '/invoices'.length) || '/';
  }
  return pathname;
}

function matchRoute(url: URL): { route: string; params: Record<string, string> } {
  const subPath = getSubPath(url.pathname);
  for (const [name, pattern] of Object.entries(ROUTES)) {
    const match = subPath.match(pattern);
    if (match) {
      const params: Record<string, string> = {};
      if (match[1]) params.id = match[1];
      if (match[2]) params.lineId = match[2];
      return { route: name, params };
    }
  }
  return { route: 'notFound', params: {} };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const { route, params } = matchRoute(url);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const service = new InvoiceService(
      undefined,
      getUserClient(req.headers.get('Authorization')!),
    );

    // ── Collection: list / create ──
    if (route === 'collection') {
      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const header = validateCreateInvoice(body as Record<string, unknown>);
        const lines = (body as Record<string, unknown>).lines
          ? validateInvoiceLines((body as Record<string, unknown>).lines)
          : undefined;
        const invoice = await service.createInvoice(auth, header, lines);
        return jsonResponse(successResponse(invoice), 201);
      }
      if (req.method === 'GET') {
        const pagination = parsePagination(url);
        const filters: Record<string, string | undefined> = {
          doc_type: url.searchParams.get('doc_type') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          customer_id: url.searchParams.get('customer_id') ?? undefined,
          posting_period: url.searchParams.get('posting_period') ?? undefined,
          date_from: url.searchParams.get('date_from') ?? undefined,
          date_to: url.searchParams.get('date_to') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
        };
        const { invoices, total, summary } = await service.listInvoices(auth, filters, pagination);
        return jsonResponse(successResponse(invoices, { total, page: pagination.page, page_size: pagination.page_size, summary }));
      }
    }

    // ── Single: get / update / delete ──
    if (route === 'single') {
      const { id } = params;
      if (req.method === 'GET') {
        const invoice = await service.getInvoiceById(auth, id);
        return jsonResponse(successResponse(invoice));
      }
      if (req.method === 'PATCH') {
        const body = await parseRequestBody(req);
        const data = validateCreateInvoice(body as Record<string, unknown>);
        const invoice = await service.updateDraftInvoice(auth, id, data);
        return jsonResponse(successResponse(invoice));
      }
      if (req.method === 'DELETE') {
        await service.deleteDraftInvoice(auth, id);
        return jsonResponse(successResponse({ deleted: true }));
      }
    }

    // ── Lines: add ──
    if (route === 'lines') {
      const { id } = params;
      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        // Accept single line or array
        const rawLines = Array.isArray(body) ? body : (body as Record<string, unknown>).lines ?? [body];
        const lines = validateInvoiceLines(rawLines);
        const created = await service.addLines(auth, id, lines);
        return jsonResponse(successResponse(created), 201);
      }
    }

    // ── Single Line: update / delete ──
    if (route === 'singleLine') {
      const { id, lineId } = params;
      if (req.method === 'PATCH') {
        const body = await parseRequestBody(req);
        const data = validateCreateInvoiceLine(body as Record<string, unknown>);
        const line = await service.updateLine(auth, id, lineId, data);
        return jsonResponse(successResponse(line));
      }
      if (req.method === 'DELETE') {
        await service.deleteLine(auth, id, lineId);
        return jsonResponse(successResponse({ deleted: true }));
      }
    }

    // ── Post Invoice ──
    if (route === 'post' && req.method === 'POST') {
      const { id } = params;
      const body = await parseRequestBody(req);
      const input = validatePostInvoice(body as Record<string, unknown>);
      const result = await service.postInvoice(auth, id, input);
      return jsonResponse(successResponse(result));
    }

    // ── Cancel Invoice ──
    if (route === 'cancel' && req.method === 'POST') {
      const { id } = params;
      const body = await parseRequestBody(req);
      const input = validateCancelInvoice(body as Record<string, unknown>);
      const result = await service.cancelInvoice(auth, id, input);
      return jsonResponse(successResponse(result));
    }

    // ── 404 ──
    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
      404,
    );

  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
