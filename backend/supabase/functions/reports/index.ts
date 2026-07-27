// ============================================================================
// TSH Synergy ERP — Edge Function: reports
// REST API for AR Reports & Analytics
// Force redeploy: 2026-04-14T01:38 — CORS headers updated in _shared/cors.ts
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { getAuthContext, extractCompanyId } from '../_shared/auth.ts';
import { getUserClient } from '../_shared/db.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';
import { CREDIT_RATINGS } from '../_shared/constants.ts';
import {
  parsePagination,
  validateDate,
  validateEnum,
} from '../_shared/validators.ts';
import { ReportService } from './service.ts';
import { handleReportExportRequest, isExportPath } from './export-handler.ts';
import { SupabaseExportRepository } from './export-repository.ts';
import { ReportExportService } from './export-service.ts';

const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Kuala_Lumpur';

function formatDateInTimeZone(date: Date, timeZone: string): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new Error('Invalid BUSINESS_TIME_ZONE configuration.');
  }

  const parts = formatter.formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Unable to derive the current business date.');
  }

  return `${year}-${month}-${day}`;
}

// ─── Route Matching ─────────────────────────────────────────────────────────
// The Supabase edge runtime may deliver various path prefixes:
//   /functions/v1/reports/dashboard  OR  /reports/dashboard  OR  /dashboard
// We normalize by extracting only the sub-path after the function name "reports".

const ROUTES: Record<string, RegExp> = {
  aging:            /^\/aging\/?$/,
  agingSummary:     /^\/aging\/summary\/?$/,
  agingByCustomer:  /^\/aging\/by-customer\/?$/,
  customerStatement:/^\/statement\/([0-9a-f\-]{36})\/?$/i,
  dashboard:        /^\/dashboard\/?$/,
};

/**
 * Extract the sub-path relative to the "reports" function.
 * e.g. "/functions/v1/reports/dashboard" → "/dashboard"
 *      "/reports/aging"                 → "/aging"
 *      "/dashboard"                     → "/dashboard"
 */
function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/reports');
  if (idx !== -1) {
    return pathname.slice(idx + '/reports'.length) || '/';
  }
  // Fallback: use the pathname as-is
  return pathname;
}

function matchRoute(subPath: string): { route: string; params: Record<string, string> } {
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
    const subPath = getSubPath(url.pathname);
    console.log('[reports] Request:', req.method, url.pathname, '→ subPath:', subPath);
    const { route, params } = matchRoute(subPath);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const userClient = getUserClient(req.headers.get('Authorization')!);
    const service = new ReportService(undefined, userClient);

    if (isExportPath(subPath)) {
      const exportService = new ReportExportService(
        new SupabaseExportRepository(userClient),
      );
      return await handleReportExportRequest(req, auth, exportService, subPath);
    }

    // ── Aging Summary (shorthand: /aging) ──
    if (route === 'aging' && req.method === 'GET') {
      const asOfDate = url.searchParams.get('as_of_date') ?? undefined;
      if (asOfDate) validateDate(asOfDate, 'as_of_date');
      const result = await service.getAgingSummary(auth, asOfDate);
      return jsonResponse(successResponse(result));
    }

    // ── Aging Summary ──
    if (route === 'agingSummary' && req.method === 'GET') {
      const asOfDate = url.searchParams.get('as_of_date') ?? undefined;
      if (asOfDate) validateDate(asOfDate, 'as_of_date');
      const result = await service.getAgingSummary(auth, asOfDate);
      return jsonResponse(successResponse(result));
    }

    // ── Aging by Customer ──
    if (route === 'agingByCustomer' && req.method === 'GET') {
      const asOfDate = url.searchParams.get('as_of_date') ?? undefined;
      if (asOfDate) validateDate(asOfDate, 'as_of_date');
      const creditRatingText = url.searchParams.get('credit_rating');
      const creditRating = creditRatingText === null
        ? undefined
        : validateEnum(creditRatingText, CREDIT_RATINGS, 'credit_rating');
      const pagination = parsePagination(url);
      const result = await service.getAgingByCustomer(
        auth,
        asOfDate,
        pagination,
        creditRating,
      );
      return jsonResponse(successResponse(result.rows, {
        total: result.total, page: pagination.page, page_size: pagination.page_size,
      }));
    }

    // ── Customer Statement ──
    if (route === 'customerStatement' && req.method === 'GET') {
      const periodFrom = url.searchParams.get('period_from');
      const periodTo = url.searchParams.get('period_to');
      if (!periodFrom || !periodTo) {
        throw new ValidationError(
          'period_from and period_to parameters are required (YYYY-MM-DD).'
        );
      }
      validateDate(periodFrom, 'period_from');
      validateDate(periodTo, 'period_to');
      const result = await service.getCustomerStatement(auth, params.id, periodFrom, periodTo);
      return jsonResponse(successResponse(result));
    }

    // ── Dashboard ──
    if (route === 'dashboard' && req.method === 'GET') {
      const forbiddenDashboardParams = [
        'company_id',
        'user_id',
        'scope_mode',
        'as_of_date',
      ];
      const suppliedForbiddenParam = forbiddenDashboardParams.find(param =>
        url.searchParams.has(param)
      );
      if (suppliedForbiddenParam) {
        throw new ValidationError(
          `${suppliedForbiddenParam} is not accepted by the dashboard endpoint.`,
        );
      }

      const trendMonthsText = url.searchParams.get('trend_months');
      const trendMonths = trendMonthsText === null
        ? 6
        : Number(trendMonthsText);

      if (!Number.isInteger(trendMonths) || trendMonths < 1 || trendMonths > 12) {
        throw new ValidationError('trend_months must be an integer from 1 to 12.');
      }

      const businessTimeZone = Deno.env.get('BUSINESS_TIME_ZONE')?.trim()
        || DEFAULT_BUSINESS_TIME_ZONE;
      const businessDate = formatDateInTimeZone(new Date(), businessTimeZone);
      const result = await service.getDashboardMetrics(
        auth,
        businessDate,
        trendMonths,
      );
      return jsonResponse(successResponse(result));
    }

    return jsonResponse(
      { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No route: ${req.method} ${url.pathname}` } }, 404);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
