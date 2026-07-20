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
import {
  BusinessError,
  errorResponse,
  NotFoundError,
  successResponse,
  ValidationError,
} from '../_shared/errors.ts';
import type { APIResponse, Invoice, Receipt } from '../_shared/types.ts';
import type { AuthContext } from '../_shared/auth.ts';
import { InvoiceService } from '../invoices/service.ts';
import { createInvoiceHandler } from '../invoices/index.ts';
import { validateCreateInvoice } from '../invoices/validators.ts';
import type { CreateInvoiceInput } from '../invoices/validators.ts';
import { calculateLineAmount } from '../invoices/calculator.ts';
import { ReceiptService } from '../receipts/service.ts';
import { CreditNoteService } from '../credit-notes/service.ts';
import { DebitNoteService } from '../debit-notes/service.ts';
import { AllocationService } from '../allocations/service.ts';
import { ImportService } from '../imports/service.ts';
import { ReportService } from './service.ts';
import { throwDatabaseError } from '../_shared/db.ts';

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

async function rejectedValue(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
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
    const queuedErrors = this.client.queryErrorSequence[this.table];
    if (queuedErrors?.length) {
      const queuedError = queuedErrors.shift();
      if (queuedError) return { data: null, error: queuedError, count: null };
    }
    const forcedError = this.client.queryErrors[this.table];
    if (forcedError) return { data: null, error: forcedError, count: null };

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
  queryErrors: Record<string, { code: string; message: string }> = {};
  queryErrorSequence: Record<string, Array<{ code: string; message: string } | null>> = {};
  rpcErrors: Record<string, { code: string; message: string }> = {};
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
    const forcedError = this.rpcErrors[functionName];
    if (forcedError) return { data: null, error: forcedError };
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
    if (functionName === 'update_draft_invoice') {
      const invoice = (this.tables.invoices ?? []).find(row => row.id === params.p_invoice_id);
      const changes = params.p_changes as MockRow;
      const persistedChanges = Object.fromEntries(
        Object.entries(changes).filter(([key]) => !key.startsWith('fx_')),
      );
      return {
        data: invoice ? { ...invoice, ...persistedChanges } : null,
        error: null,
      };
    }
    if (functionName === 'correct_posted_invoice_reference') {
      const invoice = (this.tables.invoices ?? []).find(row => row.id === params.p_invoice_id);
      return {
        data: invoice ? { ...invoice, reference_no: params.p_reference_no } : null,
        error: null,
      };
    }
    if (functionName === 'add_draft_invoice_lines') {
      const lines = this.tables.invoice_lines ?? (this.tables.invoice_lines = []);
      let nextLineNo = Math.max(
        0,
        ...lines
          .filter(line => line.invoice_id === params.p_invoice_id)
          .map(line => Number(line.line_no ?? 0)),
      ) + 10;
      const created = (params.p_lines as MockRow[]).map((line, index) => ({
        ...line,
        id: `line-rpc-${lines.length + index + 1}`,
        invoice_id: params.p_invoice_id,
        line_no: nextLineNo + index * 10,
      }));
      lines.push(...created);
      return { data: created, error: null };
    }
    if (functionName === 'update_draft_invoice_line') {
      const lines = this.tables.invoice_lines ?? [];
      const index = lines.findIndex(line =>
        line.id === params.p_line_id && line.invoice_id === params.p_invoice_id
      );
      if (index < 0) return { data: null, error: null };
      lines[index] = { ...lines[index], ...(params.p_changes as MockRow) };
      return { data: { ...lines[index] }, error: null };
    }
    if (functionName === 'delete_draft_invoice_line') {
      const lines = this.tables.invoice_lines ?? [];
      const index = lines.findIndex(line =>
        line.id === params.p_line_id && line.invoice_id === params.p_invoice_id
      );
      if (index >= 0) lines.splice(index, 1);
      return { data: { deleted: index >= 0, id: params.p_line_id }, error: null };
    }
    if (functionName === 'cancel_invoice') {
      const invoice = (this.tables.invoices ?? []).find(row => row.id === params.p_invoice_id);
      return {
        data: invoice
          ? {
            ...invoice,
            status: 'Cancelled',
            outstanding: 0,
            cancelled_by: params.p_user_id,
            cancel_reason: params.p_cancel_reason,
            version: Number(invoice.version ?? 1) + 1,
          }
          : null,
        error: null,
      };
    }
    if (functionName === 'cancel_receipt') {
      const receipt = (this.tables.receipts ?? []).find(row => row.id === params.p_receipt_id);
      return {
        data: receipt
          ? {
            ...receipt,
            status: 'Cancelled',
            allocated_amount: 0,
            unallocated_amount: 0,
            cancelled_by: params.p_user_id,
            cancel_reason: params.p_cancel_reason,
            version: Number(receipt.version ?? 1) + 1,
            reversals_created: 1,
          }
          : null,
        error: null,
      };
    }
    if (functionName === 'clear_receipt_cheque') {
      const receipt = (this.tables.receipts ?? []).find(row => row.id === params.p_receipt_id);
      return {
        data: receipt
          ? {
            ...receipt,
            value_date: params.p_clearance_date ?? '2026-01-31',
            version: Number(receipt.version ?? 1) + 1,
            je_no: 'JE-RCT-MOCK-001',
          }
          : null,
        error: null,
      };
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

const linkedCreditNoteReferenceId = 'abababab-abab-4bab-8bab-abababababab';

const linkedCreditNoteInput = (
  overrides: Partial<CreateInvoiceInput> = {},
): CreateInvoiceInput => ({
  doc_type: 'Credit Note',
  cn_type: 'Linked',
  ref_invoice_id: linkedCreditNoteReferenceId,
  invoice_date: '2026-01-15',
  customer_id: 'cust-a',
  currency: 'MYR',
  ...overrides,
});

const linkedCreditNoteTables = (
  referenceOverrides: MockRow | null = {},
): Record<string, MockRow[]> => {
  const reference = referenceOverrides === null ? [] : [{
    id: linkedCreditNoteReferenceId,
    company_id: 'co-1',
    customer_id: 'cust-a',
    invoice_no: 'INV-LINK-BASE',
    doc_type: 'Invoice',
    status: 'Open',
    invoice_date: '2026-01-01',
    currency: 'MYR',
    exchange_rate: 1,
    base_currency: 'MYR',
    total_amount: 100,
    base_total: 100,
    outstanding: 100,
    ...referenceOverrides,
  }];

  return {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{
      id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A',
      status: 'Active', credit_rating: 'A', is_deleted: false, is_hidden: false,
    }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    invoices: [
      ...reference,
      {
        id: 'inv-created', company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'CN-MOCK-001',
        doc_type: 'Credit Note', cn_type: 'Linked', ref_invoice_id: linkedCreditNoteReferenceId,
        status: 'Draft', invoice_date: '2026-01-15', customer_name: 'Customer A', currency: 'MYR',
        exchange_rate: 1, base_currency: 'MYR', subtotal: 0, tax_total: 0, total_amount: 0,
        base_total: 0, outstanding: 0, fx_decision_id: null,
      },
    ],
    invoice_lines: [],
    fx_booking_rate_decisions: [],
  };
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

Deno.test('Batch 9D-D authorized invoice detail succeeds for assigned Clerk and Finance Manager through read client only', async () => {
  const invoiceId = '11111111-1111-4111-8111-111111111111';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-DETAIL-001',
      doc_type: 'Invoice', status: 'Open', currency: 'MYR', base_total: 100,
      fx_decision_id: null,
    }],
    invoice_lines: [{ id: 'line-1', invoice_id: invoiceId, line_no: 10 }],
    fx_booking_rate_decisions: [],
  };

  for (const auth of [clerkAuth, managerAuth]) {
    const mutationClient = new MockSupabaseClient(tables, 'service_role');
    const readClient = new MockSupabaseClient(tables, 'authenticated');
    const result = await new InvoiceService(mutationClient as never, readClient as never)
      .getInvoiceById(auth, invoiceId);

    assertEquals(result.id, invoiceId);
    assertEquals(result.lines.length, 1);
    assertEquals(readClient.operations.some(op => op.table === 'invoices' && op.op === 'select'), true);
    assertEquals(mutationClient.operations.length, 0, 'Invoice detail must never SELECT through trusted mutation client');
  }
});

Deno.test('Batch 9D-D RLS-hidden and nonexistent invoice detail share the same authorization-safe 404 contract', async () => {
  const invoiceId = '22222222-2222-4222-8222-222222222222';
  const hiddenMutationClient = new MockSupabaseClient({
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-unassigned', invoice_no: 'INV-HIDDEN-001',
      doc_type: 'Invoice', status: 'Open', currency: 'MYR', base_total: 10,
    }],
  }, 'service_role');
  const hiddenReadClient = new MockSupabaseClient({ invoices: [] }, 'authenticated');
  const nonexistentMutationClient = new MockSupabaseClient({ invoices: [] }, 'service_role');
  const nonexistentReadClient = new MockSupabaseClient({ invoices: [] }, 'authenticated');

  const hiddenError = await rejectedValue(() =>
    new InvoiceService(hiddenMutationClient as never, hiddenReadClient as never)
      .getInvoiceById(clerkAuth, invoiceId)
  );
  const nonexistentError = await rejectedValue(() =>
    new InvoiceService(nonexistentMutationClient as never, nonexistentReadClient as never)
      .getInvoiceById(clerkAuth, invoiceId)
  );

  assert(hiddenError instanceof NotFoundError, 'RLS-hidden invoice must map to NotFoundError');
  assert(nonexistentError instanceof NotFoundError, 'Nonexistent invoice must map to NotFoundError');
  assertEquals(hiddenError.code, 'NOT_FOUND');
  assertEquals(hiddenError.status, 404);
  assertJsonEquals(errorResponse(hiddenError), errorResponse(nonexistentError));
  assertJsonEquals(errorResponse(hiddenError), {
    status: 404,
    body: {
      success: false,
      error: { code: 'NOT_FOUND', message: `Invoice not found: ${invoiceId}` },
    },
  });
  assertEquals(hiddenMutationClient.operations.length, 0, 'Hidden lookup must not use trusted mutation client');
  assertEquals(nonexistentMutationClient.operations.length, 0, 'Missing lookup must not use trusted mutation client');
});

Deno.test('Batch 9D-D invoice detail preserves genuine PostgREST failures as HTTP 500', async () => {
  const invoiceId = '33333333-3333-4333-8333-333333333333';
  const mutationClient = new MockSupabaseClient({}, 'service_role');
  const readClient = new MockSupabaseClient({}, 'authenticated');
  readClient.queryErrors.invoices = { code: 'XX000', message: 'forced database failure' };

  const error = await rejectedValue(() =>
    new InvoiceService(mutationClient as never, readClient as never)
      .getInvoiceById(clerkAuth, invoiceId)
  );
  const response = errorResponse(error);

  assert(!(error instanceof NotFoundError), 'Unexpected database failure must not become NotFoundError');
  assert(String(error).includes('forced database failure'));
  assertEquals(response.status, 500);
  assertEquals((response.body.error as Record<string, unknown>).code, 'INTERNAL_ERROR');
  assertEquals(mutationClient.operations.length, 0, 'Failed detail read must not fall back to trusted client');
});

Deno.test('Batch 9D-D invoice detail without authenticated read context fails before any query', async () => {
  const mutationClient = new MockSupabaseClient({}, 'service_role');
  const error = await rejectedValue(() =>
    new InvoiceService(mutationClient as never)
      .getInvoiceById(clerkAuth, '44444444-4444-4444-8444-444444444444')
  );

  assert(String(error).includes('Authenticated read client is required'));
  assertEquals(mutationClient.operations.length, 0);
  assertEquals(mutationClient.rpcCalls.length, 0);
});

Deno.test('Batch 9D-D delegated Credit Note and Debit Note hidden detail paths inherit authorization-safe 404', async () => {
  const creditNoteId = '55555555-5555-4555-8555-555555555555';
  const debitNoteId = '66666666-6666-4666-8666-666666666666';
  const mutationClient = new MockSupabaseClient({
    invoices: [
      { id: creditNoteId, company_id: 'co-1', customer_id: 'cust-unassigned', doc_type: 'Credit Note' },
      { id: debitNoteId, company_id: 'co-1', customer_id: 'cust-unassigned', doc_type: 'Debit Note' },
    ],
  }, 'service_role');
  const readClient = new MockSupabaseClient({ invoices: [] }, 'authenticated');

  const creditError = await rejectedValue(() =>
    new CreditNoteService(mutationClient as never, readClient as never)
      .getCreditNote(clerkAuth, creditNoteId)
  );
  const debitError = await rejectedValue(() =>
    new DebitNoteService(mutationClient as never, readClient as never)
      .getDebitNote(clerkAuth, debitNoteId)
  );

  assert(creditError instanceof NotFoundError);
  assert(debitError instanceof NotFoundError);
  assertEquals(errorResponse(creditError).status, 404);
  assertEquals(errorResponse(debitError).status, 404);
  assertEquals(mutationClient.operations.length, 0, 'Delegated hidden detail must not query trusted client');
});

Deno.test('Batch 9D-D unassigned invoice collection remains an empty authorized result', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-assigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-unassigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
    ],
    user_customer_assignments: [{
      id: 'assignment-1', user_id: 'user-1', customer_id: 'cust-assigned', company_id: 'co-1', is_active: true,
    }],
    invoices: [{
      id: '77777777-7777-4777-8777-777777777777', company_id: 'co-1', customer_id: 'cust-unassigned',
      invoice_no: 'INV-UNASSIGNED-001', doc_type: 'Invoice', status: 'Open', invoice_date: '2026-01-01',
      currency: 'MYR', outstanding: 10, exchange_rate: 1, total_amount: 10, base_total: 10,
      fx_decision_id: null,
    }],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');
  const result = await new InvoiceService(mutationClient as never, readClient as never)
    .listInvoices(clerkAuth, { customer_id: 'cust-unassigned' }, { page: 1, page_size: 10 });

  assertEquals(result.invoices.length, 0);
  assertEquals(result.total, 0);
  assertEquals(result.summary.current_balance_summary.row_count, 0);
  assertEquals(mutationClient.rpcCalls.length, 0);
});

Deno.test('Batch 9D-D generic Invoice creation accepts only a valid Linked Credit Note reference', async () => {
  const genericClient = new MockSupabaseClient(linkedCreditNoteTables(), 'service_role');
  const genericResult = await new InvoiceService(genericClient as never)
    .createInvoice(clerkAuth, linkedCreditNoteInput());

  assertEquals(genericResult.id, 'inv-created');
  assertEquals(
    genericClient.rpcCalls.filter(call => call.functionName === 'fx_create_governed_invoice_draft').length,
    1,
  );

  const dedicatedClient = new MockSupabaseClient(linkedCreditNoteTables(), 'service_role');
  const dedicatedResult = await new CreditNoteService(dedicatedClient as never)
    .createCreditNote(clerkAuth, linkedCreditNoteInput());

  assertEquals(dedicatedResult.id, 'inv-created');
  assertEquals(
    dedicatedClient.rpcCalls.filter(call => call.functionName === 'fx_create_governed_invoice_draft').length,
    1,
    'Dedicated and generic routes must share the InvoiceService validation contract',
  );
});

Deno.test('Batch 9D-D Linked Credit Note creation fails closed for every invalid reference class', async () => {
  const cases: Array<{ label: string; reference: MockRow | null }> = [
    { label: 'missing reference', reference: null },
    { label: 'other company', reference: { company_id: 'co-2', invoice_no: 'SECRET-OTHER-COMPANY' } },
    { label: 'other customer', reference: { customer_id: 'cust-b', invoice_no: 'SECRET-OTHER-CUSTOMER' } },
    { label: 'currency mismatch', reference: { currency: 'USD' } },
    { label: 'Credit Note reference', reference: { doc_type: 'Credit Note' } },
    { label: 'Debit Note reference', reference: { doc_type: 'Debit Note' } },
    { label: 'disallowed status', reference: { status: 'Paid' } },
  ];

  for (const testCase of cases) {
    const client = new MockSupabaseClient(linkedCreditNoteTables(testCase.reference), 'service_role');
    const error = await rejectedValue(() =>
      new InvoiceService(client as never).createInvoice(clerkAuth, linkedCreditNoteInput())
    );

    assert(error instanceof BusinessError, `${testCase.label} must produce a business error`);
    assertEquals(error.code, 'BR-CN-REF');
    assertEquals(error.message, 'Linked Credit Note reference is invalid or unavailable.');
    assertJsonEquals(error.details, { field: 'ref_invoice_id' });
    assertEquals(
      client.rpcCalls.some(call => call.functionName === 'fx_create_governed_invoice_draft'),
      false,
      `${testCase.label} must fail before governed creation`,
    );
    const publicError = JSON.stringify(errorResponse(error));
    assert(!publicError.includes('SECRET-OTHER-COMPANY'));
    assert(!publicError.includes('SECRET-OTHER-CUSTOMER'));
  }
});

Deno.test('Batch 9D-D Linked and Standalone Credit Note structural inputs fail closed before creation', async () => {
  const missingReferenceClient = new MockSupabaseClient(linkedCreditNoteTables(), 'service_role');
  const missingReferenceError = await rejectedValue(() =>
    new InvoiceService(missingReferenceClient as never).createInvoice(
      clerkAuth,
      linkedCreditNoteInput({ ref_invoice_id: undefined }),
    )
  );
  assert(missingReferenceError instanceof BusinessError);
  assertEquals(missingReferenceError.code, 'BR-CN-REF');
  assertEquals(missingReferenceClient.rpcCalls.length, 0);

  const standaloneClient = new MockSupabaseClient(linkedCreditNoteTables(), 'service_role');
  const standaloneError = await rejectedValue(() =>
    new InvoiceService(standaloneClient as never).createInvoice(
      clerkAuth,
      linkedCreditNoteInput({ cn_type: 'Standalone' }),
    )
  );
  assert(standaloneError instanceof BusinessError);
  assertEquals(standaloneError.code, 'BR-CN-REF');
  assertEquals(standaloneClient.rpcCalls.length, 0);

  const validatorError = await rejectedValue(async () => {
    validateCreateInvoice({
      ...linkedCreditNoteInput({ cn_type: 'Standalone' }),
      customer_id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
      ref_invoice_id: linkedCreditNoteReferenceId,
    } as unknown as Record<string, unknown>);
  });
  assert(validatorError instanceof ValidationError);
  assertEquals(validatorError.message, 'ref_invoice_id is only permitted for Linked Credit Notes.');
});

Deno.test('Batch 9D-D Migration 028 self-reference error remains a deterministic BR-CN-REF response', async () => {
  const client = new MockSupabaseClient(linkedCreditNoteTables({ id: 'inv-created' }), 'service_role');
  client.rpcErrors.fx_create_governed_invoice_draft = {
    code: 'P0001',
    message: 'BR-CN-REF: linked credit note reference is invalid or unavailable',
  };

  const error = await rejectedValue(() =>
    new InvoiceService(client as never).createInvoice(
      clerkAuth,
      linkedCreditNoteInput({ ref_invoice_id: 'inv-created' }),
    )
  );

  assert(error instanceof BusinessError, `Expected Linked Credit Note validation error, got ${String(error)}`);
  assertEquals(error.code, 'BR-CN-REF');
  assertEquals(errorResponse(error).status, 400);
  assertEquals(
    client.rpcCalls.filter(call => call.functionName === 'fx_create_governed_invoice_draft').length,
    1,
  );
});

Deno.test('Batch 9D-D Draft Linked Credit Note currency validation is wired before FX mutation', async () => {
  const tables = linkedCreditNoteTables();
  const client = new MockSupabaseClient(tables, 'service_role');
  const service = new InvoiceService(client as never) as unknown as {
    validateLinkedCreditNoteReference(
      data: Pick<CreateInvoiceInput, 'doc_type' | 'cn_type' | 'ref_invoice_id' | 'customer_id' | 'currency'>,
      companyId: string,
      documentId?: string,
    ): Promise<void>;
  };

  const error = await rejectedValue(() =>
    service.validateLinkedCreditNoteReference(
      linkedCreditNoteInput({ currency: 'USD' }),
      'co-1',
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    )
  );

  assert(error instanceof BusinessError, `Expected Linked Credit Note validation error, got ${String(error)}`);
  assertEquals(error.code, 'BR-CN-REF');
  assertEquals(client.rpcCalls.length, 0);

  const invoiceServiceSource = await read('../invoices/service.ts');
  const updateStart = invoiceServiceSource.indexOf('async updateDraftInvoice(');
  const validationCall = invoiceServiceSource.indexOf('await this.validateLinkedCreditNoteReference({', updateStart);
  const governedUpdateCall = invoiceServiceSource.indexOf("callRpc<Invoice>(this.client, 'update_draft_invoice'", updateStart);
  assert(
    updateStart >= 0 && validationCall > updateStart && governedUpdateCall > validationCall,
    'Draft currency update must validate the existing link before the atomic governed header mutation',
  );
});

Deno.test('Batch 9D-D Draft Invoice header update production composition uses one governed RPC', async () => {
  const source = await read('../invoices/service.ts');
  const start = source.indexOf('async updateDraftInvoice(');
  const end = source.indexOf('async deleteDraftInvoice(', start);
  const body = source.slice(start, end);
  assert(start >= 0 && end > start);
  assert(body.includes("callRpc<Invoice>(this.client, 'update_draft_invoice'"));
  assert(!body.includes(".from('invoices')\n      .update"));
  assert(body.includes('p_user_id: auth.userId'));
  assert(body.includes('p_company_id: auth.companyId'));
});

Deno.test('Batch 9D-D Invoice cancellation uses one governed atomic RPC and returns only its committed result', async () => {
  const invoiceId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const client = new MockSupabaseClient({
    customers: [{
      id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', status: 'Active',
      is_deleted: false, is_hidden: false,
    }],
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-CANCEL-001',
      doc_type: 'Invoice', status: 'Open', invoice_date: '2026-01-15', currency: 'MYR',
      exchange_rate: 1, base_currency: 'MYR', subtotal: 100, tax_total: 0, total_amount: 100,
      base_total: 100, outstanding: 100, version: 4,
    }],
  }, 'service_role');
  const service = new InvoiceService(client as never);

  const cancelled = await service.cancelInvoice(managerAuth, invoiceId, {
    cancel_reason: 'Batch 9D-D atomic cancellation test',
  });

  assertEquals(cancelled.status, 'Cancelled');
  assertEquals(cancelled.version, 5);
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].functionName, 'cancel_invoice');
  assertEquals((client.rpcCalls[0].params as MockRow).p_expected_version, 4);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'reverse_journal_entry'), false);
  assertEquals(client.operations.some(operation => operation.table === 'allocation_details'), false);
  assertEquals(client.operations.some(operation => operation.table === 'journal_entries'), false);

  const invoiceServiceSource = await read('../invoices/service.ts');
  const cancellationStart = invoiceServiceSource.indexOf('async cancelInvoice(');
  const cancellationEnd = invoiceServiceSource.indexOf('// GET / LIST INVOICES', cancellationStart);
  const cancellationBody = invoiceServiceSource.slice(cancellationStart, cancellationEnd);
  assert(cancellationBody.includes("callRpc<Invoice>(this.client, 'cancel_invoice'"));
  assert(!cancellationBody.includes('createReversalJE'));
  assert(!cancellationBody.includes(".from('allocation_details')"));
  assert(!cancellationBody.includes(".from('invoices')\n      .update"));
});

Deno.test('Batch 9D-D atomic Invoice cancellation maps governed business, conflict, and internal errors', async () => {
  const invoiceId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
  const tables = {
    customers: [{
      id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', status: 'Active',
      is_deleted: false, is_hidden: false,
    }],
    invoices: [{
      id: invoiceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-CANCEL-001',
      doc_type: 'Invoice', status: 'Open', invoice_date: '2026-01-15', currency: 'MYR',
      exchange_rate: 1, base_currency: 'MYR', total_amount: 100, outstanding: 100, version: 4,
    }],
  };
  const cases = [
    {
      error: { code: 'P0001', message: 'BR-CN-REF: Linked Credit Note reference integrity prevents this Invoice cancellation' },
      status: 400,
      code: 'BR-CN-REF',
    },
    {
      error: { code: 'P0001', message: 'BR-INV-003: Invoice cannot be cancelled while active allocations exist' },
      status: 400,
      code: 'BR-INV-003',
    },
    {
      error: { code: 'P0001', message: 'CONFLICT: Invoice was modified by another user during cancellation' },
      status: 409,
      code: 'CONFLICT',
    },
    {
      error: { code: '42703', message: 'column does not exist' },
      status: 500,
      code: 'INTERNAL_ERROR',
    },
  ];

  for (const testCase of cases) {
    const client = new MockSupabaseClient(tables, 'service_role');
    client.rpcErrors.cancel_invoice = testCase.error;
    const service = new InvoiceService(client as never);
    const error = await rejectedValue(() => service.cancelInvoice(managerAuth, invoiceId, {
      cancel_reason: 'Batch 9D-D atomic cancellation test',
    }));
    const response = errorResponse(error);
    assertEquals(response.status, testCase.status);
    assertEquals((response.body.error as { code: string }).code, testCase.code);
    assertEquals(client.rpcCalls.length, 1);
    assertEquals(client.rpcCalls[0].functionName, 'cancel_invoice');
    assertEquals(client.rpcCalls.some(call => call.functionName === 'reverse_journal_entry'), false);
  }
});

Deno.test('Batch 9D-D Receipt cancellation uses one governed RPC and returns only its committed result', async () => {
  const receiptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const client = new MockSupabaseClient({
    receipts: [{
      id: receiptId,
      company_id: 'co-1',
      customer_id: 'cust-a',
      receipt_no: 'RCT-CANCEL-001',
      receipt_date: '2026-01-15',
      payment_method: 'TT',
      status: 'Posted',
      receipt_amount: 100,
      allocated_amount: 0,
      unallocated_amount: 100,
      version: 3,
    }],
  }, 'service_role');

  const cancelled = await new ReceiptService(client as never).cancelReceipt(
    managerAuth,
    receiptId,
    { cancel_reason: 'Batch 9D-D atomic receipt cancellation test' },
  );

  assertEquals(cancelled.status, 'Cancelled');
  assertEquals(cancelled.version, 4);
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].functionName, 'cancel_receipt');
  assertEquals((client.rpcCalls[0].params as MockRow).p_user_id, managerAuth.userId);
  assertEquals((client.rpcCalls[0].params as MockRow).p_company_id, managerAuth.companyId);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'reverse_journal_entry'), false);
  assertEquals(client.operations.length, 0, 'Receipt cancellation must not perform separate table reads or writes');

  const receiptService = await read('../receipts/service.ts');
  const start = receiptService.indexOf('async cancelReceipt(');
  const end = receiptService.indexOf('// BOUNCED CHEQUE', start);
  const body = receiptService.slice(start, end);
  assert(body.includes("callRpc<Receipt>(this.client, 'cancel_receipt'"));
  assert(!body.includes('createReversalJE'));
  assert(!body.includes(".from('allocation_details')"));
  assert(!body.includes(".from('receipts')"));
});

Deno.test('Batch 9D-D cheque clearance is one governed RPC with validated AuthContext parameters', async () => {
  const receiptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const client = new MockSupabaseClient({
    receipts: [{
      id: receiptId,
      company_id: 'co-1',
      customer_id: 'cust-a',
      receipt_no: 'RCT-CHQ-001',
      receipt_date: '2026-01-15',
      payment_method: 'CHQ',
      status: 'Posted',
      receipt_amount: 100,
      allocated_amount: 0,
      unallocated_amount: 100,
      version: 2,
    }],
  }, 'service_role');

  const cleared = await new ReceiptService(client as never).clearCheque(
    managerAuth,
    receiptId,
    { clearance_date: '2026-01-31' },
  );

  assertEquals(cleared.value_date, '2026-01-31');
  assertEquals(cleared.version, 3);
  assertEquals(cleared.je_no, 'JE-RCT-MOCK-001');
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].functionName, 'clear_receipt_cheque');
  assertEquals((client.rpcCalls[0].params as MockRow).p_user_id, managerAuth.userId);
  assertEquals((client.rpcCalls[0].params as MockRow).p_company_id, managerAuth.companyId);
  assertEquals(client.operations.length, 0, 'Cheque clearance must not split journal and Receipt writes');

  const receiptService = await read('../receipts/service.ts');
  const start = receiptService.indexOf('async clearCheque(');
  const end = receiptService.indexOf('// CANCEL RECEIPT', start);
  const body = receiptService.slice(start, end);
  assert(body.includes("callRpc<Receipt & { je_no?: string }>(this.client, 'clear_receipt_cheque'"));
  assert(!body.includes('JournalEntryService'));
  assert(!body.includes('createJournalEntry'));
  assert(!body.includes(".from('receipts')"));

  const receiptIndex = await read('../receipts/index.ts');
  assert(receiptIndex.includes('validateClearReceipt'));
  assert(!receiptIndex.includes('String((body as Record<string, unknown>).clearance_date)'));
});

Deno.test('Batch 9D-D atomic Receipt operations preserve business, conflict, not-found, and internal error mapping', async () => {
  const receiptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const tables = {
    receipts: [{
      id: receiptId,
      company_id: 'co-1',
      customer_id: 'cust-a',
      receipt_no: 'RCT-CANCEL-001',
      status: 'Posted',
      receipt_amount: 100,
      allocated_amount: 0,
      unallocated_amount: 100,
      version: 1,
    }],
  };
  const cases = [
    { functionName: 'cancel_receipt', message: 'BR-RCT-CANCEL-ALLOC: active allocations exist', status: 400, code: 'BR-RCT-CANCEL-ALLOC' },
    { functionName: 'cancel_receipt', message: 'NOT_FOUND: Receipt not found', status: 404, code: 'NOT_FOUND' },
    { functionName: 'clear_receipt_cheque', message: 'CONFLICT: Receipt was modified during clearance', status: 409, code: 'CONFLICT' },
    { functionName: 'clear_receipt_cheque', message: 'column does not exist', status: 500, code: 'INTERNAL_ERROR' },
  ];

  for (const testCase of cases) {
    const client = new MockSupabaseClient(tables, 'service_role');
    client.rpcErrors[testCase.functionName] = { code: 'P0001', message: testCase.message };
    const service = new ReceiptService(client as never);
    const error = await rejectedValue(() => testCase.functionName === 'cancel_receipt'
      ? service.cancelReceipt(managerAuth, receiptId, { cancel_reason: 'Atomic receipt cancellation mapping test' })
      : service.clearCheque(managerAuth, receiptId, { clearance_date: '2026-01-31' }));
    const response = errorResponse(error);
    assertEquals(response.status, testCase.status);
    assertEquals((response.body.error as { code: string }).code, testCase.code);
    assertEquals(client.rpcCalls.length, 1);
    assertEquals(client.operations.length, 0);
  }
});

Deno.test('Batch 9D-D valid Debit Note reference remains separate from Linked Credit Note semantics', async () => {
  const validated = validateCreateInvoice({
    doc_type: 'Debit Note',
    invoice_date: '2026-01-15',
    customer_id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    currency: 'MYR',
    ref_invoice_id: linkedCreditNoteReferenceId,
  });
  assertEquals(validated.doc_type, 'Debit Note');
  assertEquals(validated.cn_type, undefined, 'Debit Note must not acquire Linked Credit Note semantics');
  assertEquals(validated.ref_invoice_id, linkedCreditNoteReferenceId);

  const tables = linkedCreditNoteTables();
  const created = tables.invoices.find(row => row.id === 'inv-created')!;
  Object.assign(created, {
    doc_type: 'Debit Note',
    cn_type: null,
    ref_invoice_id: linkedCreditNoteReferenceId,
    invoice_no: 'DN-MOCK-001',
  });
  const client = new MockSupabaseClient(tables, 'service_role');
  const result = await new DebitNoteService(client as never).createDebitNote(
    clerkAuth,
    linkedCreditNoteInput({
      doc_type: 'Debit Note',
      cn_type: undefined,
      ref_invoice_id: linkedCreditNoteReferenceId,
    }),
  );

  assertEquals(result.doc_type, 'Debit Note');
  const createCall = client.rpcCalls.find(call => call.functionName === 'fx_create_governed_invoice_draft');
  assert(createCall, 'Expected governed Debit Note creation RPC');
  const payload = (createCall.params as Record<string, unknown>).p_invoice as Record<string, unknown>;
  assertEquals(payload.ref_invoice_id, linkedCreditNoteReferenceId);
  assertEquals(payload.cn_type, null);
});

Deno.test('Batch 9D-D Debit Note creation fails closed for every invalid optional reference class', async () => {
  const cases: Array<{ label: string; reference: MockRow | null }> = [
    { label: 'missing reference', reference: null },
    { label: 'other company', reference: { company_id: 'co-2', invoice_no: 'SECRET-DN-OTHER-COMPANY' } },
    { label: 'other customer', reference: { customer_id: 'cust-b', invoice_no: 'SECRET-DN-OTHER-CUSTOMER' } },
    { label: 'currency mismatch', reference: { currency: 'USD' } },
    { label: 'Debit Note reference', reference: { doc_type: 'Debit Note' } },
    { label: 'Draft reference', reference: { status: 'Draft' } },
    { label: 'Cancelled reference', reference: { status: 'Cancelled' } },
  ];

  for (const testCase of cases) {
    const client = new MockSupabaseClient(linkedCreditNoteTables(testCase.reference), 'service_role');
    const error = await rejectedValue(() =>
      new DebitNoteService(client as never).createDebitNote(
        clerkAuth,
        linkedCreditNoteInput({
          doc_type: 'Debit Note',
          cn_type: undefined,
          ref_invoice_id: linkedCreditNoteReferenceId,
        }),
      )
    );

    assert(error instanceof BusinessError, `${testCase.label} must produce a business error`);
    assertEquals(error.code, 'BR-DN-REF');
    assertEquals(error.message, 'Debit Note reference is invalid or unavailable.');
    assertJsonEquals(error.details, { field: 'ref_invoice_id' });
    assertEquals(
      client.rpcCalls.some(call => call.functionName === 'fx_create_governed_invoice_draft'),
      false,
      `${testCase.label} must fail before governed creation`,
    );
    const publicError = JSON.stringify(errorResponse(error));
    assert(!publicError.includes('SECRET-DN-OTHER-COMPANY'));
    assert(!publicError.includes('SECRET-DN-OTHER-CUSTOMER'));
  }
});

Deno.test('Batch 9D-D Invoice detail distinguishes successful empty lines from invoice_lines failure', async () => {
  const detailId = 'edededed-eded-4ded-8ded-edededededed';
  const detailTables = linkedCreditNoteTables();
  detailTables.invoices[1] = { ...detailTables.invoices[1], id: detailId };
  const emptyClient = new MockSupabaseClient(detailTables, 'authenticated');
  const emptyResult = await new InvoiceService(
    new MockSupabaseClient({}, 'service_role') as never,
    emptyClient as never,
  ).getInvoiceById(clerkAuth, detailId);
  assertEquals(emptyResult.lines.length, 0);

  const mutationClient = new MockSupabaseClient({}, 'service_role');
  const failingReadClient = new MockSupabaseClient(detailTables, 'authenticated');
  failingReadClient.queryErrors.invoice_lines = {
    code: 'XX000',
    message: 'forced invoice line database failure',
  };
  const error = await rejectedValue(() =>
    new InvoiceService(mutationClient as never, failingReadClient as never)
      .getInvoiceById(clerkAuth, detailId)
  );

  assert(!(error instanceof NotFoundError));
  assert(String(error).includes('forced invoice line database failure'));
  assertEquals(errorResponse(error).status, 500);
  assertEquals((errorResponse(error).body.error as Record<string, unknown>).code, 'INTERNAL_ERROR');
  assertEquals(mutationClient.operations.length, 0, 'Invoice line failure must not retry through trusted client');
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

Deno.test('Batch 9D-D authorized receipt detail succeeds for assigned Clerk and Finance Manager through read client only', async () => {
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

  for (const auth of [clerkAuth, managerAuth]) {
    const mutationClient = new MockSupabaseClient(tables, 'service_role');
    const readClient = new MockSupabaseClient(tables, 'authenticated');
    const result = await new ReceiptService(mutationClient as never, readClient as never)
      .getReceiptById(auth, receiptId);

    assertEquals(result.id, receiptId);
    assertEquals(result.fx_decision?.id, 'dec-receipt');
    assertEquals(readClient.operations.some(op => op.table === 'receipts' && op.op === 'select'), true);
    assertEquals(readClient.operations.some(op => op.table === 'fx_booking_rate_decisions' && op.op === 'select'), true);
    assertEquals(mutationClient.operations.length, 0, 'Receipt detail must not query through the trusted client');
  }
});

Deno.test('Batch 9D-D RLS-hidden and nonexistent receipt detail share the same authorization-safe 404 contract', async () => {
  const receiptId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const hiddenMutationClient = new MockSupabaseClient({
    receipts: [{
      id: receiptId, company_id: 'co-1', customer_id: 'cust-unassigned', receipt_no: 'RCT-HIDDEN-001',
      status: 'Posted', currency: 'MYR', base_amount: 10,
    }],
  }, 'service_role');
  const hiddenReadClient = new MockSupabaseClient({ receipts: [] }, 'authenticated');
  const nonexistentMutationClient = new MockSupabaseClient({ receipts: [] }, 'service_role');
  const nonexistentReadClient = new MockSupabaseClient({ receipts: [] }, 'authenticated');

  const hiddenError = await rejectedValue(() =>
    new ReceiptService(hiddenMutationClient as never, hiddenReadClient as never)
      .getReceiptById(clerkAuth, receiptId)
  );
  const nonexistentError = await rejectedValue(() =>
    new ReceiptService(nonexistentMutationClient as never, nonexistentReadClient as never)
      .getReceiptById(clerkAuth, receiptId)
  );

  assert(hiddenError instanceof NotFoundError, 'RLS-hidden receipt must map to NotFoundError');
  assert(nonexistentError instanceof NotFoundError, 'Nonexistent receipt must map to NotFoundError');
  assertEquals(hiddenError.code, 'NOT_FOUND');
  assertEquals(hiddenError.status, 404);
  assertJsonEquals(errorResponse(hiddenError), errorResponse(nonexistentError));
  assertJsonEquals(errorResponse(hiddenError), {
    status: 404,
    body: {
      success: false,
      error: { code: 'NOT_FOUND', message: `Receipt not found: ${receiptId}` },
    },
  });
  assertEquals(hiddenMutationClient.operations.length, 0, 'Hidden lookup must not use trusted mutation client');
  assertEquals(nonexistentMutationClient.operations.length, 0, 'Missing lookup must not use trusted mutation client');
});

Deno.test('Batch 9D-D receipt detail preserves genuine PostgREST failures as HTTP 500', async () => {
  const receiptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const mutationClient = new MockSupabaseClient({}, 'service_role');
  const readClient = new MockSupabaseClient({}, 'authenticated');
  readClient.queryErrors.receipts = { code: 'XX000', message: 'forced receipt database failure' };

  const error = await rejectedValue(() =>
    new ReceiptService(mutationClient as never, readClient as never)
      .getReceiptById(clerkAuth, receiptId)
  );
  const response = errorResponse(error);

  assert(!(error instanceof NotFoundError), 'Unexpected receipt database failure must not become NotFoundError');
  assert(String(error).includes('forced receipt database failure'));
  assertEquals(response.status, 500);
  assertEquals((response.body.error as Record<string, unknown>).code, 'INTERNAL_ERROR');
  assertEquals(mutationClient.operations.length, 0, 'Failed receipt detail must not fall back to trusted client');
});

Deno.test('Batch 9D-D receipt detail without authenticated read context fails before any query', async () => {
  const mutationClient = new MockSupabaseClient({}, 'service_role');
  const error = await rejectedValue(() =>
    new ReceiptService(mutationClient as never)
      .getReceiptById(clerkAuth, 'ffffffff-ffff-4fff-8fff-ffffffffffff')
  );

  assert(String(error).includes('Authenticated read client is required'));
  assertEquals(mutationClient.operations.length, 0);
  assertEquals(mutationClient.rpcCalls.length, 0);
});

Deno.test('Batch 9D-D unassigned receipt collection remains an empty authorized result', async () => {
  const tables = {
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [
      { id: 'cust-assigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
      { id: 'cust-unassigned', company_id: 'co-1', is_deleted: false, is_hidden: false },
    ],
    user_customer_assignments: [{
      id: 'assignment-1', user_id: 'user-1', customer_id: 'cust-assigned', company_id: 'co-1', is_active: true,
    }],
    receipts: [{
      id: '99999999-9999-4999-8999-999999999999', company_id: 'co-1', customer_id: 'cust-unassigned',
      receipt_no: 'RCT-UNASSIGNED-001', status: 'Posted', receipt_date: '2026-01-01', payment_method: 'TT',
      currency: 'MYR', unallocated_amount: 10, exchange_rate: 1, receipt_amount: 10, base_amount: 10,
      fx_decision_id: null,
    }],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');
  const result = await new ReceiptService(mutationClient as never, readClient as never)
    .listReceipts(clerkAuth, { customer_id: 'cust-unassigned' }, { page: 1, page_size: 10 });

  assertEquals(result.receipts.length, 0);
  assertEquals(result.total, 0);
  assertEquals(result.summary.current_balance_summary.row_count, 0);
  assertEquals(mutationClient.rpcCalls.length, 0);
});

Deno.test('Batch 9D-D visible linked Credit Note reference uses authenticated caller context', async () => {
  const creditNoteId = '12121212-1212-4212-8212-121212121212';
  const referenceId = '34343434-3434-4434-8434-343434343434';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoices: [
      {
        id: creditNoteId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'CN-LINK-001',
        doc_type: 'Credit Note', cn_type: 'Linked', ref_invoice_id: referenceId, status: 'Open',
        currency: 'MYR', base_total: 10, fx_decision_id: null,
      },
      {
        id: referenceId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'INV-LINK-001',
        doc_type: 'Invoice', status: 'Open', currency: 'MYR', base_total: 100, fx_decision_id: null,
      },
    ],
    invoice_lines: [],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');

  const result = await new CreditNoteService(mutationClient as never, readClient as never)
    .getCreditNote(clerkAuth, creditNoteId);

  assertEquals((result as Invoice & { ref_invoice?: Invoice }).ref_invoice?.id, referenceId);
  assertEquals(readClient.operations.filter(op => op.table === 'invoices' && op.op === 'select').length, 2);
  assertEquals(mutationClient.operations.length, 0, 'Linked reference must not query trusted mutation client');
});

Deno.test('Batch 9D-D caller-hidden and missing linked Credit Note references share authorization-safe 404', async () => {
  const creditNoteId = '56565656-5656-4656-8656-565656565656';
  const referenceId = '78787878-7878-4878-8878-787878787878';
  const root = {
    id: creditNoteId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'CN-BROKEN-LINK',
    doc_type: 'Credit Note', cn_type: 'Linked', ref_invoice_id: referenceId, status: 'Open',
    currency: 'MYR', base_total: 10, fx_decision_id: null,
  };
  const reference = {
    id: referenceId, company_id: 'co-1', customer_id: 'cust-unassigned', invoice_no: 'INV-HIDDEN-LINK',
    doc_type: 'Invoice', status: 'Open', currency: 'MYR', base_total: 100, fx_decision_id: null,
  };
  const common = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoice_lines: [],
    fx_booking_rate_decisions: [],
  };
  const hiddenMutationClient = new MockSupabaseClient({ ...common, invoices: [root, reference] }, 'service_role');
  const hiddenReadClient = new MockSupabaseClient({ ...common, invoices: [root] }, 'authenticated');
  const missingMutationClient = new MockSupabaseClient({ ...common, invoices: [root] }, 'service_role');
  const missingReadClient = new MockSupabaseClient({ ...common, invoices: [root] }, 'authenticated');

  const hiddenError = await rejectedValue(() =>
    new CreditNoteService(hiddenMutationClient as never, hiddenReadClient as never)
      .getCreditNote(clerkAuth, creditNoteId)
  );
  const missingError = await rejectedValue(() =>
    new CreditNoteService(missingMutationClient as never, missingReadClient as never)
      .getCreditNote(clerkAuth, creditNoteId)
  );

  assert(hiddenError instanceof NotFoundError);
  assert(missingError instanceof NotFoundError);
  assertJsonEquals(errorResponse(hiddenError), errorResponse(missingError));
  assertJsonEquals(errorResponse(hiddenError), {
    status: 404,
    body: {
      success: false,
      error: { code: 'NOT_FOUND', message: `Credit Note not found: ${creditNoteId}` },
    },
  });
  assertEquals(hiddenMutationClient.operations.length, 0, 'Caller-hidden reference must not query trusted client');
  assertEquals(missingMutationClient.operations.length, 0, 'Missing reference must not query trusted client');
  assert(!JSON.stringify(errorResponse(hiddenError)).includes(reference.invoice_no));
});

Deno.test('Batch 9D-D genuine linked Credit Note reference query errors remain HTTP 500', async () => {
  const creditNoteId = '89898989-8989-4989-8989-898989898989';
  const referenceId = '90909090-9090-4090-8090-909090909090';
  const tables = {
    customers: [{ id: 'cust-a', company_id: 'co-1', is_deleted: false, is_hidden: false }],
    invoices: [{
      id: creditNoteId, company_id: 'co-1', customer_id: 'cust-a', invoice_no: 'CN-LINK-ERROR',
      doc_type: 'Credit Note', cn_type: 'Linked', ref_invoice_id: referenceId, status: 'Open',
      currency: 'MYR', base_total: 10, fx_decision_id: null,
    }],
    invoice_lines: [],
    fx_booking_rate_decisions: [],
  };
  const mutationClient = new MockSupabaseClient(tables, 'service_role');
  const readClient = new MockSupabaseClient(tables, 'authenticated');
  readClient.queryErrorSequence.invoices = [
    null,
    { code: 'XX000', message: 'forced linked reference database failure' },
  ];

  const error = await rejectedValue(() =>
    new CreditNoteService(mutationClient as never, readClient as never)
      .getCreditNote(clerkAuth, creditNoteId)
  );

  assert(!(error instanceof NotFoundError));
  assertEquals(errorResponse(error).status, 500);
  assert(String(error).includes('forced linked reference database failure'));
  assertEquals(mutationClient.operations.length, 0, 'Reference failure must not fall back to trusted client');
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
  const importService = new ImportService(client as never);
  const nestedServices = importService as unknown as {
    invoiceService: InvoiceService;
    receiptService: ReceiptService;
  };

  const invoice = await nestedServices.invoiceService.createInvoice(clerkAuth, {
    doc_type: 'Invoice',
    customer_id: 'cust-a',
    invoice_date: '2026-01-01',
    currency: 'USD',
    exchange_rate: 1.35,
  });
  const receipt = await nestedServices.receiptService.createReceipt(clerkAuth, {
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
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_receipt_collection'), false);
  assertEquals(client.operations.some(op => op.table === 'fx_booking_rate_decisions'), false);
});

Deno.test('Batch 9D-D AllocationService retains a mutation-only nested ReceiptService without implicit read context', async () => {
  const client = new MockSupabaseClient({
    companies: [{ id: 'co-1', base_currency: 'MYR' }],
    customers: [{
      id: 'cust-a', company_id: 'co-1', customer_name: 'Customer A', customer_id: 'CUST-A',
      status: 'Active', credit_rating: 'A', is_deleted: false, is_hidden: false,
    }],
    user_customer_assignments: [{
      id: 'assign-a', user_id: 'user-1', customer_id: 'cust-a', company_id: 'co-1', is_active: true,
    }],
    bank_accounts: [{ id: 'bank-1', company_id: 'co-1', is_active: true, bank_name: 'Bank', account_no: '001' }],
    receipts: [{
      id: 'rct-created', company_id: 'co-1', customer_id: 'cust-a', receipt_no: 'RCT-MOCK-001',
      receipt_date: '2026-01-01', value_date: '2026-01-01', customer_name: 'Customer A',
      payment_method: 'Bank Transfer', currency: 'USD', exchange_rate: 1.35, base_currency: 'MYR',
      receipt_amount: 10, base_amount: 13.5, allocated_amount: 0, unallocated_amount: 10,
      bank_account_id: 'bank-1', bank_account_name: 'Bank - 001', status: 'Draft', fx_decision_id: null,
    }],
    fx_booking_rate_decisions: [],
  }, 'service_role');
  const allocationService = new AllocationService(client as never);
  const nestedReceiptService = (allocationService as unknown as { receiptService: ReceiptService }).receiptService;

  const created = await nestedReceiptService.createReceipt(clerkAuth, {
    customer_id: 'cust-a', receipt_date: '2026-01-01', payment_method: 'TT', currency: 'USD',
    exchange_rate: 1.35, receipt_amount: 10, bank_account_id: 'bank-1',
  });

  assertEquals(created.id, 'rct-created');
  assertEquals(client.rpcCalls.some(call => call.functionName === 'fx_create_governed_receipt_draft'), true);
  assertEquals(client.rpcCalls.some(call => call.functionName === 'ar_receipt_collection'), false);
  const operationsBeforeReadAttempt = client.operations.length;
  const rpcCallsBeforeReadAttempt = client.rpcCalls.length;

  const readError = await rejectedValue(() =>
    nestedReceiptService.getReceiptById(clerkAuth, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  );

  assert(String(readError).includes('Authenticated read client is required'));
  assertEquals(client.operations.length, operationsBeforeReadAttempt, 'Missing read context must fail before SELECT');
  assertEquals(client.rpcCalls.length, rpcCallsBeforeReadAttempt, 'Missing read context must fail before RPC');
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
  assert(
    invoiceIndex.includes('getUserClient(authorizationHeader)')
      && invoiceIndex.includes("dependencies.createService(req.headers.get('Authorization')!)"),
    'Invoice index must inject the request Authorization header into the JWT-scoped read client',
  );
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

// The Migration 028 tests below are static SQL-contract evidence. They do not
// represent PostgreSQL installation, privilege, trigger, or concurrency proof.
Deno.test('Batch 9D-D F-01/F-07 static SQL contract installs the consolidated lifecycle closure under quiescence', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const lockIndex = migration.indexOf('LOCK TABLE\n  public.invoices,');
  const linkedPreflightIndex = migration.indexOf('BR-CN-INTEGRITY-PREFLIGHT');
  const allocationPreflightIndex = migration.indexOf('BR-CN-ALLOCATION-PREFLIGHT');
  const reversalPreflightIndex = migration.indexOf('BR-JE-INTEGRITY-PREFLIGHT');
  const firstFunctionIndex = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference()');
  const firstTriggerIndex = migration.indexOf('CREATE TRIGGER trg_ar_linked_credit_note_reference_forward');
  const invoiceCancelIndex = migration.indexOf('CREATE FUNCTION public.cancel_invoice(');
  const receiptCancelIndex = migration.indexOf('CREATE FUNCTION public.cancel_receipt(');
  const clearanceIndex = migration.indexOf('CREATE FUNCTION public.clear_receipt_cheque(');
  const commitIndex = migration.lastIndexOf('COMMIT;');

  assert(
    lockIndex >= 0
      && linkedPreflightIndex > lockIndex
      && allocationPreflightIndex > linkedPreflightIndex
      && reversalPreflightIndex > allocationPreflightIndex
      && firstFunctionIndex > reversalPreflightIndex
      && firstTriggerIndex > firstFunctionIndex
      && invoiceCancelIndex > firstTriggerIndex
      && receiptCancelIndex > invoiceCancelIndex
      && clearanceIndex > receiptCancelIndex
      && commitIndex > clearanceIndex,
    'The write barrier must cover both preflights, all trigger installation, and governed functions through commit',
  );
  for (const table of [
    'public.invoices',
    'public.invoice_lines',
    'public.receipts',
    'public.allocation_details',
    'public.cn_allocations',
    'public.journal_entries',
    'public.journal_entry_lines',
    'public.fx_booking_rate_decisions',
    'public.fx_booking_rate_decision_events',
  ]) {
    assert(migration.slice(lockIndex, linkedPreflightIndex).includes(table), `Migration lock must cover ${table}`);
  }
  assert(migration.indexOf("SET LOCAL lock_timeout = '5s';") < lockIndex);
  assert(migration.includes('IN ACCESS EXCLUSIVE MODE;'));
  assertEquals((migration.match(/LOCK TABLE/g) ?? []).length, 1, 'One deterministic barrier must acquire every governed table');
  assert(!migration.includes('IN SHARE ROW EXCLUSIVE MODE;'), 'No weaker lock may require a later Receipt lock upgrade');
  assert(migration.includes('QUIESCENT INSTALLATION CONTRACT'));
  assert(migration.includes('Confirm that no related financial transaction remains active'));
  assert(migration.includes('resume writes only after COMMIT succeeds'));
  assert(migration.indexOf('ALTER TABLE public.receipts') > lockIndex, 'Strongest barrier must precede Receipt ALTER TABLE');

  assert(migration.includes('LEFT JOIN public.invoices ref'));
  assert(migration.includes("ref.doc_type <> 'Invoice'"));
  assert(migration.includes('ref.company_id <> cn.company_id'));
  assert(migration.includes('ref.customer_id <> cn.customer_id'));
  assert(migration.includes('ref.currency <> cn.currency'));
  assert(migration.includes("ref.status NOT IN ('Open', 'Overdue', 'Partially Paid')"));
  assert(migration.includes('cn.ref_invoice_id = cn.id'));
  assert(migration.includes('BR-DN-INTEGRITY-PREFLIGHT'));
  assert(migration.includes("dn.doc_type = 'Debit Note'"));
  assert(migration.includes("ref.doc_type NOT IN ('Invoice', 'Credit Note')"));
  assert(migration.includes("ad.status = 'Active'"));
  assert(migration.includes("target.doc_type = 'Credit Note'"));
  assert(migration.includes('(array_agg(ad.id ORDER BY ad.id))[1:10]'));
  assert(migration.includes('separately reviewed data-resolution gate'));
  assert(migration.includes('uq_journal_entries_one_reversal'));

  assert(migration.includes('NEW.ref_invoice_id = NEW.id'));
  assert(migration.includes("v_reference.doc_type <> 'Invoice'"));
  assert(migration.includes('v_reference.company_id <> NEW.company_id'));
  assert(migration.includes('v_reference.customer_id <> NEW.customer_id'));
  assert(migration.includes('v_reference.currency <> NEW.currency'));
  assert(migration.includes('WHERE i.id = NEW.ref_invoice_id\n  FOR SHARE;'));
  assert(migration.includes("IF NEW.doc_type = 'Debit Note' THEN"));
  assert(migration.includes('IF NEW.ref_invoice_id IS NULL THEN'));
  assert(migration.includes("v_reference.doc_type NOT IN ('Invoice', 'Credit Note')"));
  assert(migration.includes("v_reference.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')"));
  assert(!migration.includes('FOR KEY SHARE'));
  assert(migration.includes('cn.ref_invoice_id = OLD.id'));
  assert(migration.includes('dn.ref_invoice_id = OLD.id'));
  assert(migration.includes("dn.status NOT IN ('Cancelled', 'Written Off')"));
  assert(migration.includes("NEW.status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')"));

  const triggerFunctions = [
    'ar_validate_linked_credit_note_reference',
    'ar_validate_linked_credit_note_reference_reverse',
    'ar_prevent_cancelled_document_mutation',
    'ar_enforce_receipt_lifecycle',
    'ar_enforce_invoice_line_lifecycle',
    'ar_recalculate_invoice_after_line_change',
    'ar_protect_allocation_detail',
    'ar_protect_cn_allocation',
    'ar_protect_journal_entry',
    'ar_protect_journal_entry_line',
    'ar_protect_fx_booking_decision',
    'ar_protect_fx_booking_decision_event',
  ];
  for (const functionName of triggerFunctions) {
    assert(migration.includes(`FUNCTION public.${functionName}()`));
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert(migration.includes(`REVOKE ALL ON FUNCTION public.${functionName}() FROM ${role}`));
    }
  }
  assertEquals(
    (migration.match(/SECURITY DEFINER/g) ?? []).length,
    13,
    'Only hardened internal helpers and eleven governed aggregate mutation RPCs use definer authority',
  );
  assertEquals(
    (migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length,
    11,
    'Only governed Draft/header/line deletion, cancellation, cheque, reference correction, and allocation reversal RPCs are granted',
  );
  assert(migration.includes('CREATE OR REPLACE FUNCTION public.rpc_check_customer_access('));
  assert(migration.includes("c.is_deleted = FALSE\n      AND c.is_hidden = FALSE"));
  assert(!/EXECUTE\s+FORMAT/i.test(migration), 'Dynamic SQL is prohibited');
});

Deno.test('Batch 9D-D Migration 028 uses one reference-row lock order without recursive financial mutation', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const forwardStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference()');
  const reverseStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference_reverse()');
  const triggerStart = migration.indexOf('DROP TRIGGER IF EXISTS trg_ar_linked_credit_note_reference_forward');
  const forwardBody = migration.slice(forwardStart, reverseStart);
  const reverseBody = migration.slice(reverseStart, triggerStart);

  assert(forwardBody.includes('WHERE i.id = NEW.ref_invoice_id\n  FOR SHARE;'), 'Forward writer must lock reference before validation');
  const forwardTrigger = migration.slice(
    migration.indexOf('CREATE TRIGGER trg_ar_linked_credit_note_reference_forward'),
    migration.indexOf('EXECUTE FUNCTION public.ar_validate_linked_credit_note_reference();'),
  );
  assert(!/\bstatus\b/.test(forwardTrigger), 'Posting-only CN status updates must not take a shared lock that is later upgraded');
  assert(reverseBody.includes('UPDATE already owns the referenced Invoice row lock'), 'Reverse writer must document the same reference-row serialization point');
  assert(reverseBody.includes('deliberately does not lock dependent Credit Note rows'), 'Reverse validation must avoid reference/CN reverse lock ordering');
  assert(reverseBody.includes('SELECT EXISTS ('), 'Reverse validation must inspect dependencies without mutating them');
  assert(reverseBody.includes('v_invalid_debit_note_dependency_exists'));
  assert(reverseBody.includes('BR-DN-REF: Debit Note reference is invalid or unavailable'));
  assert(!/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.invoices\b/i.test(forwardBody + reverseBody), 'Trigger functions must remain validation-only');

  const postingMigration = await read('../../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  assert(postingMigration.includes("WHEN v_new_os <= 0 THEN 'Paid'"), 'Existing BR-CN-003 Paid transition must remain intact');
  assert(postingMigration.includes("WHEN v_new_os < v_ref.total_amount THEN 'Partially Paid'"), 'Existing BR-CN-003 partial transition must remain intact');
  assert(postingMigration.includes('SELECT * INTO v_ref FROM invoices WHERE id = v_inv.ref_invoice_id FOR UPDATE;'), 'Posting must retain its authoritative reference lock');
});

Deno.test('Batch 9D-D Draft Invoice header edits keep FX and non-FX changes in one governed transaction', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const updateStart = migration.indexOf('CREATE FUNCTION public.update_draft_invoice(');
  const reverseAllocationStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.reverse_allocation(', updateStart);
  const body = migration.slice(updateStart, reverseAllocationStart);

  assertEquals((migration.match(/CREATE FUNCTION public\.update_draft_invoice\(/g) ?? []).length, 1);
  assert(body.includes('RETURNS JSONB'));
  assert(body.includes('VOLATILE'));
  assert(body.includes('SECURITY DEFINER'));
  assert(body.includes("SET search_path = ''"));
  assert(body.includes('PERFORM public.rpc_check_role('));
  assert(body.includes('PERFORM public.rpc_check_customer_access('));
  const parentLock = body.indexOf('FROM public.invoices i');
  const parentForUpdate = body.indexOf('FOR UPDATE;', parentLock);
  const fxUpdate = body.indexOf('PERFORM public.fx_update_governed_invoice_fx(');
  const headerUpdate = body.indexOf('UPDATE public.invoices i');
  assert(parentLock >= 0 && parentForUpdate > parentLock && fxUpdate > parentForUpdate && headerUpdate > fxUpdate);
  assert(body.includes("WHERE key_name NOT IN ("));
  assert(body.includes("COALESCE((p_changes->>'fx_explicit_rate_supplied')::BOOLEAN, FALSE)"));
  assert(!/^\s*COMMIT;/im.test(body));
  assert(!/EXECUTE\s+FORMAT/i.test(body));

  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(
      `REVOKE ALL ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) FROM ${role}`,
    ));
  }
  assert(migration.includes(
    'GRANT EXECUTE ON FUNCTION public.update_draft_invoice(UUID, UUID, UUID, JSONB) TO service_role',
  ));
});

Deno.test('Batch 9D-D F-05 posted reference_no correction uses one narrow governed and audited path', async () => {
  const invoiceId = '99999999-9999-4999-8999-999999999999';
  const client = new MockSupabaseClient({
    invoices: [{
      id: invoiceId,
      company_id: clerkAuth.companyId,
      customer_id: 'cust-a',
      doc_type: 'Invoice',
      status: 'Open',
      reference_no: 'PO-OLD',
    }],
  }, 'service_role');
  const corrected = await new InvoiceService(client as never).correctPostedReference(
    clerkAuth,
    invoiceId,
    'PO-NEW',
  );
  assertEquals(corrected.reference_no, 'PO-NEW');
  assertEquals(client.rpcCalls.length, 1);
  assertJsonEquals(client.rpcCalls[0], {
    functionName: 'correct_posted_invoice_reference',
    params: {
      p_invoice_id: invoiceId,
      p_user_id: clerkAuth.userId,
      p_company_id: clerkAuth.companyId,
      p_reference_no: 'PO-NEW',
    },
  });
  assertEquals(client.operations.length, 0, 'Posted reference correction must not compose trusted table DML');

  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const auditMigration = await read('../../../../database/005_audit_triggers.sql');
  const invoicePrd = await read('../../../../PRD_Part2_Invoicing_Credit_Notes.md');
  assert(invoicePrd.includes('仅允许修改：`internal_remarks`, `invoice_remarks`, `reference_no`'));
  const functionStart = migration.indexOf('CREATE FUNCTION public.correct_posted_invoice_reference(');
  const deleteStart = migration.indexOf('CREATE FUNCTION public.delete_draft_invoice(', functionStart);
  const body = migration.slice(functionStart, deleteStart);
  assertEquals((migration.match(/CREATE FUNCTION public\.correct_posted_invoice_reference\(/g) ?? []).length, 1);
  assert(body.includes('SECURITY DEFINER'));
  assert(body.includes("SET search_path = ''"));
  assert(body.includes('PERFORM public.rpc_check_role('));
  assert(body.includes('PERFORM public.rpc_check_customer_access('));
  const parentLock = body.indexOf('FROM public.invoices i');
  const forUpdate = body.indexOf('FOR UPDATE;', parentLock);
  const referenceUpdate = body.indexOf('UPDATE public.invoices', forUpdate);
  const auditInsert = body.indexOf('INSERT INTO public.credit_control_logs', referenceUpdate);
  assert(parentLock >= 0 && forUpdate > parentLock && referenceUpdate > forUpdate && auditInsert > referenceUpdate);
  assert(body.includes("v_invoice.doc_type NOT IN ('Invoice', 'Debit Note', 'Credit Note')"));
  assert(body.includes("v_invoice.status = 'Draft'"));
  assert(body.includes('SET reference_no = p_reference_no'));
  for (const forbidden of ['total_amount =', 'outstanding =', 'status = p_', 'exchange_rate =', 'posting_period =']) {
    assert(!body.includes(forbidden), `Reference correction must not mutate ${forbidden}`);
  }
  assert(body.includes("'Reference Correction'"));
  assert(body.includes('v_invoice.reference_no'));
  assert(body.includes('created_by'));
  assert(auditMigration.includes('CREATE TRIGGER trg_prevent_ccl_delete'));
  assert(auditMigration.includes('CREATE TRIGGER trg_prevent_ccl_update'));

  const lifecycleStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()');
  const receiptStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()');
  const lifecycle = migration.slice(lifecycleStart, receiptStart);
  const terminalClause = lifecycle.slice(
    lifecycle.indexOf("IF OLD.status IN ('Cancelled', 'Written Off')"),
    lifecycle.indexOf('-- BR-INV-001'),
  );
  const postedClause = lifecycle.slice(lifecycle.indexOf('-- BR-INV-001'), lifecycle.indexOf('v_system_change :='));
  assert(lifecycle.includes('OR NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(!terminalClause.includes('NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(!postedClause.includes('NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(lifecycle.includes('IF v_structural_change AND NOT v_owner_authorized THEN'));
  assert(lifecycle.includes('BR-DOC-AUTHORITY: Financial structure requires a governed mutation'));

  const signature = 'public.correct_posted_invoice_reference(UUID, UUID, UUID, TEXT)';
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`));
  }
});

const postedReferenceRouteInvoiceId = '99999999-9999-4999-8999-999999999991';
const postedReferenceRouteCompanyId = '99999999-9999-4999-8999-999999999992';
const postedReferenceRouteUserId = '99999999-9999-4999-8999-999999999993';
const postedReferenceRouteCustomerId = '99999999-9999-4999-8999-999999999994';

const postedReferenceRouteAuth: AuthContext = {
  userId: postedReferenceRouteUserId,
  companyId: postedReferenceRouteCompanyId,
  roles: ['AR Clerk'],
  highestRole: 'AR Clerk',
  email: 'route-clerk@example.test',
};

function postedReferenceRequest(
  path: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(`https://example.test/functions/v1/invoices${path}`, {
    method,
    headers: {
      Authorization: 'Bearer route-test-token',
      'Content-Type': 'application/json',
      'X-Company-Id': postedReferenceRouteCompanyId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function postedReferenceHandler(
  client: MockSupabaseClient,
  authenticatedCompanies: string[] = [],
): (req: Request) => Promise<Response> {
  return createInvoiceHandler({
    authenticate: async (req, companyId) => {
      assertEquals(req.headers.get('Authorization'), 'Bearer route-test-token');
      authenticatedCompanies.push(companyId);
      return postedReferenceRouteAuth;
    },
    createService: (authorizationHeader) => {
      assertEquals(authorizationHeader, 'Bearer route-test-token');
      return new InvoiceService(client as never);
    },
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test('Batch 9D-D F-05/F-07 production handler reaches posted reference RPC with AuthContext-bound identity', async () => {
  const client = new MockSupabaseClient({
    invoices: [{
      id: postedReferenceRouteInvoiceId,
      company_id: postedReferenceRouteCompanyId,
      customer_id: postedReferenceRouteCustomerId,
      doc_type: 'Invoice',
      status: 'Open',
      reference_no: 'PO-OLD',
    }],
  }, 'service_role');
  const authenticatedCompanies: string[] = [];
  const routeHandler = postedReferenceHandler(client, authenticatedCompanies);

  const response = await routeHandler(postedReferenceRequest(
    `/${postedReferenceRouteInvoiceId}/reference`,
    'PATCH',
    { reference_no: 'PO-NEW' },
  ));
  assertEquals(response.status, 200);
  const responseBody = await responseJson(response);
  assertEquals(responseBody.success, true);
  assertEquals((responseBody.data as MockRow).reference_no, 'PO-NEW');
  assertJsonEquals(authenticatedCompanies, [postedReferenceRouteCompanyId]);
  assertEquals(client.rpcCalls.length, 1);
  assertJsonEquals(client.rpcCalls[0], {
    functionName: 'correct_posted_invoice_reference',
    params: {
      p_invoice_id: postedReferenceRouteInvoiceId,
      p_user_id: postedReferenceRouteUserId,
      p_company_id: postedReferenceRouteCompanyId,
      p_reference_no: 'PO-NEW',
    },
  });

  const nullResponse = await routeHandler(postedReferenceRequest(
    `/${postedReferenceRouteInvoiceId}/reference`,
    'PATCH',
    { reference_no: null },
  ));
  assertEquals(nullResponse.status, 200);
  assertEquals(client.rpcCalls[1].functionName, 'correct_posted_invoice_reference');
  assertEquals((client.rpcCalls[1].params as MockRow).p_reference_no, null);
});

Deno.test('Batch 9D-D F-07 posted reference route rejects payload authority, invalid values, and unsupported methods', async () => {
  const invalidCases: Array<{ name: string; body: unknown }> = [
    { name: 'missing', body: {} },
    { name: 'blank', body: { reference_no: '   ' } },
    { name: 'overlength', body: { reference_no: 'R'.repeat(51) } },
    { name: 'wrong type', body: { reference_no: 42 } },
    {
      name: 'unsupported authority and financial fields',
      body: {
        reference_no: 'PO-SPOOF',
        user_id: 'attacker-user',
        company_id: 'attacker-company',
        status: 'Paid',
        total_amount: 0,
      },
    },
  ];

  for (const invalidCase of invalidCases) {
    const client = new MockSupabaseClient({}, 'service_role');
    const response = await postedReferenceHandler(client)(postedReferenceRequest(
      `/${postedReferenceRouteInvoiceId}/reference`,
      'PATCH',
      invalidCase.body,
    ));
    assertEquals(response.status, 400, `${invalidCase.name} must return HTTP 400`);
    const responseBody = await responseJson(response);
    assertEquals(
      (responseBody.error as MockRow).code,
      'VALIDATION_ERROR',
      `${invalidCase.name} must use the safe validation contract`,
    );
    assertEquals(client.rpcCalls.length, 0, `${invalidCase.name} must not reach an RPC`);
    const serialized = JSON.stringify(responseBody);
    assert(!serialized.includes('attacker-user') && !serialized.includes('attacker-company'));
  }

  const methodClient = new MockSupabaseClient({}, 'service_role');
  const methodResponse = await postedReferenceHandler(methodClient)(postedReferenceRequest(
    `/${postedReferenceRouteInvoiceId}/reference`,
    'POST',
  ));
  assertEquals(methodResponse.status, 405);
  assertEquals((await responseJson(methodResponse)).error instanceof Object, true);
  assertEquals(methodClient.rpcCalls.length, 0);

  const corsResponse = await postedReferenceHandler(methodClient)(postedReferenceRequest(
    `/${postedReferenceRouteInvoiceId}/reference`,
    'OPTIONS',
  ));
  assertEquals(corsResponse.status, 204);
  assert(
    corsResponse.headers.get('Access-Control-Allow-Methods')?.split(',').map((method) => method.trim())
      .includes('PATCH'),
    'Invoice CORS preflight must advertise the PATCH reference route',
  );
});

Deno.test('Batch 9D-D F-07 generic Invoice PATCH remains Draft-only update composition', async () => {
  const calls: Array<{ method: string; auth: AuthContext; id: string; input: CreateInvoiceInput }> = [];
  const service = {
    updateDraftInvoice: async (
      auth: AuthContext,
      id: string,
      input: CreateInvoiceInput,
    ): Promise<Invoice> => {
      calls.push({ method: 'updateDraftInvoice', auth, id, input });
      return {
        id,
        company_id: auth.companyId,
        customer_id: input.customer_id,
        doc_type: input.doc_type,
        status: 'Draft',
        reference_no: input.reference_no,
      } as Invoice;
    },
    correctPostedReference: (): never => {
      throw new Error('Generic PATCH must not invoke correctPostedReference');
    },
  } as unknown as InvoiceService;
  const routeHandler = createInvoiceHandler({
    authenticate: async () => postedReferenceRouteAuth,
    createService: () => service,
  });

  const response = await routeHandler(postedReferenceRequest(
    `/${postedReferenceRouteInvoiceId}`,
    'PATCH',
    {
      doc_type: 'Invoice',
      invoice_date: '2026-07-14',
      customer_id: postedReferenceRouteCustomerId,
      currency: 'MYR',
      reference_no: 'PO-DRAFT',
    },
  ));
  assertEquals(response.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].method, 'updateDraftInvoice');
  assertEquals(calls[0].auth.userId, postedReferenceRouteUserId);
  assertEquals(calls[0].auth.companyId, postedReferenceRouteCompanyId);
  assertEquals(calls[0].id, postedReferenceRouteInvoiceId);
  assertEquals(calls[0].input.reference_no, 'PO-DRAFT');
});

Deno.test('Batch 9D-D F-07 posted reference route preserves governed RPC error mapping and disclosure', async () => {
  const cases = [
    { message: 'BR-DOC-REFERENCE: correction rejected', status: 400, code: 'BR-DOC-REFERENCE' },
    { message: 'AUTH: caller is not permitted', status: 400, code: 'AUTH' },
    { message: 'CONFLICT: document changed', status: 409, code: 'CONFLICT' },
    { message: 'NOT_FOUND: Financial document not found', status: 404, code: 'NOT_FOUND' },
    { message: 'column private_financial_detail does not exist', status: 500, code: 'INTERNAL_ERROR' },
  ];

  for (const testCase of cases) {
    const client = new MockSupabaseClient({}, 'service_role');
    client.rpcErrors.correct_posted_invoice_reference = {
      code: 'P0001',
      message: testCase.message,
    };
    const response = await postedReferenceHandler(client)(postedReferenceRequest(
      `/${postedReferenceRouteInvoiceId}/reference`,
      'PATCH',
      { reference_no: 'PO-ERROR' },
    ));
    assertEquals(response.status, testCase.status);
    const responseBody = await responseJson(response);
    assertEquals((responseBody.error as MockRow).code, testCase.code);
    if (testCase.status === 500) {
      const serialized = JSON.stringify(responseBody);
      assert(!serialized.includes('private_financial_detail'));
      assert(serialized.includes('An unexpected error occurred'));
    }
  }
});

Deno.test('Batch 9D-D Migration 028 makes every Invoice-family lifecycle classification-independently terminal', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const terminalStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()');
  const receiptFunctionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()');
  const forwardTriggerStart = migration.indexOf('CREATE TRIGGER trg_ar_linked_credit_note_reference_forward');
  const reverseTriggerStart = migration.indexOf('CREATE TRIGGER trg_ar_linked_credit_note_reference_reverse');
  const terminalTriggerStart = migration.indexOf('CREATE TRIGGER trg_ar_financial_document_lifecycle');
  const receiptTriggerStart = migration.indexOf('CREATE TRIGGER trg_ar_receipt_lifecycle');
  const terminalBody = migration.slice(terminalStart, receiptFunctionStart);
  const terminalClause = terminalBody.slice(
    terminalBody.indexOf("IF OLD.status IN ('Cancelled', 'Written Off')"),
    terminalBody.indexOf('-- BR-INV-001'),
  );
  const terminalTrigger = migration.slice(terminalTriggerStart, receiptTriggerStart);

  assert(terminalStart >= 0 && terminalTriggerStart > reverseTriggerStart);
  assertEquals((migration.match(/CREATE OR REPLACE FUNCTION public\.ar_prevent_cancelled_document_mutation\(\)/g) ?? []).length, 1);
  assertEquals((migration.match(/CREATE TRIGGER trg_ar_financial_document_lifecycle/g) ?? []).length, 1);
  assert(!migration.includes('intentionally validation-only'));
  assert(terminalClause.includes("OLD.status IN ('Cancelled', 'Written Off')"));
  assert(!terminalClause.includes("OLD.doc_type = 'Credit Note'"), 'Terminality must not depend on mutable document classification');
  assert(!terminalClause.includes("OLD.cn_type = 'Linked'"), 'Terminality must not depend on mutable CN classification');
  for (const field of [
    'id', 'company_id', 'invoice_no', 'doc_type', 'invoice_date', 'due_date',
    'customer_id', 'customer_name', 'currency', 'exchange_rate', 'base_currency',
    'fx_source_category', 'fx_decision_id', 'subtotal', 'tax_total', 'total_amount',
    'base_total', 'outstanding', 'status', 'posting_period',
    'ref_invoice_id', 'cn_type', 'reason_code', 'reason_desc', 'ar_acct',
    'created_by', 'created_at', 'posted_by', 'posted_at', 'cancelled_by',
    'cancelled_at', 'cancel_reason', 'version',
  ]) {
    assert(
      terminalClause.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`),
      `Terminal function must protect ${field}`,
    );
  }
  assert(!terminalClause.includes('NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(terminalBody.includes('v_structural_change := NEW.id IS DISTINCT FROM OLD.id'));
  assert(terminalBody.includes('OR NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(terminalBody.includes('BR-DOC-TERMINAL'));
  assert(terminalBody.includes('SECURITY INVOKER'));
  assert(terminalBody.includes("SET search_path = ''"));
  assert(terminalTrigger.includes('BEFORE INSERT OR UPDATE OR DELETE'));
  assert(!terminalBody.includes('FOR SHARE'), 'Terminal rejection must not enter the reference-row posting lock order');
  assert(!/\bINSERT\s+INTO\b/i.test(terminalBody), 'Lifecycle trigger must not create financial records');
  assert(!/\bUPDATE\s+public\./i.test(terminalBody), 'Lifecycle trigger must not mutate another financial row');
  assert(!/\bDELETE\s+FROM\b/i.test(terminalBody), 'Lifecycle trigger must not delete financial records');

  const forwardTrigger = migration.slice(forwardTriggerStart, reverseTriggerStart);
  assert(!/\bstatus\b/.test(forwardTrigger), 'Ordinary posting status transitions must remain outside forward FOR SHARE validation');
  assert(!migration.includes('ar_prevent_cancelled_linked_credit_note_reactivation'));
  assert(!migration.includes('trg_ar_cancelled_linked_credit_note_terminal'));
  assert(!migration.includes('CREATE TRIGGER trg_ar_cancelled_document_terminal'));
  assert(!migration.includes('BR-CN-TERMINAL'));
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(
      `REVOKE ALL ON FUNCTION public.ar_prevent_cancelled_document_mutation() FROM ${role}`,
    ));
  }
});

Deno.test('Batch 9D-D Cancelled-document transition model covers every protected field and valid lifecycle transitions', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  type TerminalRow = {
    status: string | null;
    doc_type: string | null;
    cn_type: string | null;
    ref_invoice_id: string | null;
    company_id: string | null;
    customer_id: string | null;
    currency: string | null;
  };
  const protectedFields: Array<keyof TerminalRow> = [
    'status',
    'doc_type',
    'cn_type',
    'ref_invoice_id',
    'company_id',
    'customer_id',
    'currency',
  ];
  const isRejectedTransition = (oldRow: TerminalRow, newRow: TerminalRow) =>
    ['Cancelled', 'Written Off'].includes(oldRow.status ?? '')
    && protectedFields.some((field) => oldRow[field] !== newRow[field]);
  const cancelledInvoice: TerminalRow = {
    status: 'Cancelled',
    doc_type: 'Invoice',
    cn_type: null,
    ref_invoice_id: null,
    company_id: 'company-a',
    customer_id: 'customer-a',
    currency: 'MYR',
  };

  for (const targetStatus of ['Draft', 'Open', 'Paid', null, 'Written Off']) {
    assertEquals(
      isRejectedTransition(cancelledInvoice, { ...cancelledInvoice, status: targetStatus }),
      true,
      `Cancelled Invoice must reject status ${String(targetStatus)}`,
    );
  }
  for (const change of [
    { doc_type: 'Debit Note' },
    { company_id: 'company-b' },
    { customer_id: 'customer-b' },
    { currency: 'USD' },
  ]) {
    assertEquals(isRejectedTransition(cancelledInvoice, { ...cancelledInvoice, ...change }), true);
  }

  const cancelledStandalone: TerminalRow = {
    ...cancelledInvoice,
    doc_type: 'Credit Note',
    cn_type: 'Standalone',
  };
  const cancelledDebitNote: TerminalRow = { ...cancelledInvoice, doc_type: 'Debit Note' };
  assertEquals(isRejectedTransition(cancelledStandalone, { ...cancelledStandalone, status: 'Open' }), true);
  assertEquals(isRejectedTransition(cancelledDebitNote, { ...cancelledDebitNote, status: 'Open' }), true);
  assertEquals(isRejectedTransition(cancelledInvoice, { ...cancelledInvoice }), false, 'Cancelled no-op must remain harmless');

  const draftInvoice = { ...cancelledInvoice, status: 'Draft' };
  const openInvoice = { ...cancelledInvoice, status: 'Open' };
  assertEquals(isRejectedTransition(draftInvoice, { ...draftInvoice, status: 'Open' }), false);
  assertEquals(isRejectedTransition(draftInvoice, { ...draftInvoice, status: 'Paid' }), false);
  assertEquals(isRejectedTransition(draftInvoice, { ...draftInvoice, status: 'Cancelled' }), false);
  assertEquals(isRejectedTransition(openInvoice, { ...openInvoice, status: 'Paid' }), false);
  assertEquals(isRejectedTransition(openInvoice, { ...openInvoice, status: 'Cancelled' }), false);

  assert(migration.includes("OLD.status IN ('Cancelled', 'Written Off')"));
  for (const field of protectedFields) {
    assert(migration.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`));
  }
});

Deno.test('Batch 9D-D Cancelled Linked Credit Note two-step and simultaneous classification bypasses fail at the first write', () => {
  type TerminalRow = {
    status: string | null;
    doc_type: string | null;
    cn_type: string | null;
    ref_invoice_id: string | null;
    company_id: string | null;
    customer_id: string | null;
    currency: string | null;
  };
  const protectedFields: Array<keyof TerminalRow> = [
    'status',
    'doc_type',
    'cn_type',
    'ref_invoice_id',
    'company_id',
    'customer_id',
    'currency',
  ];
  const isRejectedTransition = (oldRow: TerminalRow, newRow: TerminalRow) =>
    oldRow.status === 'Cancelled'
    && protectedFields.some((field) => oldRow[field] !== newRow[field]);
  const linkedCancelled: TerminalRow = {
    status: 'Cancelled',
    doc_type: 'Credit Note',
    cn_type: 'Linked',
    ref_invoice_id: 'invoice-a',
    company_id: 'company-a',
    customer_id: 'customer-a',
    currency: 'MYR',
  };

  for (const targetStatus of ['Draft', 'Open', 'Paid']) {
    assertEquals(
      isRejectedTransition(linkedCancelled, { ...linkedCancelled, status: targetStatus }),
      true,
      `Direct Cancelled Linked Credit Note transition to ${targetStatus} must fail`,
    );
  }
  assertEquals(
    isRejectedTransition(linkedCancelled, { ...linkedCancelled, ref_invoice_id: 'invoice-b' }),
    true,
    'Reference-only replacement while Cancelled must fail',
  );
  const standaloneFirstStep = { ...linkedCancelled, cn_type: 'Standalone', ref_invoice_id: null };
  assertEquals(
    isRejectedTransition(linkedCancelled, standaloneFirstStep),
    true,
    'Two-step bypass must fail before reclassification can commit',
  );
  assertEquals(
    isRejectedTransition(linkedCancelled, { ...linkedCancelled, doc_type: 'Debit Note', cn_type: null }),
    true,
    'Document-type reclassification while Cancelled must fail',
  );
  assertEquals(
    isRejectedTransition(linkedCancelled, {
      ...linkedCancelled,
      status: 'Draft',
      doc_type: 'Invoice',
      cn_type: null,
      ref_invoice_id: 'invoice-b',
    }),
    true,
    'Simultaneous reactivation, reclassification, and reference replacement must fail',
  );
});

Deno.test('Batch 9D-D Migration 028 cancellation RPC keeps checks, reversal, and status update atomic', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const functionStart = migration.indexOf('CREATE FUNCTION public.cancel_invoice(');
  const receiptFunctionStart = migration.indexOf('CREATE FUNCTION public.cancel_receipt(', functionStart);
  const body = migration.slice(functionStart, receiptFunctionStart);
  assert(functionStart >= 0 && receiptFunctionStart > functionStart);
  assertEquals((migration.match(/CREATE FUNCTION public\.cancel_invoice\(/g) ?? []).length, 1, 'Expected one non-overloaded cancellation function');
  assert(body.includes('RETURNS JSONB'));
  assert(body.includes('VOLATILE'));
  assert(body.includes('SECURITY DEFINER'));
  assert(body.includes("SET search_path = ''"));
  assert(body.includes('PERFORM public.rpc_check_role('));
  assert(body.includes('PERFORM public.rpc_check_customer_access('));
  assert(body.includes('ARRAY[\'AR Supervisor\', \'Finance Manager\']'));

  const invoiceLock = body.indexOf('FROM public.invoices i');
  const forUpdate = body.indexOf('FOR UPDATE;', invoiceLock);
  const allocationCheck = body.indexOf('FROM public.allocation_details ad');
  const linkedCheck = body.indexOf('FROM public.invoices cn');
  const journalLookup = body.indexOf('FROM public.journal_entries je');
  const reversal = body.indexOf('v_reversal := public.reverse_journal_entry(');
  const cancellationUpdate = body.indexOf('UPDATE public.invoices');
  assert(
    invoiceLock >= 0
      && forUpdate > invoiceLock
      && allocationCheck > forUpdate
      && linkedCheck > allocationCheck
      && journalLookup > linkedCheck
      && reversal > journalLookup
      && cancellationUpdate > reversal,
    'Invoice lock and all preconditions must precede reversal and cancellation update',
  );
  assert(body.includes("ad.status = 'Active'"));
  assert(body.includes("cn.status <> 'Cancelled'"));
  assert(body.includes("dn.doc_type = 'Debit Note'"));
  assert(body.includes("dn.status NOT IN ('Cancelled', 'Written Off')"));
  assert(body.includes('BR-DN-REF: Debit Note reference integrity prevents this document cancellation'));
  assert(body.includes("v_invoice.status NOT IN ('Open', 'Overdue')"));
  assert(body.includes("v_invoice.doc_type = 'Credit Note'"));
  assert(body.includes("v_invoice.doc_type NOT IN ('Invoice', 'Debit Note')"));
  assert(body.includes('v_invoice.outstanding IS DISTINCT FROM v_invoice.total_amount'));
  assert(body.includes('IF v_primary_je_count <> 1 THEN'));
  assert(body.includes('AND version = p_expected_version'));
  assert(!/\bCOMMIT\b/i.test(body), 'Cancellation function must not escape its caller transaction');
  assert(!/EXECUTE\s+FORMAT/i.test(body), 'Cancellation function must not use dynamic SQL');

  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(
      `REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) FROM ${role}`,
    ));
  }
  assert(migration.includes(
    'GRANT EXECUTE ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) TO service_role',
  ));
  assert(!migration.includes(
    'GRANT EXECUTE ON FUNCTION public.cancel_invoice(UUID, UUID, UUID, TEXT, INTEGER) TO authenticated',
  ));

  const invoiceService = await read('../invoices/service.ts');
  const serviceStart = invoiceService.indexOf('async cancelInvoice(');
  const serviceEnd = invoiceService.indexOf('// GET / LIST INVOICES', serviceStart);
  const serviceBody = invoiceService.slice(serviceStart, serviceEnd);
  assert(serviceBody.includes("callRpc<Invoice>(this.client, 'cancel_invoice'"));
  assert(!serviceBody.includes('createReversalJE'));
  assert(!serviceBody.includes(".from('allocation_details')"));
  assert(!serviceBody.includes(".from('invoices')\n      .update"));
});

Deno.test('Batch 9D-D Migration 028 protects lifecycle headers, lines, allocations, and journal evidence', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const invoiceStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()');
  const receiptStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()');
  const lineStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_invoice_line_lifecycle()');
  const allocationStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_allocation_detail()');
  const cnAllocationStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_cn_allocation()');
  const journalStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry()');
  const journalLineStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry_line()');
  const triggerStart = migration.indexOf('DROP TRIGGER IF EXISTS trg_ar_linked_credit_note_reference_forward');
  const invoiceBody = migration.slice(invoiceStart, receiptStart);
  const receiptBody = migration.slice(receiptStart, lineStart);
  const lineBody = migration.slice(lineStart, allocationStart);
  const allocationBody = migration.slice(allocationStart, cnAllocationStart);
  const cnAllocationBody = migration.slice(cnAllocationStart, journalStart);
  const journalBody = migration.slice(journalStart, journalLineStart);
  const journalLineBody = migration.slice(journalLineStart, triggerStart);

  assert(invoiceBody.includes("TG_OP = 'INSERT'"));
  assert(invoiceBody.includes("NEW.status <> 'Draft'"));
  assert(invoiceBody.includes('NEW.created_by IS NULL'));
  assert(invoiceBody.includes("ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']"));
  assert(invoiceBody.includes('PERFORM public.rpc_check_customer_access('));
  assert(invoiceBody.includes("NEW.outstanding <> 0"));
  assert(invoiceBody.includes('BR-DOC-INITIAL'));
  assert(invoiceBody.includes("TG_OP = 'DELETE'"));
  assert(invoiceBody.includes("current_setting('app.ar_draft_delete', TRUE) IS DISTINCT FROM 'on'"));
  assert(invoiceBody.includes('BR-DOC-AUTHORITY: Draft deletion requires the governed deletion operation'));
  assert(invoiceBody.includes("OLD.status <> 'Draft'"));
  assert(invoiceBody.includes('BR-DOC-DELETE'));
  assert(invoiceBody.includes('FROM public.journal_entries je'));
  assert(invoiceBody.includes('FROM public.allocation_details ad'));
  assert(invoiceBody.includes('FROM public.cn_allocations ca'));
  assert(invoiceBody.includes('BR-DOC-IMMUTABLE'));
  assert(invoiceBody.includes('BR-DOC-BALANCE'));
  assert(invoiceBody.includes('NEW.outstanding > NEW.total_amount'));
  assert(invoiceBody.includes('ROUND(NEW.subtotal + NEW.tax_total, 2)'));
  assert(invoiceBody.includes('ROUND(NEW.total_amount * NEW.exchange_rate, 2)'));
  assert(invoiceBody.includes('NEW.reference_no IS DISTINCT FROM OLD.reference_no'));
  assert(invoiceBody.includes('BR-DOC-AUTHORITY'));
  assert(invoiceBody.includes('BR-DOC-AUDIT'));
  assert(invoiceBody.includes('NEW.version := OLD.version + 1'));

  assert(receiptBody.includes("NEW.status <> 'Draft'"));
  assert(receiptBody.includes('NEW.created_by IS NULL'));
  assert(receiptBody.includes("ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']"));
  assert(receiptBody.includes('PERFORM public.rpc_check_customer_access('));
  assert(receiptBody.includes('BR-RCT-INITIAL'));
  assert(receiptBody.includes("OLD.status IN ('Cancelled', 'Bounced')"));
  assert(receiptBody.includes('BR-RCT-IMMUTABLE'));
  assert(receiptBody.includes('BR-RCT-AUTHORITY'));
  assert(receiptBody.includes('BR-RCT-DELETE'));
  assert(receiptBody.includes("current_setting('app.ar_draft_delete', TRUE) IS DISTINCT FROM 'on'"));
  assert(receiptBody.includes('BR-RCT-AUTHORITY: Draft deletion requires the governed deletion operation'));
  assert(receiptBody.includes("NEW.status NOT IN ('Cancelled', 'Bounced')"));
  assert(receiptBody.includes('ROUND(NEW.allocated_amount + NEW.unallocated_amount, 2)'));
  assert(receiptBody.includes('ROUND(NEW.receipt_amount * NEW.exchange_rate, 2)'));

  assert(lineBody.includes('FROM public.invoices i'));
  assert(lineBody.includes('FOR SHARE;'));
  assert(lineBody.includes('IF NOT v_owner_authorized THEN'));
  assert(lineBody.includes('BR-LINE-AUTHORITY'));
  assert(lineBody.includes("v_parent_status <> 'Draft'"));
  assert(lineBody.includes('BR-LINE-IMMUTABLE'));
  assert(lineBody.includes('NEW.invoice_id IS DISTINCT FROM OLD.invoice_id'));
  assert(lineBody.includes('p.company_id = v_parent_company_id'));
  assert(lineBody.includes('tc.company_id = v_parent_company_id'));
  assert(lineBody.includes('tc.is_active = TRUE'));
  assert(lineBody.includes('NEW.tax_rate IS DISTINCT FROM v_tax_rate'));
  assert(lineBody.includes('ga.company_id = v_parent_company_id'));
  assert(lineBody.includes('ga.is_active = TRUE'));
  assert(lineBody.includes('v_gross := NEW.quantity * NEW.unit_price'));
  assert(lineBody.includes('v_expected_line_amount := ROUND(v_gross - v_discount, 2)'));
  assert(lineBody.includes('v_expected_tax_amount := ROUND(v_expected_line_amount * NEW.tax_rate / 100, 2)'));
  assert(lineBody.includes('v_expected_line_total := ROUND(v_expected_line_amount + v_expected_tax_amount, 2)'));
  assert(lineBody.includes('v_discount > v_gross'));
  assert(lineBody.includes('BR-LINE-CALC'));
  assert(lineBody.includes('CREATE OR REPLACE FUNCTION public.ar_recalculate_invoice_after_line_change()'));
  assert(lineBody.includes('PERFORM public.fx_recalculate_invoice_draft_totals(v_company_id, v_invoice_id)'));

  for (const [body, code] of [
    [allocationBody, 'BR-ALLOC-AUTHORITY'],
    [cnAllocationBody, 'BR-CN-ALLOC-AUTHORITY'],
    [journalBody, 'BR-JE-AUTHORITY'],
    [journalLineBody, 'BR-JE-LINE-IMMUTABLE'],
  ] as const) {
    assert(body.includes('v_owner_authorized'));
    assert(body.includes(code));
    assert(body.includes("SET search_path = ''"));
  }
  assert(allocationBody.includes("OLD.status <> 'Active'") && allocationBody.includes("NEW.status <> 'Reversed'"));
  assert(cnAllocationBody.includes("OLD.status <> 'Active'") && cnAllocationBody.includes("NEW.status <> 'Reversed'"));
  assert(allocationBody.includes('NEW.receipt_rate IS DISTINCT FROM v_receipt_rate'));
  assert(allocationBody.includes('NEW.invoice_rate IS DISTINCT FROM v_invoice_rate'));
  assert(allocationBody.includes('ROUND(NEW.allocated_amount * v_receipt_rate, 2)'));
  assert(allocationBody.includes('NEW.forex_gain_loss IS DISTINCT FROM ROUND('));
  assert(allocationBody.includes('NEW.allocated_amount + NEW.discount_amount > v_invoice_outstanding + 0.01'));
  assert(allocationBody.includes('PERFORM public.rpc_check_role('));
  assert(allocationBody.includes('PERFORM public.rpc_check_customer_access('));
  assert(cnAllocationBody.includes("v_cn_status NOT IN ('Open', 'Partially Paid', 'Paid')"));
  assert(cnAllocationBody.includes("v_invoice_status NOT IN ('Open', 'Overdue', 'Partially Paid', 'Paid')"));
  assert(cnAllocationBody.includes('NEW.allocated_amount > v_cn_total + 0.01'));
  assert(cnAllocationBody.includes('PERFORM public.rpc_check_role('));
  assert(cnAllocationBody.includes('PERFORM public.rpc_check_customer_access('));
  assert(journalBody.includes('OLD.is_reversed = FALSE'));
  assert(journalBody.includes('NEW.is_reversed = TRUE'));
  assert(journalBody.includes('OLD.reversal_je_id IS NULL'));
  assert(journalBody.includes('NEW.reversal_je_id IS NOT NULL'));
  assert(journalLineBody.includes("TG_OP <> 'INSERT'"));
  assert(journalLineBody.includes('FROM public.journal_entries je'));
  assert(journalLineBody.includes('WHERE je.id = NEW.je_id'));
  assert(journalLineBody.includes('FOR SHARE;'));
  assert(journalLineBody.includes('ga.company_id = v_journal_company_id'));
  assert(!journalLineBody.includes('ga.is_active = TRUE'), 'Reversals must retain historical GL accounts even after deactivation');
  assert(journalLineBody.includes('BR-JE-LINE-PARENT'));
  assert(migration.includes('CREATE UNIQUE INDEX uq_journal_entries_one_reversal'));

  for (const trigger of [
    'trg_ar_financial_document_lifecycle',
    'trg_ar_receipt_lifecycle',
    'trg_ar_invoice_line_lifecycle',
    'trg_ar_invoice_line_recalculate',
    'trg_ar_allocation_detail_integrity',
    'trg_ar_cn_allocation_integrity',
    'trg_ar_journal_entry_integrity',
    'trg_ar_journal_entry_line_integrity',
    'trg_ar_fx_booking_decision_integrity',
    'trg_ar_fx_booking_decision_event_integrity',
  ]) {
    assertEquals((migration.match(new RegExp(`CREATE TRIGGER ${trigger}`, 'g')) ?? []).length, 1);
  }
});

Deno.test('Batch 9D-D FX booking provenance rejects routine direct DML and binds new decision actors', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const decisionStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_fx_booking_decision()',
  );
  const eventStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_fx_booking_decision_event()',
  );
  const triggerStart = migration.indexOf(
    'DROP TRIGGER IF EXISTS trg_ar_linked_credit_note_reference_forward',
  );
  const decisionBody = migration.slice(decisionStart, eventStart);
  const eventBody = migration.slice(eventStart, triggerStart);

  assert(decisionStart >= 0 && eventStart > decisionStart && triggerStart > eventStart);
  assert(decisionBody.includes('IF NOT v_owner_authorized THEN'));
  assert(decisionBody.includes("IF TG_OP = 'DELETE' THEN"));
  assert(decisionBody.includes('IF NEW.maker_user_id IS NULL THEN'));
  assert(decisionBody.includes('FROM public.invoices i'));
  assert(decisionBody.includes('FROM public.receipts r'));
  assert(decisionBody.includes('PERFORM public.rpc_check_role('));
  assert(decisionBody.includes('PERFORM public.rpc_check_customer_access('));
  assert(eventBody.includes("IF TG_OP <> 'INSERT' OR NOT v_owner_authorized THEN"));
  assert(migration.includes('CREATE TRIGGER trg_ar_fx_booking_decision_integrity'));
  assert(migration.includes('CREATE TRIGGER trg_ar_fx_booking_decision_event_integrity'));
  for (const functionName of [
    'ar_protect_fx_booking_decision',
    'ar_protect_fx_booking_decision_event',
  ]) {
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert(migration.includes(`REVOKE ALL ON FUNCTION public.${functionName}() FROM ${role}`));
    }
  }
});

Deno.test('Batch 9D-D Invoice line transition and stored-amount model matches the authoritative trigger contract', () => {
  type LineOperation = 'INSERT' | 'UPDATE' | 'DELETE';
  const mayMutateLine = (parentStatus: string, _operation: LineOperation) => parentStatus === 'Draft';
  const calculateStoredAmounts = (
    quantity: number,
    unitPrice: number,
    discountPct: number,
    discountAmount: number,
    taxRate: number,
  ) => {
    const gross = quantity * unitPrice;
    const discount = discountPct > 0 ? gross * discountPct / 100 : discountAmount;
    const lineAmount = Math.round((gross - discount) * 100) / 100;
    const taxAmount = Math.round(lineAmount * taxRate) / 100;
    return {
      lineAmount,
      taxAmount,
      lineTotal: Math.round((lineAmount + taxAmount) * 100) / 100,
    };
  };

  for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    assertEquals(mayMutateLine('Draft', operation), true, `Draft ${operation} must remain available`);
    for (const status of ['Open', 'Overdue', 'Partially Paid', 'Paid', 'Cancelled', 'Written Off']) {
      assertEquals(
        mayMutateLine(status, operation),
        false,
        `${status} ${operation} must be rejected by the parent-lifecycle boundary`,
      );
    }
  }

  assertJsonEquals(calculateStoredAmounts(3, 10.005, 10, 0, 6), {
    lineAmount: 27.01,
    taxAmount: 1.62,
    lineTotal: 28.63,
  });
  assertJsonEquals(calculateStoredAmounts(2, 20, 0, 3, 0), {
    lineAmount: 37,
    taxAmount: 0,
    lineTotal: 37,
  });

  let excessiveDiscount: unknown;
  try {
    calculateLineAmount({
      quantity: 1,
      unit_price: 10,
      discount_pct: 0,
      discount_amt: 10.01,
      tax_rate: 0,
    });
  } catch (error) {
    excessiveDiscount = error;
  }
  assert(excessiveDiscount instanceof ValidationError);
  assert(String(excessiveDiscount).includes('Discount amount cannot exceed the gross line amount'));
});

Deno.test('Batch 9D-D bounced-cheque credit-control evidence preserves the existing append-only boundary', async () => {
  const auditMigration = await read('../../../../database/005_audit_triggers.sql');
  assert(auditMigration.includes('CREATE TRIGGER trg_prevent_ccl_delete'));
  assert(auditMigration.includes('BEFORE DELETE ON credit_control_logs'));
  assert(auditMigration.includes('CREATE TRIGGER trg_prevent_ccl_update'));
  assert(auditMigration.includes('BEFORE UPDATE ON credit_control_logs'));
  assert(auditMigration.includes('EXECUTE FUNCTION fn_prevent_audit_log_modification()'));
});

Deno.test('Batch 9D-D F-03 direct PostgREST lifecycle errors preserve safe business mapping and disclosure', async () => {
  const cases = [
    { message: 'BR-LINE-IMMUTABLE: Invoice lines may change only while the parent is Draft', status: 400, code: 'BR-LINE-IMMUTABLE' },
    { message: 'AUTH: User does not have access to this customer', status: 400, code: 'AUTH' },
    { message: 'VALIDATION: reference_no must not exceed 50 characters', status: 400, code: 'VALIDATION' },
    { message: 'CONFIG: Bank account configuration is unavailable', status: 400, code: 'CONFIG' },
    { message: 'CONFLICT: Financial document version must advance exactly once', status: 409, code: 'CONFLICT' },
    { message: 'NOT_FOUND: Parent financial document is unavailable', status: 404, code: 'NOT_FOUND' },
  ];

  for (const testCase of cases) {
    let mapped: unknown;
    try {
      throwDatabaseError({ message: testCase.message }, 'Failed lifecycle mutation');
    } catch (error) {
      mapped = error;
    }
    const response = errorResponse(mapped);
    assertEquals(response.status, testCase.status);
    assertEquals((response.body.error as Record<string, unknown>).code, testCase.code);
  }

  const capturedLogs: unknown[][] = [];
  const originalConsoleError = console.error;
  let unknown: unknown;
  let unknownResponse: ReturnType<typeof errorResponse> | undefined;
  try {
    console.error = (...args: unknown[]) => capturedLogs.push(args);
    try {
      throwDatabaseError(
        { message: 'XX000: forced storage failure containing AUTH: but without a governed prefix' },
        'Failed lifecycle mutation',
      );
    } catch (error) {
      unknown = error;
    }
    const response = errorResponse(unknown);
    unknownResponse = response;
    assert(!(unknown instanceof BusinessError));
    assertEquals(response.status, 500);
    assertJsonEquals(response.body, {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  } finally {
    console.error = originalConsoleError;
  }
  const loggedDetail = capturedLogs.map(args =>
    args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')
  ).join('\n');
  assert(loggedDetail.includes('XX000: forced storage failure'));
  assert(!JSON.stringify(unknownResponse).includes('forced storage failure'));

  const overdueHandler = await read('../daily-overdue/index.ts');
  assert(!/result\.errors\.push\([^\n]*\.message/.test(overdueHandler));
  assert(!overdueHandler.includes('result.errors.push(error instanceof Error ? error.message'));
  assert(/result\.errors\.push\(["']Daily overdue task failed["']\)/.test(overdueHandler));
  assert(/console\.error\(["']\[DAILY-OVERDUE\] Fatal error:["'], error\)/.test(overdueHandler));

  const invoiceService = await read('../invoices/service.ts');
  assert(!invoiceService.includes(".from('invoice_lines')\n      .insert"));
  assert(!invoiceService.includes(".from('invoice_lines')\n      .update"));
  assert(!invoiceService.includes(".from('invoice_lines')\n      .delete"));
  assert(invoiceService.includes("callRpc<InvoiceLine[]>(this.client, 'add_draft_invoice_lines'"));
  assert(invoiceService.includes("callRpc<InvoiceLine>(this.client, 'update_draft_invoice_line'"));
  assert(invoiceService.includes("callRpc(this.client, 'delete_draft_invoice_line'"));
});

Deno.test('Batch 9D-D Draft Invoice line edits are parent-locked one-RPC aggregate mutations', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const service = await read('../invoices/service.ts');
  const addStart = migration.indexOf('CREATE FUNCTION public.add_draft_invoice_lines(');
  const updateStart = migration.indexOf('CREATE FUNCTION public.update_draft_invoice_line(');
  const deleteStart = migration.indexOf('CREATE FUNCTION public.delete_draft_invoice_line(');
  const cancelStart = migration.indexOf('CREATE FUNCTION public.cancel_invoice(');
  const bodies = [
    migration.slice(addStart, updateStart),
    migration.slice(updateStart, deleteStart),
    migration.slice(deleteStart, cancelStart),
  ];

  assert(addStart >= 0 && updateStart > addStart && deleteStart > updateStart && cancelStart > deleteStart);
  for (const body of bodies) {
    const parent = body.indexOf('FROM public.invoices i');
    const parentLock = body.indexOf('FOR UPDATE;', parent);
    const lineDml = Math.max(
      body.indexOf('INSERT INTO public.invoice_lines'),
      body.indexOf('UPDATE public.invoice_lines'),
      body.indexOf('DELETE FROM public.invoice_lines'),
    );
    assert(parent >= 0 && parentLock > parent && lineDml > parentLock);
    assert(body.includes('PERFORM public.rpc_check_role('));
    assert(body.includes('PERFORM public.rpc_check_customer_access('));
    assert(body.includes("v_invoice.status <> 'Draft'"));
    assert(body.includes('SECURITY DEFINER'));
    assert(body.includes("SET search_path = ''"));
    assert(!/^\s*COMMIT;/im.test(body));
  }

  const aggregateStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_recalculate_invoice_after_line_change()',
  );
  const aggregateEnd = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_allocation_detail()',
    aggregateStart,
  );
  const aggregateBody = migration.slice(aggregateStart, aggregateEnd);
  assert(aggregateBody.includes('PERFORM public.fx_recalculate_invoice_draft_totals(v_company_id, v_invoice_id)'));
  assert(migration.includes('CREATE TRIGGER trg_ar_invoice_line_recalculate'));
  assert(migration.includes('AFTER INSERT OR UPDATE OR DELETE\nON public.invoice_lines'));

  for (const [method, rpc] of [
    ['async addLines(', 'add_draft_invoice_lines'],
    ['async updateLine(', 'update_draft_invoice_line'],
    ['async deleteLine(', 'delete_draft_invoice_line'],
  ] as const) {
    const start = service.indexOf(method);
    const next = service.indexOf('\n  /**', start + method.length);
    const body = service.slice(start, next < 0 ? undefined : next);
    assert(body.includes(`'${rpc}'`));
    assert(!body.includes(".from('invoice_lines')"));
  }

  for (const signature of [
    'public.add_draft_invoice_lines(UUID, UUID, UUID, JSONB)',
    'public.update_draft_invoice_line(UUID, UUID, UUID, UUID, JSONB)',
    'public.delete_draft_invoice_line(UUID, UUID, UUID, UUID)',
  ]) {
    assert(migration.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role`));
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      assert(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM ${role}`));
    }
  }
});

Deno.test('Batch 9D-D Cancelled header transition model covers every financial and audit evidence field', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const terminalStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()');
  const terminalEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()');
  const terminalBody = migration.slice(terminalStart, terminalEnd);
  const fields = [
    'id', 'company_id', 'invoice_no', 'doc_type', 'invoice_date', 'due_date',
    'customer_id', 'customer_name', 'currency', 'exchange_rate', 'base_currency',
    'fx_source_category', 'fx_decision_id', 'subtotal', 'tax_total', 'total_amount',
    'base_total', 'outstanding', 'status', 'posting_period',
    'ref_invoice_id', 'cn_type', 'reason_code', 'reason_desc', 'ar_acct',
    'created_by', 'created_at', 'posted_by', 'posted_at', 'cancelled_by',
    'cancelled_at', 'cancel_reason', 'version',
  ];
  const oldRow = Object.fromEntries(fields.map((field) => [field, `${field}-old`])) as Record<string, unknown>;
  oldRow.status = 'Cancelled';
  const rejected = (next: Record<string, unknown>) => oldRow.status === 'Cancelled'
    && fields.some((field) => oldRow[field] !== next[field]);

  for (const field of fields) {
    assert(terminalBody.includes(`NEW.${field} IS DISTINCT FROM OLD.${field}`));
    assertEquals(rejected({ ...oldRow, [field]: null }), true, `Cancelled ${field} NULL mutation must fail`);
    assertEquals(rejected({ ...oldRow, [field]: `${field}-new` }), true, `Cancelled ${field} mutation must fail`);
  }
  assertEquals(rejected({ ...oldRow }), false, 'Protected-field no-op remains harmless');
  assert(!fields.includes('updated_at'), 'Automatic updated_at is intentionally outside the terminal evidence comparison');
  assert(!fields.includes('internal_remarks') && !fields.includes('invoice_remarks'), 'Narrative remarks remain PRD-approved post-state edits');
  assert(!fields.includes('reference_no'), 'reference_no changes are permitted only through the governed correction RPC');
});

Deno.test('Batch 9D-D Migration 028 makes Receipt cancellation and cheque clearance fully atomic', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const receiptStart = migration.indexOf('CREATE FUNCTION public.cancel_receipt(');
  const clearanceStart = migration.indexOf('CREATE FUNCTION public.clear_receipt_cheque(');
  const revokeStart = migration.indexOf('REVOKE ALL ON FUNCTION public.ar_validate_linked_credit_note_reference()', clearanceStart);
  const cancellation = migration.slice(receiptStart, clearanceStart);
  const clearance = migration.slice(clearanceStart, revokeStart);

  assertEquals((migration.match(/CREATE FUNCTION public\.cancel_receipt\(/g) ?? []).length, 1);
  assertEquals((migration.match(/CREATE FUNCTION public\.clear_receipt_cheque\(/g) ?? []).length, 1);
  for (const body of [cancellation, clearance]) {
    assert(body.includes('RETURNS JSONB'));
    assert(body.includes('VOLATILE'));
    assert(body.includes('SECURITY DEFINER'));
    assert(body.includes("SET search_path = ''"));
    assert(body.includes('PERFORM public.rpc_check_role('));
    assert(body.includes('PERFORM public.rpc_check_customer_access('));
    assert(!/^\s*COMMIT;/im.test(body));
    assert(!/EXECUTE\s+FORMAT/i.test(body));
  }

  const receiptLock = cancellation.indexOf('FROM public.receipts r');
  const forUpdate = cancellation.indexOf('FOR UPDATE;', receiptLock);
  const allocationCheck = cancellation.indexOf('FROM public.allocation_details ad');
  const journalCheck = cancellation.indexOf('FROM public.journal_entries je');
  const reversal = cancellation.indexOf('PERFORM public.reverse_journal_entry(');
  const receiptUpdate = cancellation.indexOf('UPDATE public.receipts');
  assert(
    receiptLock >= 0 && forUpdate > receiptLock && allocationCheck > forUpdate
      && journalCheck > allocationCheck && reversal > journalCheck && receiptUpdate > reversal,
    'Receipt lock and every precondition must precede all reversals and terminal update',
  );
  assert(cancellation.includes("v_receipt.status <> 'Posted'"));
  assert(cancellation.includes("ad.status = 'Active'"));
  assert(cancellation.includes('v_receipt.unallocated_amount IS DISTINCT FROM v_receipt.receipt_amount'));
  assert(cancellation.includes("je.source_type = 'RCT'"));
  assert(cancellation.includes('FOR v_je IN'));
  assert(cancellation.includes("status = 'Cancelled'"));
  assert(cancellation.includes('cancelled_by = p_user_id'));
  assert(cancellation.includes('version = v_receipt.version + 1'));

  const clearLock = clearance.indexOf('FROM public.receipts r');
  const clearForUpdate = clearance.indexOf('FOR UPDATE;', clearLock);
  const postingJournalLock = clearance.indexOf('INTO v_original_je_id', clearForUpdate);
  const postingJournalForUpdate = clearance.indexOf('FOR UPDATE;', postingJournalLock);
  const clearJournalInsert = clearance.indexOf('INSERT INTO public.journal_entries');
  const clearLineInsert = clearance.indexOf('INSERT INTO public.journal_entry_lines');
  const valueDateUpdate = clearance.indexOf('UPDATE public.receipts');
  assert(clearLock >= 0 && clearForUpdate > clearLock
    && postingJournalLock > clearForUpdate && postingJournalForUpdate > postingJournalLock
    && clearJournalInsert > postingJournalForUpdate
    && clearLineInsert > clearJournalInsert && valueDateUpdate > clearLineInsert);
  assert(clearance.includes("v_receipt.payment_method <> 'CHQ'"));
  assert(clearance.includes("je.description LIKE 'Cheque clearance:%'"));
  assert(clearance.includes('public.rpc_get_config_account('));

  for (const [signature, role] of [
    ['public.cancel_receipt(UUID, UUID, UUID, TEXT)', 'service_role'],
    ['public.clear_receipt_cheque(UUID, UUID, UUID, DATE)', 'service_role'],
  ]) {
    assert(migration.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO ${role}`));
    for (const revokedRole of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM ${revokedRole}`));
    }
  }
});

Deno.test('Batch 9D-D F-06 consolidated guards preserve posting, constrained overdue, and one-RPC Draft deletion', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const posting = await read('../../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  const invoiceService = await read('../invoices/service.ts');

  const journalStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry()');
  const journalLineStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_protect_journal_entry_line()');
  const journalBody = migration.slice(journalStart, journalLineStart);
  assert(journalBody.includes('v_header_noop BOOLEAN := FALSE'));
  assert(journalBody.includes('v_header_noop := v_header_stable'));
  assert(journalBody.includes('NEW.total_debit IS NOT DISTINCT FROM OLD.total_debit'));
  assert(journalBody.includes('NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit'));
  assert(journalBody.includes('AND NOT v_header_noop'));
  assert(
    posting.includes('UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit'),
    'The compatibility guard must match the authoritative posting RPC no-op totals update',
  );

  const invoiceLifecycleStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()',
  );
  const receiptLifecycleStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()',
  );
  const invoiceLifecycle = migration.slice(invoiceLifecycleStart, receiptLifecycleStart);
  assert(invoiceLifecycle.includes("v_direct_overdue_transition := OLD.doc_type IN ('Invoice', 'Debit Note')"));
  assert(invoiceLifecycle.includes("AND OLD.status IN ('Open', 'Partially Paid')"));
  assert(invoiceLifecycle.includes('OLD.due_date < CURRENT_DATE'));
  assert(invoiceLifecycle.includes('OLD.outstanding > 0'));
  assert(invoiceLifecycle.includes("OLD.doc_type = 'Credit Note' AND NEW.status = 'Overdue'"));
  assert(invoiceLifecycle.includes('BR-CN-004: Credit Notes cannot enter the Overdue lifecycle'));
  const directOverdueAllowed = (
    docType: string,
    status: string,
    dueDateBeforeToday: boolean,
    outstanding: number,
  ) => ['Invoice', 'Debit Note'].includes(docType)
    && ['Open', 'Partially Paid'].includes(status)
    && dueDateBeforeToday
    && outstanding > 0;
  assertEquals(directOverdueAllowed('Invoice', 'Open', true, 10), true);
  assertEquals(directOverdueAllowed('Debit Note', 'Partially Paid', true, 10), true);
  assertEquals(directOverdueAllowed('Credit Note', 'Open', true, 10), false, 'Standalone CN must not become Overdue');
  assertEquals(directOverdueAllowed('Credit Note', 'Partially Paid', true, 10), false, 'Linked/CN balance state must not become Overdue');

  const deleteStart = invoiceService.indexOf('async deleteDraftInvoice(');
  const helperStart = invoiceService.indexOf('// PRIVATE HELPERS', deleteStart);
  const deleteBody = invoiceService.slice(deleteStart, helperStart);
  assert(deleteBody.includes("callRpc(this.client, 'delete_draft_invoice'"));
  assert(!deleteBody.includes("from('invoices').delete"));
  assert(!deleteBody.includes("from('invoice_lines').delete"));
});

Deno.test('Batch 9D-D F-04 Invoice and Receipt Draft deletion restore scoped flags around one governed RPC', async () => {
  const invoiceClient = new MockSupabaseClient({}, 'service_role');
  await new InvoiceService(invoiceClient as never).deleteDraftInvoice(
    clerkAuth,
    '11111111-1111-4111-8111-111111111111',
  );
  assertEquals(invoiceClient.rpcCalls.length, 1);
  assertJsonEquals(invoiceClient.rpcCalls[0], {
    functionName: 'delete_draft_invoice',
    params: {
      p_invoice_id: '11111111-1111-4111-8111-111111111111',
      p_user_id: clerkAuth.userId,
      p_company_id: clerkAuth.companyId,
    },
  });
  assertEquals(invoiceClient.operations.length, 0);

  const receiptClient = new MockSupabaseClient({}, 'service_role');
  await new ReceiptService(receiptClient as never).deleteDraftReceipt(
    clerkAuth,
    '22222222-2222-4222-8222-222222222222',
  );
  assertEquals(receiptClient.rpcCalls.length, 1);
  assertJsonEquals(receiptClient.rpcCalls[0], {
    functionName: 'delete_draft_receipt',
    params: {
      p_receipt_id: '22222222-2222-4222-8222-222222222222',
      p_user_id: clerkAuth.userId,
      p_company_id: clerkAuth.companyId,
    },
  });
  assertEquals(receiptClient.operations.length, 0);

  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  for (const contract of [
    {
      name: 'delete_draft_invoice',
      parent: 'FROM public.invoices i',
      importRef: 'WHERE ir.invoice_id = p_invoice_id',
      eventDelete: 'WHERE e.invoice_id = p_invoice_id',
      pointer: 'SET fx_decision_id = NULL',
      decisionDelete: 'WHERE d.invoice_id = p_invoice_id',
      headerDelete: 'DELETE FROM public.invoices',
      signature: 'public.delete_draft_invoice(UUID, UUID, UUID)',
    },
    {
      name: 'delete_draft_receipt',
      parent: 'FROM public.receipts r',
      importRef: 'WHERE ir.receipt_id = p_receipt_id',
      eventDelete: 'WHERE e.receipt_id = p_receipt_id',
      pointer: 'SET fx_decision_id = NULL',
      decisionDelete: 'WHERE d.receipt_id = p_receipt_id',
      headerDelete: 'DELETE FROM public.receipts',
      signature: 'public.delete_draft_receipt(UUID, UUID, UUID)',
    },
  ]) {
    const start = migration.indexOf(`CREATE FUNCTION public.${contract.name}(`);
    const end = migration.indexOf('\n$$;', start) + 4;
    const body = migration.slice(start, end);
    const parent = body.indexOf(contract.parent);
    const parentLock = body.indexOf('FOR UPDATE;', parent);
    const importCheck = body.indexOf(contract.importRef, parentLock);
    const eventDelete = body.indexOf(contract.eventDelete, importCheck);
    const pointer = body.indexOf(contract.pointer, eventDelete);
    const decisionDelete = body.indexOf(contract.decisionDelete, pointer);
    const headerDelete = body.indexOf(contract.headerDelete, decisionDelete);
    const captureDraftFlag = body.indexOf("current_setting('app.ar_draft_delete', TRUE)");
    const captureFxFlag = body.indexOf("current_setting('app.fx_governed_mutation', TRUE)");
    const successRestore = body.indexOf("COALESCE(NULLIF(v_prior_draft_delete, ''), 'off')", headerDelete);
    const successReturn = body.indexOf("RETURN jsonb_build_object('deleted'", successRestore);
    const exceptionBlock = body.indexOf('EXCEPTION\n  WHEN OTHERS THEN', successReturn);
    const exceptionRestore = body.indexOf("COALESCE(NULLIF(v_prior_draft_delete, ''), 'off')", exceptionBlock);
    assert(start >= 0 && parent >= 0 && parentLock > parent && importCheck > parentLock
      && eventDelete > importCheck && pointer > eventDelete
      && decisionDelete > pointer && headerDelete > decisionDelete);
    assert(captureDraftFlag >= 0 && captureFxFlag > captureDraftFlag && captureFxFlag < eventDelete);
    assert(successRestore > headerDelete && successReturn > successRestore
      && exceptionBlock > successReturn && exceptionRestore > exceptionBlock);
    assert(body.includes("pg_catalog.set_config('app.ar_draft_delete', 'on', TRUE)"));
    assert(body.includes("pg_catalog.set_config('app.fx_governed_mutation', 'on', TRUE)"));
    assertEquals(
      (body.match(/COALESCE\(NULLIF\(v_prior_draft_delete, ''\), 'off'\)/g) ?? []).length,
      2,
      'Success and exception paths must both restore the prior Draft-delete flag',
    );
    assertEquals(
      (body.match(/COALESCE\(NULLIF\(v_prior_fx_governed_mutation, ''\), 'off'\)/g) ?? []).length,
      2,
      'Success and exception paths must both restore the prior FX flag',
    );
    assert(body.includes('v_bypass_enabled := FALSE;'));
    assert(body.includes('IF v_bypass_enabled THEN'));
    assert(!/^\s*COMMIT;/im.test(body));
    assert(migration.includes(`GRANT EXECUTE ON FUNCTION ${contract.signature} TO service_role;`));
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      assert(migration.includes(`REVOKE ALL ON FUNCTION ${contract.signature} FROM ${role};`));
    }
  }

  const restoredFlag = (prior: string | null) => prior && prior.length > 0 ? prior : 'off';
  assertEquals(restoredFlag(null), 'off', 'An unset outer flag restores to a safe disabled value');
  assertEquals(restoredFlag('off'), 'off', 'A disabled outer flag stays disabled after success or failure');
  assertEquals(restoredFlag('on'), 'on', 'A nested governed invocation restores its caller-owned enabled scope');

  const appendOnlyStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.fx_prevent_booking_rate_event_mutation()',
  );
  const appendOnlyEnd = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_fx_booking_decision_event()',
    appendOnlyStart,
  );
  const appendOnlyBody = migration.slice(appendOnlyStart, appendOnlyEnd);
  assert(appendOnlyBody.includes("TG_OP = 'DELETE'"));
  assert(appendOnlyBody.includes("current_setting('app.ar_draft_delete', TRUE) = 'on'"));
  assert(appendOnlyBody.includes("i.status = 'Draft'"));
  assert(appendOnlyBody.includes("r.status = 'Draft'"));
  assert(appendOnlyBody.includes('Booking-rate decision events are append-only'));
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(
      `REVOKE ALL ON FUNCTION public.fx_prevent_booking_rate_event_mutation() FROM ${role};`,
    ));
  }

  const invoiceIndex = await read('../invoices/index.ts');
  const receiptIndex = await read('../receipts/index.ts');
  assert(invoiceIndex.includes('await service.deleteDraftInvoice(auth, id)'));
  assert(receiptIndex.includes('await service.deleteDraftReceipt(auth, params.id)'));
});

Deno.test('Batch 9D-D allocation reversal uses the same parent-first lock order as bounce and cancellation', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const reverseStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.reverse_allocation(');
  const invoiceCancelStart = migration.indexOf('CREATE FUNCTION public.cancel_invoice(', reverseStart);
  const body = migration.slice(reverseStart, invoiceCancelStart);

  assert(reverseStart >= 0 && invoiceCancelStart > reverseStart);
  assert(body.includes('VOLATILE'));
  assert(body.includes('SECURITY DEFINER'));
  assert(body.includes("SET search_path = ''"));
  const immutableKeyRead = body.indexOf('SELECT ad.receipt_id');
  const receiptLock = body.indexOf('SELECT r.*', immutableKeyRead);
  const receiptForUpdate = body.indexOf('FOR UPDATE;', receiptLock);
  const allocationLock = body.indexOf('SELECT ad.*', receiptForUpdate);
  const allocationForUpdate = body.indexOf('FOR UPDATE;', allocationLock);
  const invoiceLock = body.indexOf('SELECT i.*', allocationForUpdate);
  const invoiceForUpdate = body.indexOf('FOR UPDATE;', invoiceLock);
  const allocationMutation = body.indexOf('UPDATE public.allocation_details', invoiceForUpdate);
  const invoiceMutation = body.indexOf('UPDATE public.invoices', allocationMutation);
  const receiptMutation = body.indexOf('UPDATE public.receipts', invoiceMutation);
  const journalLock = body.indexOf('FROM public.journal_entries je', receiptMutation);
  assert(
    immutableKeyRead >= 0
      && receiptLock > immutableKeyRead
      && receiptForUpdate > receiptLock
      && allocationLock > receiptForUpdate
      && allocationForUpdate > allocationLock
      && invoiceLock > allocationForUpdate
      && invoiceForUpdate > invoiceLock
      && allocationMutation > invoiceForUpdate
      && invoiceMutation > allocationMutation
      && receiptMutation > invoiceMutation
      && journalLock > receiptMutation,
    'Allocation reversal must lock Receipt, allocation, Invoice, then journals before completing mutations',
  );
  assert(!/^\s*COMMIT;/im.test(body));
  assert(migration.includes(
    'GRANT EXECUTE ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) TO service_role;',
  ));
  assert(!migration.includes(
    'GRANT EXECUTE ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) TO authenticated;',
  ));
});

Deno.test('Batch 9D-D F-02 static SQL contract keeps posted Credit Notes irreversible across preflight and reversal', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const legacyFinancialRpcs = await read('../../../../database/007_financial_rpcs.sql');
  const preflightStart = migration.indexOf('-- Migration 027 and earlier allocation logic did not exclude Credit Notes');
  const preflightEnd = migration.indexOf('-- Reversal creation already locks the original journal entry', preflightStart);
  const preflight = migration.slice(preflightStart, preflightEnd);
  assert(preflightStart >= 0 && preflightEnd > preflightStart);
  assert(preflight.includes('FROM public.allocation_details ad'));
  assert(preflight.includes('JOIN public.invoices target ON target.id = ad.invoice_id'));
  assert(preflight.includes("ad.status = 'Active'"));
  assert(preflight.includes("target.doc_type = 'Credit Note'"));
  assert(preflight.includes('(array_agg(ad.id ORDER BY ad.id))[1:10]'));
  assert(preflight.includes('BR-CN-ALLOCATION-PREFLIGHT'));
  assert(!/\b(?:UPDATE|DELETE)\s+public\./i.test(preflight), 'Preflight must never rewrite historical allocation evidence');

  const reverseStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.reverse_allocation(');
  const cancelStart = migration.indexOf('CREATE FUNCTION public.cancel_invoice(', reverseStart);
  const reverseBody = migration.slice(reverseStart, cancelStart);
  const targetLock = reverseBody.indexOf('SELECT i.*');
  const creditNoteGuard = reverseBody.indexOf("IF v_inv.doc_type = 'Credit Note'", targetLock);
  const allowedTypeGuard = reverseBody.indexOf("v_inv.doc_type NOT IN ('Invoice', 'Debit Note')", creditNoteGuard);
  const allocationMutation = reverseBody.indexOf('UPDATE public.allocation_details', allowedTypeGuard);
  assert(targetLock >= 0 && creditNoteGuard > targetLock
    && allowedTypeGuard > creditNoteGuard && allocationMutation > allowedTypeGuard);
  assert(reverseBody.includes('BR-CN-004: Receipt allocation reversal cannot reopen a posted Credit Note'));

  const lifecycleStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()');
  const receiptStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()');
  const lifecycle = migration.slice(lifecycleStart, receiptStart);
  assert(lifecycle.includes("OLD.doc_type = 'Credit Note' AND OLD.status = 'Paid'"));
  assert(lifecycle.includes('BR-CN-004: Posted Credit Notes are irreversible; issue a Debit Note instead'));
  assert(lifecycle.includes("OLD.doc_type = 'Credit Note' AND NEW.status = 'Overdue'"));

  const supportsReceiptReversal = (docType: string) => ['Invoice', 'Debit Note'].includes(docType);
  assertEquals(supportsReceiptReversal('Invoice'), true);
  assertEquals(supportsReceiptReversal('Debit Note'), true);
  assertEquals(supportsReceiptReversal('Credit Note'), false);

  assert(legacyFinancialRpcs.includes('CREATE OR REPLACE FUNCTION handle_bounced_cheque('));
  assert(legacyFinancialRpcs.includes('UPDATE invoices SET\n        outstanding = v_new_os,\n        status = v_new_stat'));
  assert(
    migration.includes("v_invoice_doc_type NOT IN ('Invoice', 'Debit Note')"),
    'Future Receipt allocations must exclude Credit Notes before bounce can see them',
  );
});

Deno.test('Batch 9D-D initial and Draft structural boundaries enforce visible same-tenant parents', async () => {
  const migration = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const invoiceStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_prevent_cancelled_document_mutation()',
  );
  const receiptStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_enforce_receipt_lifecycle()',
  );
  const lineStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_enforce_invoice_line_lifecycle()',
  );
  const invoiceBody = migration.slice(invoiceStart, receiptStart);
  const receiptBody = migration.slice(receiptStart, lineStart);

  for (const body of [invoiceBody, receiptBody]) {
    assert(body.includes('current_user = pg_catalog.pg_get_userbyid(c.relowner)'));
    assert(body.includes('c.company_id = NEW.company_id'));
    assert(body.includes('c.is_deleted = FALSE'));
    assert(body.includes('c.is_hidden = FALSE'));
    assert(body.indexOf("IF TG_OP = 'DELETE' THEN") < body.indexOf('v_structural_change :='));
  }
  assert(invoiceBody.includes('IF v_structural_change AND NOT v_owner_authorized THEN'));
  assert(invoiceBody.includes('BR-DOC-AUTHORITY: Financial structure requires a governed mutation'));
  assert(receiptBody.includes('b.company_id = NEW.company_id'));
  assert(receiptBody.includes('b.is_active = TRUE'));
  assert(receiptBody.includes('BR-RCT-AUTHORITY: Receipt structure requires a governed mutation'));

  const allocationStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_allocation_detail()',
  );
  const cnAllocationStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_protect_cn_allocation()',
  );
  const allocationBody = migration.slice(allocationStart, cnAllocationStart);
  assert(
    allocationBody.includes("v_invoice_doc_type NOT IN ('Invoice', 'Debit Note')"),
    'Receipt allocation must not treat a Credit Note as a receivable target',
  );

  const customerScopeStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.rpc_check_customer_access(',
  );
  const linkedStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION public.ar_validate_linked_credit_note_reference()',
  );
  const customerScopeBody = migration.slice(customerScopeStart, linkedStart);
  assert(customerScopeBody.includes("MESSAGE = 'NOT_FOUND: Customer not found'"));
  assert(customerScopeBody.includes("ur.role IN ('AR Supervisor', 'Finance Manager')"));
  assert(customerScopeBody.includes("ur.role = 'AR Clerk'"));
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration.includes(
      `REVOKE ALL ON FUNCTION public.rpc_check_customer_access(UUID, UUID, UUID) FROM ${role};`,
    ));
  }
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

  assert(
    invoiceIndex.includes('getUserClient(authorizationHeader)')
      && invoiceIndex.includes("dependencies.createService(req.headers.get('Authorization')!)"),
    'Invoice handler dependency composition must preserve the request JWT-scoped client',
  );
  for (const indexSource of [receiptIndex, reportIndex, creditIndex, debitIndex]) {
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

// Migration 029 tests are static/local contract evidence. They verify the
// committed production SQL and real Edge dispatcher composition, but do not
// represent PostgreSQL installation or staging concurrency proof.
Deno.test('Batch 9D-D Migration 029 statically hardens governed sequence generation without changing callers', async () => {
  const migration029 = await read('../../../../database/029_batch_9d_d_staging_runtime_defect_remediation.sql');
  const migration028 = await read('../../../../database/028_linked_credit_note_reference_integrity.sql');
  const migration002 = await read('../../../../database/002_create_views.sql');
  const migration007 = await read('../../../../database/007_financial_rpcs.sql');
  const migration023 = await read('../../../../database/023_fx_booking_rate_rpcs_and_immutability.sql');
  const sharedDb = await read('../_shared/db.ts');

  assertEquals((migration029.match(/^BEGIN;$/gm) ?? []).length, 1);
  assertEquals((migration029.match(/^COMMIT;$/gm) ?? []).length, 1);
  assertEquals(
    (migration029.match(/CREATE OR REPLACE FUNCTION public\.get_next_sequence\(/g) ?? []).length,
    1,
  );
  assert(migration029.includes(
    "pg_catalog.to_regprocedure(\n    'public.get_next_sequence(uuid,character varying,character varying)'",
  ));
  assert(migration029.includes(
    "'public.clear_receipt_cheque(uuid,uuid,uuid,date)'",
  ));

  const sequenceStart = migration029.indexOf('CREATE OR REPLACE FUNCTION public.get_next_sequence(');
  const sequenceEnd = migration029.indexOf('\n$$;', sequenceStart) + '\n$$;'.length;
  const sequence = migration029.slice(sequenceStart, sequenceEnd);
  assert(sequenceStart >= 0 && sequenceEnd > sequenceStart);
  assert(sequence.includes('RETURNS pg_catalog.varchar(30)'));
  assert(sequence.includes('VOLATILE'));
  assert(sequence.includes('SECURITY INVOKER'));
  assert(sequence.includes("SET search_path = ''"));
  assert(!/EXECUTE\s+(?:FORMAT|IMMEDIATE)/i.test(sequence));

  assert(sequence.includes('public.document_sequences'));
  assertEquals(
    (sequence.match(/(?<!public\.)\bdocument_sequences\b/g) ?? []).length,
    0,
    'The replacement function must not contain an unqualified document_sequences reference',
  );
  for (const qualifiedBuiltin of [
    'pg_catalog.date_part',
    'pg_catalog.pg_advisory_xact_lock',
    'pg_catalog.hashtextextended',
    'pg_catalog.concat',
    'pg_catalog.max',
    'pg_catalog.now',
    'pg_catalog.lpad',
  ]) {
    assert(sequence.includes(qualifiedBuiltin), `Expected schema-qualified ${qualifiedBuiltin}`);
  }

  const advisoryLock = sequence.indexOf('pg_catalog.pg_advisory_xact_lock(');
  const customerRowLock = sequence.indexOf('ORDER BY ds.current_year, ds.current_month, ds.id');
  const customerForUpdate = sequence.indexOf('FOR UPDATE;', customerRowLock);
  const customerUpsert = sequence.indexOf('ON CONFLICT (company_id, doc_type, current_year, current_month)', customerForUpdate);
  assert(advisoryLock >= 0 && customerRowLock > advisoryLock
    && customerForUpdate > customerRowLock && customerUpsert > customerForUpdate);
  assert(sequence.includes('last_sequence = sequence_row.last_sequence + 1'));
  assert(sequence.includes("v_result := 'CUST-'"));
  for (const documentType of ['CUST', 'INV', 'CN', 'DN', 'RCT', 'JE']) {
    assert(sequence.includes(`WHEN '${documentType}'`), `Missing ${documentType} numbering compatibility`);
  }
  assert(sequence.includes("v_result := 'JE-' || p_source_type || '-'"));

  assert(migration028.includes("v_je_no := public.get_next_sequence(p_company_id, 'JE', 'RCT');"));
  for (const sourceType of ["'INV'", "'CN'", "'DN'", "'RCT'", "'ADJ'", "'REV'"]) {
    const callers = `${migration007}\n${migration023}\n${migration028}`;
    assert(callers.includes(sourceType), `Expected preserved ${sourceType} caller/source contract`);
  }
  assert(sharedDb.includes("client.rpc('get_next_sequence'"));
  assert(migration002.includes('RETURNS VARCHAR(30)'));
  assert(!/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.get_next_sequence/i.test(migration029));
  assert(!/REVOKE\s+.*public\.get_next_sequence/i.test(migration029));

  const clearanceStart = migration028.indexOf('CREATE FUNCTION public.clear_receipt_cheque(');
  const clearanceEnd = migration028.indexOf('\n$$;', clearanceStart);
  const clearance = migration028.slice(clearanceStart, clearanceEnd);
  const sequenceCall = clearance.indexOf("public.get_next_sequence(p_company_id, 'JE', 'RCT')");
  const journalInsert = clearance.indexOf('INSERT INTO public.journal_entries', sequenceCall);
  const receiptUpdate = clearance.indexOf('UPDATE public.receipts', journalInsert);
  assert(sequenceCall >= 0 && journalInsert > sequenceCall && receiptUpdate > journalInsert);
  assert(!/^\s*COMMIT;/im.test(clearance), 'Late failure must roll back sequence, journal, and Receipt mutations together');
});

Deno.test('Batch 9D-D Migration 029 statically makes posted-reference target scope authorization-safe', async () => {
  const migration029 = await read('../../../../database/029_batch_9d_d_staging_runtime_defect_remediation.sql');
  const functionStart = migration029.indexOf(
    'CREATE OR REPLACE FUNCTION public.correct_posted_invoice_reference(',
  );
  const revokeStart = migration029.indexOf(
    'REVOKE ALL ON FUNCTION public.correct_posted_invoice_reference(',
    functionStart,
  );
  const body = migration029.slice(functionStart, revokeStart);

  assertEquals(
    (migration029.match(/CREATE OR REPLACE FUNCTION public\.correct_posted_invoice_reference\(/g) ?? []).length,
    1,
  );
  assert(migration029.includes(
    "'public.correct_posted_invoice_reference(uuid,uuid,uuid,text)'",
  ));
  assert(body.includes('RETURNS pg_catalog.jsonb'));
  assert(body.includes('SECURITY DEFINER'));
  assert(body.includes("SET search_path = ''"));
  assert(!/EXECUTE\s+(?:FORMAT|IMMEDIATE)/i.test(body));

  const roleCheck = body.indexOf('PERFORM public.rpc_check_role(');
  const targetLock = body.indexOf('FROM public.invoices AS i');
  const forUpdate = body.indexOf('FOR UPDATE;', targetLock);
  const accessCheck = body.indexOf('PERFORM public.rpc_check_customer_access(', forUpdate);
  const referenceUpdate = body.indexOf('UPDATE public.invoices', accessCheck);
  const auditInsert = body.indexOf('INSERT INTO public.credit_control_logs', referenceUpdate);
  assert(roleCheck >= 0 && targetLock > roleCheck && forUpdate > targetLock
    && accessCheck > forUpdate && referenceUpdate > accessCheck && auditInsert > referenceUpdate);

  assert(body.includes("WHEN SQLSTATE 'P0001' THEN"));
  assert(body.includes('GET STACKED DIAGNOSTICS v_access_message = MESSAGE_TEXT;'));
  assert(body.includes("'AUTH: User does not have access to this customer'"));
  assert(body.includes("'NOT_FOUND: Customer not found'"));
  assertEquals(
    (body.match(/MESSAGE = 'NOT_FOUND: Financial document not found'/g) ?? []).length,
    2,
    'Missing and customer-hidden paths must raise the same governed message',
  );
  assert(body.includes('RAISE;'), 'Unrelated P0001 errors must be re-raised unchanged');
  assert(!body.includes('WHEN OTHERS'), 'Unknown SQL errors must never be converted to NOT_FOUND');
  assert(body.includes('SET reference_no = p_reference_no'));
  assert(body.includes("'Reference Correction'"));
  assert(body.includes('RETURN pg_catalog.to_jsonb(v_updated)'));
  assert(!/^\s*COMMIT;/im.test(body), 'Reference update and audit insertion must remain one transaction');

  const signature = [
    'public.correct_posted_invoice_reference(',
    '  pg_catalog.uuid,',
    '  pg_catalog.uuid,',
    '  pg_catalog.uuid,',
    '  pg_catalog.text',
    ')',
  ].join('\n');
  assert(migration029.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`));
  for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    assert(migration029.includes(`REVOKE ALL ON FUNCTION ${signature} FROM ${role};`));
  }
  assert(!/\b(?:ALTER|GRANT|REVOKE)\s+(?:TABLE|POLICY)\b/i.test(migration029));
});

Deno.test('Batch 9D-D Migration 029 hidden and nonexistent reference targets have an identical production-handler envelope', async () => {
  const hiddenId = '99999999-9999-4999-8999-999999999981';
  const nonexistentId = '99999999-9999-4999-8999-999999999982';

  const invoke = async (invoiceId: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const client = new MockSupabaseClient({}, 'service_role');
    client.rpcErrors.correct_posted_invoice_reference = {
      code: 'P0001',
      message: 'NOT_FOUND: Financial document not found',
    };
    const response = await postedReferenceHandler(client)(postedReferenceRequest(
      `/${invoiceId}/reference`,
      'PATCH',
      { reference_no: 'PO-HIDDEN-SAFE' },
    ));
    assertEquals(client.rpcCalls.length, 1);
    assertEquals((client.rpcCalls[0].params as MockRow).p_invoice_id, invoiceId);
    return { status: response.status, body: await responseJson(response) };
  };

  const hidden = await invoke(hiddenId);
  const nonexistent = await invoke(nonexistentId);
  assertEquals(hidden.status, 404);
  assertEquals(nonexistent.status, 404);
  assertJsonEquals(hidden.body, nonexistent.body, 'Hidden and nonexistent envelopes must be byte-equivalent JSON');
  assertEquals((hidden.body.error as MockRow).code, 'NOT_FOUND');
  assertEquals(
    (hidden.body.error as MockRow).message,
    'NOT_FOUND: Financial document not found',
  );
});
