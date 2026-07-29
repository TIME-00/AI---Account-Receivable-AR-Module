import type { SupabaseClient } from 'supabase';
import type { AuthContext } from './_shared/auth.ts';
import { AuthorizationError, BusinessError } from './_shared/errors.ts';
import { InvoiceService } from './invoices/service.ts';
import { ReceiptService } from './receipts/service.ts';
import {
  CURRENT_OUTSTANDING_AMOUNT_BASIS,
  CURRENT_UNALLOCATED_AMOUNT_BASIS,
  parseMonetaryCollectionSummary,
} from './reports/monetary-contracts.ts';
import { validateDashboardMetricsResponse } from './reports/dashboard-types.ts';

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

function assert(
  condition: unknown,
  message = 'Assertion failed',
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = 'Values differ') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function expectThrows(action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    assert(
      String(error).includes(expected),
      `Unexpected error: ${String(error)}`,
    );
    return;
  }
  throw new Error(`Expected error containing ${expected}`);
}

async function rejectedError(
  action: () => Promise<unknown>,
): Promise<Error & { code?: string; status?: number }> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error, 'Expected a typed Error rejection');
    return error as Error & { code?: string; status?: number };
  }
  throw new Error('Expected operation to reject');
}

function v1Summary(currentAmountBasis: string) {
  const entry = (
    amountBasis: string,
    normalizationBasis: string,
  ) => ({
    row_count: 1,
    amount_basis: amountBasis,
    base_total: 425,
    base_currency: 'MYR',
    by_currency: [{
      currency: 'USD',
      amount: 100,
      base_amount: 425,
      count: 1,
    }],
    meta: {
      base_currency: 'MYR',
      multi_currency: false,
      normalization_basis: normalizationBasis,
    },
  });
  return {
    current_balance_summary: entry(
      currentAmountBasis,
      'current_balance_x_booked_rate',
    ),
    document_total_summary: entry(
      'original_document_total',
      'original_booked_base_snapshot',
    ),
  };
}

function v2Summary(currentAmountBasis: string) {
  const entry = (
    amountBasis: string,
    normalizationBasis: string,
  ) => ({
    row_count: 3,
    matching_document_count: 3,
    authoritative_document_count: 1,
    unavailable_count: 2,
    base_available: false,
    amount_basis: amountBasis,
    base_currency: 'MYR',
    base_total: '125.50',
    by_currency: [
      {
        currency: 'MYR',
        amount: '125.50',
        base_amount: '125.50',
        count: 1,
        authoritative_document_count: 1,
        unavailable_count: 0,
        base_available: true,
      },
      {
        currency: 'USD',
        amount: '100.00',
        base_amount: null,
        count: 2,
        authoritative_document_count: 0,
        unavailable_count: 2,
        base_available: false,
      },
    ],
    unavailable_by_currency: [{
      currency: 'USD',
      document_count: 2,
    }],
    meta: {
      contract_version: 2,
      base_currency: 'MYR',
      multi_currency: true,
      normalization_basis: normalizationBasis,
      authority_basis: 'current_consistent_booked_fx_decision',
    },
  });
  return {
    current_balance_summary: entry(
      currentAmountBasis,
      'current_balance_x_booked_rate',
    ),
    document_total_summary: entry(
      'original_document_total',
      'original_booked_base_snapshot',
    ),
  };
}

const auth: AuthContext = {
  companyId: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000001',
  roles: ['Finance Manager'],
  highestRole: 'Finance Manager',
  email: null,
};

class CollectionClient {
  constructor(
    private invoiceSummary: unknown,
    private receiptSummary: unknown,
  ) {}

  rpc(name: string): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({
      data: {
        rows: [],
        total: name === 'ar_invoice_collection' ? 0 : 0,
        summary: name === 'ar_invoice_collection'
          ? this.invoiceSummary
          : this.receiptSummary,
      },
      error: null,
    });
  }
}

class CollectionResultClient {
  constructor(
    private result: {
      data: unknown;
      error: { code: string; message: string } | null;
    },
  ) {}

  rpc(): Promise<{
    data: unknown;
    error: { code: string; message: string } | null;
  }> {
    return Promise.resolve(this.result);
  }
}

Deno.test('Gate D parser preserves explicit v1 compatibility without fabricating authority', () => {
  const invoice = parseMonetaryCollectionSummary(
    v1Summary('current_outstanding'),
    { currentAmountBasis: CURRENT_OUTSTANDING_AMOUNT_BASIS },
  );
  const receipt = parseMonetaryCollectionSummary(
    v1Summary('current_unallocated'),
    { currentAmountBasis: CURRENT_UNALLOCATED_AMOUNT_BASIS },
  );

  for (const parsed of [invoice, receipt]) {
    assertEquals(parsed.current_balance_summary.meta.contract_version, 1);
    assertEquals(parsed.current_balance_summary.base_total, 425);
    assert(
      !('base_available' in parsed.current_balance_summary),
      'v1 must not be promoted to v2 authority',
    );
    assert(
      !('authoritative_document_count' in parsed.current_balance_summary),
      'v1 must not fabricate authority counts',
    );
  }
});

Deno.test('Gate D parser strictly accepts the exact Invoice and Receipt v2 contract', () => {
  const invoice = parseMonetaryCollectionSummary(
    v2Summary('current_outstanding'),
    { currentAmountBasis: CURRENT_OUTSTANDING_AMOUNT_BASIS },
  );
  const receipt = parseMonetaryCollectionSummary(
    v2Summary('current_unallocated'),
    { currentAmountBasis: CURRENT_UNALLOCATED_AMOUNT_BASIS },
  );

  for (const parsed of [invoice, receipt]) {
    assertEquals(parsed.current_balance_summary.meta.contract_version, 2);
    assertEquals(parsed.current_balance_summary.base_total, '125.50');
    assertEquals(
      parsed.current_balance_summary.by_currency[1].base_amount,
      null,
    );
    assert(
      'unavailable_by_currency' in parsed.current_balance_summary,
      'Expected v2 unavailable currency contract',
    );
    assertEquals(
      parsed.current_balance_summary.unavailable_by_currency,
      [{ currency: 'USD', document_count: 2 }],
    );
  }
});

Deno.test('Gate D parser rejects mixed versions, malformed decimals, counts and ordering', () => {
  const mixed = v2Summary('current_outstanding');
  mixed.document_total_summary = v1Summary(
    'current_outstanding',
  ).document_total_summary as unknown as typeof mixed.document_total_summary;
  expectThrows(
    () =>
      parseMonetaryCollectionSummary(mixed, {
        currentAmountBasis: CURRENT_OUTSTANDING_AMOUNT_BASIS,
      }),
    'Invalid monetary summary contract.',
  );

  for (
    const mutate of [
      (summary: ReturnType<typeof v2Summary>) => {
        summary.current_balance_summary.base_total = 125.5 as unknown as string;
      },
      (summary: ReturnType<typeof v2Summary>) => {
        summary.current_balance_summary.unavailable_count = 1;
      },
      (summary: ReturnType<typeof v2Summary>) => {
        summary.current_balance_summary.by_currency.reverse();
      },
      (summary: ReturnType<typeof v2Summary>) => {
        summary.current_balance_summary.by_currency[1].base_amount = '0.00';
      },
      (summary: ReturnType<typeof v2Summary>) => {
        summary.current_balance_summary.by_currency.push({
          currency: 'ZZZ',
          amount: '0.00',
          base_amount: null,
          count: 0,
          authoritative_document_count: 0,
          unavailable_count: 0,
          base_available: true,
        });
      },
    ]
  ) {
    const malformed = v2Summary('current_outstanding');
    mutate(malformed);
    expectThrows(
      () =>
        parseMonetaryCollectionSummary(malformed, {
          currentAmountBasis: CURRENT_OUTSTANDING_AMOUNT_BASIS,
        }),
      'Invalid monetary summary contract.',
    );
  }
});

Deno.test('Gate D Invoice and Receipt services map v1 before migration and v2 after migration', async () => {
  for (
    const [invoiceSummary, receiptSummary, version] of [
      [
        v1Summary('current_outstanding'),
        v1Summary('current_unallocated'),
        1,
      ],
      [
        v2Summary('current_outstanding'),
        v2Summary('current_unallocated'),
        2,
      ],
    ] as const
  ) {
    const client = new CollectionClient(
      invoiceSummary,
      receiptSummary,
    ) as unknown as SupabaseClient;
    const invoices = await new InvoiceService(client, client).listInvoices(
      auth,
      {},
      { page: 1, page_size: 50 },
    );
    const receipts = await new ReceiptService(client, client).listReceipts(
      auth,
      {},
      { page: 1, page_size: 50 },
    );
    assertEquals(
      invoices.summary.current_balance_summary.meta.contract_version,
      version,
    );
    assertEquals(
      receipts.summary.current_balance_summary.meta.contract_version,
      version,
    );
  }
});

Deno.test('Gate D service mixed-version failures are fixed English copy and sanitized', async () => {
  const invoiceMixed = v2Summary('current_outstanding');
  invoiceMixed.document_total_summary = v1Summary(
    'current_outstanding',
  ).document_total_summary as unknown as typeof invoiceMixed.document_total_summary;
  const receiptMixed = v2Summary('current_unallocated');
  receiptMixed.document_total_summary = v1Summary(
    'current_unallocated',
  ).document_total_summary as unknown as typeof receiptMixed.document_total_summary;
  const client = new CollectionClient(
    invoiceMixed,
    receiptMixed,
  ) as unknown as SupabaseClient;

  const invoiceError = await rejectedError(
    () =>
      new InvoiceService(client, client).listInvoices(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
  );
  assert(invoiceError instanceof BusinessError);
  assertEquals(invoiceError.code, 'REPORT_CONTRACT_INVALID');
  assertEquals(invoiceError.status, 500);
  assertEquals(
    invoiceError.message,
    'Failed to list invoices: invalid monetary summary contract.',
  );

  const receiptError = await rejectedError(
    () =>
      new ReceiptService(client, client).listReceipts(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
  );
  assert(receiptError instanceof BusinessError);
  assertEquals(receiptError.code, 'REPORT_CONTRACT_INVALID');
  assertEquals(receiptError.status, 500);
  assertEquals(
    receiptError.message,
    'Failed to list receipts: invalid monetary summary contract.',
  );
});

Deno.test('Gate D Invoice and Receipt collection RPC errors use sanitized authorization and internal classifications', async () => {
  const operations = [
    (client: SupabaseClient) =>
      new InvoiceService(client, client).listInvoices(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
    (client: SupabaseClient) =>
      new ReceiptService(client, client).listReceipts(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
  ];

  for (const operation of operations) {
    const authorizationClient = new CollectionResultClient({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for private_schema.secret_table',
      },
    }) as unknown as SupabaseClient;
    const authorizationError = await rejectedError(() =>
      operation(authorizationClient)
    );
    assert(authorizationError instanceof AuthorizationError);
    assertEquals(authorizationError.code, 'AUTHORIZATION_ERROR');
    assertEquals(authorizationError.status, 403);
    assertEquals(authorizationError.message, 'Insufficient permissions');
    assert(!authorizationError.message.includes('private_schema'));
    assert(!authorizationError.message.includes('permission denied'));

    const internalClient = new CollectionResultClient({
      data: null,
      error: {
        code: 'XX000',
        message: 'relation private_schema.secret_table does not exist',
      },
    }) as unknown as SupabaseClient;
    const internalError = await rejectedError(() => operation(internalClient));
    assert(internalError instanceof BusinessError);
    assertEquals(internalError.code, 'REPORT_QUERY_FAILED');
    assertEquals(internalError.status, 500);
    assertEquals(
      internalError.message,
      'Unable to retrieve the requested collection.',
    );
    assert(!internalError.message.includes('private_schema'));
    assert(!internalError.message.includes('relation'));
  }
});

Deno.test('Gate D Invoice and Receipt malformed collection envelopes remain sanitized contract failures', async () => {
  const malformedClient = new CollectionResultClient({
    data: {
      rows: 'not-an-array',
      total: -1,
      summary: v2Summary('current_outstanding'),
    },
    error: null,
  }) as unknown as SupabaseClient;
  const operations = [
    () =>
      new InvoiceService(malformedClient, malformedClient).listInvoices(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
    () =>
      new ReceiptService(malformedClient, malformedClient).listReceipts(
        auth,
        {},
        { page: 1, page_size: 50 },
      ),
  ];

  for (const operation of operations) {
    const error = await rejectedError(operation);
    assert(error instanceof BusinessError);
    assertEquals(error.code, 'REPORT_CONTRACT_INVALID');
    assertEquals(error.status, 500);
    assert(!error.message.includes('not-an-array'));
  }
});

Deno.test('Gate D Dashboard validator enforces schema, population, statuses and exact rating order', () => {
  const dashboard = {
    meta: {
      company_id: '10000000-0000-4000-8000-000000000001',
      base_currency: 'MYR',
      as_of_date: '2026-07-29',
      calculated_at: '2026-07-29T00:00:00.000Z',
      scope: 'company',
      trend_months: 1,
    },
    kpis: {
      total_outstanding_ar: 0,
      overdue_outstanding: 0,
      overdue_invoice_count: 0,
      unapplied_cash: 0,
      current_month_collections: 0,
      current_month_posted_invoices: 0,
      import_rows_needing_review: 0,
    },
    invoice_status_counts: {
      open: 0,
      partially_paid: 0,
      overdue_status: 0,
      paid: 0,
      unpaid_total: 0,
    },
    aging_buckets: [
      ['current', 'Current'],
      ['1_30', '1-30 Days'],
      ['31_60', '31-60 Days'],
      ['61_90', '61-90 Days'],
      ['over_90', 'Over 90 Days'],
    ].map(([key, label]) => ({
      key,
      label,
      invoice_count: 0,
      outstanding_base: 0,
      percentage: 0,
    })),
    collection_trend: [{
      month: '2026-07',
      collected_base: 0,
      receipt_count: 0,
    }],
    top_outstanding_customers: [],
    credit_rating_distribution: ['AAA', 'AA', 'A', 'B', 'C', 'D'].map(
      (rating) => ({ rating, customer_count: 0, outstanding_base: 0 }),
    ),
    customer_credit_rating_distribution: {
      population: 'VISIBLE_CUSTOMERS',
      included_statuses: ['Active', 'Inactive', 'Blocked', 'On Hold'],
      rows: ['AAA', 'AA', 'A', 'B', 'C', 'D'].map(
        (rating) => ({ rating, customer_count: 0 }),
      ),
    },
    total_invoices: 0,
    open_invoices: 0,
    overdue_invoices: 0,
    total_receipts: 0,
    total_ar_balance: 0,
    total_overdue_balance: 0,
    total_credit_balance: 0,
    overdue_percentage: 0,
  };

  assertEquals(
    validateDashboardMetricsResponse(dashboard)
      .customer_credit_rating_distribution.rows.length,
    6,
  );
  dashboard.customer_credit_rating_distribution.rows[0] = {
    ...dashboard.customer_credit_rating_distribution.rows[0],
    unexpected: true,
  } as typeof dashboard.customer_credit_rating_distribution.rows[0];
  expectThrows(
    () => validateDashboardMetricsResponse(dashboard),
    'customer_credit_rating_distribution.rows[0]',
  );
  delete (
    dashboard.customer_credit_rating_distribution.rows[0] as Record<
      string,
      unknown
    >
  ).unexpected;
  dashboard.customer_credit_rating_distribution.rows.reverse();
  expectThrows(
    () => validateDashboardMetricsResponse(dashboard),
    'customer_credit_rating_distribution.rows[0].rating',
  );
});

Deno.test('Gate D SQL preserves signatures, filters, outer keys and one exact authority classifier', async () => {
  const migration = await read(
    '../../../database/033_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority.sql',
  );
  const invoiceStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_invoice_collection(',
  );
  const receiptStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_receipt_collection(',
  );
  const invoiceSql = migration.slice(invoiceStart, receiptStart);
  const receiptSql = migration.slice(receiptStart);

  for (
    const required of [
      'BEGIN;',
      'COMMIT;',
      "SET search_path = ''",
      'SECURITY INVOKER',
      "'rows'",
      "'total'",
      "'summary'",
      "'current_balance_summary'",
      "'document_total_summary'",
      'p_page INTEGER DEFAULT 1',
      'p_page_size INTEGER DEFAULT 50',
      'current_consistent_booked_fx_decision',
      'LEGACY_UNVERIFIED',
      'd.stale_reference = false',
      "d.approval_status IN ('NotRequired', 'Approved')",
      "d.lifecycle_status = 'Posted'",
      'd.booked_rate = i.exchange_rate::NUMERIC',
      'd.booked_rate = r.exchange_rate::NUMERIC',
      'i.base_total',
      '= ROUND(i.total_amount * d.booked_rate, 2)',
      'r.base_amount',
      '= ROUND(r.receipt_amount * d.booked_rate, 2)',
      'd.posted = false',
      'd.posted_at IS NULL',
      'd.posted = true',
      'd.posted_at IS NOT NULL',
    ]
  ) {
    assert(
      migration.includes(required),
      `Missing Gate D SQL rule: ${required}`,
    );
  }

  const invoiceClassifier = invoiceSql.slice(
    invoiceSql.indexOf('EXISTS ('),
    invoiceSql.indexOf(') AS is_authoritative'),
  ).replaceAll('i.', 'tx.').replaceAll('invoice_id', 'transaction_id')
    .replaceAll('invoice_date', 'transaction_date');
  const receiptClassifier = receiptSql.slice(
    receiptSql.indexOf('EXISTS ('),
    receiptSql.indexOf(') AS is_authoritative'),
  ).replaceAll('r.', 'tx.').replaceAll('receipt_id', 'transaction_id')
    .replaceAll('receipt_date', 'transaction_date');
  assert(
    invoiceClassifier.length > 4_000 && receiptClassifier.length > 4_000,
    'Authority predicates must be substantive',
  );
  for (
    const source of [
      "WHEN 'BASE_PARITY'",
      "WHEN 'CATALOG'",
      "WHEN 'REFERENCE_SELECTED'",
      "WHEN 'MANUAL_OVERRIDE'",
    ]
  ) {
    assert(invoiceClassifier.includes(source));
    assert(receiptClassifier.includes(source));
  }

  for (
    const filter of [
      'p_status IS NULL',
      'p_customer_id IS NULL',
      'p_posting_period IS NULL',
      'p_date_from IS NULL',
      'p_date_to IS NULL',
      'p_search IS NULL',
    ]
  ) {
    assert(invoiceSql.includes(filter));
    assert(receiptSql.includes(filter));
  }
  assert(invoiceSql.includes('p_doc_type IS NULL'));
  assert(receiptSql.includes('p_payment_method IS NULL'));
});

Deno.test('Gate D Dashboard and customer list use equal tenant, visibility and assignment predicates', async () => {
  const migration = await read(
    '../../../database/033_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority.sql',
  );
  const customers = await read('./customers/service.ts');
  for (
    const predicate of [
      'c.company_id = p_company_id',
      'c.is_deleted = false',
      'c.is_hidden = false',
      'uca.company_id = p_company_id',
      'uca.user_id = p_user_id',
      'uca.customer_id = c.id',
      'uca.is_active = true',
    ]
  ) {
    assert(
      migration.includes(predicate),
      `Missing Dashboard predicate ${predicate}`,
    );
  }
  assert(customers.includes(".eq('company_id', auth.companyId)"));
  assert(customers.includes(".eq('is_hidden', false)"));
  assert(customers.includes(".eq('is_deleted', false)"));
  assert(customers.includes(".order('customer_id', { ascending: true })"));
  assert(
    migration.includes(
      'ON public.customers (company_id, credit_rating, customer_id)',
    ),
  );
});

Deno.test('Gate D migration has zero financial DML/backfill and governed paths cannot create false authority', async () => {
  const migration = await read(
    '../../../database/033_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority.sql',
  );
  const executable = migration.replace(/--.*$/gm, '');
  for (
    const table of [
      'invoices',
      'receipts',
      'exchange_rates',
      'fx_reference_rates',
      'fx_booking_rate_decisions',
      'fx_booking_rate_decision_events',
      'journal_entries',
      'journal_lines',
      'allocations',
      'allocation_details',
      'import_rows',
      'import_batches',
    ]
  ) {
    assert(
      !new RegExp(
        `\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|MERGE\\s+INTO)\\s+public\\.${table}\\b`,
        'i',
      ).test(executable),
      `Gate D must not mutate public.${table}`,
    );
  }

  const invoiceService = await read('./invoices/service.ts');
  const receiptService = await read('./receipts/service.ts');
  const importService = await read('./imports/service.ts');
  const monetaryContracts = await read('./reports/monetary-contracts.ts');
  assert(invoiceService.includes('fx_create_governed_invoice_draft'));
  assert(receiptService.includes('fx_create_governed_receipt_draft'));
  assert(importService.includes('createInvoice'));
  assert(importService.includes('createReceipt'));
  assert(
    monetaryContracts.includes(
      'Deploy a frontend compatibility build that understands v1 and v2',
    ),
  );
  assert(
    monetaryContracts.includes(
      'Deploy v1/v2-compatible Invoice, Receipt and Reports Edge Functions.',
    ),
  );
  assert(
    monetaryContracts.includes('Apply Migration 033 last to activate v2.'),
  );
  assert(
    migration.includes(
      "d.source_category IN (\n            'BASE_PARITY',\n            'CATALOG',\n            'REFERENCE_SELECTED',\n            'MANUAL_OVERRIDE'",
    ),
    'Authority must be an allow-list that excludes legacy and missing provenance',
  );
});
