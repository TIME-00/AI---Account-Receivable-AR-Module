import {
  addCurrencyTotal,
  applyStatementRunningBalances,
  buildStatementCurrencyBalances,
  currencyTotalsFromMap,
  currentBaseFromBookedRate,
  monetarySummaryFromEntries,
  monetaryAggregationMeta,
  roundMoney,
  CURRENT_BALANCE_BOOKED_RATE_BASIS,
  CURRENT_OUTSTANDING_AMOUNT_BASIS,
  CURRENT_UNALLOCATED_AMOUNT_BASIS,
  ORIGINAL_BOOKED_BASE_BASIS,
  ORIGINAL_DOCUMENT_AMOUNT_BASIS,
} from './monetary-contracts.ts';
import type {
  MonetaryCollectionAPIResponse,
  MonetaryCollectionSummary,
} from './monetary-contracts.ts';
import {
  isBaseValueAvailable,
  fxPostingEligibility,
  withOptionalReadEnrichment,
} from '../_shared/fx-read-contracts.ts';
import {
  SUPPORTED_OPERATIONAL_CURRENCIES,
  validateCurrency,
  validateOperationalCurrencyForWrite,
} from '../_shared/validators.ts';
import { successResponse, ValidationError } from '../_shared/errors.ts';
import type { APIResponse, Invoice, Receipt } from '../_shared/types.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { InvoiceService } from '../invoices/service.ts';
import { ReceiptService } from '../receipts/service.ts';
import { CreditNoteService } from '../credit-notes/service.ts';
import { DebitNoteService } from '../debit-notes/service.ts';
import { ReportService } from './service.ts';

const read = (path: string) => Deno.readTextFile(new URL(path, import.meta.url));

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = 'Values differ'): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertJsonEquals(actual: unknown, expected: unknown, message = 'JSON values differ'): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}. Expected ${expectedJson}, got ${actualJson}`);
  }
}

type IsExact<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends
    (<T>() => T extends TExpected ? 1 : 2)
    ? (<T>() => T extends TExpected ? 1 : 2) extends
        (<T>() => T extends TActual ? 1 : 2)
      ? true
      : false
    : false;

type MockRow = Record<string, unknown>;

class MockQuery {
  private filters: Array<(row: MockRow) => boolean> = [];
  private orderField: string | null = null;
  private orderAscending = true;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private singleMode: 'single' | 'maybeSingle' | null = null;
  private selectedColumns = '*';
  private selectOptions: Record<string, unknown> = {};

  constructor(
    private readonly client: MockSupabaseClient,
    private readonly table: string,
  ) {}

  select(columns?: string, options?: Record<string, unknown>): this {
    this.selectedColumns = columns?.trim() || '*';
    this.selectOptions = options ?? {};
    this.client.operations.push({ table: this.table, op: 'select', columns, options });
    return this;
  }

  eq(field: string, value: unknown): this {
    this.client.operations.push({ table: this.table, op: 'eq', field, value });
    this.filters.push(row => row[field] === value);
    return this;
  }

  neq(field: string, value: unknown): this {
    this.filters.push(row => row[field] !== value);
    return this;
  }

  in(field: string, values: unknown[]): this {
    this.client.operations.push({ table: this.table, op: 'in', field, values });
    this.filters.push(row => values.includes(row[field]));
    return this;
  }

  gte(field: string, value: unknown): this {
    this.client.operations.push({ table: this.table, op: 'gte', field, value });
    this.filters.push(row => String(row[field]) >= String(value));
    return this;
  }

  lte(field: string, value: unknown): this {
    this.client.operations.push({ table: this.table, op: 'lte', field, value });
    this.filters.push(row => String(row[field]) <= String(value));
    return this;
  }

  lt(field: string, value: unknown): this {
    this.filters.push(row => String(row[field]) < String(value));
    return this;
  }

  or(expression: string): this {
    this.client.operations.push({ table: this.table, op: 'or', expression });
    const match = expression.match(/%([^%]+)%/);
    const search = match?.[1]?.toLowerCase() ?? '';
    this.filters.push(row => search.length === 0 || Object.values(row).some(value =>
      typeof value === 'string' && value.toLowerCase().includes(search)
    ));
    return this;
  }

  order(field: string, options?: { ascending?: boolean }): this {
    this.orderField = field;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single(): Promise<{ data: MockRow | null; error: null }> {
    this.singleMode = 'single';
    return Promise.resolve(this.execute() as { data: MockRow | null; error: null });
  }

  maybeSingle(): Promise<{ data: MockRow | null; error: null }> {
    this.singleMode = 'maybeSingle';
    return Promise.resolve(this.execute() as { data: MockRow | null; error: null });
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): unknown {
    let rows = [...(this.client.tables[this.table] ?? [])].filter(row =>
      this.filters.every(filter => filter(row))
    );
    const count = rows.length;
    if (this.orderField) {
      rows = rows.sort((a, b) => {
        const left = String(a[this.orderField!]);
        const right = String(b[this.orderField!]);
        return this.orderAscending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    } else if (!this.singleMode) {
      // Match the repository's PostgREST max_rows contract. RPCs return one
      // aggregate JSON object and are intentionally not subject to this cap.
      rows = rows.slice(0, 1000);
    }

    const project = (row: MockRow): MockRow => {
      if (this.selectedColumns === '*') return { ...row };
      const fields = this.selectedColumns
        .split(',')
        .map(field => field.trim())
        .filter(field => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field));
      return Object.fromEntries(fields.map(field => [field, row[field]]));
    };
    const projectedRows = rows.map(project);

    if (this.singleMode) {
      return { data: projectedRows[0] ?? null, error: null };
    }
    if (this.selectOptions.head === true) {
      return { data: null, error: null, count };
    }
    return { data: projectedRows, error: null, count };
  }
}

class MockSupabaseClient {
  operations: MockRow[] = [];
  rpcCalls: MockRow[] = [];
  failDecisionRead = false;
  afterCollectionSnapshot?: () => void;

  constructor(
    public readonly tables: Record<string, MockRow[]>,
    public readonly databaseRole: 'authenticated' | 'service_role' | 'anon' = 'authenticated',
  ) {}

  from(table: string): MockQuery {
    if (this.failDecisionRead && table === 'fx_booking_rate_decisions') {
      return new FailingQuery(this, table);
    }
    return new MockQuery(this, table);
  }

  private scopedCustomerIds(params: Record<string, unknown>): Set<unknown> {
    const companyId = params.p_company_id;
    const visible = (this.tables.customers ?? []).filter(customer =>
      customer.company_id === companyId
      && customer.is_deleted === false
      && customer.is_hidden === false
    );
    if (params.p_scope_mode === 'company') return new Set(visible.map(customer => customer.id));

    const assigned = new Set((this.tables.user_customer_assignments ?? [])
      .filter(assignment =>
        assignment.company_id === companyId
        && assignment.user_id === params.p_user_id
        && assignment.is_active === true
      )
      .map(assignment => assignment.customer_id));
    return new Set(visible.filter(customer => assigned.has(customer.id)).map(customer => customer.id));
  }

  private matchesSearch(row: MockRow, search: unknown, fields: string[]): boolean {
    if (search === null || search === undefined || String(search).length === 0) return true;
    const needle = String(search).toLowerCase();
    return fields.some(field => String(row[field] ?? '').toLowerCase().includes(needle));
  }

  private invoiceCollectionSummary(params: Record<string, unknown>): unknown {
    const customers = this.scopedCustomerIds(params);
    const rows = (this.tables.invoices ?? []).filter(row =>
      row.company_id === params.p_company_id
      && customers.has(row.customer_id)
      && (params.p_doc_type === null || params.p_doc_type === undefined || row.doc_type === params.p_doc_type)
      && (params.p_status === null || params.p_status === undefined || row.status === params.p_status)
      && (params.p_customer_id === null || params.p_customer_id === undefined || row.customer_id === params.p_customer_id)
      && (params.p_posting_period === null || params.p_posting_period === undefined || row.posting_period === params.p_posting_period)
      && (params.p_date_from === null || params.p_date_from === undefined || String(row.invoice_date) >= String(params.p_date_from))
      && (params.p_date_to === null || params.p_date_to === undefined || String(row.invoice_date) <= String(params.p_date_to))
      && this.matchesSearch(row, params.p_search, ['invoice_no', 'customer_name', 'reference_no'])
    );
    const baseCurrency = String((this.tables.companies ?? []).find(company => company.id === params.p_company_id)?.base_currency ?? 'MYR');

    return {
      current_balance_summary: monetarySummaryFromEntries(
        rows.map(row => ({
          currency: String(row.currency),
          transaction_amount: Number(row.outstanding),
          base_amount: currentBaseFromBookedRate(Number(row.outstanding), Number(row.exchange_rate)),
        })),
        baseCurrency,
        CURRENT_BALANCE_BOOKED_RATE_BASIS,
        CURRENT_OUTSTANDING_AMOUNT_BASIS,
      ),
      document_total_summary: monetarySummaryFromEntries(
        rows.map(row => ({
          currency: String(row.currency),
          transaction_amount: Number(row.total_amount),
          base_amount: Number(row.base_total),
        })),
        baseCurrency,
        ORIGINAL_BOOKED_BASE_BASIS,
        ORIGINAL_DOCUMENT_AMOUNT_BASIS,
      ),
    };
  }

  private invoiceCollectionPage(params: Record<string, unknown>): unknown {
    const customers = this.scopedCustomerIds(params);
    const rows = (this.tables.invoices ?? []).filter(row =>
      row.company_id === params.p_company_id
      && customers.has(row.customer_id)
      && (params.p_doc_type === null || params.p_doc_type === undefined || row.doc_type === params.p_doc_type)
      && (params.p_status === null || params.p_status === undefined || row.status === params.p_status)
      && (params.p_customer_id === null || params.p_customer_id === undefined || row.customer_id === params.p_customer_id)
      && (params.p_posting_period === null || params.p_posting_period === undefined || row.posting_period === params.p_posting_period)
      && (params.p_date_from === null || params.p_date_from === undefined || String(row.invoice_date) >= String(params.p_date_from))
      && (params.p_date_to === null || params.p_date_to === undefined || String(row.invoice_date) <= String(params.p_date_to))
      && this.matchesSearch(row, params.p_search, ['invoice_no', 'customer_name', 'reference_no'])
    ).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)) || String(b.id).localeCompare(String(a.id)));
    const page = Number(params.p_page);
    const pageSize = Number(params.p_page_size);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  }

  private receiptCollectionSummary(params: Record<string, unknown>): unknown {
    const customers = this.scopedCustomerIds(params);
    const rows = (this.tables.receipts ?? []).filter(row =>
      row.company_id === params.p_company_id
      && customers.has(row.customer_id)
      && (params.p_status === null || params.p_status === undefined || row.status === params.p_status)
      && (params.p_customer_id === null || params.p_customer_id === undefined || row.customer_id === params.p_customer_id)
      && (params.p_payment_method === null || params.p_payment_method === undefined || row.payment_method === params.p_payment_method)
      && (params.p_posting_period === null || params.p_posting_period === undefined || row.posting_period === params.p_posting_period)
      && (params.p_date_from === null || params.p_date_from === undefined || String(row.receipt_date) >= String(params.p_date_from))
      && (params.p_date_to === null || params.p_date_to === undefined || String(row.receipt_date) <= String(params.p_date_to))
      && this.matchesSearch(row, params.p_search, ['receipt_no', 'customer_name', 'reference_no'])
    );
    const baseCurrency = String((this.tables.companies ?? []).find(company => company.id === params.p_company_id)?.base_currency ?? 'MYR');

    return {
      current_balance_summary: monetarySummaryFromEntries(
        rows.map(row => ({
          currency: String(row.currency),
          transaction_amount: Number(row.unallocated_amount),
          base_amount: currentBaseFromBookedRate(Number(row.unallocated_amount), Number(row.exchange_rate)),
        })),
        baseCurrency,
        CURRENT_BALANCE_BOOKED_RATE_BASIS,
        CURRENT_UNALLOCATED_AMOUNT_BASIS,
      ),
      document_total_summary: monetarySummaryFromEntries(
        rows.map(row => ({
          currency: String(row.currency),
          transaction_amount: Number(row.receipt_amount),
          base_amount: Number(row.base_amount),
        })),
        baseCurrency,
        ORIGINAL_BOOKED_BASE_BASIS,
        ORIGINAL_DOCUMENT_AMOUNT_BASIS,
      ),
    };
  }

  private receiptCollectionPage(params: Record<string, unknown>): unknown {
    const customers = this.scopedCustomerIds(params);
    const rows = (this.tables.receipts ?? []).filter(row =>
      row.company_id === params.p_company_id
      && customers.has(row.customer_id)
      && (params.p_status === null || params.p_status === undefined || row.status === params.p_status)
      && (params.p_customer_id === null || params.p_customer_id === undefined || row.customer_id === params.p_customer_id)
      && (params.p_payment_method === null || params.p_payment_method === undefined || row.payment_method === params.p_payment_method)
      && (params.p_posting_period === null || params.p_posting_period === undefined || row.posting_period === params.p_posting_period)
      && (params.p_date_from === null || params.p_date_from === undefined || String(row.receipt_date) >= String(params.p_date_from))
      && (params.p_date_to === null || params.p_date_to === undefined || String(row.receipt_date) <= String(params.p_date_to))
      && this.matchesSearch(row, params.p_search, ['receipt_no', 'customer_name', 'reference_no'])
    ).sort((a, b) => String(b.receipt_date).localeCompare(String(a.receipt_date)) || String(b.id).localeCompare(String(a.id)));
    const page = Number(params.p_page);
    const pageSize = Number(params.p_page_size);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length };
  }

  private invoiceCollection(params: Record<string, unknown>): unknown {
    const page = this.invoiceCollectionPage(params) as { rows: MockRow[]; total: number };
    const summary = this.invoiceCollectionSummary(params);
    this.afterCollectionSnapshot?.();
    return {
      ...page,
      summary,
    };
  }

  private receiptCollection(params: Record<string, unknown>): unknown {
    const page = this.receiptCollectionPage(params) as { rows: MockRow[]; total: number };
    const summary = this.receiptCollectionSummary(params);
    this.afterCollectionSnapshot?.();
    return {
      ...page,
      summary,
    };
  }

  private agingBucketKey(row: MockRow, asOfDate: string): 'current' | '1_30' | '31_60' | '61_90' | 'over_90' {
    if (!row.due_date || String(row.due_date) >= asOfDate) return 'current';
    const elapsed = Math.floor((new Date(`${asOfDate}T00:00:00Z`).getTime() - new Date(`${String(row.due_date)}T00:00:00Z`).getTime()) / 86400000);
    if (elapsed <= 30) return '1_30';
    if (elapsed <= 60) return '31_60';
    if (elapsed <= 90) return '61_90';
    return 'over_90';
  }

  private scopedAgingRows(params: Record<string, unknown>): MockRow[] {
    const customers = this.scopedCustomerIds(params);
    return (this.tables.invoices ?? []).filter(row =>
      row.company_id === params.p_company_id
      && customers.has(row.customer_id)
      && ['Open', 'Overdue', 'Partially Paid'].includes(String(row.status))
      && ['Invoice', 'Debit Note'].includes(String(row.doc_type))
      && Number(row.outstanding) > 0
    );
  }

  private agingSummary(params: Record<string, unknown>): unknown {
    const rows = this.scopedAgingRows(params);
    const asOfDate = String(params.p_as_of_date);
    const baseCurrency = String((this.tables.companies ?? []).find(company => company.id === params.p_company_id)?.base_currency ?? 'MYR');
    const totals = new Map<string, { currency: string; amount: number; base_amount: number; count: number }>();
    const bucketKeys = ['current', '1_30', '31_60', '61_90', 'over_90'] as const;
    const buckets = new Map(bucketKeys.map(key => [key, { amount: 0, count: 0, currencies: new Map<string, { currency: string; amount: number; base_amount: number; count: number }>() }]));
    let baseTotal = 0;
    let overdueBase = 0;

    for (const row of rows) {
      const amount = Number(row.outstanding);
      const baseAmount = currentBaseFromBookedRate(amount, Number(row.exchange_rate));
      const key = this.agingBucketKey(row, asOfDate);
      addCurrencyTotal(totals, String(row.currency), amount, baseAmount);
      const bucket = buckets.get(key)!;
      addCurrencyTotal(bucket.currencies, String(row.currency), amount, baseAmount);
      bucket.amount = roundMoney(bucket.amount + baseAmount);
      bucket.count++;
      baseTotal = roundMoney(baseTotal + baseAmount);
      if (key !== 'current') overdueBase = roundMoney(overdueBase + baseAmount);
    }
    const byCurrency = currencyTotalsFromMap(totals);
    const definitions = [
      ['current', 'Current', 0, 0], ['1_30', '1-30', 1, 30], ['31_60', '31-60', 31, 60],
      ['61_90', '61-90', 61, 90], ['over_90', 'Over 90', 91, null],
    ] as const;
    return {
      total_customers: new Set(rows.map(row => row.customer_id)).size,
      total_outstanding: baseTotal,
      total_overdue: overdueBase,
      overdue_percentage: baseTotal > 0 ? roundMoney(overdueBase / baseTotal * 100) : 0,
      base_total: baseTotal,
      base_currency: baseCurrency,
      by_currency: byCurrency,
      meta: monetaryAggregationMeta(baseCurrency, byCurrency),
      aging_summary: definitions.map(([key, name, fromDays, toDays]) => {
        const bucket = buckets.get(key)!;
        return {
          bucket_name: name, from_days: fromDays, to_days: toDays, invoice_count: bucket.count,
          total_outstanding: bucket.amount, base_total: bucket.amount, base_currency: baseCurrency,
          by_currency: currencyTotalsFromMap(bucket.currencies), normalization_basis: CURRENT_BALANCE_BOOKED_RATE_BASIS,
          percentage: baseTotal > 0 ? roundMoney(bucket.amount / baseTotal * 100) : 0,
        };
      }),
    };
  }

  private agingByCustomer(params: Record<string, unknown>): unknown {
    const rows = this.scopedAgingRows(params);
    const baseCurrency = String((this.tables.companies ?? []).find(company => company.id === params.p_company_id)?.base_currency ?? 'MYR');
    const asOfDate = String(params.p_as_of_date);
    const grouped = new Map<string, MockRow[]>();
    for (const row of rows) grouped.set(String(row.customer_id), [...(grouped.get(String(row.customer_id)) ?? []), row]);
    const customerRows = [...grouped.entries()].map(([customerId, invoiceRows]) => {
      const customer = (this.tables.customers ?? []).find(row => row.id === customerId)!;
      const currencies = new Map<string, { currency: string; amount: number; base_amount: number; count: number }>();
      const amounts = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0 };
      for (const row of invoiceRows) {
        const amount = Number(row.outstanding);
        const baseAmount = currentBaseFromBookedRate(amount, Number(row.exchange_rate));
        addCurrencyTotal(currencies, String(row.currency), amount, baseAmount);
        const key = this.agingBucketKey(row, asOfDate);
        amounts[key] = roundMoney(amounts[key] + baseAmount);
      }
      const byCurrency = currencyTotalsFromMap(currencies);
      const total = roundMoney(Object.values(amounts).reduce((sum, value) => sum + value, 0));
      return {
        customer_id: customerId, customer_name: customer.customer_name, customer_code: customer.customer_id,
        credit_limit: Number(customer.credit_limit ?? 0), credit_rating: customer.credit_rating,
        total_outstanding: total, base_total: total, base_currency: baseCurrency, by_currency: byCurrency,
        meta: monetaryAggregationMeta(baseCurrency, byCurrency), current_amount: amounts.current,
        bucket_1_30: amounts['1_30'], bucket_31_60: amounts['31_60'], bucket_61_90: amounts['61_90'], bucket_over_90: amounts.over_90,
      };
    }).sort((a, b) => b.base_total - a.base_total || String(a.customer_name).localeCompare(String(b.customer_name)));
    const page = Number(params.p_page);
    const pageSize = Number(params.p_page_size);
    return { rows: customerRows.slice((page - 1) * pageSize, page * pageSize), total: customerRows.length };
  }

  private customerStatement(params: Record<string, unknown>): unknown {
    const baseCurrency = String((this.tables.companies ?? []).find(company => company.id === params.p_company_id)?.base_currency ?? 'MYR');
    const customer = (this.tables.customers ?? []).find(row => row.id === params.p_customer_id)!;
    const periodFrom = String(params.p_period_from);
    const periodTo = String(params.p_period_to);
    const invoices = (this.tables.invoices ?? []).filter(row =>
      row.company_id === params.p_company_id
      && row.customer_id === params.p_customer_id
      && !['Draft', 'Cancelled'].includes(String(row.status))
    );
    const receipts = (this.tables.receipts ?? []).filter(row =>
      row.company_id === params.p_company_id
      && row.customer_id === params.p_customer_id
      && !['Draft', 'Cancelled', 'Bounced'].includes(String(row.status))
    );

    const opening = [
      ...invoices.filter(row => String(row.invoice_date) < periodFrom).map(row => ({
        currency: String(row.currency),
        debit: row.doc_type === 'Credit Note' ? 0 : Number(row.total_amount),
        credit: row.doc_type === 'Credit Note' ? Number(row.total_amount) : 0,
        base_debit: row.doc_type === 'Credit Note' ? 0 : Number(row.base_total),
        base_credit: row.doc_type === 'Credit Note' ? Number(row.base_total) : 0,
      })),
      ...receipts.filter(row => String(row.receipt_date) < periodFrom).map(row => ({
        currency: String(row.currency), debit: 0, credit: Number(row.receipt_amount), base_debit: 0, base_credit: Number(row.base_amount),
      })),
    ];
    const period = [
      ...invoices.filter(row => String(row.invoice_date) >= periodFrom && String(row.invoice_date) <= periodTo).map(row => ({
        id: String(row.id), date: String(row.invoice_date), doc_type: String(row.doc_type), doc_no: String(row.invoice_no),
        description: `${String(row.doc_type)}: ${String(row.invoice_no)}`, currency: String(row.currency), exchange_rate: Number(row.exchange_rate),
        debit: row.doc_type === 'Credit Note' ? 0 : Number(row.total_amount), credit: row.doc_type === 'Credit Note' ? Number(row.total_amount) : 0,
        base_debit: row.doc_type === 'Credit Note' ? 0 : Number(row.base_total), base_credit: row.doc_type === 'Credit Note' ? Number(row.base_total) : 0,
      })),
      ...receipts.filter(row => String(row.receipt_date) >= periodFrom && String(row.receipt_date) <= periodTo).map(row => ({
        id: String(row.id), date: String(row.receipt_date), doc_type: 'Receipt', doc_no: String(row.receipt_no),
        description: `Receipt: ${String(row.receipt_no)} (${String(row.payment_method)})`, currency: String(row.currency), exchange_rate: Number(row.exchange_rate),
        debit: 0, credit: Number(row.receipt_amount), base_debit: 0, base_credit: Number(row.base_amount),
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.doc_no.localeCompare(b.doc_no) || a.id.localeCompare(b.id));

    const movements = [
      ...opening.map(row => ({ currency: row.currency, opening_delta: row.debit - row.credit })),
      ...period.map(row => ({ currency: row.currency, debit: row.debit, credit: row.credit })),
    ];
    const byCurrency = buildStatementCurrencyBalances(movements);
    const multiCurrency = byCurrency.length > 1;
    let transactionBalance = opening.reduce((sum, row) => roundMoney(sum + row.debit - row.credit), 0);
    let baseBalance = opening.reduce((sum, row) => roundMoney(sum + row.base_debit - row.base_credit), 0);
    const lines = period.map(row => {
      transactionBalance = roundMoney(transactionBalance + row.debit - row.credit);
      baseBalance = roundMoney(baseBalance + row.base_debit - row.base_credit);
      return {
        ...row,
        transaction_debit: row.debit,
        transaction_credit: row.credit,
        transaction_balance: multiCurrency ? null : transactionBalance,
        balance: multiCurrency ? null : transactionBalance,
        base_currency: baseCurrency,
        base_balance: baseBalance,
        amount_basis: 'stored_booked_base_snapshot',
      };
    });
    const totalDebit = period.reduce((sum, row) => roundMoney(sum + row.debit), 0);
    const totalCredit = period.reduce((sum, row) => roundMoney(sum + row.credit), 0);
    const totalDebitBase = period.reduce((sum, row) => roundMoney(sum + row.base_debit), 0);
    const totalCreditBase = period.reduce((sum, row) => roundMoney(sum + row.base_credit), 0);
    const openingBalance = opening.reduce((sum, row) => roundMoney(sum + row.debit - row.credit), 0);
    const openingBalanceBase = opening.reduce((sum, row) => roundMoney(sum + row.base_debit - row.base_credit), 0);

    return {
      customer_id: params.p_customer_id,
      customer_name: customer.customer_name,
      customer_code: customer.customer_id,
      address: '', period_from: periodFrom, period_to: periodTo,
      opening_balance: multiCurrency ? null : openingBalance,
      lines,
      closing_balance: multiCurrency ? null : roundMoney(openingBalance + totalDebit - totalCredit),
      total_debit: multiCurrency ? null : totalDebit,
      total_credit: multiCurrency ? null : totalCredit,
      base_currency: baseCurrency,
      opening_balance_base: openingBalanceBase,
      closing_balance_base: roundMoney(openingBalanceBase + totalDebitBase - totalCreditBase),
      total_debit_base: totalDebitBase,
      total_credit_base: totalCreditBase,
      by_currency: byCurrency,
      meta: { base_currency: baseCurrency, multi_currency: multiCurrency, normalization_basis: 'stored_booked_base_snapshot' },
      legacy_amount_basis: 'transaction_currency_legacy',
      legacy_transaction_fields_valid: !multiCurrency,
      legacy_transaction_currency: multiCurrency ? null : byCurrency[0]?.currency ?? null,
    };
  }

  async rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code: string; message: string } | null }> {
    this.rpcCalls.push({ functionName, params });
    if (functionName.startsWith('ar_') && this.databaseRole !== 'authenticated') {
      return {
        data: null,
        error: { code: '42501', message: 'permission denied for authenticated read RPC' },
      };
    }
    if (functionName === 'get_next_sequence') {
      return { data: params.p_doc_type === 'RCT' ? 'RCT-MOCK-001' : 'INV-MOCK-001', error: null };
    }
    if (functionName === 'fx_create_governed_invoice_draft') {
      return { data: 'inv-created', error: null };
    }
    if (functionName === 'fx_create_governed_receipt_draft') {
      return { data: 'rct-created', error: null };
    }
    if (functionName === 'ar_invoice_collection') {
      return { data: this.invoiceCollection(params), error: null };
    }
    if (functionName === 'ar_receipt_collection') {
      return { data: this.receiptCollection(params), error: null };
    }
    if (functionName === 'ar_customer_statement') {
      return { data: this.customerStatement(params), error: null };
    }
    if (functionName === 'ar_aging_summary') {
      return { data: this.agingSummary(params), error: null };
    }
    if (functionName === 'ar_aging_by_customer') {
      return { data: this.agingByCustomer(params), error: null };
    }
    return { data: null, error: null };
  }
}

class FailingQuery extends MockQuery {
  override then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: { message: 'forced decision read failure' } })
      .then(onfulfilled, onrejected);
  }
}

const clerkAuth: AuthContext = {
  userId: 'user-1',
  companyId: 'co-1',
  roles: ['AR Clerk'],
  highestRole: 'AR Clerk',
  email: 'clerk@example.test',
};

const managerAuth: AuthContext = {
  userId: 'manager-1',
  companyId: 'co-1',
  roles: ['Finance Manager'],
  highestRole: 'Finance Manager',
  email: 'manager@example.test',
};

Deno.test('Batch 9D-D grouped mixed-currency totals never collapse to transaction sum 300', () => {
  const totals = new Map();
  addCurrencyTotal(totals, 'USD', 100, currentBaseFromBookedRate(100, 1.35));
  addCurrencyTotal(totals, 'SGD', 100, currentBaseFromBookedRate(100, 3.10));
  addCurrencyTotal(totals, 'MYR', 100, currentBaseFromBookedRate(100, 1.00));

  const byCurrency = currencyTotalsFromMap(totals);
  const baseTotal = roundMoney(byCurrency.reduce((sum, row) => sum + row.base_amount, 0));
  const meta = monetaryAggregationMeta('MYR', byCurrency);

  assertEquals(byCurrency.length, 3, 'Expected grouped currency rows');
  assertEquals(baseTotal, 545, 'Expected approved MYR 545 anchor');
  assert(baseTotal !== 300, 'Mixed-currency transaction amounts must not render as one monetary total');
  assertEquals(meta.multi_currency, true, 'Expected multi-currency metadata');
  assertEquals(meta.normalization_basis, CURRENT_BALANCE_BOOKED_RATE_BASIS, 'Expected booked-rate current-balance basis');
});

Deno.test('Batch 9D-D mock enforces selected-column projection and the 1,000-row raw-query cap', async () => {
  const client = new MockSupabaseClient({
    invoices: Array.from({ length: 1001 }, (_, index) => ({ id: `projection-${index}`, base_total: index, omitted: 'must-not-leak' })),
  });
  const result = await client.from('invoices').select('id,base_total') as unknown as { data: MockRow[]; count: number };
  assertEquals(result.data.length, 1000);
  assertEquals(result.count, 1001);
  assertEquals(Object.hasOwn(result.data[0], 'base_total'), true);
  assertEquals(Object.hasOwn(result.data[0], 'omitted'), false);
});

Deno.test('Batch 9D-D base availability is null/empty safe and sign-neutral', () => {
  assertEquals(isBaseValueAvailable(null), false);
  assertEquals(isBaseValueAvailable(undefined), false);
  assertEquals(isBaseValueAvailable(''), false);
  assertEquals(isBaseValueAvailable('   '), false);
  assertEquals(isBaseValueAvailable(0), true);
  assertEquals(isBaseValueAvailable('0.00'), true);
  assertEquals(isBaseValueAvailable(123.45), true);
  assertEquals(isBaseValueAvailable(-12.34), true);
  assertEquals(isBaseValueAvailable(Number.NaN), false);
  assertEquals(isBaseValueAvailable('not-a-number'), false);
});

Deno.test('Batch 9D-D FX governance eligibility reasons are explicit and not a global posting contract', () => {
  assertEquals(fxPostingEligibility(null).reason, 'missing_decision');
  assertEquals(fxPostingEligibility({
    source_category: 'CATALOG',
    approval_status: 'Approved',
    lifecycle_status: 'Approved',
    stale_reference: true,
  }).reason, 'stale_decision');
  assertEquals(fxPostingEligibility({
    source_category: 'MANUAL_OVERRIDE',
    approval_status: 'Pending',
    lifecycle_status: 'Pending',
    stale_reference: false,
  }).reason, 'pending_approval');
  assertEquals(fxPostingEligibility({
    source_category: 'MANUAL_OVERRIDE',
    approval_status: 'Rejected',
    lifecycle_status: 'Rejected',
    stale_reference: false,
  }).reason, 'rejected');
  assertEquals(fxPostingEligibility({
    source_category: 'CATALOG',
    approval_status: 'Approved',
    lifecycle_status: 'Superseded',
    stale_reference: false,
  }).reason, 'non_current_decision');
  assertEquals(fxPostingEligibility({
    source_category: 'CATALOG',
    approval_status: 'Approved',
    lifecycle_status: 'Posted',
    stale_reference: false,
  }).reason, 'blocked');
  assertJsonEquals(fxPostingEligibility({
    source_category: 'BASE_PARITY',
    approval_status: 'NotRequired',
    lifecycle_status: 'Draft',
    stale_reference: false,
  }), { gate: 'fx_governance', eligible: true, reason: 'not_required' });
  assertJsonEquals(fxPostingEligibility({
    source_category: 'CATALOG',
    approval_status: 'NotRequired',
    lifecycle_status: 'Draft',
    stale_reference: false,
  }), { gate: 'fx_governance', eligible: true, reason: 'not_required' });
  assertJsonEquals(fxPostingEligibility({
    source_category: 'MANUAL_OVERRIDE',
    approval_status: 'Approved',
    lifecycle_status: 'Approved',
    stale_reference: false,
  }), { gate: 'fx_governance', eligible: true, reason: 'approved' });
  assertJsonEquals(fxPostingEligibility({
    source_category: 'REFERENCE_SELECTED',
    approval_status: 'Approved',
    lifecycle_status: 'Approved',
    stale_reference: false,
  }), { gate: 'fx_governance', eligible: true, reason: 'approved' });
  assertJsonEquals(fxPostingEligibility({
    source_category: 'LEGACY_UNVERIFIED',
    approval_status: 'NotRequired',
    lifecycle_status: 'Draft',
    stale_reference: false,
  }), { gate: 'fx_governance', eligible: false, reason: 'blocked' });
  for (const decision of [
    { source_category: 'CATALOG', approval_status: 'Approved', lifecycle_status: 'Draft', stale_reference: false },
    { source_category: 'CATALOG', approval_status: 'Pending', lifecycle_status: 'Approved', stale_reference: false },
    { source_category: 'CATALOG', approval_status: 'Rejected', lifecycle_status: 'Pending', stale_reference: false },
    { source_category: 'CATALOG', approval_status: 'NotRequired', lifecycle_status: 'Approved', stale_reference: false },
  ]) {
    assertJsonEquals(fxPostingEligibility(decision), {
      gate: 'fx_governance',
      eligible: false,
      reason: 'inconsistent_state',
    });
  }
});

Deno.test('Batch 9D-D optional post-write enrichment cannot mask a committed mutation', async () => {
  const committed = { id: 'committed-mutation' };
  const result = await withOptionalReadEnrichment(committed, async () => {
    throw new Error('optional enrichment failed');
  });
  assertEquals(result, committed);
});

Deno.test('Batch 9D-D current-base derivation uses current balance and immutable booked rate', () => {
  const originalTransactionTotal = 100;
  const currentOutstanding = 40;
  const bookedRate = 4.125;

  assertEquals(currentBaseFromBookedRate(originalTransactionTotal, bookedRate), 412.5);
  assertEquals(currentBaseFromBookedRate(currentOutstanding, bookedRate), 165);
});

Deno.test('Batch 9D-D monetary rounding is backend-defined at two decimals including .005 boundary', () => {
  for (const [input, expected] of [
    [1.005, 1.01],
    [-1.005, -1.01],
    [2.675, 2.68],
    [-2.675, -2.68],
    [10.005, 10.01],
    [-10.005, -10.01],
    [0, 0],
  ] as const) {
    assertEquals(roundMoney(input), expected, `Unexpected PostgreSQL-compatible rounding for ${input}`);
  }
  assertEquals(currentBaseFromBookedRate(1, 1.005), 1.01);
  assertEquals(currentBaseFromBookedRate(-1, 1.005), -1.01);
});

Deno.test('Batch 9D-D operational currency validation accepts only the approved new-write set', () => {
  for (const currency of SUPPORTED_OPERATIONAL_CURRENCIES) {
    validateOperationalCurrencyForWrite(currency);
  }

  for (const currency of ['AUD', 'JPY', 'HKD']) {
    try {
      validateOperationalCurrencyForWrite(currency);
    } catch (error) {
      assert(error instanceof ValidationError, `Expected ValidationError for ${currency}`);
      continue;
    }
    throw new Error(`Expected unsupported currency ${currency} to fail closed for new writes`);
  }
});

Deno.test('Batch 9D-D generic currency validation keeps legacy three-letter reads valid', () => {
  for (const legacyCurrency of ['AUD', 'JPY', 'HKD']) {
    validateCurrency(legacyCurrency);
  }
});

Deno.test('Batch 9D-D statement balances preserve legacy transaction fields and add base fields', () => {
  const lines = [
    {
      debit: 100,
      credit: 0,
      balance: 0,
      transaction_balance: 0,
      base_debit: 135,
      base_credit: 0,
      base_balance: 0,
    },
    {
      debit: 0,
      credit: 20,
      balance: 0,
      transaction_balance: 0,
      base_debit: 0,
      base_credit: 27,
      base_balance: 0,
    },
  ];

  const result = applyStatementRunningBalances(lines, 10, 13.5);
  assertEquals(result.closing_transaction_balance, 90);
  assertEquals(result.closing_base_balance, 121.5);
  assertEquals(result.lines[0].balance, 110);
  assertEquals(result.lines[0].transaction_balance, 110);
  assertEquals(result.lines[0].base_balance, 148.5);
});

Deno.test('Batch 9D-D statement v2 groups native balances by currency and marks mixed scalar compatibility', () => {
  const byCurrency = buildStatementCurrencyBalances([
    { currency: 'USD', opening_delta: 100 },
    { currency: 'SGD', opening_delta: 100 },
    { currency: 'MYR', opening_delta: 100 },
    { currency: 'USD', credit: 25 },
    { currency: 'SGD', debit: 10 },
  ]);
  const meta = monetaryAggregationMeta('MYR', byCurrency);

  assertJsonEquals(byCurrency, [
    { currency: 'MYR', opening_balance: 100, total_debit: 0, total_credit: 0, closing_balance: 100 },
    { currency: 'SGD', opening_balance: 100, total_debit: 10, total_credit: 0, closing_balance: 110 },
    { currency: 'USD', opening_balance: 100, total_debit: 0, total_credit: 25, closing_balance: 75 },
  ]);
  assertEquals(meta.multi_currency, true);
  const unsafeMixedScalar = byCurrency.reduce((sum, row) => sum + row.opening_balance, 0);
  assertEquals(unsafeMixedScalar, 300);
  assert(meta.multi_currency, 'Legacy scalar transaction fields must be treated as invalid when currencies are mixed');
});

Deno.test('Batch 9D-D statement v2 preserves single-currency legacy compatibility metadata', () => {
  const byCurrency = buildStatementCurrencyBalances([
    { currency: 'USD', opening_delta: 100 },
    { currency: 'USD', debit: 50 },
    { currency: 'USD', credit: 25 },
  ]);
  const meta = monetaryAggregationMeta('MYR', byCurrency);

  assertJsonEquals(byCurrency, [
    { currency: 'USD', opening_balance: 100, total_debit: 50, total_credit: 25, closing_balance: 125 },
  ]);
  assertEquals(meta.multi_currency, false);
});

Deno.test('Batch 9D-D invoice report summary contract returns grouped and company-base totals', () => {
  const summary = monetarySummaryFromEntries([
    { currency: 'USD', transaction_amount: 100, base_amount: currentBaseFromBookedRate(100, 1.35) },
    { currency: 'SGD', transaction_amount: 100, base_amount: currentBaseFromBookedRate(100, 3.10) },
    { currency: 'MYR', transaction_amount: 100, base_amount: currentBaseFromBookedRate(100, 1.00) },
  ], 'MYR');

  assertEquals(summary.row_count, 3);
  assertEquals(summary.base_total, 545);
  assertEquals(summary.meta.multi_currency, true);
  assertJsonEquals(summary.by_currency.map(row => [row.currency, row.amount, row.base_amount]), [
    ['MYR', 100, 100],
    ['SGD', 100, 310],
    ['USD', 100, 135],
  ]);
});

Deno.test('Batch 9D-D receipt and outstanding summary contracts use current balances with booked rates', () => {
  const receiptSummary = monetarySummaryFromEntries([
    { currency: 'USD', transaction_amount: 40, base_amount: currentBaseFromBookedRate(40, 1.35) },
    { currency: 'SGD', transaction_amount: 20, base_amount: currentBaseFromBookedRate(20, 3.10) },
  ], 'MYR');
  const outstandingSummary = monetarySummaryFromEntries([
    { currency: 'USD', transaction_amount: 25, base_amount: currentBaseFromBookedRate(25, 1.35) },
    { currency: 'MYR', transaction_amount: 75, base_amount: currentBaseFromBookedRate(75, 1.00) },
  ], 'MYR');

  assertEquals(receiptSummary.base_total, 116);
  assertEquals(receiptSummary.meta.multi_currency, true);
  assertEquals(outstandingSummary.base_total, 108.75);
  assertEquals(outstandingSummary.meta.multi_currency, true);
});

Deno.test('Batch 9D-D invoice and receipt API envelopes expose one typed monetary summary at meta.summary', () => {
  const summary: MonetaryCollectionSummary = {
    current_balance_summary: monetarySummaryFromEntries(
      [{ currency: 'USD', transaction_amount: 100, base_amount: 135 }],
      'MYR',
      CURRENT_BALANCE_BOOKED_RATE_BASIS,
      CURRENT_OUTSTANDING_AMOUNT_BASIS,
    ),
    document_total_summary: monetarySummaryFromEntries(
      [{ currency: 'USD', transaction_amount: 120, base_amount: 162 }],
      'MYR',
      ORIGINAL_BOOKED_BASE_BASIS,
      ORIGINAL_DOCUMENT_AMOUNT_BASIS,
    ),
  };

  const invoiceEnvelope: MonetaryCollectionAPIResponse<Invoice[]> = successResponse<Invoice[], MonetaryCollectionSummary>(
    [],
    { total: 1, page: 1, page_size: 50, summary },
  );
  const receiptEnvelope: MonetaryCollectionAPIResponse<Receipt[]> = successResponse<Receipt[], MonetaryCollectionSummary>(
    [],
    { total: 1, page: 1, page_size: 50, summary },
  );

  type InvoiceSummaryType = NonNullable<NonNullable<typeof invoiceEnvelope.meta>['summary']>;
  type ReceiptSummaryType = NonNullable<NonNullable<typeof receiptEnvelope.meta>['summary']>;
  const invoiceSummaryIsExact: IsExact<InvoiceSummaryType, MonetaryCollectionSummary> = true;
  const receiptSummaryIsExact: IsExact<ReceiptSummaryType, MonetaryCollectionSummary> = true;

  assertEquals(invoiceSummaryIsExact, true);
  assertEquals(receiptSummaryIsExact, true);
  assertEquals(invoiceEnvelope.meta?.summary?.current_balance_summary.amount_basis, 'current_outstanding');
  assertEquals(invoiceEnvelope.meta?.summary?.document_total_summary.amount_basis, 'original_document_total');
  assertEquals(receiptEnvelope.meta?.summary?.current_balance_summary.base_total, 135);
  assertEquals(receiptEnvelope.meta?.summary?.document_total_summary.base_total, 162);
  assertJsonEquals(Object.keys(invoiceEnvelope).sort(), ['data', 'meta', 'success']);
  assert(invoiceEnvelope.meta && 'summary' in invoiceEnvelope.meta, 'Runtime summary must remain under meta.summary');
  assert(receiptEnvelope.meta && 'summary' in receiptEnvelope.meta, 'Receipt runtime summary must remain under meta.summary');
});

Deno.test('Batch 9D-D canonical API response remains compatible without collection summaries or metadata', () => {
  const paginated: APIResponse<Array<{ id: string }>> = successResponse(
    [{ id: 'row-1' }],
    { total: 1, page: 1, page_size: 50 },
  );
  const withoutMetadata: APIResponse<{ id: string }> = successResponse({ id: 'row-1' });

  assertEquals(paginated.meta?.total, 1);
  assert(!paginated.meta || !('summary' in paginated.meta), 'Ordinary paginated responses must not fabricate summaries');
  assertEquals(withoutMetadata.meta, undefined);
  assertEquals(withoutMetadata.data?.id, 'row-1');
});

Deno.test('Batch 9D-D monetary collection summary has one canonical interface definition', async () => {
  const sharedTypes = await read('../_shared/types.ts');
  const monetaryContracts = await read('./monetary-contracts.ts');
  assert(!sharedTypes.includes('interface MonetaryCollectionSummary'), 'Shared envelope types must not duplicate the monetary summary interface');
  assertEquals(
    monetaryContracts.match(/export interface MonetaryCollectionSummary/g)?.length ?? 0,
    1,
    'Expected one canonical MonetaryCollectionSummary interface',
  );
});

Deno.test('Batch 9D-D InvoiceService.listInvoices returns scoped rows and full filtered summaries', async () => {
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-b', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-hidden', company_id: 'co-1', is_deleted: false, is_hidden: true },
    ],
    user_customer_assignments: [
      { id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true },
      { id: 'assign-b', user_id: 'user-1', customer_id: 'cust-b', company_id: 'co-1', is_active: true },
    ],
    invoices: [
      { id: 'inv-1', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'B9DD-001', customer_name: 'A', reference_no: 'S', status: 'Open', invoice_date: '2026-01-10', currency: 'USD', outstanding: 100, total_amount: 120, exchange_rate: 1.35, base_total: 162, fx_decision_id: 'dec-1' },
      { id: 'inv-2', company_id: 'co-1', customer_id: 'cust-b', invoice_no: 'B9DD-002', customer_name: 'B', reference_no: 'S', status: 'Open', invoice_date: '2026-01-11', currency: 'SGD', outstanding: 100, total_amount: 110, exchange_rate: 3.10, base_total: 341, fx_decision_id: 'dec-2' },
      { id: 'inv-3', company_id: 'co-1', customer_id: 'cust-hidden', invoice_no: 'B9DD-003', customer_name: 'H', reference_no: 'S', status: 'Open', invoice_date: '2026-01-12', currency: 'MYR', outstanding: 100, total_amount: 100, exchange_rate: 1, base_total: 100, fx_decision_id: null },
      { id: 'inv-4', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'OTHER', customer_name: 'A', reference_no: 'X', status: 'Paid', invoice_date: '2026-01-13', currency: 'MYR', outstanding: 0, total_amount: 50, exchange_rate: 1, base_total: 50, fx_decision_id: null },
    ],
    fx_booking_rate_decisions: [
      { id: 'dec-1', source_category: 'CATALOG', approval_status: 'NotRequired', lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'dec-1', supersedes_decision_id: null, import_origin: null, booked_rate: 1.35, deviation_pct: null, stale_reference: false },
      { id: 'dec-2', source_category: 'CATALOG', approval_status: 'NotRequired', lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'dec-2', supersedes_decision_id: null, import_origin: null, booked_rate: 3.10, deviation_pct: null, stale_reference: false },
    ],
  });

  const service = new InvoiceService(client as never, client as never);
  const result = await service.listInvoices(clerkAuth, {
    status: 'Open',
    date_from: '2026-01-01',
    date_to: '2026-01-31',
    search: 'B9DD',
  }, { page: 1, page_size: 1 });

  assertEquals(result.invoices.length, 1, 'Pagination should return only one row');
  assertEquals(result.total, 2, 'Count should include all filtered matching rows');
  assertEquals(result.summary.current_balance_summary.row_count, 2, 'Summary should use all filtered rows, not only page rows');
  assertEquals(result.summary.current_balance_summary.amount_basis, 'current_outstanding');
  assertEquals(result.summary.current_balance_summary.base_total, 445);
  assertEquals(result.summary.document_total_summary.amount_basis, 'original_document_total');
  assertEquals(result.summary.document_total_summary.base_total, 503);
  assertEquals(result.summary.current_balance_summary.meta.multi_currency, true);
  assertEquals(
    client.rpcCalls.filter(call => call.functionName === 'ar_invoice_collection').length,
    1,
    'Invoice page, total, and summary must come from one RPC invocation',
  );
  const response = successResponse(result.invoices, { total: result.total, page: 1, page_size: 1, summary: result.summary });
  assert(response.meta?.summary !== undefined, 'Index response metadata must carry a typed summary');
});

Deno.test('Batch 9D-D ReceiptService.listReceipts returns scoped rows and full filtered summaries', async () => {
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-b', company_id: 'co-1', is_deleted: false, is_hidden: false },
    ],
    user_customer_assignments: [
      { id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true },
      { id: 'assign-b', user_id: 'user-1', customer_id: 'cust-b', company_id: 'co-1', is_active: true },
    ],
    receipts: [
      { id: 'rct-1', company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'B9DD-R1', customer_name: 'A', reference_no: 'S', status: 'Posted', payment_method: 'Bank Transfer', receipt_date: '2026-01-10', currency: 'USD', unallocated_amount: 100, receipt_amount: 120, exchange_rate: 1.35, base_amount: 162, fx_decision_id: 'rdec-1' },
      { id: 'rct-2', company_id: 'co-1', customer_id: 'cust-b', receipt_no: 'B9DD-R2', customer_name: 'B', reference_no: 'S', status: 'Posted', payment_method: 'Bank Transfer', receipt_date: '2026-01-11', currency: 'SGD', unallocated_amount: 100, receipt_amount: 110, exchange_rate: 3.10, base_amount: 341, fx_decision_id: 'rdec-2' },
    ],
    fx_booking_rate_decisions: [
      { id: 'rdec-1', source_category: 'CATALOG', approval_status: 'NotRequired', lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'rdec-1', supersedes_decision_id: null, import_origin: null, booked_rate: 1.35, deviation_pct: null, stale_reference: false },
      { id: 'rdec-2', source_category: 'CATALOG', approval_status: 'NotRequired', lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'rdec-2', supersedes_decision_id: null, import_origin: null, booked_rate: 3.10, deviation_pct: null, stale_reference: false },
    ],
  });

  const service = new ReceiptService(client as never, client as never);
  const result = await service.listReceipts(clerkAuth, {
    status: 'Posted',
    date_from: '2026-01-01',
    date_to: '2026-01-31',
    search: 'B9DD',
  }, { page: 1, page_size: 1 });

  assertEquals(result.receipts.length, 1);
  assertEquals(result.total, 2);
  assertEquals(result.summary.current_balance_summary.row_count, 2);
  assertEquals(result.summary.current_balance_summary.amount_basis, 'current_unallocated');
  assertEquals(result.summary.current_balance_summary.base_total, 445);
  assertEquals(result.summary.document_total_summary.amount_basis, 'original_document_total');
  assertEquals(result.summary.document_total_summary.base_total, 503);
  assertEquals(
    client.rpcCalls.filter(call => call.functionName === 'ar_receipt_collection').length,
    1,
    'Receipt page, total, and summary must come from one RPC invocation',
  );
});

Deno.test('Batch 9D-D single collection RPC keeps page and summary snapshot-consistent across a simulated concurrent change', async () => {
  const common = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    fx_booking_rate_decisions: [],
  };
  const invoice = {
    id: 'inv-snapshot-1', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'SNAP-INV-1',
    customer_name: 'A', reference_no: null, doc_type: 'Invoice', status: 'Open', posting_period: '2026-01',
    invoice_date: '2026-01-10', currency: 'MYR', outstanding: 100, total_amount: 100,
    exchange_rate: 1, base_total: 100, fx_decision_id: null,
  };
  const invoiceClient = new MockSupabaseClient({ ...common, invoices: [invoice] });
  invoiceClient.afterCollectionSnapshot = () => {
    invoiceClient.tables.invoices.push({ ...invoice, id: 'inv-snapshot-2', invoice_no: 'SNAP-INV-2' });
  };
  const invoiceResult = await new InvoiceService(invoiceClient as never, invoiceClient as never).listInvoices(
    clerkAuth, { search: 'SNAP' }, { page: 1, page_size: 10 },
  );
  assertEquals(invoiceResult.invoices.length, 1);
  assertEquals(invoiceResult.total, 1);
  assertEquals(invoiceResult.summary.current_balance_summary.row_count, 1);
  assertEquals(invoiceClient.rpcCalls.filter(call => call.functionName === 'ar_invoice_collection').length, 1);

  const receipt = {
    id: 'rct-snapshot-1', company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'SNAP-RCT-1',
    customer_name: 'A', reference_no: null, status: 'Posted', payment_method: 'Bank Transfer', posting_period: '2026-01',
    receipt_date: '2026-01-10', currency: 'MYR', unallocated_amount: 100, receipt_amount: 100,
    exchange_rate: 1, base_amount: 100, fx_decision_id: null,
  };
  const receiptClient = new MockSupabaseClient({ ...common, receipts: [receipt] });
  receiptClient.afterCollectionSnapshot = () => {
    receiptClient.tables.receipts.push({ ...receipt, id: 'rct-snapshot-2', receipt_no: 'SNAP-RCT-2' });
  };
  const receiptResult = await new ReceiptService(receiptClient as never, receiptClient as never).listReceipts(
    clerkAuth, { search: 'SNAP' }, { page: 1, page_size: 10 },
  );
  assertEquals(receiptResult.receipts.length, 1);
  assertEquals(receiptResult.total, 1);
  assertEquals(receiptResult.summary.current_balance_summary.row_count, 1);
  assertEquals(receiptClient.rpcCalls.filter(call => call.functionName === 'ar_receipt_collection').length, 1);
});

Deno.test('Batch 9D-D ordinary user-domain reads reject a service-role-only mock client', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    invoices: [],
    receipts: [],
  };
  const serviceRoleClient = new MockSupabaseClient(tables, 'service_role');
  const operations = [
    () => new InvoiceService(serviceRoleClient as never, serviceRoleClient as never).listInvoices(clerkAuth, {}, { page: 1, page_size: 10 }),
    () => new ReceiptService(serviceRoleClient as never, serviceRoleClient as never).listReceipts(clerkAuth, {}, { page: 1, page_size: 10 }),
    () => new ReportService(serviceRoleClient as never, serviceRoleClient as never).getAgingSummary(managerAuth, '2026-01-31'),
  ];
  for (const operation of operations) {
    let rejected = false;
    try {
      await operation();
    } catch (error) {
      rejected = String(error).includes('permission denied')
        || String(error).includes('Report access is not permitted');
    }
    assertEquals(rejected, true, 'Ordinary user-domain reads must not depend on service_role execution');
  }
});

Deno.test('Batch 9D-D services route migration-027 reads through the authenticated client, not the mutation client', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{
      id: 'cust-a', company_id: 'co-1', customer_id: 'CUST-A', customer_name: 'A',
      credit_limit: 0, credit_rating: 'A', is_deleted: false, is_hidden: false,
    }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    invoices: [],
    receipts: [],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const authenticatedReadClient = new MockSupabaseClient(tables, 'authenticated');

  await new InvoiceService(mutationClient as never, authenticatedReadClient as never).listInvoices(
    clerkAuth, {}, { page: 1, page_size: 10 },
  );
  await new ReceiptService(mutationClient as never, authenticatedReadClient as never).listReceipts(
    clerkAuth, {}, { page: 1, page_size: 10 },
  );
  await new ReportService(mutationClient as never, authenticatedReadClient as never).getAgingSummary(
    clerkAuth, '2026-01-31',
  );

  assertEquals(mutationClient.rpcCalls.length, 0, 'Migration-027 reads must not use the trusted mutation client');
  assertEquals(authenticatedReadClient.rpcCalls.filter(call => call.functionName === 'ar_invoice_collection').length, 1);
  assertEquals(authenticatedReadClient.rpcCalls.filter(call => call.functionName === 'ar_receipt_collection').length, 1);
  assertEquals(authenticatedReadClient.rpcCalls.filter(call => call.functionName === 'ar_aging_summary').length, 1);
});

Deno.test('Batch 9D-D CreditNoteService production composition delegates collection reads only to authenticated client', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    invoices: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'co-1', customer_id: 'cust-a',
      invoice_no: 'CN-MOCK-001', customer_name: 'Customer A', reference_no: null, doc_type: 'Credit Note',
      status: 'Open', invoice_date: '2026-01-10', currency: 'MYR', outstanding: 10,
      total_amount: 10, exchange_rate: 1, base_total: 10, fx_decision_id: null,
    }],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');

  const result = await new CreditNoteService(mutationClient as never, readClient as never)
    .listCreditNotes(clerkAuth, {}, { page: 1, page_size: 10 });

  assertEquals(result.creditNotes.length, 1);
  assertEquals(result.creditNotes[0].doc_type, 'Credit Note');
  assertEquals(readClient.rpcCalls.filter(call => call.functionName === 'ar_invoice_collection').length, 1);
  assertEquals(
    (readClient.rpcCalls.find(call => call.functionName === 'ar_invoice_collection')?.params as Record<string, unknown>).p_doc_type,
    'Credit Note',
  );
  assertEquals(mutationClient.rpcCalls.some(call => call.functionName === 'ar_invoice_collection'), false);
  assertEquals(mutationClient.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
});

Deno.test('Batch 9D-D CreditNoteService detail enrichment uses authenticated client only', async () => {
  const invoiceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'CN-MOCK-001',
      doc_type: 'Credit Note', status: 'Draft', currency: 'USD', base_total: 13.5,
      fx_decision_id: 'dec-credit', ref_invoice_id: null,
    }],
    invoice_lines: [{ id: 'line-credit', invoice_id: invoiceId, line_no: 1 }],
    fx_booking_rate_decisions: [{
      id: 'dec-credit', company_id: 'co-1', source_category: 'MANUAL_OVERRIDE', approval_status: 'Approved',
      lifecycle_status: 'Approved', decision_version: 2, root_decision_id: 'dec-credit',
      supersedes_decision_id: null, import_origin: null, booked_rate: 1.35,
      deviation_pct: 1, stale_reference: false,
    }],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');

  const result = await new CreditNoteService(mutationClient as never, readClient as never)
    .getCreditNote(clerkAuth, invoiceId);

  assertEquals(result.fx_decision?.id, 'dec-credit');
  assertEquals(result.lines.length, 1);
  assertEquals(readClient.operations.some(op => op.table === 'fx_booking_rate_decisions' && op.op === 'select'), true);
  assertEquals(mutationClient.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
  assertEquals(mutationClient.operations.length, 0, 'Credit-note detail must not query through the trusted client');
});

Deno.test('Batch 9D-D DebitNoteService detail enrichment uses authenticated client only', async () => {
  const invoiceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'DN-MOCK-001',
      doc_type: 'Debit Note', status: 'Draft', currency: 'USD', base_total: 20.25,
      fx_decision_id: 'dec-debit',
    }],
    invoice_lines: [{ id: 'line-debit', invoice_id: invoiceId, line_no: 1 }],
    fx_booking_rate_decisions: [{
      id: 'dec-debit', company_id: 'co-1', source_category: 'CATALOG', approval_status: 'NotRequired',
      lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'dec-debit',
      supersedes_decision_id: null, import_origin: null, booked_rate: 1.35,
      deviation_pct: null, stale_reference: false,
    }],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');

  const result = await new DebitNoteService(mutationClient as never, readClient as never)
    .getDebitNote(clerkAuth, invoiceId);

  assertEquals(result.fx_decision?.id, 'dec-debit');
  assertEquals(result.lines.length, 1);
  assertEquals(readClient.operations.some(op => op.table === 'fx_booking_rate_decisions' && op.op === 'select'), true);
  assertEquals(mutationClient.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
  assertEquals(mutationClient.operations.length, 0, 'Debit-note detail must not query through the trusted client');
});

Deno.test('Batch 9D-D direct receipt detail enrichment uses authenticated client only', async () => {
  const receiptId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    receipts: [{
      id: receiptId, company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'RCT-DETAIL-001',
      status: 'Draft', currency: 'USD', base_amount: 13.5, fx_decision_id: 'dec-receipt',
    }],
    fx_booking_rate_decisions: [{
      id: 'dec-receipt', company_id: 'co-1', source_category: 'CATALOG', approval_status: 'NotRequired',
      lifecycle_status: 'Draft', decision_version: 1, root_decision_id: 'dec-receipt',
      supersedes_decision_id: null, import_origin: null, booked_rate: 1.35,
      deviation_pct: null, stale_reference: false,
    }],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');

  const result = await new ReceiptService(mutationClient as never, readClient as never)
    .getReceiptById(clerkAuth, receiptId);

  assertEquals(result.fx_decision?.id, 'dec-receipt');
  assertEquals(readClient.operations.some(op => op.table === 'fx_booking_rate_decisions' && op.op === 'select'), true);
  assertEquals(mutationClient.operations.length, 0, 'Receipt detail must not query through the trusted client');
});

Deno.test('Batch 9D-D missing authenticated read context fails before any delegated read query', async () => {
  const mutationClient = new MockSupabaseClient({ invoices: [], receipts: [], fx_booking_rate_decisions: [] }, 'service_role');
  const operations = [
    () => new InvoiceService(mutationClient as never).listInvoices(clerkAuth, {}, { page: 1, page_size: 10 }),
    () => new ReceiptService(mutationClient as never).getReceiptById(clerkAuth, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    () => new ReportService(mutationClient as never).getAgingSummary(managerAuth, '2026-01-31'),
    () => new CreditNoteService(mutationClient as never).listCreditNotes(clerkAuth, {}, { page: 1, page_size: 10 }),
    () => new DebitNoteService(mutationClient as never).getDebitNote(clerkAuth, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ];

  for (const operation of operations) {
    let message = '';
    try {
      await operation();
    } catch (error) {
      message = String(error);
    }
    assert(message.includes('Authenticated read client is required'), `Expected fail-closed read-client error, got ${message}`);
  }
  assertEquals(mutationClient.rpcCalls.length, 0, 'Missing read context must fail before migration-027 RPC invocation');
  assertEquals(mutationClient.operations.length, 0, 'Missing read context must fail before SELECT invocation');
});

Deno.test('Batch 9D-D invoice RPC summary includes 1,001 authorized rows while the returned page stays paginated', async () => {
  const authorizedRows = Array.from({ length: 1001 }, (_, index) => ({
    id: `inv-cap-${index}`,
    company_id: 'co-1',
    customer_id: 'cust-a',
    invoice_no: `CAP-INV-${String(index).padStart(4, '0')}`,
    customer_name: 'Customer A',
    reference_no: 'CAP',
    doc_type: 'Invoice',
    status: 'Open',
    posting_period: '2026-01',
    invoice_date: '2026-01-10',
    currency: 'MYR',
    outstanding: 1,
    total_amount: 1,
    exchange_rate: 1,
    base_total: 1,
    fx_decision_id: null,
  }));
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-unassigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-hidden', company_id: 'co-1', is_deleted: false, is_hidden: true },
      { id: 'cust-other-company', company_id: 'co-2', is_deleted: false, is_hidden: false },
    ],
    user_customer_assignments: [
      { id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true },
    ],
    invoices: [
      ...authorizedRows,
      { ...authorizedRows[0], id: 'inv-unassigned', customer_id: 'cust-unassigned', invoice_no: 'CAP-UNASSIGNED' },
      { ...authorizedRows[0], id: 'inv-hidden', customer_id: 'cust-hidden', invoice_no: 'CAP-HIDDEN' },
      { ...authorizedRows[0], id: 'inv-other-company', company_id: 'co-2', customer_id: 'cust-other-company', invoice_no: 'CAP-OTHER' },
    ],
    fx_booking_rate_decisions: [],
  });

  const result = await new InvoiceService(client as never, client as never).listInvoices(
    clerkAuth,
    { status: 'Open', doc_type: 'Invoice', search: 'CAP' },
    { page: 1, page_size: 10 },
  );

  assertEquals(result.invoices.length, 10);
  assertEquals(result.total, 1001);
  assertEquals(result.summary.current_balance_summary.row_count, 1001);
  assertEquals(result.summary.current_balance_summary.base_total, 1001);
  assertEquals(result.summary.document_total_summary.base_total, 1001);
  assertEquals(result.summary.current_balance_summary.by_currency[0].count, 1001);
  assertEquals(client.rpcCalls.filter(call => call.functionName === 'ar_invoice_collection').length, 1);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_invoice_collection_page'), false);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_invoice_collection_summary'), false);
});

Deno.test('Batch 9D-D receipt RPC summary includes 1,001 authorized rows and excludes tenant/visibility adversaries', async () => {
  const authorizedRows = Array.from({ length: 1001 }, (_, index) => ({
    id: `rct-cap-${index}`,
    company_id: 'co-1',
    customer_id: 'cust-a',
    receipt_no: `CAP-RCT-${String(index).padStart(4, '0')}`,
    customer_name: 'Customer A',
    reference_no: 'CAP',
    status: 'Posted',
    payment_method: 'Bank Transfer',
    posting_period: '2026-01',
    receipt_date: '2026-01-10',
    currency: 'MYR',
    unallocated_amount: 1,
    receipt_amount: 1,
    exchange_rate: 1,
    base_amount: 1,
    fx_decision_id: null,
  }));
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-unassigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-hidden', company_id: 'co-1', is_deleted: false, is_hidden: true },
      { id: 'cust-other-company', company_id: 'co-2', is_deleted: false, is_hidden: false },
    ],
    user_customer_assignments: [
      { id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true },
    ],
    receipts: [
      ...authorizedRows,
      { ...authorizedRows[0], id: 'rct-unassigned', customer_id: 'cust-unassigned', receipt_no: 'CAP-UNASSIGNED' },
      { ...authorizedRows[0], id: 'rct-hidden', customer_id: 'cust-hidden', receipt_no: 'CAP-HIDDEN' },
      { ...authorizedRows[0], id: 'rct-other-company', company_id: 'co-2', customer_id: 'cust-other-company', receipt_no: 'CAP-OTHER' },
    ],
    fx_booking_rate_decisions: [],
  });

  const result = await new ReceiptService(client as never, client as never).listReceipts(
    clerkAuth,
    { status: 'Posted', payment_method: 'Bank Transfer', search: 'CAP' },
    { page: 1, page_size: 10 },
  );

  assertEquals(result.receipts.length, 10);
  assertEquals(result.total, 1001);
  assertEquals(result.summary.current_balance_summary.row_count, 1001);
  assertEquals(result.summary.current_balance_summary.base_total, 1001);
  assertEquals(result.summary.document_total_summary.base_total, 1001);
  assertEquals(result.summary.current_balance_summary.by_currency[0].count, 1001);
  assertEquals(client.rpcCalls.filter(call => call.functionName === 'ar_receipt_collection').length, 1);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_receipt_collection_page'), false);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_receipt_collection_summary'), false);
});

Deno.test('Batch 9D-D aging summary and by-customer contracts aggregate 1,001 rows inside RPCs before pagination', async () => {
  const invoices = Array.from({ length: 1001 }, (_, index) => ({
    id: `aging-${index}`, company_id: 'co-1', customer_id: 'cust-aging', doc_type: 'Invoice', status: 'Open',
    outstanding: 1, exchange_rate: 1, currency: 'MYR', due_date: '2026-01-31',
  }));
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{
      id: 'cust-aging', company_id: 'co-1', customer_id: 'CUST-AGING', customer_name: 'Aging Customer',
      credit_limit: 5000, credit_rating: 'A', is_deleted: false, is_hidden: false,
    }],
    invoices,
  });
  const service = new ReportService(client as never, client as never);

  const summary = await service.getAgingSummary(managerAuth, '2026-01-31');
  const byCustomer = await service.getAgingByCustomer(managerAuth, '2026-01-31', { page: 1, page_size: 1 });

  assertEquals(summary.total_outstanding, 1001);
  assertEquals(summary.aging_summary[0].invoice_count, 1001);
  assertEquals(summary.by_currency[0].count, 1001);
  assertEquals(byCustomer.total, 1);
  assertEquals(byCustomer.rows[0].total_outstanding, 1001);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_aging_summary'), true);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_aging_by_customer'), true);
});

Deno.test('Batch 9D-D ReportService.getCustomerStatement returns null mixed legacy scalars and base/per-currency balances', async () => {
  const customerId = '11111111-1111-1111-1111-111111111111';
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: customerId, company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A', is_deleted: false, is_hidden: false }],
    invoices: [
      { id: 'inv-us', invoice_no: 'INV-US', invoice_date: '2026-01-05', doc_type: 'Invoice', total_amount: 100, base_total: 135, status: 'Open', currency: 'USD', exchange_rate: 1.35, company_id: 'co-1', customer_id: customerId },
      { id: 'inv-sg', invoice_no: 'INV-SG', invoice_date: '2026-01-06', doc_type: 'Invoice', total_amount: 100, base_total: 310, status: 'Open', currency: 'SGD', exchange_rate: 3.10, company_id: 'co-1', customer_id: customerId },
    ],
    receipts: [
      { id: 'rct-my', receipt_no: 'RCT-MY', receipt_date: '2026-01-07', receipt_amount: 100, base_amount: 100, payment_method: 'Bank Transfer', status: 'Posted', currency: 'MYR', exchange_rate: 1, company_id: 'co-1', customer_id: customerId },
    ],
  });

  const statement = await new ReportService(client as never, client as never).getCustomerStatement(
    managerAuth,
    customerId,
    '2026-01-01',
    '2026-01-31',
  );

  assertEquals(statement.legacy_transaction_fields_valid, false);
  assertEquals(statement.legacy_transaction_currency, null);
  assertEquals(statement.opening_balance, null);
  assertEquals(statement.closing_balance, null);
  assertEquals(statement.total_debit, null);
  assertEquals(statement.total_credit, null);
  assertEquals(statement.closing_balance_base, 345);
  assertJsonEquals(statement.by_currency, [
    { currency: 'MYR', opening_balance: 0, total_debit: 0, total_credit: 100, closing_balance: -100 },
    { currency: 'SGD', opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
    { currency: 'USD', opening_balance: 0, total_debit: 100, total_credit: 0, closing_balance: 100 },
  ]);
  assert(statement.lines.every(line => line.transaction_balance === null && line.balance === null));
});

Deno.test('Batch 9D-D ReportService.getCustomerStatement preserves single-currency legacy scalars', async () => {
  const customerId = '22222222-2222-2222-2222-222222222222';
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: customerId, company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A', is_deleted: false, is_hidden: false }],
    invoices: [
      { id: 'inv-us-single', invoice_no: 'INV-US', invoice_date: '2026-01-05', doc_type: 'Invoice', total_amount: 100, base_total: 135, status: 'Open', currency: 'USD', exchange_rate: 1.35, company_id: 'co-1', customer_id: customerId },
    ],
    receipts: [
      { id: 'rct-us-single', receipt_no: 'RCT-US', receipt_date: '2026-01-07', receipt_amount: 25, base_amount: 33.75, payment_method: 'Bank Transfer', status: 'Posted', currency: 'USD', exchange_rate: 1.35, company_id: 'co-1', customer_id: customerId },
    ],
  });

  const statement = await new ReportService(client as never, client as never).getCustomerStatement(
    managerAuth,
    customerId,
    '2026-01-01',
    '2026-01-31',
  );

  assertEquals(statement.legacy_transaction_fields_valid, true);
  assertEquals(statement.legacy_transaction_currency, 'USD');
  assertEquals(statement.total_debit, 100);
  assertEquals(statement.total_credit, 25);
  assertEquals(statement.closing_balance, 75);
  assertEquals(statement.closing_balance_base, 101.25);
});

Deno.test('Batch 9D-D customer statement uses stored booked-base snapshots when they diverge from rate recomputation', async () => {
  const customerId = '33333333-3333-3333-3333-333333333333';
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: customerId, company_id: 'co-1', customer_name: 'Snapshot Customer', customer_id: 'CUST-SNAP', is_deleted: false, is_hidden: false }],
    invoices: [{
      id: 'inv-snapshot', invoice_no: 'INV-SNAPSHOT', invoice_date: '2026-01-05', doc_type: 'Invoice',
      total_amount: 100, exchange_rate: 1.234567, base_total: 123.99, status: 'Open', currency: 'USD',
      company_id: 'co-1', customer_id: customerId,
    }],
    receipts: [{
      id: 'rct-snapshot', receipt_no: 'RCT-SNAPSHOT', receipt_date: '2026-01-06', receipt_amount: 10,
      exchange_rate: 1.2, base_amount: 12.34, payment_method: 'Bank Transfer', status: 'Posted', currency: 'USD',
      company_id: 'co-1', customer_id: customerId,
    }],
  });

  const statement = await new ReportService(client as never, client as never).getCustomerStatement(
    managerAuth,
    customerId,
    '2026-01-01',
    '2026-01-31',
  );

  assertEquals(statement.lines[0].base_debit, 123.99);
  assertEquals(statement.lines[1].base_credit, 12.34);
  assertEquals(statement.total_debit_base, 123.99);
  assertEquals(statement.total_credit_base, 12.34);
  assertEquals(statement.closing_balance_base, 111.65);
  assertEquals(statement.lines[0].amount_basis, 'stored_booked_base_snapshot');
  assertEquals(statement.meta.normalization_basis, 'stored_booked_base_snapshot');
  assert(statement.total_debit_base !== currentBaseFromBookedRate(100, 1.234567), 'Stored invoice base_total must win over recomputation');
});

Deno.test('Batch 9D-D customer statement RPC returns all 1,001 period movements in one authoritative contract', async () => {
  const customerId = '44444444-4444-4444-4444-444444444444';
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: customerId, company_id: 'co-1', customer_name: 'Large Statement', customer_id: 'CUST-1001', is_deleted: false, is_hidden: false }],
    invoices: Array.from({ length: 1001 }, (_, index) => ({
      id: `stmt-${index}`, invoice_no: `STMT-${String(index).padStart(4, '0')}`, invoice_date: '2026-01-05',
      doc_type: 'Invoice', total_amount: 1, base_total: 1, status: 'Open', currency: 'MYR', exchange_rate: 1,
      company_id: 'co-1', customer_id: customerId,
    })),
    receipts: [],
  });

  const statement = await new ReportService(client as never, client as never).getCustomerStatement(
    managerAuth,
    customerId,
    '2026-01-01',
    '2026-01-31',
  );

  assertEquals(statement.lines.length, 1001);
  assertEquals(statement.total_debit, 1001);
  assertEquals(statement.total_debit_base, 1001);
  assertEquals(statement.closing_balance_base, 1001);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_customer_statement'), true);
});

Deno.test('Batch 9D-D mutation-only import/background composition returns committed results without elevated enrichment reads', async () => {
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A', status: 'Active', credit_rating: 'A', is_deleted: false, is_hidden: false }],
    user_customer_assignments: [{ id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true }],
    bank_accounts: [{ id: 'bank-1', company_id: 'co-1', is_active: true, bank_name: 'Bank', account_no: '001' }],
    invoices: [{ id: 'inv-created', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-MOCK-001', doc_type: 'Invoice', invoice_date: '2026-01-01', customer_name: 'Customer A', currency: 'USD', exchange_rate: 1.35, base_currency: 'MYR', subtotal: 0, tax_total: 0, total_amount: 0, base_total: 0, outstanding: 0, status: 'Draft', fx_decision_id: 'missing-decision' }],
    invoice_lines: [],
    receipts: [{ id: 'rct-created', company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'RCT-MOCK-001', receipt_date: '2026-01-01', value_date: '2026-01-01', customer_name: 'Customer A', payment_method: 'Bank Transfer', currency: 'USD', exchange_rate: 1.35, base_currency: 'MYR', receipt_amount: 10, base_amount: 13.5, allocated_amount: 0, unallocated_amount: 10, bank_account_id: 'bank-1', bank_account_name: 'Bank - 001', status: 'Draft', fx_decision_id: 'missing-decision' }],
    fx_booking_rate_decisions: [],
  });
  client.failDecisionRead = true;

  const invoice = await new InvoiceService(client as never).createInvoice(clerkAuth, {
    doc_type: 'Invoice',
    customer_id: 'cust-a',
    invoice_date: '2026-01-01',
    currency: 'USD',
    exchange_rate: 1.35,
  });
  const receipt = await new ReceiptService(client as never).createReceipt(clerkAuth, {
    customer_id: 'cust-a',
    receipt_date: '2026-01-01',
    payment_method: 'TT',
    currency: 'USD',
    exchange_rate: 1.35,
    receipt_amount: 10,
    bank_account_id: 'bank-1',
  });

  assertEquals(invoice.id, 'inv-created');
  assertEquals(receipt.id, 'rct-created');
  assertEquals(client.rpcCalls.some(call => call.functionName === 'fx_create_governed_invoice_draft'), true);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'fx_create_governed_receipt_draft'), true);
  assertEquals(client.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
  assertEquals(invoice.fx_decision, undefined, 'Mutation-only response must omit optional decision enrichment');
  assertEquals(receipt.fx_decision, undefined, 'Mutation-only response must omit optional decision enrichment');
});

Deno.test('Batch 9D-D authenticated post-create enrichment failure cannot mask a committed mutation', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{ id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A', status: 'Active', credit_rating: 'A', is_deleted: false, is_hidden: false }],
    user_customer_assignments: [{ id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true }],
    bank_accounts: [{ id: 'bank-1', company_id: 'co-1', is_active: true, bank_name: 'Bank', account_no: '001' }],
    invoices: [{ id: 'inv-created', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-MOCK-001', doc_type: 'Invoice', invoice_date: '2026-01-01', customer_name: 'Customer A', currency: 'USD', exchange_rate: 1.35, base_currency: 'MYR', subtotal: 0, tax_total: 0, total_amount: 0, base_total: 0, outstanding: 0, status: 'Draft', fx_decision_id: 'missing-decision' }],
    invoice_lines: [],
    receipts: [{ id: 'rct-created', company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'RCT-MOCK-001', receipt_date: '2026-01-01', value_date: '2026-01-01', customer_name: 'Customer A', payment_method: 'Bank Transfer', currency: 'USD', exchange_rate: 1.35, base_currency: 'MYR', receipt_amount: 10, base_amount: 13.5, allocated_amount: 0, unallocated_amount: 10, bank_account_id: 'bank-1', bank_account_name: 'Bank - 001', status: 'Draft', fx_decision_id: 'missing-decision' }],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');
  readClient.failDecisionRead = true;

  const invoice = await new InvoiceService(mutationClient as never, readClient as never).createInvoice(clerkAuth, {
    doc_type: 'Invoice', customer_id: 'cust-a', invoice_date: '2026-01-01', currency: 'USD', exchange_rate: 1.35,
  });
  const receipt = await new ReceiptService(mutationClient as never, readClient as never).createReceipt(clerkAuth, {
    customer_id: 'cust-a', receipt_date: '2026-01-01', payment_method: 'TT', currency: 'USD',
    exchange_rate: 1.35, receipt_amount: 10, bank_account_id: 'bank-1',
  });

  assertEquals(invoice.id, 'inv-created');
  assertEquals(receipt.id, 'rct-created');
  assertEquals(readClient.operations.some(op => op.table === 'fx_booking_rate_decisions'), true);
  assertEquals(mutationClient.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
});

Deno.test('Batch 9D-D allocation source preserves SQL-authoritative currency block and realized FX writer', async () => {
  const allocationSql = await read('../../../../database/007_financial_rpcs.sql');

  assert(allocationSql.includes("RAISE EXCEPTION 'BR-REC-003: Currency mismatch"), 'Expected stable BR-REC-003 currency mismatch block');
  assert(allocationSql.includes('v_forex := ROUND(v_alloc_amt * (v_rct.exchange_rate - v_inv.exchange_rate), 2);'), 'Expected SQL-authoritative realized FX formula');
  assert(allocationSql.includes('forex_gain_loss'), 'Expected allocation_details.forex_gain_loss writer');
});

Deno.test('Batch 9D-D migration 027 defines complete-set scoped aggregates and stored-snapshot statements', async () => {
  const migration = await read('../../../../database/027_batch_9d_d_authoritative_monetary_aggregation.sql');
  const config = await read('../../config.toml');
  const invoiceService = await read('../invoices/service.ts');
  const receiptService = await read('../receipts/service.ts');
  const reportService = await read('service.ts');
  const invoiceIndex = await read('../invoices/index.ts');
  const receiptIndex = await read('../receipts/index.ts');
  const reportIndex = await read('index.ts');
  const creditNoteIndex = await read('../credit-notes/index.ts');
  const creditNoteService = await read('../credit-notes/service.ts');
  const debitNoteIndex = await read('../debit-notes/index.ts');
  const debitNoteService = await read('../debit-notes/service.ts');
  const importsService = await read('../imports/service.ts');

  for (const functionName of [
    'ar_invoice_collection',
    'ar_receipt_collection',
    'ar_aging_summary',
    'ar_aging_by_customer',
    'ar_customer_statement',
  ]) {
    assert(migration.includes(`FUNCTION public.${functionName}`), `Expected migration 027 function ${functionName}`);
  }
  assert(migration.includes('SECURITY INVOKER'), 'Expected read RPCs to preserve invoker security');
  assert(migration.includes("SET search_path = ''"), 'Expected locked empty search_path');
  assert(migration.includes('TO authenticated'), 'Expected authenticated caller execution grants');
  assert(migration.includes('FROM service_role'), 'Expected ordinary read RPCs to reject service-role-only execution');
  assert(migration.includes('auth.uid()'), 'Expected database-derived authenticated identity');
  assert(migration.includes('p_user_id IS DISTINCT FROM v_authenticated_user_id'), 'Expected spoofed user parameter rejection');
  assert(migration.includes('c.is_deleted = false') && migration.includes('c.is_hidden = false'), 'Expected hidden/deleted customer exclusion');
  assert(migration.includes('public.user_customer_assignments'), 'Expected AR Clerk assignment scope inside SQL');
  assert(migration.includes('i.company_id = p_company_id') && migration.includes('r.company_id = p_company_id'), 'Expected company predicates before aggregation');
  assert(migration.includes('SUM(f.outstanding_base)') && migration.includes('SUM(f.unallocated_base)'), 'Expected database-side current-base sums');
  assert(migration.includes('SUM(f.base_total)') && migration.includes('SUM(f.base_amount)'), 'Expected stored original booked-base sums');
  assert(migration.includes("'amount_basis', 'current_outstanding'") && migration.includes("'amount_basis', 'current_unallocated'"), 'Expected explicit summary amount bases');
  assert(migration.includes('i.base_total AS base_debit') || migration.includes('ELSE i.base_total END AS base_debit'), 'Expected stored invoice snapshot statement debit');
  assert(migration.includes('r.base_amount AS base_credit'), 'Expected stored receipt snapshot statement credit');
  assert(migration.includes("'stored_booked_base_snapshot'"), 'Expected precise statement snapshot basis');
  assert(!/\bEXECUTE\s+FORMAT\b/i.test(migration), 'Dynamic SQL is prohibited');
  assert(!/\n(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)/i.test(migration), 'Migration 027 must not mutate financial data');
  assert(config.includes('max_rows = 1000'), 'Expected documented PostgREST cap regression premise');

  assert(invoiceService.includes("rpc('ar_invoice_collection'"), 'Invoice service must consume one collection RPC');
  assert(receiptService.includes("rpc('ar_receipt_collection'"), 'Receipt service must consume one collection RPC');
  for (const obsolete of ['ar_invoice_collection_summary', 'ar_invoice_collection_page', 'ar_receipt_collection_summary', 'ar_receipt_collection_page']) {
    assert(!migration.includes(`FUNCTION public.${obsolete}`), `Obsolete migration RPC must be absent: ${obsolete}`);
    assert(!invoiceService.includes(`'${obsolete}'`) && !receiptService.includes(`'${obsolete}'`), `Obsolete service RPC must be absent: ${obsolete}`);
  }
  assert(invoiceIndex.includes("getUserClient(req.headers.get('Authorization')!)"), 'Invoice index must inject the JWT-scoped read client');
  assert(receiptIndex.includes("getUserClient(req.headers.get('Authorization')!)"), 'Receipt index must inject the JWT-scoped read client');
  assert(reportIndex.includes("getUserClient(req.headers.get('Authorization')!)"), 'Report index must inject the JWT-scoped migration-027 read client');
  assert(creditNoteIndex.includes("getUserClient(req.headers.get('Authorization')!)"), 'Credit-note index must inject the JWT-scoped delegated read client');
  assert(debitNoteIndex.includes("getUserClient(req.headers.get('Authorization')!)"), 'Debit-note index must inject the JWT-scoped delegated read client');
  assert(invoiceService.includes("const readClient = this.requireReadClient();") && invoiceService.includes("readClient.rpc('ar_invoice_collection'"), 'Invoice collection RPC must require the caller-context read client');
  assert(receiptService.includes("const readClient = this.requireReadClient();") && receiptService.includes("readClient.rpc('ar_receipt_collection'"), 'Receipt collection RPC must require the caller-context read client');
  assert(reportService.includes('const readClient = this.requireReadClient();') && reportService.includes('readClient.rpc(functionName, params)'), 'Migration-027 report RPCs must require the caller-context read client');
  for (const source of [invoiceService, receiptService, reportService]) {
    assert(!source.includes('readClient ?? client'), 'Trusted clients must never be implicit read-client fallbacks');
  }
  assert(creditNoteService.includes('new InvoiceService(this.client, readClient)'), 'Credit-note delegated service must propagate authenticated read client');
  assert(debitNoteService.includes('new InvoiceService(this.client, readClient)'), 'Debit-note delegated service must propagate authenticated read client');
  assert(importsService.includes('new InvoiceService(this.client)') && importsService.includes('new ReceiptService(this.client)'), 'Imports must retain explicit mutation-only nested services');
  assert(!importsService.includes('this.invoiceService.listInvoices') && !importsService.includes('this.invoiceService.getInvoiceById'), 'Import mutation-only service must not invoke invoice user-domain reads');
  assert(!importsService.includes('this.receiptService.listReceipts') && !importsService.includes('this.receiptService.getReceiptById'), 'Import mutation-only service must not invoke receipt user-domain reads');
  assert(reportService.includes('const { data, error } = await this.client.rpc(') && reportService.includes("'get_ar_dashboard_metrics'"), 'The unchanged legacy dashboard RPC retains its established trusted client');
  assert(!invoiceService.includes("select('currency,outstanding,total_amount,exchange_rate,base_total')"), 'Invoice service must not aggregate capped raw summary rows');
  assert(!receiptService.includes("select('currency,unallocated_amount,receipt_amount,exchange_rate,base_amount')"), 'Receipt service must not aggregate capped raw summary rows');
  assert(reportService.includes("'ar_aging_summary'"), 'Aging summary must use SQL RPC');
  assert(reportService.includes("'ar_aging_by_customer'"), 'Aging by customer must use SQL RPC');
  assert(reportService.includes("'ar_customer_statement'"), 'Customer statement must use stored-snapshot SQL RPC');
});

Deno.test('Batch 9D-D production constructor composition keeps trusted and authenticated clients distinct', async () => {
  const invoiceIndex = await read('../invoices/index.ts');
  const receiptIndex = await read('../receipts/index.ts');
  const reportIndex = await read('index.ts');
  const creditIndex = await read('../credit-notes/index.ts');
  const debitIndex = await read('../debit-notes/index.ts');
  const creditService = await read('../credit-notes/service.ts');
  const debitService = await read('../debit-notes/service.ts');
  const importService = await read('../imports/service.ts');
  const allocationService = await read('../allocations/service.ts');

  for (const indexSource of [invoiceIndex, receiptIndex, reportIndex, creditIndex, debitIndex]) {
    assert(indexSource.includes("getUserClient(req.headers.get('Authorization')!)"), 'Every user-request read composition must inject the JWT-scoped client');
  }
  assert(creditService.includes('new InvoiceService(this.client, readClient)'), 'Credit-note nested invoice service must receive read client explicitly');
  assert(debitService.includes('new InvoiceService(this.client, readClient)'), 'Debit-note nested invoice service must receive read client explicitly');
  assert(importService.includes('new InvoiceService(this.client)') && importService.includes('new ReceiptService(this.client)'), 'Import composition must remain mutation-only');
  assert(!/this\.(?:invoiceService|receiptService)\.(?:listInvoices|listReceipts|getInvoiceById|getReceiptById|getUnallocatedReceipts)/.test(importService), 'Import composition must not invoke user-domain reads');
  assert(allocationService.includes('new ReceiptService(this.client)'), 'Allocation composition retains an explicit mutation-only receipt service');
  assert(!/this\.receiptService\.(?:listReceipts|getReceiptById|getUnallocatedReceipts)/.test(allocationService), 'Allocation composition must not invoke user-domain receipt reads without JWT context');
});

Deno.test('Batch 9D-D auto-allocation route remains disabled in source', async () => {
  const allocationsIndex = await read('../allocations/index.ts');

  assert(allocationsIndex.includes('AUTO_ALLOCATION_DISABLED'), 'Expected disabled auto-allocation contract');
  assert(allocationsIndex.includes('Automatic allocation route is disabled'), 'Expected explicit disabled response');
});

Deno.test('Batch 9D-D import contracts preserve provenance, explicit FX, and governance hold source paths', async () => {
  const importsService = await read('../imports/service.ts');

  assert(importsService.includes('function importOriginPayload(batch: ImportBatch, row: ImportRow)'), 'Expected trusted import-origin payload construction');
  assert(importsService.includes('const importOrigin = importOriginPayload(batch, row)'), 'Expected import-origin payload creation at execute time');
  assert(importsService.includes('this.invoiceService.createInvoice(auth, header, lines, { importOrigin })'), 'Expected invoice import-origin propagation to create service');
  assert(importsService.includes('this.receiptService.createReceipt(auth, receiptInput, { importOrigin })'), 'Expected receipt import-origin propagation to create service');
  assert(importsService.includes('fields.exchange_rate'), 'Expected explicit exchange_rate mapping preservation');
  assert(importsService.includes('fields.fx_override_reason'), 'Expected fx_override_reason mapping preservation');
  assert(importsService.includes('HeldGovernance'), 'Expected receipt explicit-FX governance hold state');
  assert(importsService.includes('created_count: 0'), 'Expected PDF/Image manual-review boundary without transaction creation');
  assert(importsService.includes('posted_count: 0'), 'Expected PDF/Image boundary without posting');
  assert(importsService.includes('allocated_count: 0'), 'Expected PDF/Image boundary without allocation');
});

Deno.test('Batch 9D-D read contracts establish tenant and role scope before aggregation', async () => {
  const reportsService = await read('service.ts');
  const allocationsService = await read('../allocations/service.ts');
  const migration = await read('../../../../database/027_batch_9d_d_authoritative_monetary_aggregation.sql');

  assert(reportsService.includes('requireOperationalReadRole(auth)'), 'Expected report reads to require operational read role');
  assert(migration.includes('c.is_deleted = false') && migration.includes('c.is_hidden = false'), 'Expected hidden-customer filtering before SQL aggregation');
  assert(migration.includes('public.user_customer_assignments'), 'Expected AR Clerk assignment filtering before SQL aggregation');
  assert(migration.includes('i.company_id = p_company_id'), 'Expected company scope filters in report SQL');
  assert(reportsService.includes('get_ar_dashboard_metrics'), 'Expected dashboard to use the backend RPC contract');
  assert(reportsService.includes('p_company_id: auth.companyId'), 'Expected dashboard RPC tenant parameter');
  assert(reportsService.includes('p_user_id: auth.userId'), 'Expected dashboard RPC user parameter');

  assert(allocationsService.includes("const allowedReadRoles = ['AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor']"), 'Expected allocation-history Auditor read access');
  assert(allocationsService.includes('user_customer_assignments'), 'Expected AR Clerk assignment scoping in allocation history');
  assert(allocationsService.includes(".eq('company_id', auth.companyId)"), 'Expected allocation-history company scoping');
});

Deno.test('Batch 9D-D invoice and receipt read contracts expose additive FX governance summaries', async () => {
  const invoiceService = await read('../invoices/service.ts');
  const receiptService = await read('../receipts/service.ts');
  const sharedTypes = await read('../_shared/types.ts');

  for (const source of [invoiceService, receiptService]) {
    assert(source.includes('attachFxDecisionReadSummary'), 'Expected FX decision read-summary enrichment');
    assert(source.includes('fx_booking_rate_decisions'), 'Expected decision summary to come from authoritative decision table');
    assert(source.includes('source_category, approval_status, lifecycle_status, decision_version, root_decision_id, supersedes_decision_id, import_origin, booked_rate, deviation_pct, stale_reference'), 'Expected authoritative decision fields in read contract');
    assert(source.includes('fx_posting_eligibility'), 'Expected narrowly named FX-governance eligibility summary');
  }

  assert(invoiceService.includes("rpc('ar_invoice_collection'"), 'Expected authoritative single-snapshot invoice collection RPC');
  assert(receiptService.includes("rpc('ar_receipt_collection'"), 'Expected authoritative single-snapshot receipt collection RPC');

  assert(sharedTypes.includes('export interface FxDecisionReadSummary'), 'Expected shared additive decision summary type');
  assert(!sharedTypes.includes('fx_decision_status?: string | null'), 'Unexpected temporary concatenated fx_decision_status field');
  assert(sharedTypes.includes('base_available?: boolean'), 'Expected optional additive base availability field');
});
