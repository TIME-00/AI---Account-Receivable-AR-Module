// ============================================================================
// Edge Function: fx-rate-sync
// Batch 9D-A provider-neutral mock FX reference sync only.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { errorResponse, successResponse, ValidationError } from '../_shared/errors.ts';
import { FxRateSyncService, assertProviderNeutralOnly } from './service.ts';
import type { ProviderPairRequest } from './types.ts';
import { MOCK_PROVIDER_ID, assertDate } from './validation.ts';
import type { MockFxScenario } from './provider.ts';

const MOCK_SCENARIOS: MockFxScenario[] = [
  'success',
  'malformed',
  'invalid-rate',
  'inverted-pair',
  'unsupported-currency',
  'partial-failure',
  'duplicate',
  'correction',
];

function getSubPath(pathname: string): string {
  const idx = pathname.indexOf('/fx-rate-sync');
  if (idx !== -1) return pathname.slice(idx + '/fx-rate-sync'.length) || '/';
  return pathname;
}

async function parseJson(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('Content-Type')?.includes('application/json')) return {};
  const parsed = await req.json();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('JSON body must be an object.');
  }
  return parsed as Record<string, unknown>;
}

function parsePairs(value: unknown): ProviderPairRequest[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ValidationError('pairs must be an array.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError('Each pair must be an object.');
    }
    const pair = item as Record<string, unknown>;
    return {
      fromCurrency: String(pair.from_currency ?? pair.fromCurrency ?? ''),
      toCurrency: String(pair.to_currency ?? pair.toCurrency ?? ''),
    };
  });
}

function parseScenario(value: unknown): MockFxScenario | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const scenario = String(value);
  if (!MOCK_SCENARIOS.includes(scenario as MockFxScenario)) {
    throw new ValidationError('Unsupported deterministic mock scenario.', {
      scenario,
      allowed_scenarios: MOCK_SCENARIOS,
    });
  }
  return scenario as MockFxScenario;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);

    if (req.method !== 'POST' || !/^\/mock-sync\/?$/i.test(subPath)) {
      return jsonResponse({
        success: false,
        error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` },
      }, 404);
    }

    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const body = await parseJson(req);

    const provider = String(body.provider ?? MOCK_PROVIDER_ID);
    assertProviderNeutralOnly(provider);

    const effectiveDate = assertDate(
      String(body.effective_date ?? new Date().toISOString().slice(0, 10)),
      'effective_date',
    );

    const pairs = parsePairs(body.pairs);
    const scenario = parseScenario(body.scenario);

    const service = new FxRateSyncService();
    const result = await service.runMockSync(auth, {
      effectiveDate,
      pairs,
      scenario,
    });

    return jsonResponse(successResponse(result), 200);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
