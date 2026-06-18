export type DashboardScope = 'assigned_customers' | 'company';
export type AgingBucketKey =
  | 'current'
  | '1_30'
  | '31_60'
  | '61_90'
  | 'over_90';

export interface DashboardMeta {
  company_id: string;
  base_currency: string;
  as_of_date: string;
  calculated_at: string;
  scope: DashboardScope;
  trend_months: number;
}

export interface DashboardKpis {
  total_outstanding_ar: number;
  overdue_outstanding: number;
  overdue_invoice_count: number;
  unapplied_cash: number;
  current_month_collections: number;
  current_month_posted_invoices: number;
  import_rows_needing_review: number;
}

export interface DashboardInvoiceStatusCounts {
  open: number;
  partially_paid: number;
  overdue_status: number;
  paid: number;
  unpaid_total: number;
}

export interface DashboardAgingBucket {
  key: AgingBucketKey;
  label: string;
  invoice_count: number;
  outstanding_base: number;
  percentage: number;
}

export interface DashboardCollectionTrendPoint {
  month: string;
  collected_base: number;
  receipt_count: number;
}

export interface DashboardTopCustomer {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  outstanding_base: number;
  overdue_base: number;
  overdue_invoice_count: number;
}

export interface DashboardCreditRatingRow {
  rating: 'AAA' | 'AA' | 'A' | 'B' | 'C' | 'D';
  customer_count: number;
  outstanding_base: number;
}

export interface LiveDashboardMetrics {
  meta: DashboardMeta;
  kpis: DashboardKpis;
  invoice_status_counts: DashboardInvoiceStatusCounts;
  aging_buckets: DashboardAgingBucket[];
  collection_trend: DashboardCollectionTrendPoint[];
  top_outstanding_customers: DashboardTopCustomer[];
  credit_rating_distribution: DashboardCreditRatingRow[];

  /** @deprecated Temporary compatibility alias. */
  total_invoices: number;
  /** @deprecated Temporary compatibility alias. */
  open_invoices: number;
  /** @deprecated Temporary compatibility alias. */
  overdue_invoices: number;
  /** @deprecated Preserves legacy receipt-count semantics. */
  total_receipts: number;
  /** @deprecated Preserves legacy transaction-currency semantics. */
  total_ar_balance: number;
  /** @deprecated Preserves legacy transaction-currency semantics. */
  total_overdue_balance: number;
  /** @deprecated Preserves legacy unapplied-receipt plus credit-note semantics. */
  total_credit_balance: number;
  /** @deprecated Temporary compatibility alias. */
  overdue_percentage: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGING_KEYS = new Set<AgingBucketKey>([
  'current',
  '1_30',
  '31_60',
  '61_90',
  'over_90',
]);
const RATINGS = new Set<DashboardCreditRatingRow['rating']>([
  'AAA',
  'AA',
  'A',
  'B',
  'C',
  'D',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Dashboard metrics response has invalid ${path}.`);
  }
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Dashboard metrics response has invalid ${path}.`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Dashboard metrics response has invalid ${path}.`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Dashboard metrics response has invalid ${path}.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  const number = requireNonNegativeNumber(value, path);
  if (!Number.isInteger(number)) {
    throw new Error(`Dashboard metrics response has invalid ${path}.`);
  }
  return number;
}

function validateMetricFields(
  value: Record<string, unknown>,
  integerFields: string[],
  amountFields: string[],
  path: string,
): void {
  for (const field of integerFields) {
    requireNonNegativeInteger(value[field], `${path}.${field}`);
  }
  for (const field of amountFields) {
    requireNonNegativeNumber(value[field], `${path}.${field}`);
  }
}

export function validateDashboardMetricsResponse(
  value: unknown,
): LiveDashboardMetrics {
  const root = requireRecord(value, 'root');
  const meta = requireRecord(root.meta, 'meta');
  const kpis = requireRecord(root.kpis, 'kpis');
  const statusCounts = requireRecord(
    root.invoice_status_counts,
    'invoice_status_counts',
  );

  const companyId = requireString(meta.company_id, 'meta.company_id');
  if (!UUID_PATTERN.test(companyId)) {
    throw new Error('Dashboard metrics response has invalid meta.company_id.');
  }

  const baseCurrency = requireString(
    meta.base_currency,
    'meta.base_currency',
  );
  if (!/^[A-Z]{3}$/.test(baseCurrency)) {
    throw new Error('Dashboard metrics response has invalid meta.base_currency.');
  }

  const asOfDate = requireString(meta.as_of_date, 'meta.as_of_date');
  if (!DATE_PATTERN.test(asOfDate)) {
    throw new Error('Dashboard metrics response has invalid meta.as_of_date.');
  }

  const calculatedAt = requireString(
    meta.calculated_at,
    'meta.calculated_at',
  );
  if (!Number.isFinite(Date.parse(calculatedAt))) {
    throw new Error('Dashboard metrics response has invalid meta.calculated_at.');
  }

  if (meta.scope !== 'assigned_customers' && meta.scope !== 'company') {
    throw new Error('Dashboard metrics response has invalid meta.scope.');
  }

  const trendMonths = requireNonNegativeInteger(
    meta.trend_months,
    'meta.trend_months',
  );
  if (trendMonths < 1 || trendMonths > 12) {
    throw new Error('Dashboard metrics response has invalid meta.trend_months.');
  }

  validateMetricFields(
    kpis,
    [
      'overdue_invoice_count',
      'current_month_posted_invoices',
      'import_rows_needing_review',
    ],
    [
      'total_outstanding_ar',
      'overdue_outstanding',
      'unapplied_cash',
      'current_month_collections',
    ],
    'kpis',
  );
  validateMetricFields(
    statusCounts,
    ['open', 'partially_paid', 'overdue_status', 'paid', 'unpaid_total'],
    [],
    'invoice_status_counts',
  );

  const agingBuckets = requireArray(root.aging_buckets, 'aging_buckets');
  if (agingBuckets.length !== 5) {
    throw new Error('Dashboard metrics response has invalid aging_buckets.');
  }
  agingBuckets.forEach((item, index) => {
    const row = requireRecord(item, `aging_buckets[${index}]`);
    if (
      typeof row.key !== 'string' ||
      !AGING_KEYS.has(row.key as AgingBucketKey)
    ) {
      throw new Error(
        `Dashboard metrics response has invalid aging_buckets[${index}].key.`,
      );
    }
    requireString(row.label, `aging_buckets[${index}].label`);
    validateMetricFields(
      row,
      ['invoice_count'],
      ['outstanding_base', 'percentage'],
      `aging_buckets[${index}]`,
    );
  });

  const collectionTrend = requireArray(
    root.collection_trend,
    'collection_trend',
  );
  if (collectionTrend.length !== trendMonths) {
    throw new Error('Dashboard metrics response has invalid collection_trend.');
  }
  collectionTrend.forEach((item, index) => {
    const row = requireRecord(item, `collection_trend[${index}]`);
    const month = requireString(row.month, `collection_trend[${index}].month`);
    if (!MONTH_PATTERN.test(month)) {
      throw new Error(
        `Dashboard metrics response has invalid collection_trend[${index}].month.`,
      );
    }
    validateMetricFields(
      row,
      ['receipt_count'],
      ['collected_base'],
      `collection_trend[${index}]`,
    );
  });

  const topCustomers = requireArray(
    root.top_outstanding_customers,
    'top_outstanding_customers',
  );
  if (topCustomers.length > 10) {
    throw new Error(
      'Dashboard metrics response has invalid top_outstanding_customers.',
    );
  }
  topCustomers.forEach((item, index) => {
    const row = requireRecord(item, `top_outstanding_customers[${index}]`);
    requireString(
      row.customer_id,
      `top_outstanding_customers[${index}].customer_id`,
    );
    requireString(
      row.customer_code,
      `top_outstanding_customers[${index}].customer_code`,
    );
    requireString(
      row.customer_name,
      `top_outstanding_customers[${index}].customer_name`,
    );
    validateMetricFields(
      row,
      ['overdue_invoice_count'],
      ['outstanding_base', 'overdue_base'],
      `top_outstanding_customers[${index}]`,
    );
  });

  const creditRatings = requireArray(
    root.credit_rating_distribution,
    'credit_rating_distribution',
  );
  if (creditRatings.length !== 6) {
    throw new Error(
      'Dashboard metrics response has invalid credit_rating_distribution.',
    );
  }
  creditRatings.forEach((item, index) => {
    const row = requireRecord(item, `credit_rating_distribution[${index}]`);
    if (
      typeof row.rating !== 'string' ||
      !RATINGS.has(row.rating as DashboardCreditRatingRow['rating'])
    ) {
      throw new Error(
        `Dashboard metrics response has invalid credit_rating_distribution[${index}].rating.`,
      );
    }
    validateMetricFields(
      row,
      ['customer_count'],
      ['outstanding_base'],
      `credit_rating_distribution[${index}]`,
    );
  });

  validateMetricFields(
    root,
    [
      'total_invoices',
      'open_invoices',
      'overdue_invoices',
      'total_receipts',
    ],
    [
      'total_ar_balance',
      'total_overdue_balance',
      'total_credit_balance',
      'overdue_percentage',
    ],
    'root',
  );

  return root as unknown as LiveDashboardMetrics;
}
