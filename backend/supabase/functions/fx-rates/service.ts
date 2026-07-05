import type { SupabaseClient } from 'supabase';
import { ValidationError } from '../_shared/errors.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { requireOperationalReadRole } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';
import { calculateStaleState, normalizeCurrency, assertDate } from '../fx-rate-sync/validation.ts';
import type { FxReferenceRateRow } from '../fx-rate-sync/types.ts';

export interface FxRateLookupParams {
  fromCurrency: string;
  toCurrency: string;
  provider?: string | null;
  requestedDate?: string | null;
}

export class FxRatesReadService {
  constructor(private readonly client: SupabaseClient = getAdminClient()) {}

  async latest(auth: AuthContext, provider?: string | null): Promise<FxReferenceRateRow[]> {
    requireOperationalReadRole(auth);
    let query = this.client
      .from('fx_reference_rates')
      .select('id, company_id, from_currency, to_currency, rate, effective_date, provider, provider_rate_type, provider_timestamp, fetched_at, sync_run_id, status, supersedes_rate_id, created_at')
      .eq('company_id', auth.companyId)
      .eq('status', 'Active')
      .order('effective_date', { ascending: false })
      .order('fetched_at', { ascending: false });
    if (provider) query = query.eq('provider', provider);
    const { data, error } = await query.limit(500);
    if (error) throw new Error(`Failed to list latest reference rates: ${error.message}`);
    const latestByPair = new Map<string, FxReferenceRateRow>();
    for (const row of (data ?? []) as FxReferenceRateRow[]) {
      const key = [
        row.provider,
        row.provider_rate_type ?? '',
        row.from_currency,
        row.to_currency,
      ].join('|');
      if (!latestByPair.has(key)) latestByPair.set(key, row);
    }
    return [...latestByPair.values()];
  }

  async lookup(auth: AuthContext, params: FxRateLookupParams): Promise<Record<string, unknown>> {
    requireOperationalReadRole(auth);
    const fromCurrency = normalizeCurrency(params.fromCurrency, 'from_currency');
    const toCurrency = normalizeCurrency(params.toCurrency, 'to_currency');
    const requestedDate = assertDate(
      params.requestedDate ?? new Date().toISOString().slice(0, 10),
      'requested_date',
    );

    let query = this.client
      .from('fx_reference_rates')
      .select('id, company_id, from_currency, to_currency, rate, effective_date, provider, provider_rate_type, provider_timestamp, fetched_at, sync_run_id, status, supersedes_rate_id, created_at')
      .eq('company_id', auth.companyId)
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .eq('status', 'Active')
      .lte('effective_date', requestedDate)
      .order('effective_date', { ascending: false })
      .order('fetched_at', { ascending: false })
      .limit(1);
    if (params.provider) query = query.eq('provider', params.provider);

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Failed to lookup reference rate: ${error.message}`);
    if (!data) {
      return {
        found: false,
        requested_date: requestedDate,
        from_currency: fromCurrency,
        to_currency: toCurrency,
        reference_only: true,
      };
    }

    const row = data as FxReferenceRateRow;
    return {
      found: true,
      requested_date: requestedDate,
      actual_effective_date: row.effective_date,
      reference_only: true,
      stale: calculateStaleState(row.effective_date, requestedDate),
      rate: row,
    };
  }

  async history(auth: AuthContext, params: FxRateLookupParams): Promise<FxReferenceRateRow[]> {
    requireOperationalReadRole(auth);
    const fromCurrency = normalizeCurrency(params.fromCurrency, 'from_currency');
    const toCurrency = normalizeCurrency(params.toCurrency, 'to_currency');
    let query = this.client
      .from('fx_reference_rates')
      .select('id, company_id, from_currency, to_currency, rate, effective_date, provider, provider_rate_type, provider_timestamp, fetched_at, sync_run_id, status, supersedes_rate_id, created_at')
      .eq('company_id', auth.companyId)
      .eq('from_currency', fromCurrency)
      .eq('to_currency', toCurrency)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (params.provider) query = query.eq('provider', params.provider);
    const { data, error } = await query.limit(200);
    if (error) throw new Error(`Failed to list reference rate history: ${error.message}`);
    return (data ?? []) as FxReferenceRateRow[];
  }

  async health(auth: AuthContext, provider?: string | null): Promise<Record<string, unknown>> {
    requireOperationalReadRole(auth);
    let query = this.client
      .from('fx_sync_runs')
      .select('id, company_id, provider, source_host, effective_date, started_at, completed_at, status, attempted_pair_count, succeeded_pair_count, failed_pair_count, error_category, error_summary')
      .eq('company_id', auth.companyId)
      .order('started_at', { ascending: false })
      .limit(10);
    if (provider) query = query.eq('provider', provider);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to load FX sync health: ${error.message}`);
    return {
      reference_only: true,
      recent_runs: data ?? [],
    };
  }

  static requirePairParams(searchParams: URLSearchParams): FxRateLookupParams {
    const fromCurrency = searchParams.get('from_currency') ?? searchParams.get('from');
    const toCurrency = searchParams.get('to_currency') ?? searchParams.get('to');
    if (!fromCurrency || !toCurrency) {
      throw new ValidationError('from_currency and to_currency are required.');
    }
    return {
      fromCurrency,
      toCurrency,
      provider: searchParams.get('provider'),
      requestedDate: searchParams.get('requested_date') ?? searchParams.get('date'),
    };
  }
}
