import { BusinessError } from './_shared/errors.ts';
import {
  SUPPORTED_OPERATIONAL_CURRENCIES,
  SUPPORTED_TRANSACTION_CURRENCIES,
  validateOperationalCurrencyForWrite,
} from './_shared/validators.ts';
import { resolveBookableReferenceRate } from './_shared/fx-reference.ts';
import { validateCreateInvoice } from './invoices/validators.ts';
import { validateCreateReceipt } from './receipts/validators.ts';
import { calculateStaleState } from './fx-rate-sync/validation.ts';

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

function assert(
  condition: unknown,
  message = 'Assertion failed',
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function expectUnsupportedCurrency(fn: () => unknown): BusinessError {
  try {
    fn();
  } catch (error) {
    if (
      error instanceof BusinessError &&
      error.code === 'UNSUPPORTED_TRANSACTION_CURRENCY'
    ) return error;
    throw error;
  }
  throw new Error('Expected UNSUPPORTED_TRANSACTION_CURRENCY');
}

function referenceClient(result: { data: unknown; error: unknown }): never {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'lte', 'order', 'limit']) {
    chain[name] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(result);
  return { from: () => chain } as never;
}

Deno.test('new AR currency policy accepts only MYR and SGD while historical reads retain legacy codes', () => {
  assertEquals([...SUPPORTED_TRANSACTION_CURRENCIES], ['MYR', 'SGD']);
  assert(SUPPORTED_OPERATIONAL_CURRENCIES.includes('USD'));
  assert(SUPPORTED_OPERATIONAL_CURRENCIES.includes('EUR'));
  validateOperationalCurrencyForWrite('MYR');
  validateOperationalCurrencyForWrite('SGD');
  for (const currency of ['USD', 'EUR', 'GBP', 'JPY']) {
    const error = expectUnsupportedCurrency(() =>
      validateOperationalCurrencyForWrite(currency)
    );
    assertEquals(
      error.details.supported_currencies,
      SUPPORTED_TRANSACTION_CURRENCIES,
    );
  }
});

Deno.test('Invoice and Receipt validators enforce MYR/SGD before financial service calls', () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const bankId = '22222222-2222-4222-8222-222222222222';
  for (const currency of ['MYR', 'SGD']) {
    assertEquals(
      validateCreateInvoice({
        doc_type: 'Invoice',
        invoice_date: '2026-08-11',
        customer_id: customerId,
        currency,
      }).currency,
      currency,
    );
    assertEquals(
      validateCreateReceipt({
        receipt_date: '2026-08-11',
        customer_id: customerId,
        payment_method: 'TT',
        currency,
        receipt_amount: 1,
        bank_account_id: bankId,
      }).currency,
      currency,
    );
  }
  for (const currency of ['USD', 'EUR']) {
    expectUnsupportedCurrency(() =>
      validateCreateInvoice({
        doc_type: 'Invoice',
        invoice_date: '2026-08-11',
        customer_id: customerId,
        currency,
      })
    );
    expectUnsupportedCurrency(() =>
      validateCreateReceipt({
        receipt_date: '2026-08-11',
        customer_id: customerId,
        payment_method: 'TT',
        currency,
        receipt_amount: 1,
        bank_account_id: bankId,
      })
    );
  }
});

Deno.test('weekend fallback is accepted but the bounded business-day window still fails closed', () => {
  assertEquals(calculateStaleState('2026-08-07', '2026-08-10'), {
    is_stale: false,
    stale_reason: null,
    age_days: 1,
  });
  assertEquals(calculateStaleState('2026-08-07', '2026-08-12'), {
    is_stale: false,
    stale_reason: null,
    age_days: 3,
  });
  assertEquals(calculateStaleState('2026-08-07', '2026-08-13'), {
    is_stale: true,
    stale_reason: 'effective_date_older_than_business_day_threshold',
    age_days: 4,
  });
});

Deno.test('automatic reference resolution is transaction-date bounded and returns immutable reference identity', async () => {
  const selected = await resolveBookableReferenceRate(
    referenceClient({
      data: { id: 'ref-1', effective_date: '2026-08-11', provider: 'MAS' },
      error: null,
    }),
    'company-1',
    'SGD',
    'MYR',
    '2026-08-11',
  );
  assertEquals(selected, {
    id: 'ref-1',
    effectiveDate: '2026-08-11',
    provider: 'MAS',
  });
});

Deno.test('missing, provider-query failure, and stale automatic references fail closed safely', async () => {
  for (
    const result of [
      { data: null, error: null },
      { data: null, error: { message: 'provider internals must not escape' } },
      {
        data: { id: 'old', effective_date: '2026-08-07', provider: 'MAS' },
        error: null,
      },
    ]
  ) {
    try {
      await resolveBookableReferenceRate(
        referenceClient(result),
        'company-1',
        'SGD',
        'MYR',
        '2026-08-13',
      );
      throw new Error('Expected FX_REFERENCE_UNAVAILABLE');
    } catch (error) {
      assert(error instanceof BusinessError);
      assertEquals(error.code, 'FX_REFERENCE_UNAVAILABLE');
      assert(!error.message.includes('provider internals'));
    }
  }
});

Deno.test('manual, import, and automation create paths converge on the same authoritative policy', async () => {
  const [
    invoiceService,
    receiptService,
    imports,
    automationDocument,
    automationService,
  ] = await Promise.all([
    read('invoices/service.ts'),
    read('receipts/service.ts'),
    read('imports/service.ts'),
    read('automation/document.ts'),
    read('automation/service.ts'),
  ]);
  for (const source of [invoiceService, receiptService]) {
    assert(source.includes('resolveBookableReferenceRate('));
    assert(
      source.includes('validateOperationalCurrencyForWrite(nextCurrency)'),
    );
    assert(source.includes('currency !== undefined'));
    assert(source.includes('p_fx_reference_rate_id: selectedReferenceRateId'));
  }
  assert(imports.includes('validateOperationalCurrencyForWrite'));
  assert(automationDocument.includes('validateOperationalCurrencyForWrite'));
  assert(
    automationService.includes(
      'FX_REFERENCE_UNAVAILABLE: "fx_reference_unavailable"',
    ),
  );
});

Deno.test('Migration 043 enforces prospective currency authority without invalidating historical rows', async () => {
  const migration = await read(
    '../../../database/043_post_gate_e_fx_currency_freshness_authority.sql',
  );
  assert(migration.includes("v_currency NOT IN ('MYR', 'SGD')"));
  assert(
    migration.includes(
      'BEFORE INSERT OR UPDATE OF currency ON public.invoices',
    ),
  );
  assert(
    migration.includes(
      'BEFORE INSERT OR UPDATE OF currency ON public.receipts',
    ),
  );
  assert(
    migration.includes(
      "TG_OP = 'UPDATE' AND NEW.currency IS NOT DISTINCT FROM OLD.currency",
    ),
  );
  assert(!/CHECK\s*\(\s*currency\s+IN/i.test(migration));
  assert(!/UPDATE\s+public\.(invoices|receipts)/i.test(migration));
  assert(!/DELETE\s+FROM\s+public\.(invoices|receipts)/i.test(migration));
});

Deno.test('Migration 043 aligns PostgreSQL transaction-date freshness and exact-decimal booking authority', async () => {
  const migration = await read(
    '../../../database/043_post_gate_e_fx_currency_freshness_authority.sql',
  );
  for (
    const contract of [
      'r.company_id = p_company_id',
      'r.from_currency = p_from_currency',
      'r.to_currency = p_to_currency',
      'r.effective_date <= p_transaction_date',
      "r.status = 'Active'",
      'public.fx_reference_business_day_age(',
      'RETURN v_reference.rate::NUMERIC(18,8)',
    ]
  ) assert(migration.includes(contract), `Missing ${contract}`);
});

Deno.test('refresh cadence gains late publication retries without changing provider command or secrets', async () => {
  const migration = await read(
    '../../../database/043_post_gate_e_fx_currency_freshness_authority.sql',
  );
  assert(migration.includes("schedule => '30 7,12,17 * * *'"));
  assert(migration.includes("jobname = 'batch_9d_e_fx_scheduler_production'"));
  assert(!/net\.http|vault\.|authorization|bearer/i.test(migration));
});

Deno.test('booked snapshots remain stable and historical destructive remediation stays unavailable', async () => {
  const [migration031, migration043, migration023] = await Promise.all([
    read(
      '../../../database/031_post_batch_9d_gate_a_governed_fx_reference_booking.sql',
    ),
    read(
      '../../../database/043_post_gate_e_fx_currency_freshness_authority.sql',
    ),
    read('../../../database/023_fx_booking_rate_rpcs_and_immutability.sql'),
  ]);
  assert(migration031.includes('fx_record_booking_decision('));
  assert(migration031.includes("'{base_total}'"));
  assert(migration031.includes("'{base_amount}'"));
  assert(migration023.includes('Only Draft'));
  assert(
    !/UPDATE\s+public\.(invoices|receipts|journal_entries|allocation_details)/i
      .test(migration043),
  );
});

Deno.test('Migration 043 private helpers and rollback smoke retain least privilege', async () => {
  const [migration, smoke] = await Promise.all([
    read(
      '../../../database/043_post_gate_e_fx_currency_freshness_authority.sql',
    ),
    read(
      '../../../database/043b_post_gate_e_fx_currency_freshness_authority_smoke_tests.sql',
    ),
  ]);
  assert(migration.includes("SET search_path = ''"));
  assert(migration.includes('FROM PUBLIC, anon, authenticated, service_role'));
  assert(smoke.startsWith('-- ROLLBACK-ONLY'));
  assert(smoke.includes('BEGIN;'));
  assert(smoke.trimEnd().endsWith('ROLLBACK;'));
  assert(!/\bCOMMIT\b/i.test(smoke));
});
