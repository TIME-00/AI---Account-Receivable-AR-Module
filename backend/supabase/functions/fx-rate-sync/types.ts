export type FxSyncStatus = 'Running' | 'Succeeded' | 'PartialFailure' | 'Failed';
export type FxReferenceStatus = 'Active' | 'Superseded';

export interface ProviderRateInput {
  provider: string;
  sourceHost: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number | string;
  effectiveDate: string;
  providerTimestamp?: string | null;
  providerRateType?: string | null;
  direction?: 'from_to' | 'to_from';
}

export interface NormalizedProviderRate {
  provider: string;
  sourceHost: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  effectiveDate: string;
  providerTimestamp: string | null;
  providerRateType: string | null;
}

export interface ProviderPairRequest {
  fromCurrency: string;
  toCurrency: string;
}

export interface ProviderPairFailure {
  pair: ProviderPairRequest;
  category: string;
  message: string;
}

export interface ProviderFetchResult {
  provider: string;
  sourceHost: string;
  effectiveDate: string;
  rates: ProviderRateInput[];
  failures: ProviderPairFailure[];
}

export interface ExistingReferenceRate {
  id: string;
  rate: string | number;
  status: FxReferenceStatus;
}

export type ReconcileDecision =
  | { action: 'insert' }
  | { action: 'noop'; existingId: string }
  | { action: 'correct'; supersededId: string };

export interface FxSyncRunRow {
  id: string;
  company_id: string;
  provider: string;
  source_host: string;
  effective_date: string;
  status: FxSyncStatus;
}

export interface FxSyncLeaseRun {
  id: string;
  company_id: string;
  provider: string;
  source_host: string;
  effective_date: string;
  lease_token: string;
  lease_expires_at: string;
  recovered_run_id: string | null;
}

export interface FxReferenceRateRow {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  effective_date: string;
  provider: string;
  provider_rate_type: string | null;
  provider_timestamp: string | null;
  fetched_at: string;
  sync_run_id: string | null;
  status: FxReferenceStatus;
  supersedes_rate_id: string | null;
  created_at?: string;
}
