import { BusinessError } from '../_shared/errors.ts';
import type {
  ProviderFetchParams,
  ProviderFetchResult,
  ProviderPairFailure,
  ProviderPairRequest,
  ProviderRateInput,
} from './types.ts';
import {
  APPROVED_REAL_PROVIDER_ID,
  FRANKFURTER_BASE_URL,
  FRANKFURTER_PROVIDER_RATE_TYPE,
  FRANKFURTER_SOURCE_HOST,
  PROVIDER_TIMEOUT_MS,
  REAL_PROVIDER_MAX_ATTEMPTS,
  normalizeCurrency,
  sanitizeErrorSummary,
} from './validation.ts';

type FetchLike = typeof fetch;

interface FrankfurterProviderAttribution {
  key?: unknown;
  date?: unknown;
  rate?: unknown;
  excluded?: unknown;
}

interface FrankfurterRateRecord {
  date?: unknown;
  base?: unknown;
  quote?: unknown;
  rate?: unknown;
  providers?: unknown;
}

export interface FrankfurterProviderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class FrankfurterFxProvider {
  readonly provider = APPROVED_REAL_PROVIDER_ID;
  readonly sourceHost = FRANKFURTER_SOURCE_HOST;

  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;

  constructor(options: FrankfurterProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? REAL_PROVIDER_MAX_ATTEMPTS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  }

  async fetchRates(params: ProviderFetchParams): Promise<ProviderFetchResult> {
    const rates: ProviderRateInput[] = [];
    const failures: ProviderPairFailure[] = [];

    for (const pair of params.pairs) {
      try {
        rates.push(await this.fetchPair(params.effectiveDate, params.requestMode ?? 'date', pair));
      } catch (error) {
        failures.push({
          pair,
          category: providerErrorCategory(error),
          message: sanitizeErrorSummary(error instanceof Error ? error.message : error),
        });
      }
    }

    return {
      provider: this.provider,
      sourceHost: this.sourceHost,
      effectiveDate: params.effectiveDate,
      rates,
      failures,
    };
  }

  buildRatesUrl(
    requestedDate: string,
    requestMode: 'date' | 'latest',
    pair: ProviderPairRequest,
  ): URL {
    const fromCurrency = normalizeCurrency(pair.fromCurrency, 'from_currency');
    const toCurrency = normalizeCurrency(pair.toCurrency, 'to_currency');
    const url = new URL(`${FRANKFURTER_BASE_URL}/rates`);
    url.searchParams.set('base', fromCurrency);
    url.searchParams.set('quotes', toCurrency);
    if (requestMode === 'date') url.searchParams.set('date', requestedDate);
    url.searchParams.set('providers', APPROVED_REAL_PROVIDER_ID);
    url.searchParams.set('expand', 'providers');
    return url;
  }

  private async fetchPair(
    requestedDate: string,
    requestMode: 'date' | 'latest',
    pair: ProviderPairRequest,
  ): Promise<ProviderRateInput> {
    const url = this.buildRatesUrl(requestedDate, requestMode, pair);
    const response = await this.fetchWithRetry(url);
    const records = parseFrankfurterArray(response);
    const requestedBase = normalizeCurrency(pair.fromCurrency, 'from_currency');
    const requestedQuote = normalizeCurrency(pair.toCurrency, 'to_currency');
    const record = records.find((item) =>
      String(item.base ?? '').toUpperCase() === requestedBase &&
      String(item.quote ?? '').toUpperCase() === requestedQuote
    );

    if (!record) {
      throw new ProviderContractError(
        'FX_PROVIDER_UNSUPPORTED_PAIR',
        'Frankfurter response did not include the requested pair.',
      );
    }

    return this.mapRecord(record, requestedBase, requestedQuote);
  }

  private mapRecord(
    record: FrankfurterRateRecord,
    requestedBase: string,
    requestedQuote: string,
  ): ProviderRateInput {
    const base = normalizeCurrency(String(record.base ?? ''), 'base');
    const quote = normalizeCurrency(String(record.quote ?? ''), 'quote');
    if (base !== requestedBase || quote !== requestedQuote) {
      throw new ProviderContractError(
        'FX_PROVIDER_PAIR_MISMATCH',
        'Frankfurter response base/quote did not match the requested pair.',
      );
    }

    assertMasAttribution(record.providers);

    return {
      provider: this.provider,
      sourceHost: this.sourceHost,
      fromCurrency: base,
      toCurrency: quote,
      rate: normalizeProviderNumber(record.rate),
      effectiveDate: String(record.date ?? ''),
      providerTimestamp: null,
      providerRateType: FRANKFURTER_PROVIDER_RATE_TYPE,
      direction: 'from_to',
    };
  }

  private async fetchWithRetry(url: URL): Promise<unknown> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        lastError = error;
        if (!isRetryableProviderError(error) || attempt >= this.maxAttempts) break;
        await delay(this.retryDelayMs(attempt));
      }
    }
    throw lastError;
  }

  private async fetchOnce(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new ProviderContractError('FX_PROVIDER_RESPONSE_TOO_LARGE', 'Provider response exceeded safe size bound.');
      }
      if (!response.ok) {
        throw new ProviderHttpError(response.status);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderContractError('FX_PROVIDER_MALFORMED', 'Provider response was not valid JSON.');
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw new ProviderRetryableError('FX_PROVIDER_TIMEOUT', 'Provider request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class ProviderContractError extends BusinessError {
  constructor(code: string, message: string) {
    super(code, message, 400);
  }
}

class ProviderRetryableError extends BusinessError {
  constructor(code: string, message: string) {
    super(code, message, code === 'FX_PROVIDER_RATE_LIMIT' ? 429 : 503);
  }
}

class ProviderHttpError extends BusinessError {
  constructor(status: number) {
    super(httpStatusCategory(status), `Provider returned HTTP ${status}.`, status >= 500 ? 503 : 400);
  }
}

export function assertMasAttribution(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new ProviderContractError('FX_PROVIDER_MISMATCH', 'Provider attribution is missing.');
  }
  if (value.length === 0) {
    throw new ProviderContractError('FX_PROVIDER_MISMATCH', 'Provider attribution is empty.');
  }
  const providers = value as FrankfurterProviderAttribution[];
  const keys = providers.map((provider) => String(provider.key ?? '').trim().toUpperCase()).filter(Boolean);
  if (!keys.includes(APPROVED_REAL_PROVIDER_ID)) {
    throw new ProviderContractError('FX_PROVIDER_MISMATCH', 'Provider attribution does not include MAS.');
  }
  if (keys.some((key) => key !== APPROVED_REAL_PROVIDER_ID)) {
    throw new ProviderContractError('FX_PROVIDER_MISMATCH', 'Provider attribution contains an unapproved provider.');
  }
}

function parseFrankfurterArray(value: unknown): FrankfurterRateRecord[] {
  if (!Array.isArray(value)) {
    throw new ProviderContractError('FX_PROVIDER_MALFORMED', 'Frankfurter /rates response must be an array.');
  }
  return value as FrankfurterRateRecord[];
}

function normalizeProviderNumber(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') return value;
  throw new ProviderContractError('FX_PROVIDER_MALFORMED', 'Provider rate is missing or non-numeric.');
}

function defaultRetryDelayMs(attempt: number): number {
  const base = Math.min(2 ** (attempt - 1) * 250, 2_000);
  return base + Math.floor(Math.random() * base);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRetryableError) return true;
  if (error instanceof ProviderHttpError && RETRYABLE_STATUS.has(Number(error.details?.status))) return true;
  if (error instanceof BusinessError) {
    return ['FX_PROVIDER_TIMEOUT', 'FX_PROVIDER_SERVER_ERROR', 'FX_PROVIDER_RATE_LIMIT'].includes(error.code);
  }
  return error instanceof TypeError;
}

function httpStatusCategory(status: number): string {
  if (status === 429) return 'FX_PROVIDER_RATE_LIMIT';
  if (status >= 500) return 'FX_PROVIDER_SERVER_ERROR';
  return 'FX_PROVIDER_CLIENT_ERROR';
}

function providerErrorCategory(error: unknown): string {
  if (error instanceof BusinessError) return error.code;
  if (error instanceof TypeError) return 'FX_PROVIDER_NETWORK';
  return 'FX_PROVIDER_ERROR';
}
