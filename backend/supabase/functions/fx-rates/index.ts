// ============================================================================
// Edge Function: fx-rates
// Batch 9D-A authenticated company-scoped reference FX read API.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errors.ts';
import { FxRatesReadService } from './service.ts';

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/fx-rates');
  if (idx !== -1) return pathname.slice(idx + '/fx-rates'.length) || '/';
  return pathname;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);
    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const service = new FxRatesReadService();

    if (req.method !== 'GET') {
      return jsonResponse({
        success: false,
        error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` },
      }, 404);
    }

    if (/^\/latest\/?$/i.test(subPath)) {
      const data = await service.latest(auth, url.searchParams.get('provider'));
      return jsonResponse(successResponse({
        reference_only: true,
        rates: data,
      }, { total: data.length }));
    }

    if (/^\/lookup\/?$/i.test(subPath)) {
      const data = await service.lookup(auth, FxRatesReadService.requirePairParams(url.searchParams));
      return jsonResponse(successResponse(data));
    }

    if (/^\/history\/?$/i.test(subPath)) {
      const data = await service.history(auth, FxRatesReadService.requirePairParams(url.searchParams));
      return jsonResponse(successResponse({
        reference_only: true,
        rates: data,
      }, { total: data.length }));
    }

    if (/^\/health\/?$/i.test(subPath)) {
      const data = await service.health(auth, url.searchParams.get('provider'));
      return jsonResponse(successResponse(data));
    }

    return jsonResponse({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` },
    }, 404);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
