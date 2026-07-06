import { DeterministicMockFxProvider } from './provider.ts';
import {
  calculateStaleState,
  lookupLatestOnOrBefore,
  normalizeProviderRate,
  normalizeRate,
  reconcileReferenceRate,
  sanitizeErrorSummary,
} from './validation.ts';
import { calculateTerminalFailureCounts, defaultMockPairs, isLeaseLostError } from './service.ts';
import { FxRatesReadService } from '../fx-rates/service.ts';
import { ValidationError } from '../_shared/errors.ts';

const FIXED_NOW = new Date('2026-07-06T00:00:00.000Z');

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message = 'Values are not equal'): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}. Actual: ${actualJson}; Expected: ${expectedJson}`);
  }
}

async function assertRejects(
  action: () => unknown | Promise<unknown>,
  errorClass: new (...args: never[]) => Error,
  expectedMessagePart: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof errorClass, `Expected ${errorClass.name}, got ${error?.constructor?.name ?? typeof error}`);
    assert(
      error instanceof Error && error.message.includes(expectedMessagePart),
      `Expected error message to include "${expectedMessagePart}", got "${error instanceof Error ? error.message : String(error)}"`,
    );
    return;
  }
  throw new Error(`Expected action to reject with ${errorClass.name}`);
}

Deno.test('normalizes explicit from_currency to to_currency pair direction', () => {
  const normalized = normalizeProviderRate({
    provider: 'mock_batch_9d_a',
    sourceHost: 'mock.fx.local',
    fromCurrency: 'sgd',
    toCurrency: 'myr',
    rate: '3.48',
    effectiveDate: '2026-07-03',
    providerTimestamp: '2026-07-03T12:00:00.000Z',
    providerRateType: 'mock-mid',
    direction: 'from_to',
  }, 'MYR', FIXED_NOW);

  assertEquals(normalized.fromCurrency, 'SGD');
  assertEquals(normalized.toCurrency, 'MYR');
  assertEquals(normalized.rate, '3.48000000');
  assertEquals(normalized.effectiveDate, '2026-07-03');
});

Deno.test('rejects inverted provider direction instead of silently inverting', () => {
  assertRejects(
    () => Promise.resolve(normalizeProviderRate({
      provider: 'mock_batch_9d_a',
      sourceHost: 'mock.fx.local',
      fromCurrency: 'MYR',
      toCurrency: 'SGD',
      rate: '0.28735632',
      effectiveDate: '2026-07-03',
      direction: 'to_from',
    }, 'MYR', FIXED_NOW)),
    ValidationError,
    'inverted',
  );
});

Deno.test('rejects pair when to_currency is not company base currency', () => {
  assertRejects(
    () => Promise.resolve(normalizeProviderRate({
      provider: 'mock_batch_9d_a',
      sourceHost: 'mock.fx.local',
      fromCurrency: 'USD',
      toCurrency: 'SGD',
      rate: '1.35',
      effectiveDate: '2026-07-03',
      direction: 'from_to',
    }, 'MYR', FIXED_NOW)),
    ValidationError,
    'company base currency',
  );
});

Deno.test('validates rate precision and positive bounds', () => {
  assertEquals(normalizeRate('4.70000000'), '4.70000000');
  assertRejects(() => Promise.resolve(normalizeRate('0')), ValidationError, 'greater than zero');
  assertRejects(() => Promise.resolve(normalizeRate('-1')), ValidationError, 'positive decimal');
  assertRejects(() => Promise.resolve(normalizeRate('1.123456789')), ValidationError, '8 decimal');
});

Deno.test('rejects unsupported currency and future effective date', () => {
  assertRejects(
    () => Promise.resolve(normalizeProviderRate({
      provider: 'mock_batch_9d_a',
      sourceHost: 'mock.fx.local',
      fromCurrency: 'ZZZ',
      toCurrency: 'MYR',
      rate: '1.00',
      effectiveDate: '2026-07-03',
    }, 'MYR', FIXED_NOW)),
    ValidationError,
    'Unsupported',
  );

  assertRejects(
    () => Promise.resolve(normalizeProviderRate({
      provider: 'mock_batch_9d_a',
      sourceHost: 'mock.fx.local',
      fromCurrency: 'SGD',
      toCurrency: 'MYR',
      rate: '3.48',
      effectiveDate: '2026-07-07',
    }, 'MYR', FIXED_NOW)),
    ValidationError,
    'future',
  );
});

Deno.test('deterministic mock provider has no external dependency and supports partial failure', async () => {
  const provider = new DeterministicMockFxProvider();
  const result = await provider.fetchRates({
    effectiveDate: '2026-07-03',
    pairs: [
      { fromCurrency: 'SGD', toCurrency: 'MYR' },
      { fromCurrency: 'USD', toCurrency: 'MYR' },
    ],
    scenario: 'partial-failure',
  });

  assertEquals(provider.sourceHost, 'mock.fx.local');
  assertEquals(result.rates.length, 1);
  assertEquals(result.failures.length, 1);
  assertEquals(result.failures[0].category, 'MOCK_PAIR_FAILURE');
});

Deno.test('duplicate and corrected historical rates reconcile without duplicate active versions', () => {
  const incoming = normalizeProviderRate({
    provider: 'mock_batch_9d_a',
    sourceHost: 'mock.fx.local',
    fromCurrency: 'SGD',
    toCurrency: 'MYR',
    rate: '3.48',
    effectiveDate: '2026-07-03',
  }, 'MYR', FIXED_NOW);

  assertEquals(reconcileReferenceRate(null, incoming), { action: 'insert' });
  assertEquals(
    reconcileReferenceRate({ id: 'old-id', rate: '3.48000000', status: 'Active' }, incoming),
    { action: 'noop', existingId: 'old-id' },
  );
  assertEquals(
    reconcileReferenceRate({ id: 'old-id', rate: '3.47000000', status: 'Active' }, incoming),
    { action: 'correct', supersededId: 'old-id' },
  );
});

Deno.test('requested-date lookup uses latest effective_date <= requested date', () => {
  const rates = [
    { effectiveDate: '2026-07-01', rate: '3.45' },
    { effectiveDate: '2026-07-03', rate: '3.48' },
  ];

  assertEquals(lookupLatestOnOrBefore(rates, '2026-07-04')?.rate, '3.48');
  assertEquals(lookupLatestOnOrBefore(rates, '2026-07-05')?.rate, '3.48');
  assertEquals(lookupLatestOnOrBefore(rates, '2026-07-02')?.rate, '3.45');
  assertEquals(lookupLatestOnOrBefore(rates, '2026-06-30'), null);
});

Deno.test('stale state separates requested date from actual effective date', () => {
  assertEquals(calculateStaleState('2026-07-03', '2026-07-05', 3), {
    is_stale: false,
    stale_reason: null,
    age_days: 2,
  });
  assertEquals(calculateStaleState('2026-07-01', '2026-07-06', 3), {
    is_stale: true,
    stale_reason: 'effective_date_older_than_threshold',
    age_days: 5,
  });
});

Deno.test('default mock pairs target company base currency and avoid same-currency pair', () => {
  const pairs = defaultMockPairs('MYR');
  assert(pairs.length > 0);
  assert(pairs.every((pair) => pair.toCurrency === 'MYR'));
  assert(pairs.every((pair) => pair.fromCurrency !== pair.toCurrency));
});

Deno.test('read API pair parameter parser supports canonical query names', () => {
  const parsed = FxRatesReadService.requirePairParams(new URLSearchParams({
    from_currency: 'SGD',
    to_currency: 'MYR',
    requested_date: '2026-07-05',
  }));

  assertEquals(parsed.fromCurrency, 'SGD');
  assertEquals(parsed.toCurrency, 'MYR');
  assertEquals(parsed.requestedDate, '2026-07-05');
});

Deno.test('sanitized errors redact bearer tokens, JWTs, and key-like values', () => {
  const summary = sanitizeErrorSummary(
    'Bearer abc.def.ghi token=sample-token-value api_key=sample-key-value eyJhbGciOiJIUzI1NiJ9.payload.sig',
  );
  assert(!summary.includes('sample-token-value'));
  assert(!summary.includes('sample-key-value'));
  assert(!summary.includes('eyJhbGci'));
});

Deno.test('migration contains RLS, active-version uniqueness, and no exchange_rates writes', async () => {
  const migrationUrl = new URL('../../../../database/017_fx_reference_foundation.sql', import.meta.url);
  const migration = await Deno.readTextFile(migrationUrl);

  assert(migration.includes('CREATE TABLE IF NOT EXISTS public.fx_reference_rates'));
  assert(migration.includes('CREATE TABLE IF NOT EXISTS public.fx_sync_runs'));
  assert(migration.includes('ENABLE ROW LEVEL SECURITY'));
  assert(migration.includes('uq_fx_reference_rates_active_logical_key'));
  assert(migration.includes("WHERE status = 'Active'"));
  assert(migration.includes('fx_try_sync_lock'));
  assert(!/INSERT\s+INTO\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/UPDATE\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/DELETE\s+FROM\s+(public\.)?exchange_rates/i.test(migration));
});

Deno.test('Fix1 migration defines persistent lifecycle lease and owner-checked RPCs', async () => {
  const migrationUrl = new URL('../../../../database/018_fx_reference_concurrency_hardening.sql', import.meta.url);
  const migration = await Deno.readTextFile(migrationUrl);

  assert(migration.includes('CREATE TABLE IF NOT EXISTS public.fx_sync_leases'));
  assert(migration.includes('CONSTRAINT pk_fx_sync_leases PRIMARY KEY (company_id, provider)'));
  assert(migration.includes('owner_run_id UUID NULL REFERENCES public.fx_sync_runs(id)'));
  assert(migration.includes('lease_token UUID NOT NULL'));
  assert(migration.includes('lease_expires_at TIMESTAMPTZ NOT NULL'));
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.fx_acquire_sync_lease'));
  assert(migration.includes('ON CONFLICT (company_id, provider) DO UPDATE'));
  assert(migration.includes('WHERE public.fx_sync_leases.lease_expires_at <= v_now'));
  assert(migration.includes('FX_SYNC_LEASE_EXPIRED'));
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.fx_renew_sync_lease'));
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.fx_complete_sync_run'));
  assert(migration.includes('AND owner_run_id = p_owner_run_id'));
  assert(migration.includes('AND lease_token = p_lease_token'));
  assert(migration.includes('AND lease_expires_at > v_now'));
  assert(migration.includes('DELETE FROM public.fx_sync_leases'));
});

Deno.test('Fix1 migration hardens reference upsert with owner fencing and in-RPC serialization', async () => {
  const migrationUrl = new URL('../../../../database/018_fx_reference_concurrency_hardening.sql', import.meta.url);
  const migration = await Deno.readTextFile(migrationUrl);

  assert(migration.includes('DROP FUNCTION IF EXISTS public.fx_try_sync_lock'));
  assert(migration.includes('DROP FUNCTION IF EXISTS public.fx_upsert_reference_rate'));
  assert(migration.includes('p_lease_token UUID'));
  assert(migration.includes('FX_SYNC_LEASE_LOST'));
  assert(migration.includes('pg_advisory_xact_lock'));
  assert(migration.includes('FOR UPDATE'));
  assert(migration.includes("status = 'Superseded'"));
  assert(migration.includes('supersedes_rate_id'));
  assert(!/INSERT\s+INTO\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/UPDATE\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/DELETE\s+FROM\s+(public\.)?exchange_rates/i.test(migration));
});

Deno.test('Fix2 migration transactionally fences upserts with a locked live lease row', async () => {
  const migrationUrl = new URL('../../../../database/019_fx_reference_transactional_fencing.sql', import.meta.url);
  const migration = await Deno.readTextFile(migrationUrl);

  assert(migration.includes('CREATE OR REPLACE FUNCTION public.fx_upsert_reference_rate'));
  assert(migration.includes('p_lease_token UUID'));
  assert(migration.includes('FROM public.fx_sync_leases'));
  assert(migration.includes('owner_run_id = p_sync_run_id'));
  assert(migration.includes('lease_token = p_lease_token'));
  assert(migration.includes('lease_expires_at > v_now'));
  assert(migration.includes('FOR UPDATE'));
  assert(
    migration.indexOf('FROM public.fx_sync_leases') < migration.indexOf('pg_advisory_xact_lock'),
    'lease row must be locked before the rate-key advisory lock',
  );
  assert(
    migration.indexOf('pg_advisory_xact_lock') < migration.indexOf('FROM public.fx_reference_rates'),
    'rate-key advisory lock must be acquired before active rate row access',
  );
  assert(migration.includes('FX_SYNC_LEASE_LOST'));
  assert(migration.includes("SET search_path = public"));
  assert(migration.includes('REVOKE EXECUTE ON FUNCTION public.fx_upsert_reference_rate'));
  assert(migration.includes('GRANT EXECUTE ON FUNCTION public.fx_upsert_reference_rate'));
  assert(!/INSERT\s+INTO\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/UPDATE\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/DELETE\s+FROM\s+(public\.)?exchange_rates/i.test(migration));
});

Deno.test('Fix3 migration explicitly revokes anon helper RPC execution', async () => {
  const migrationUrl = new URL('../../../../database/020_fx_helper_rpc_privilege_hardening.sql', import.meta.url);
  const migration = await Deno.readTextFile(migrationUrl);

  const helperSignatures = [
    {
      name: 'fx_acquire_sync_lease',
      signature: 'UUID, TEXT, TEXT, DATE, INTEGER, UUID, INTEGER',
    },
    {
      name: 'fx_renew_sync_lease',
      signature: 'UUID, TEXT, UUID, UUID, INTEGER',
    },
    {
      name: 'fx_complete_sync_run',
      signature: 'UUID, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT',
    },
    {
      name: 'fx_upsert_reference_rate',
      signature: 'UUID, CHAR(3), CHAR(3), NUMERIC, DATE, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID',
    },
  ];

  for (const helper of helperSignatures) {
    assert(
      migration.includes(`REVOKE EXECUTE ON FUNCTION public.${helper.name}(\n  ${helper.signature}\n) FROM PUBLIC;`),
      `${helper.name} must revoke EXECUTE from PUBLIC`,
    );
    assert(
      migration.includes(`REVOKE EXECUTE ON FUNCTION public.${helper.name}(\n  ${helper.signature}\n) FROM anon;`),
      `${helper.name} must revoke EXECUTE from anon`,
    );
    assert(
      migration.includes(`REVOKE EXECUTE ON FUNCTION public.${helper.name}(\n  ${helper.signature}\n) FROM authenticated;`),
      `${helper.name} must revoke EXECUTE from authenticated`,
    );
    assert(
      migration.includes(`GRANT EXECUTE ON FUNCTION public.${helper.name}(\n  ${helper.signature}\n) TO service_role;`),
      `${helper.name} must grant EXECUTE to service_role`,
    );
  }

  assert(!migration.includes('fx_try_sync_lock'));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fx_upsert_reference_rate/i.test(migration));
  assert(!/INSERT\s+INTO\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/UPDATE\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/DELETE\s+FROM\s+(public\.)?exchange_rates/i.test(migration));
  assert(!/allocation_details|journal_entries|journal_entry_lines|allocated_amount|unallocated_amount|allocations\/auto/i.test(migration));
  assert(!/https?:\/\/|fetch\(|cron|scheduler|frankfurter/i.test(migration));
});

Deno.test('lease-lost errors are detected and fail closed', () => {
  assert(isLeaseLostError(new Error('FX_SYNC_LEASE_LOST: current sync run lost ownership')));
  assert(!isLeaseLostError(new Error('ordinary pair validation failure')));
});

Deno.test('terminal failed runs preserve persisted successes and classify remaining pairs', () => {
  assertEquals(calculateTerminalFailureCounts(5, 2, 1), {
    succeededPairCount: 2,
    failedPairCount: 3,
  });
  assertEquals(calculateTerminalFailureCounts(5, 0, 0), {
    succeededPairCount: 0,
    failedPairCount: 5,
  });
  assertEquals(calculateTerminalFailureCounts(5, 5, 0), {
    succeededPairCount: 5,
    failedPairCount: 0,
  });
});
