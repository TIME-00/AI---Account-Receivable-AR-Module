import type { ProviderFetchParams, ProviderFetchResult, ProviderPairRequest, ProviderRateInput } from './types.ts';
import { FrankfurterFxProvider, type FrankfurterProviderOptions } from './frankfurter.ts';
import { APPROVED_REAL_PROVIDER_ID, MOCK_PROVIDER_ID, MOCK_SOURCE_HOST } from './validation.ts';

export type MockFxScenario =
  | 'success'
  | 'malformed'
  | 'invalid-rate'
  | 'inverted-pair'
  | 'unsupported-currency'
  | 'partial-failure'
  | 'duplicate'
  | 'correction';

export interface FxProviderAdapter {
  readonly provider: string;
  readonly sourceHost: string;
  fetchRates(params: ProviderFetchParams): Promise<ProviderFetchResult>;
}

const FIXTURE_RATES: Record<string, string> = {
  'SGD:MYR': '3.48000000',
  'USD:MYR': '4.70000000',
  'EUR:MYR': '5.08000000',
  'GBP:MYR': '5.92000000',
  'CNY:MYR': '0.65000000',
  'MYR:SGD': '0.28735632',
  'USD:SGD': '1.35000000',
};

function fixtureRate(pair: ProviderPairRequest, scenario?: MockFxScenario): string {
  const key = `${pair.fromCurrency}:${pair.toCurrency}`;
  if (scenario === 'correction' && key === 'SGD:MYR') return '3.49000000';
  return FIXTURE_RATES[key] ?? '1.23450000';
}

export class DeterministicMockFxProvider implements FxProviderAdapter {
  readonly provider = MOCK_PROVIDER_ID;
  readonly sourceHost = MOCK_SOURCE_HOST;

  async fetchRates(params: ProviderFetchParams): Promise<ProviderFetchResult> {
    const scenario = (params.scenario as MockFxScenario | undefined) ?? 'success';

    if (scenario === 'malformed') {
      return {
        provider: this.provider,
        sourceHost: this.sourceHost,
        effectiveDate: params.effectiveDate,
        rates: [{
          provider: this.provider,
          sourceHost: this.sourceHost,
          fromCurrency: '',
          toCurrency: '',
          rate: 'not-a-number',
          effectiveDate: 'not-a-date',
        }],
        failures: [],
      };
    }

    const failures = scenario === 'partial-failure' && params.pairs.length > 1
      ? [{
        pair: params.pairs[params.pairs.length - 1],
        category: 'MOCK_PAIR_FAILURE',
        message: 'Deterministic mock pair failure.',
      }]
      : [];

    const failedKey = failures[0]
      ? `${failures[0].pair.fromCurrency}:${failures[0].pair.toCurrency}`
      : null;

    const rates: ProviderRateInput[] = params.pairs
      .filter((pair) => `${pair.fromCurrency}:${pair.toCurrency}` !== failedKey)
      .map((pair) => {
        if (scenario === 'invalid-rate') {
          return this.buildRate(pair, params.effectiveDate, '0');
        }
        if (scenario === 'inverted-pair') {
          return {
            ...this.buildRate({
              fromCurrency: pair.toCurrency,
              toCurrency: pair.fromCurrency,
            }, params.effectiveDate, fixtureRate(pair)),
            direction: 'to_from',
          };
        }
        if (scenario === 'unsupported-currency') {
          return this.buildRate({
            fromCurrency: 'ZZZ',
            toCurrency: pair.toCurrency,
          }, params.effectiveDate, fixtureRate(pair));
        }
        return this.buildRate(pair, params.effectiveDate, fixtureRate(pair, scenario));
      });

    return {
      provider: this.provider,
      sourceHost: this.sourceHost,
      effectiveDate: params.effectiveDate,
      rates,
      failures,
    };
  }

  private buildRate(
    pair: ProviderPairRequest,
    effectiveDate: string,
    rate: string,
  ): ProviderRateInput {
    return {
      provider: this.provider,
      sourceHost: this.sourceHost,
      fromCurrency: pair.fromCurrency,
      toCurrency: pair.toCurrency,
      rate,
      effectiveDate,
      providerTimestamp: `${effectiveDate}T12:00:00.000Z`,
      providerRateType: 'mock-mid',
      direction: 'from_to',
    };
  }
}

export function createMockFxProvider(): FxProviderAdapter {
  return new DeterministicMockFxProvider();
}

export function createFxProvider(
  providerId: string,
  options: FrankfurterProviderOptions = {},
): FxProviderAdapter {
  if (providerId === MOCK_PROVIDER_ID) return createMockFxProvider();
  if (providerId === APPROVED_REAL_PROVIDER_ID) return new FrankfurterFxProvider(options);
  throw new Error(`Unsupported FX provider: ${providerId}`);
}
