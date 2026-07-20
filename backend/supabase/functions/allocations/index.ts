// ============================================================================
// TSH Synergy ERP — Edge Function: allocations
// REST API for Receipt-to-Invoice Allocation operations
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination, validateUUID, requireString } from '../_shared/validators.ts';
import { AllocationService } from './service.ts';

const ROUTES: Record<string, RegExp> = {
  manual:    /^\/manual\/?$/,
  auto:      /^\/auto\/?$/,
  candidates:/^\/candidates\/?$/,
  preview:   /^\/preview\/?$/,
  reverse:   /^\/([0-9a-f\-]{36})\/reverse\/?$/i,
  single:    /^\/([0-9a-f\-]{36})\/?$/i,
  collection:/^\/?$/,
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/allocations');
  if (idx !== -1) {
    return pathname.slice(idx + '/allocations'.length) || '/';
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

export interface AllocationHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  createService(): AllocationService;
}

const productionDependencies: AllocationHandlerDependencies = {
  authenticate: getAuthContext,
  createService: () => new AllocationService(),
};

export async function handleAllocationRequest(
  req: Request,
  dependencies: AllocationHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const { route, params } = matchRoute(url);
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    const service = dependencies.createService();

    // ── Manual allocation ──
    if (route === 'manual' && req.method === 'POST') {
      const body = await parseRequestBody(req) as Record<string, unknown>;
      const receipt_id = requireString(body.receipt_id, 'receipt_id');
      validateUUID(receipt_id, 'receipt_id');

      const allocations = body.allocations;
      if (!Array.isArray(allocations) || allocations.length === 0) {
        throw new ValidationError('allocations must be a non-empty array.');
      }

      const parsedAllocations = allocations.map((a: Record<string, unknown>) => {
        const invoice_id = requireString(a.invoice_id, 'invoice_id');
        validateUUID(invoice_id, 'invoice_id');

        return {
          invoice_id,
          amount: Number(a.amount),
          discount_amount: a.discount_amount ? Number(a.discount_amount) : undefined,
        };
      });

      const invoiceIds = parsedAllocations.map((allocation) => allocation.invoice_id.toLowerCase());
      if (new Set(invoiceIds).size !== invoiceIds.length) {
        throw new ValidationError(
          'Duplicate invoice allocation rows are not allowed. Submit each invoice_id only once.',
          { field: 'allocations', reason: 'duplicate_invoice_id' },
        );
      }

      const result = await service.manualAllocate(auth, {
        receipt_id,
        allocations: parsedAllocations,
      });
      return jsonResponse(successResponse(result), 201);
    }

    // ── Auto allocation ──
    if (route === 'auto' && req.method === 'POST') {
      return jsonResponse({
        success: false,
        error: {
          code: 'AUTO_ALLOCATION_DISABLED',
          message: 'Automatic allocation route is disabled until reviewed. Use POST /allocations/manual for verified allocation flows.',
        },
      }, 403);
    }

    // Complete allocation candidates (GET - governed read, no side effects).
    if (route === 'candidates' && req.method === 'GET') {
      const receiptId = url.searchParams.get('receipt_id');
      if (!receiptId) throw new ValidationError('receipt_id is required.');
      validateUUID(receiptId, 'receipt_id');
      const result = await service.getAllocationCandidates(auth, receiptId);
      return jsonResponse(successResponse(result));
    }

    // ── Preview auto allocation (GET — no side effects) ──
    if (route === 'preview' && req.method === 'GET') {
      const receiptId = url.searchParams.get('receipt_id');
      if (!receiptId) throw new ValidationError('receipt_id is required.');
      validateUUID(receiptId, 'receipt_id');
      const method = url.searchParams.get('method') ?? 'FIFO';
      const preview = await service.previewAllocation(auth, receiptId, method);
      return jsonResponse(successResponse(preview));
    }

    // ── Reverse allocation ──
    if (route === 'reverse' && req.method === 'POST') {
      const { id } = params;
      const body = await parseRequestBody(req) as Record<string, unknown>;
      const reason = requireString(body.reason, 'reason');
      await service.reverseAllocation(auth, { allocation_id: id, reason });
      return jsonResponse(successResponse({ reversed: true }));
    }

    // ── List allocations ──
    if (route === 'collection' && req.method === 'GET') {
      const pagination = parsePagination(url);
      const filters: Record<string, string | undefined> = {
        receipt_id: url.searchParams.get('receipt_id') ?? undefined,
        invoice_id: url.searchParams.get('invoice_id') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        method: url.searchParams.get('method') ?? undefined,
      };
      const { allocations, total } = await service.listAllocations(auth, filters, pagination);
      return jsonResponse(successResponse(allocations, { total, page: pagination.page, page_size: pagination.page_size }));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route: ${req.method} ${url.pathname}` } }, 404);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}

export function createAllocationHandler(
  dependencies: AllocationHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleAllocationRequest(req, dependencies);
}

export const handler = createAllocationHandler();

if (import.meta.main) {
  Deno.serve(handler);
}
