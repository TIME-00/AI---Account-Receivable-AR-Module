// ============================================================================
// Edge Function: fx-rate-sync
// Batch 9D-A provider-neutral mock FX reference sync only.
// ============================================================================

import { handleCORS, jsonResponse } from '../_shared/cors.ts';
import { extractCompanyId, getAuthContext } from '../_shared/auth.ts';
import { errorResponse, successResponse, BusinessError, ValidationError } from '../_shared/errors.ts';
import { validateUUID } from '../_shared/validators.ts';
import { FxRateSyncService, assertProviderNeutralOnly } from './service.ts';
import type { ProviderPairRequest } from './types.ts';
import { APPROVED_REAL_PROVIDER_ID, MOCK_PROVIDER_ID, assertApprovedRealProvider, assertDate } from './validation.ts';
import type { MockFxScenario } from './provider.ts';
import { SCHEDULER_COMPANY_ENV, SCHEDULER_SECRET_ENV, validateSchedulerSecret } from './scheduler_auth.ts';

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

function getScheduledCompanyId(): string {
  const companyId = Deno.env.get(SCHEDULER_COMPANY_ENV);
  if (!companyId) {
    throw new BusinessError('FX_SCHEDULER_SCOPE_NOT_CONFIGURED', 'FX scheduler company scope is not configured.', 500);
  }
  validateUUID(companyId, 'FX_SCHEDULER_COMPANY_ID');
  return companyId;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return handleCORS();

  try {
    const url = new URL(req.url);
    const subPath = getSubPath(url.pathname);

    const service = new FxRateSyncService();

    if (req.method === 'POST' && /^\/scheduled-sync\/?$/i.test(subPath)) {
      validateSchedulerSecret(req, Deno.env.get(SCHEDULER_SECRET_ENV));
      const companyId = getScheduledCompanyId();
      const result = await service.runScheduledProviderSync({
        companyId,
        effectiveDate: new Date().toISOString().slice(0, 10),
        requestMode: 'latest',
      });
      return jsonResponse(successResponse(result), 200);
    }

    if (req.method !== 'POST' || (!/^\/mock-sync\/?$/i.test(subPath) && !/^\/sync\/?$/i.test(subPath))) {
      return jsonResponse({
        success: false,
        error: { code: 'ROUTE_NOT_FOUND', message: `No route matches ${req.method} ${url.pathname}` },
      }, 404);
    }

    const companyId = extractCompanyId(req);
    const auth = await getAuthContext(req, companyId);
    const body = await parseJson(req);

    const effectiveDate = assertDate(
      String(body.effective_date ?? new Date().toISOString().slice(0, 10)),
      'effective_date',
    );

    const pairs = parsePairs(body.pairs);

    let result;
    if (/^\/mock-sync\/?$/i.test(subPath)) {
      const provider = String(body.provider ?? MOCK_PROVIDER_ID);
      assertProviderNeutralOnly(provider);
      const scenario = parseScenario(body.scenario);
      result = await service.runMockSync(auth, {
        effectiveDate,
        pairs,
        scenario,
      });
    } else {
      const provider = String(body.provider ?? APPROVED_REAL_PROVIDER_ID);
      assertApprovedRealProvider(provider);
      result = await service.runProviderSync(auth, {
        provider,
        effectiveDate,
        pairs,
        requestMode: 'date',
      });
    }

    return jsonResponse(successResponse(result), 200);
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
});
