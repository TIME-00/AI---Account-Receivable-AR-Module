import { ValidationError } from '../_shared/errors.ts';
import type {
  ExistingReferenceRate,
  NormalizedProviderRate,
  ProviderRateInput,
  ReconcileDecision,
} from './types.ts';

export const SUPPORTED_REFERENCE_CURRENCIES = ['MYR', 'SGD', 'USD', 'EUR', 'GBP', 'CNY'] as const;
export const MOCK_PROVIDER_ID = 'mock_batch_9d_a';
export const MOCK_SOURCE_HOST = 'mock.fx.local';
export const APPROVED_REAL_PROVIDER_ID = 'MAS';
export const FRANKFURTER_SOURCE_HOST = 'api.frankfurter.dev';
export const FRANKFURTER_BASE_URL = `https://${FRANKFURTER_SOURCE_HOST}/v2`;
export const FRANKFURTER_PROVIDER_RATE_TYPE = 'frankfurter-rebased-mas-reference';
export const PROVIDER_TIMEOUT_MS = 8_000;
export const REAL_PROVIDER_MAX_ATTEMPTS = 3;
export const FX_REFERENCE_STALE_AFTER_BUSINESS_DAYS = 3;
export const INITIAL_REAL_PROVIDER_PAIRS = [
  { fromCurrency: 'SGD', toCurrency: 'MYR' },
  { fromCurrency: 'USD', toCurrency: 'MYR' },
  { fromCurrency: 'EUR', toCurrency: 'MYR' },
] as const;

const PROVIDER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const SOURCE_HOST_RE = /^[a-z0-9][a-z0-9_.:-]{1,127}$/;
const RATE_TYPE_RE = /^[A-Za-z0-9 _.-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RATE = 1_000_000;

export function normalizeCurrency(value: string, field: string): string {
  const currency = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError(`${field} must be a three-letter ISO currency code.`, { field });
  }
  return currency;
}

export function assertSupportedCurrency(currency: string, field: string): void {
  if (!SUPPORTED_REFERENCE_CURRENCIES.includes(currency as typeof SUPPORTED_REFERENCE_CURRENCIES[number])) {
    throw new ValidationError(`Unsupported reference currency: ${currency}.`, {
      field,
      supported_currencies: [...SUPPORTED_REFERENCE_CURRENCIES],
    });
  }
}

export function assertApprovedRealProvider(provider: string): void {
  if (provider !== APPROVED_REAL_PROVIDER_ID) {
    throw new ValidationError('Unsupported real FX provider.', {
      provider,
      approved_provider: APPROVED_REAL_PROVIDER_ID,
    });
  }
}

export function assertInitialRealProviderPair(fromCurrency: string, toCurrency: string): void {
  const from = normalizeCurrency(fromCurrency, 'from_currency');
  const to = normalizeCurrency(toCurrency, 'to_currency');
  const allowed = INITIAL_REAL_PROVIDER_PAIRS.some((pair) =>
    pair.fromCurrency === from && pair.toCurrency === to
  );
  if (!allowed) {
    throw new ValidationError('FX pair is outside the approved Batch 9D-B staging allowlist.', {
      from_currency: from,
      to_currency: to,
      allowed_pairs: INITIAL_REAL_PROVIDER_PAIRS.map((pair) => `${pair.fromCurrency}/${pair.toCurrency}`),
    });
  }
}

export function assertDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} must be a valid calendar date.`, { field });
  }
  return value;
}

export function assertNotFutureDate(value: string, now: Date = new Date()): void {
  const today = now.toISOString().slice(0, 10);
  if (value > today) {
    throw new ValidationError('effective_date cannot be in the future.', {
      effective_date: value,
      today,
    });
  }
}

export function normalizeRate(value: number | string): string {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new ValidationError('rate must be a positive decimal value.', { field: 'rate' });
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ValidationError('rate must be greater than zero.', { field: 'rate' });
  }
  if (numeric > MAX_RATE) {
    throw new ValidationError('rate exceeds the maximum safe reference bound.', {
      field: 'rate',
      max_rate: MAX_RATE,
    });
  }
  const [, decimals = ''] = text.split('.');
  if (decimals.length > 8) {
    throw new ValidationError('rate supports at most 8 decimal places.', {
      field: 'rate',
      decimal_places: decimals.length,
    });
  }
  return numeric.toFixed(8);
}

export function sanitizeErrorSummary(value: unknown): string {
  return String(value ?? 'Unknown FX sync error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[REDACTED_JWT]')
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

export function normalizeProviderRate(
  input: ProviderRateInput,
  companyBaseCurrency: string,
  now: Date = new Date(),
): NormalizedProviderRate {
  if (!PROVIDER_RE.test(input.provider)) {
    throw new ValidationError('provider identifier is invalid.', { provider: input.provider });
  }
  if (!SOURCE_HOST_RE.test(input.sourceHost)) {
    throw new ValidationError('source_host identifier is invalid.', { source_host: input.sourceHost });
  }
  if (input.direction && input.direction !== 'from_to') {
    throw new ValidationError('Provider rate direction is inverted or unsupported.', {
      direction: input.direction,
      expected: 'from_to',
    });
  }

  const fromCurrency = normalizeCurrency(input.fromCurrency, 'from_currency');
  const toCurrency = normalizeCurrency(input.toCurrency, 'to_currency');
  const expectedBase = normalizeCurrency(companyBaseCurrency, 'company_base_currency');

  assertSupportedCurrency(fromCurrency, 'from_currency');
  assertSupportedCurrency(toCurrency, 'to_currency');

  if (fromCurrency === toCurrency) {
    throw new ValidationError('Reference pair must not use the same from_currency and to_currency.', {
      from_currency: fromCurrency,
      to_currency: toCurrency,
    });
  }
  if (toCurrency !== expectedBase) {
    throw new ValidationError('Reference rate to_currency must equal the company base currency.', {
      to_currency: toCurrency,
      company_base_currency: expectedBase,
    });
  }

  const effectiveDate = assertDate(input.effectiveDate, 'effective_date');
  assertNotFutureDate(effectiveDate, now);

  const providerTimestamp = input.providerTimestamp ?? null;
  if (providerTimestamp) {
    const parsedTimestamp = new Date(providerTimestamp);
    if (Number.isNaN(parsedTimestamp.getTime())) {
      throw new ValidationError('provider_timestamp must be a valid timestamp.', {
        provider_timestamp: providerTimestamp,
      });
    }
    if (parsedTimestamp.getTime() > now.getTime() + 60_000) {
      throw new ValidationError('provider_timestamp cannot be materially in the future.', {
        provider_timestamp: providerTimestamp,
      });
    }
  }

  const providerRateType = input.providerRateType?.trim() || null;
  if (providerRateType && !RATE_TYPE_RE.test(providerRateType)) {
    throw new ValidationError('provider_rate_type contains unsupported characters.', {
      provider_rate_type: providerRateType,
    });
  }

  return {
    provider: input.provider,
    sourceHost: input.sourceHost,
    fromCurrency,
    toCurrency,
    rate: normalizeRate(input.rate),
    effectiveDate,
    providerTimestamp,
    providerRateType,
  };
}

export function referenceRateKey(rate: NormalizedProviderRate): string {
  return [
    rate.fromCurrency,
    rate.toCurrency,
    rate.effectiveDate,
    rate.provider,
    rate.providerRateType ?? '',
  ].join('|');
}

export function reconcileReferenceRate(
  existing: ExistingReferenceRate | null,
  incoming: NormalizedProviderRate,
): ReconcileDecision {
  if (!existing) return { action: 'insert' };
  const existingRate = normalizeRate(existing.rate);
  if (existing.status === 'Active' && existingRate === incoming.rate) {
    return { action: 'noop', existingId: existing.id };
  }
  return { action: 'correct', supersededId: existing.id };
}

export function lookupLatestOnOrBefore<T extends { effectiveDate: string }>(
  rates: T[],
  requestedDate: string,
): T | null {
  assertDate(requestedDate, 'requested_date');
  return rates
    .filter((rate) => rate.effectiveDate <= requestedDate)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

export function calculateStaleState(
  latestEffectiveDate: string | null,
  requestedDate: string,
  thresholdBusinessDays = FX_REFERENCE_STALE_AFTER_BUSINESS_DAYS,
): { is_stale: boolean; stale_reason: string | null; age_days: number | null } {
  assertDate(requestedDate, 'requested_date');
  if (!latestEffectiveDate) {
    return { is_stale: true, stale_reason: 'missing_reference_rate', age_days: null };
  }
  assertDate(latestEffectiveDate, 'latest_effective_date');
  const latest = new Date(`${latestEffectiveDate}T00:00:00.000Z`);
  const requested = new Date(`${requestedDate}T00:00:00.000Z`);
  let ageDays = 0;
  for (
    const cursor = new Date(latest.getTime() + 86_400_000);
    cursor <= requested;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) ageDays += 1;
  }
  return {
    is_stale: ageDays > thresholdBusinessDays,
    stale_reason: ageDays > thresholdBusinessDays ? 'effective_date_older_than_business_day_threshold' : null,
    age_days: ageDays,
  };
}
