import type { SupabaseClient } from 'supabase';
import { AuthorizationError, BusinessError, ValidationError } from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireAnyRole } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { createMockFxProvider, type MockFxScenario } from './provider.ts';
import type { FxSyncLeaseRun, NormalizedProviderRate, ProviderPairRequest } from './types.ts';
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
const DEFAULT_LEASE_SECONDS = 300;

export class FxRateSyncService {
  constructor(private readonly client: SupabaseClient = getAdminClient()) {}

  async runMockSync(auth: AuthContext, input: FxSyncRequest): Promise<FxSyncResult> {
    requireAnyRole(auth, ['Finance Manager', 'System Admin']);

    const company = await this.fetchCompany(auth.companyId);
    const effectiveDate = input.effectiveDate;
    const baseCurrency = normalizeCurrency(company.base_currency, 'company_base_currency');
    const provider = createMockFxProvider();
    const pairs = this.normalizePairs(input.pairs ?? defaultMockPairs(baseCurrency), baseCurrency);

    const run = await this.acquireLeaseAndStartRun(auth, {
      provider: provider.provider,
      sourceHost: provider.sourceHost,
      effectiveDate,
      attemptedPairCount: pairs.length,
    });

    try {
      await this.renewLeaseOrFail(run);
      const fetchResult = await provider.fetchRates({
        effectiveDate,
        pairs,
        scenario: input.scenario,
      });
      await this.renewLeaseOrFail(run);

      let succeeded = 0;
      let failed = fetchResult.failures.length;
      let inserted = 0;
      let unchanged = 0;
      let corrected = 0;
      const errors: string[] = fetchResult.failures.map((failure) =>
        `${failure.pair.fromCurrency}/${failure.pair.toCurrency}: ${failure.category}`);

      for (const rateInput of fetchResult.rates) {
        try {
          await this.renewLeaseOrFail(run);
          const normalized = normalizeProviderRate(rateInput, baseCurrency);
          const decision = await this.upsertVersionedReferenceRate(run, normalized);
          succeeded += 1;
          if (decision === 'insert') inserted += 1;
          if (decision === 'noop') unchanged += 1;
          if (decision === 'correct') corrected += 1;
        } catch (error) {
          if (isLeaseLostError(error)) throw error;
          failed += 1;
          errors.push(sanitizeErrorSummary(error instanceof Error ? error.message : error));
        }
      }

      const status = failed === 0 ? 'Succeeded' : succeeded > 0 ? 'PartialFailure' : 'Failed';
      await this.renewLeaseOrFail(run);
      await this.completeRun(run, {
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
      try {
        await this.completeRun(run, {
          status: 'Failed',
          succeededPairCount: 0,
          failedPairCount: pairs.length,
          errorCategory: error instanceof BusinessError ? error.code : isLeaseLostError(error) ? 'FX_SYNC_LEASE_LOST' : 'SYNC_ERROR',
          errorSummary: sanitizeErrorSummary(error instanceof Error ? error.message : error),
        });
      } catch (completeError) {
        if (!isLeaseLostError(completeError)) throw completeError;
      }
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

  private async acquireLeaseAndStartRun(
    auth: AuthContext,
    params: { provider: string; sourceHost: string; effectiveDate: string; attemptedPairCount: number },
  ): Promise<FxSyncLeaseRun> {
    const { data, error } = await this.client.rpc('fx_acquire_sync_lease', {
      p_company_id: auth.companyId,
      p_provider: params.provider,
      p_source_host: params.sourceHost,
      p_effective_date: params.effectiveDate,
      p_attempted_pair_count: params.attemptedPairCount,
      p_created_by: auth.userId,
      p_lease_seconds: DEFAULT_LEASE_SECONDS,
    });
    if (error) throw new Error(`Failed to acquire FX sync lease: ${error.message}`);
    const result = data as {
      acquired?: boolean;
      reason?: string;
      run_id?: string;
      lease_token?: string;
      lease_expires_at?: string;
      recovered_run_id?: string | null;
    } | null;
    if (!result?.acquired) {
      throw new BusinessError(
        'FX_SYNC_ALREADY_RUNNING',
        'An FX sync is already running for this company/provider scope.',
        409,
        { lease_expires_at: result?.lease_expires_at ?? null },
      );
    }
    if (!result.run_id || !result.lease_token || !result.lease_expires_at) {
      throw new Error('FX sync lease acquisition returned an incomplete owner result.');
    }
    return {
      id: result.run_id,
      company_id: auth.companyId,
      provider: params.provider,
      source_host: params.sourceHost,
      effective_date: params.effectiveDate,
      lease_token: result.lease_token,
      lease_expires_at: result.lease_expires_at,
      recovered_run_id: result.recovered_run_id ?? null,
    };
  }

  private async upsertVersionedReferenceRate(
    run: FxSyncLeaseRun,
    rate: NormalizedProviderRate,
  ): Promise<'insert' | 'noop' | 'correct'> {
    const { data, error } = await this.client.rpc('fx_upsert_reference_rate', {
      p_company_id: run.company_id,
      p_from_currency: rate.fromCurrency,
      p_to_currency: rate.toCurrency,
      p_rate: rate.rate,
      p_effective_date: rate.effectiveDate,
      p_provider: rate.provider,
      p_provider_rate_type: rate.providerRateType,
      p_provider_timestamp: rate.providerTimestamp,
      p_fetched_at: new Date().toISOString(),
      p_sync_run_id: run.id,
      p_lease_token: run.lease_token,
    });
    if (error) throw new Error(`Failed to upsert reference FX rate: ${error.message}`);
    const action = (data as { action?: unknown } | null)?.action;
    if (action !== 'insert' && action !== 'noop' && action !== 'correct') {
      throw new Error('Unexpected FX reference upsert result.');
    }
    return action;
  }

  private async completeRun(
    run: FxSyncLeaseRun,
    params: {
      status: 'Succeeded' | 'PartialFailure' | 'Failed';
      succeededPairCount: number;
      failedPairCount: number;
      errorCategory: string | null;
      errorSummary: string | null;
    },
  ): Promise<void> {
    const { data, error } = await this.client.rpc('fx_complete_sync_run', {
      p_company_id: run.company_id,
      p_provider: run.provider,
      p_owner_run_id: run.id,
      p_lease_token: run.lease_token,
      p_status: params.status,
      p_succeeded_pair_count: params.succeededPairCount,
      p_failed_pair_count: params.failedPairCount,
      p_error_category: params.errorCategory,
      p_error_summary: params.errorSummary,
    });
    if (error) throw new Error(`Failed to complete FX sync run: ${error.message}`);
    if ((data as { completed?: unknown } | null)?.completed !== true) {
      throw new BusinessError('FX_SYNC_LEASE_LOST', 'FX sync lease ownership was lost before run completion.', 409);
    }
  }

  private async renewLeaseOrFail(run: FxSyncLeaseRun): Promise<void> {
    const { data, error } = await this.client.rpc('fx_renew_sync_lease', {
      p_company_id: run.company_id,
      p_provider: run.provider,
      p_owner_run_id: run.id,
      p_lease_token: run.lease_token,
      p_lease_seconds: DEFAULT_LEASE_SECONDS,
    });
    if (error) throw new Error(`Failed to renew FX sync lease: ${error.message}`);
    if ((data as { renewed?: unknown } | null)?.renewed !== true) {
      throw new BusinessError('FX_SYNC_LEASE_LOST', 'FX sync lease ownership was lost.', 409);
    }
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

export function isLeaseLostError(error: unknown): boolean {
  if (error instanceof BusinessError && error.code === 'FX_SYNC_LEASE_LOST') return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('FX_SYNC_LEASE_LOST');
}
