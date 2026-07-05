import type { SupabaseClient } from 'supabase';
import { AuthorizationError, BusinessError, ValidationError } from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireAnyRole } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { createMockFxProvider, type MockFxScenario } from './provider.ts';
import type { FxSyncRunRow, NormalizedProviderRate, ProviderPairRequest } from './types.ts';
import {
  MOCK_PROVIDER_ID,
  normalizeCurrency,
  normalizeProviderRate,
  sanitizeErrorSummary,
} from './validation.ts';

export interface FxSyncRequest {
  effectiveDate: string;
  pairs?: ProviderPairRequest[];
  scenario?: MockFxScenario;
}

export interface FxSyncResult {
  run_id: string;
  status: 'Succeeded' | 'PartialFailure' | 'Failed';
  attempted_pair_count: number;
  succeeded_pair_count: number;
  failed_pair_count: number;
  inserted_count: number;
  unchanged_count: number;
  corrected_count: number;
  provider: string;
  source_host: string;
  effective_date: string;
}

type CompanyRow = { id: string; base_currency: string };

export class FxRateSyncService {
  constructor(private readonly client: SupabaseClient = getAdminClient()) {}

  async runMockSync(auth: AuthContext, input: FxSyncRequest): Promise<FxSyncResult> {
    requireAnyRole(auth, ['Finance Manager', 'System Admin']);

    const company = await this.fetchCompany(auth.companyId);
    const effectiveDate = input.effectiveDate;
    const baseCurrency = normalizeCurrency(company.base_currency, 'company_base_currency');
    const provider = createMockFxProvider();
    const pairs = this.normalizePairs(input.pairs ?? defaultMockPairs(baseCurrency), baseCurrency);

    const run = await this.startRun(auth, {
      provider: provider.provider,
      sourceHost: provider.sourceHost,
      effectiveDate,
      attemptedPairCount: pairs.length,
    });

    try {
      const locked = await this.tryAcquireLock(auth.companyId, provider.provider);
      if (!locked) {
        throw new BusinessError('FX_SYNC_ALREADY_RUNNING', 'An FX sync is already running for this company/provider scope.', 409);
      }

      const fetchResult = await provider.fetchRates({
        effectiveDate,
        pairs,
        scenario: input.scenario,
      });

      let succeeded = 0;
      let failed = fetchResult.failures.length;
      let inserted = 0;
      let unchanged = 0;
      let corrected = 0;
      const errors: string[] = fetchResult.failures.map((failure) =>
        `${failure.pair.fromCurrency}/${failure.pair.toCurrency}: ${failure.category}`);

      for (const rateInput of fetchResult.rates) {
        try {
          const normalized = normalizeProviderRate(rateInput, baseCurrency);
          const decision = await this.upsertVersionedReferenceRate(auth.companyId, run.id, normalized);
          succeeded += 1;
          if (decision === 'insert') inserted += 1;
          if (decision === 'noop') unchanged += 1;
          if (decision === 'correct') corrected += 1;
        } catch (error) {
          failed += 1;
          errors.push(sanitizeErrorSummary(error instanceof Error ? error.message : error));
        }
      }

      const status = failed === 0 ? 'Succeeded' : succeeded > 0 ? 'PartialFailure' : 'Failed';
      await this.completeRun(run.id, {
        status,
        succeededPairCount: succeeded,
        failedPairCount: failed,
        errorCategory: failed > 0 ? 'PAIR_FAILURE' : null,
        errorSummary: failed > 0 ? sanitizeErrorSummary(errors.join('; ')) : null,
      });

      return {
        run_id: run.id,
        status,
        attempted_pair_count: pairs.length,
        succeeded_pair_count: succeeded,
        failed_pair_count: failed,
        inserted_count: inserted,
        unchanged_count: unchanged,
        corrected_count: corrected,
        provider: provider.provider,
        source_host: provider.sourceHost,
        effective_date: effectiveDate,
      };
    } catch (error) {
      await this.completeRun(run.id, {
        status: 'Failed',
        succeededPairCount: 0,
        failedPairCount: pairs.length,
        errorCategory: error instanceof BusinessError ? error.code : 'SYNC_ERROR',
        errorSummary: sanitizeErrorSummary(error instanceof Error ? error.message : error),
      });
      throw error;
    }
  }

  private normalizePairs(pairs: ProviderPairRequest[], baseCurrency: string): ProviderPairRequest[] {
    if (!Array.isArray(pairs) || pairs.length === 0) {
      throw new ValidationError('At least one FX pair is required.', { field: 'pairs' });
    }
    return pairs.map((pair) => {
      const fromCurrency = normalizeCurrency(pair.fromCurrency, 'from_currency');
      const toCurrency = normalizeCurrency(pair.toCurrency, 'to_currency');
      if (fromCurrency === toCurrency) {
        throw new ValidationError('from_currency and to_currency must differ.', { from_currency: fromCurrency, to_currency: toCurrency });
      }
      if (toCurrency !== baseCurrency) {
        throw new ValidationError('to_currency must equal the company base currency.', {
          to_currency: toCurrency,
          company_base_currency: baseCurrency,
        });
      }
      return { fromCurrency, toCurrency };
    });
  }

  private async fetchCompany(companyId: string): Promise<CompanyRow> {
    const { data, error } = await this.client
      .from('companies')
      .select('id, base_currency')
      .eq('id', companyId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load company base currency: ${error.message}`);
    if (!data) throw new AuthorizationError('Company is not accessible.');
    return data as CompanyRow;
  }

  private async startRun(
    auth: AuthContext,
    params: { provider: string; sourceHost: string; effectiveDate: string; attemptedPairCount: number },
  ): Promise<FxSyncRunRow> {
    const { data, error } = await this.client
      .from('fx_sync_runs')
      .insert({
        company_id: auth.companyId,
        provider: params.provider,
        source_host: params.sourceHost,
        effective_date: params.effectiveDate,
        status: 'Running',
        attempted_pair_count: params.attemptedPairCount,
        created_by: auth.userId,
      })
      .select('id, company_id, provider, source_host, effective_date, status')
      .single();
    if (error) throw new Error(`Failed to start FX sync run: ${error.message}`);
    return data as FxSyncRunRow;
  }

  private async tryAcquireLock(companyId: string, provider: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('fx_try_sync_lock', {
      p_company_id: companyId,
      p_provider: provider,
    });
    if (error) throw new Error(`Failed to acquire FX sync lock: ${error.message}`);
    return data === true;
  }

  private async upsertVersionedReferenceRate(
    companyId: string,
    runId: string,
    rate: NormalizedProviderRate,
  ): Promise<'insert' | 'noop' | 'correct'> {
    const { data, error } = await this.client.rpc('fx_upsert_reference_rate', {
      p_company_id: companyId,
      p_from_currency: rate.fromCurrency,
      p_to_currency: rate.toCurrency,
      p_rate: rate.rate,
      p_effective_date: rate.effectiveDate,
      p_provider: rate.provider,
      p_provider_rate_type: rate.providerRateType,
      p_provider_timestamp: rate.providerTimestamp,
      p_fetched_at: new Date().toISOString(),
      p_sync_run_id: runId,
    });
    if (error) throw new Error(`Failed to upsert reference FX rate: ${error.message}`);
    const action = (data as { action?: unknown } | null)?.action;
    if (action !== 'insert' && action !== 'noop' && action !== 'correct') {
      throw new Error('Unexpected FX reference upsert result.');
    }
    return action;
  }

  private async completeRun(
    runId: string,
    params: {
      status: 'Succeeded' | 'PartialFailure' | 'Failed';
      succeededPairCount: number;
      failedPairCount: number;
      errorCategory: string | null;
      errorSummary: string | null;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from('fx_sync_runs')
      .update({
        status: params.status,
        completed_at: new Date().toISOString(),
        succeeded_pair_count: params.succeededPairCount,
        failed_pair_count: params.failedPairCount,
        error_category: params.errorCategory,
        error_summary: params.errorSummary,
      })
      .eq('id', runId);
    if (error) throw new Error(`Failed to complete FX sync run: ${error.message}`);
  }
}

export function defaultMockPairs(companyBaseCurrency = 'MYR'): ProviderPairRequest[] {
  const base = normalizeCurrency(companyBaseCurrency, 'company_base_currency');
  return ['SGD', 'USD', 'EUR', 'GBP', 'CNY']
    .filter((fromCurrency) => fromCurrency !== base)
    .map((fromCurrency) => ({ fromCurrency, toCurrency: base }));
}

export function assertProviderNeutralOnly(provider: string): void {
  if (provider !== MOCK_PROVIDER_ID) {
    throw new ValidationError('Batch 9D-A supports the deterministic mock provider only.', { provider });
  }
}
