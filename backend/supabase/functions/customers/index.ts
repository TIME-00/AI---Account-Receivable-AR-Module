// ============================================================================
// TSH Synergy ERP — Accounts Receivable Module
// Edge Function: customers
// REST API entry point for Customer Master Data operations
// ============================================================================
// Deploy: supabase functions deploy customers
// URL:    POST/GET/PATCH/DELETE  <project>.supabase.co/functions/v1/customers
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { parseRequestBody, parsePagination, validateUUID, validateEnum } from '../_shared/validators.ts';
import { CUSTOMER_STATUSES, CUSTOMER_TYPES, CREDIT_RATINGS } from '../_shared/constants.ts';
import { CustomerService } from './service.ts';
import { validateCreateCustomer, validateUpdateCustomer } from './validators.ts';
import type {
  CustomerListFilters,
  UpdateCreditLimitRequest,
  UpdateCreditRatingRequest,
  UpdateCustomerStatusRequest,
  CustomerStatus,
  CreditRating,
} from '../_shared/types.ts';

// ─── URL Pattern Matching ───────────────────────────────────────────────────
// Normalize path by extracting the sub-path after "customers" to handle
// any prefix variation from the Supabase edge runtime.

const UUID = '([0-9a-f\\-]{36})';

const ROUTE_PATTERNS: Record<string, RegExp> = {
  collection: /^\/?$/,
  single:     new RegExp(`^\\/${UUID}\\/?$`, 'i'),
  status:     new RegExp(`^\\/${UUID}\\/status\\/?$`, 'i'),
  credit:     new RegExp(`^\\/${UUID}\\/credit\\/?$`, 'i'),
  rating:     new RegExp(`^\\/${UUID}\\/rating\\/?$`, 'i'),
  creditSum:  new RegExp(`^\\/${UUID}\\/credit-summary\\/?$`, 'i'),
  changeLog:  new RegExp(`^\\/${UUID}\\/change-log\\/?$`, 'i'),
};

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/customers');
  if (idx !== -1) {
    return pathname.slice(idx + '/customers'.length) || '/';
  }
  return pathname;
}

function matchRoute(url: URL): { route: string; params: Record<string, string> } {
  const subPath = getSubPath(url.pathname);

  for (const [name, pattern] of Object.entries(ROUTE_PATTERNS)) {
    const match = subPath.match(pattern);
    if (match) {
      return {
        route: name,
        params: match[1] ? { id: match[1] } : {},
      };
    }
  }

  return { route: 'notFound', params: {} };
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return handleCORS();
  }

  try {
    const url = new URL(req.url);
    const { route, params } = matchRoute(url);

    // Extract company context
    const companyId = extractCompanyId(req);

    // Authenticate & authorize
    const auth = await getAuthContext(req, companyId);

    // Initialize service
    const service = new CustomerService();

    // ── Route: Collection (list / create) ──────────────────────────────
    if (route === 'collection') {
      if (req.method === 'POST') {
        // CREATE CUSTOMER
        const body = await parseRequestBody(req);
        const validatedData = validateCreateCustomer(body);
        const customer = await service.createCustomer(auth, validatedData);
        return jsonResponse(successResponse(customer), 201);
      }

      if (req.method === 'GET') {
        // LIST CUSTOMERS
        const pagination = parsePagination(url);
        const filters: CustomerListFilters = {
          status: url.searchParams.get('status')
            ? validateEnum(url.searchParams.get('status')!, CUSTOMER_STATUSES, 'status') as CustomerStatus
            : undefined,
          customer_type: url.searchParams.get('customer_type')
            ? validateEnum(url.searchParams.get('customer_type')!, CUSTOMER_TYPES, 'customer_type')
            : undefined,
          customer_group_id: url.searchParams.get('customer_group_id') ?? undefined,
          bill_country: url.searchParams.get('bill_country') ?? undefined,
          credit_rating: url.searchParams.get('credit_rating')
            ? validateEnum(url.searchParams.get('credit_rating')!, CREDIT_RATINGS, 'credit_rating') as CreditRating
            : undefined,
          search: url.searchParams.get('search') ?? undefined,
          include_deleted: url.searchParams.get('include_deleted') === 'true',
        };
        const { customers, total } = await service.listCustomers(auth, filters, pagination);
        return jsonResponse(successResponse(customers, { total, page: pagination.page, page_size: pagination.page_size }));
      }
    }

    // ── Route: Single (get / update / delete) ──────────────────────────
    if (route === 'single') {
      const { id } = params;
      validateUUID(id, 'id');

      if (req.method === 'GET') {
        const customer = await service.getCustomerById(auth, id);
        return jsonResponse(successResponse(customer));
      }

      if (req.method === 'PATCH') {
        const body = await parseRequestBody(req);
        const validatedData = validateUpdateCustomer(body);
        const customer = await service.updateCustomer(auth, id, validatedData);
        return jsonResponse(successResponse(customer));
      }

      if (req.method === 'DELETE') {
        await service.deleteCustomer(auth, id);
        return jsonResponse(successResponse({ deleted: true }));
      }
    }

    // ── Route: Status ──────────────────────────────────────────────────
    if (route === 'status' && req.method === 'PATCH') {
      const { id } = params;
      const body = await parseRequestBody<UpdateCustomerStatusRequest>(req);
      validateEnum(body.new_status, CUSTOMER_STATUSES, 'new_status');
      const customer = await service.updateStatus(auth, id, body);
      return jsonResponse(successResponse(customer));
    }

    // ── Route: Credit Limit ────────────────────────────────────────────
    if (route === 'credit' && req.method === 'PATCH') {
      const { id } = params;
      const body = await parseRequestBody<UpdateCreditLimitRequest>(req);
      const customer = await service.updateCreditLimit(auth, id, body);
      return jsonResponse(successResponse(customer));
    }

    // ── Route: Credit Rating ───────────────────────────────────────────
    if (route === 'rating' && req.method === 'PATCH') {
      const { id } = params;
      const body = await parseRequestBody<UpdateCreditRatingRequest>(req);
      validateEnum(body.new_credit_rating, CREDIT_RATINGS, 'new_credit_rating');
      const customer = await service.updateCreditRating(auth, id, body);
      return jsonResponse(successResponse(customer));
    }

    // ── Route: Credit Summary ──────────────────────────────────────────
    if (route === 'creditSum' && req.method === 'GET') {
      const { id } = params;
      const summary = await service.getCreditSummary(auth, id);
      return jsonResponse(successResponse(summary));
    }

    // ── Route: Change Log ──────────────────────────────────────────────
    if (route === 'changeLog' && req.method === 'GET') {
      const { id } = params;
      const pagination = parsePagination(url);
      const { logs, total } = await service.getChangeLog(auth, id, pagination);
      return jsonResponse(successResponse(logs, { total, page: pagination.page, page_size: pagination.page_size }));
    }

    // ── 404: Route not found ───────────────────────────────────────────
    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` } },
      404,
    );

  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
