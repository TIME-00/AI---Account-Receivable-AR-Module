// ============================================================================
// Batch 9D-D Monetary Aggregation Contracts
// Server-side helpers for company-base normalization and per-currency grouping.
// ============================================================================

export { roundMoney } from '../_shared/money.ts';
import { roundMoney } from '../_shared/money.ts';
import type { APIResponse } from '../_shared/types.ts';

export const CURRENT_BALANCE_BOOKED_RATE_BASIS =
  'current_balance_x_booked_rate' as const;
export const ORIGINAL_BOOKED_BASE_BASIS =
  'original_booked_base_snapshot' as const;
export const STORED_BOOKED_BASE_SNAPSHOT_BASIS =
  'stored_booked_base_snapshot' as const;
export const CURRENT_CONSISTENT_BOOKED_FX_DECISION_AUTHORITY =
  'current_consistent_booked_fx_decision' as const;
export const CURRENT_OUTSTANDING_AMOUNT_BASIS = 'current_outstanding' as const;
export const CURRENT_UNALLOCATED_AMOUNT_BASIS = 'current_unallocated' as const;
export const ORIGINAL_DOCUMENT_AMOUNT_BASIS =
  'original_document_total' as const;

export type NormalizationBasis =
  | typeof CURRENT_BALANCE_BOOKED_RATE_BASIS
  | typeof ORIGINAL_BOOKED_BASE_BASIS
  | typeof STORED_BOOKED_BASE_SNAPSHOT_BASIS;

export type SummaryAmountBasis =
  | typeof CURRENT_OUTSTANDING_AMOUNT_BASIS
  | typeof CURRENT_UNALLOCATED_AMOUNT_BASIS
  | typeof ORIGINAL_DOCUMENT_AMOUNT_BASIS;

export interface CurrencyTotal {
  currency: string;
  amount: number;
  base_amount: number;
  count: number;
}

export interface MonetaryAggregationMeta {
  contract_version?: 1;
  base_currency: string;
  multi_currency: boolean;
  normalization_basis: NormalizationBasis;
}

export interface MonetarySummaryEntry {
  currency: string;
  transaction_amount: number;
  base_amount: number;
}

export interface MonetarySummary {
  row_count: number;
  amount_basis: SummaryAmountBasis;
  base_total: number;
  base_currency: string;
  by_currency: CurrencyTotal[];
  meta: MonetaryAggregationMeta;
}

export interface AuthorityCurrencyTotal {
  currency: string;
  amount: string;
  base_amount: string | null;
  count: number;
  authoritative_document_count: number;
  unavailable_count: number;
  base_available: boolean;
}

export interface UnavailableCurrencyCount {
  currency: string;
  document_count: number;
}

export interface MonetaryAuthorityMeta {
  contract_version: 2;
  base_currency: string;
  multi_currency: boolean;
  normalization_basis: NormalizationBasis;
  authority_basis: typeof CURRENT_CONSISTENT_BOOKED_FX_DECISION_AUTHORITY;
}

export interface MonetaryAuthoritySummary {
  row_count: number;
  matching_document_count: number;
  authoritative_document_count: number;
  unavailable_count: number;
  base_available: boolean;
  amount_basis: SummaryAmountBasis;
  base_currency: string;
  base_total: string | null;
  by_currency: AuthorityCurrencyTotal[];
  unavailable_by_currency: UnavailableCurrencyCount[];
  meta: MonetaryAuthorityMeta;
}

export type VersionedMonetarySummary =
  | MonetarySummary
  | MonetaryAuthoritySummary;

export interface MonetaryCollectionSummary {
  current_balance_summary: VersionedMonetarySummary;
  document_total_summary: VersionedMonetarySummary;
}

/** Canonical success envelope for invoice/receipt collection contracts. */
export type MonetaryCollectionAPIResponse<T> = APIResponse<
  T,
  MonetaryCollectionSummary
>;

export interface StatementRunningBalanceLine {
  debit: number;
  credit: number;
  balance: number | null;
  transaction_balance: number | null;
  base_debit: number;
  base_credit: number;
  base_balance: number;
}

export interface StatementCurrencyMovement {
  currency: string;
  opening_delta?: number;
  debit?: number;
  credit?: number;
}

export interface StatementCurrencyBalance {
  currency: string;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
}

export function currentBaseFromBookedRate(
  currentTransactionBalance: number,
  bookedExchangeRate: number,
): number {
  return roundMoney(currentTransactionBalance * bookedExchangeRate);
}

export function addCurrencyTotal(
  totals: Map<string, CurrencyTotal>,
  currency: string,
  amount: number,
  baseAmount: number,
  count = 1,
): void {
  const key = currency.toUpperCase();
  const existing = totals.get(key) ?? {
    currency: key,
    amount: 0,
    base_amount: 0,
    count: 0,
  };

  existing.amount = roundMoney(existing.amount + amount);
  existing.base_amount = roundMoney(existing.base_amount + baseAmount);
  existing.count += count;
  totals.set(key, existing);
}

export function currencyTotalsFromMap(
  totals: Map<string, CurrencyTotal>,
): CurrencyTotal[] {
  return [...totals.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );
}

export function monetaryAggregationMeta(
  baseCurrency: string,
  byCurrency: Array<{ currency: string }>,
  normalizationBasis: NormalizationBasis = CURRENT_BALANCE_BOOKED_RATE_BASIS,
): MonetaryAggregationMeta {
  return {
    base_currency: baseCurrency,
    multi_currency: byCurrency.length > 1,
    normalization_basis: normalizationBasis,
  };
}

export function monetarySummaryFromEntries(
  entries: MonetarySummaryEntry[],
  baseCurrency: string,
  normalizationBasis: NormalizationBasis = CURRENT_BALANCE_BOOKED_RATE_BASIS,
  amountBasis: SummaryAmountBasis = ORIGINAL_DOCUMENT_AMOUNT_BASIS,
): MonetarySummary {
  const totals = new Map<string, CurrencyTotal>();
  let baseTotal = 0;

  for (const entry of entries) {
    addCurrencyTotal(
      totals,
      entry.currency,
      entry.transaction_amount,
      entry.base_amount,
    );
    baseTotal = roundMoney(baseTotal + entry.base_amount);
  }

  const byCurrency = currencyTotalsFromMap(totals);
  return {
    row_count: entries.length,
    amount_basis: amountBasis,
    base_total: baseTotal,
    base_currency: baseCurrency,
    by_currency: byCurrency,
    meta: monetaryAggregationMeta(baseCurrency, byCurrency, normalizationBasis),
  };
}

interface MonetaryCollectionParseOptions {
  currentAmountBasis:
    | typeof CURRENT_OUTSTANDING_AMOUNT_BASIS
    | typeof CURRENT_UNALLOCATED_AMOUNT_BASIS;
}

// Safe mixed-version rollout sequence:
// 1. Deploy a frontend compatibility build that understands v1 and v2 and
//    never labels v1 numeric base totals as verified.
// 2. Deploy v1/v2-compatible Invoice, Receipt and Reports Edge Functions.
// 3. Apply Migration 033 last to activate v2.
// 4. Verify every caller is receiving v2. Never apply the database migration
//    first.
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const INVALID_MONETARY_CONTRACT = 'Invalid monetary summary contract.';

function failMonetaryContract(): never {
  throw new Error(INVALID_MONETARY_CONTRACT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) failMonetaryContract();
  return Number(value);
}

function requireCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    failMonetaryContract();
  }
  return value;
}

function requireDecimalString(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_STRING_PATTERN.test(value)) {
    failMonetaryContract();
  }
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failMonetaryContract();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') failMonetaryContract();
  return value;
}

function requireSortedUniqueCurrencies(currencies: string[]): void {
  const sorted = [...currencies].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    new Set(currencies).size !== currencies.length ||
    currencies.some((currency, index) => currency !== sorted[index])
  ) {
    failMonetaryContract();
  }
}

function parseV1Summary(
  value: unknown,
  expectedAmountBasis: SummaryAmountBasis,
  expectedNormalizationBasis: NormalizationBasis,
): MonetarySummary {
  if (!isRecord(value)) failMonetaryContract();
  if (
    !hasExactKeys(value, [
      'row_count',
      'amount_basis',
      'base_total',
      'base_currency',
      'by_currency',
      'meta',
    ])
  ) {
    failMonetaryContract();
  }

  const rowCount = requireNonNegativeInteger(value.row_count);
  if (value.amount_basis !== expectedAmountBasis) failMonetaryContract();
  const baseTotal = requireFiniteNumber(value.base_total);
  const baseCurrency = requireCurrency(value.base_currency);
  if (!Array.isArray(value.by_currency) || !isRecord(value.meta)) {
    failMonetaryContract();
  }
  if (
    !hasExactKeys(value.meta, [
      'base_currency',
      'multi_currency',
      'normalization_basis',
    ])
  ) {
    failMonetaryContract();
  }
  if (
    value.meta.base_currency !== baseCurrency ||
    value.meta.normalization_basis !== expectedNormalizationBasis
  ) {
    failMonetaryContract();
  }

  const byCurrency = value.by_currency.map((item): CurrencyTotal => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['currency', 'amount', 'base_amount', 'count'])
    ) {
      failMonetaryContract();
    }
    return {
      currency: requireCurrency(item.currency),
      amount: requireFiniteNumber(item.amount),
      base_amount: requireFiniteNumber(item.base_amount),
      count: requireNonNegativeInteger(item.count),
    };
  });
  requireSortedUniqueCurrencies(byCurrency.map((item) => item.currency));
  if (
    byCurrency.reduce((count, item) => count + item.count, 0) !== rowCount ||
    requireBoolean(value.meta.multi_currency) !== (byCurrency.length > 1)
  ) {
    failMonetaryContract();
  }

  return {
    row_count: rowCount,
    amount_basis: expectedAmountBasis,
    base_total: baseTotal,
    base_currency: baseCurrency,
    by_currency: byCurrency,
    meta: {
      contract_version: 1,
      base_currency: baseCurrency,
      multi_currency: byCurrency.length > 1,
      normalization_basis: expectedNormalizationBasis,
    },
  };
}

function parseV2Summary(
  value: unknown,
  expectedAmountBasis: SummaryAmountBasis,
  expectedNormalizationBasis: NormalizationBasis,
): MonetaryAuthoritySummary {
  if (!isRecord(value)) failMonetaryContract();
  if (
    !hasExactKeys(value, [
      'row_count',
      'matching_document_count',
      'authoritative_document_count',
      'unavailable_count',
      'base_available',
      'amount_basis',
      'base_currency',
      'base_total',
      'by_currency',
      'unavailable_by_currency',
      'meta',
    ])
  ) {
    failMonetaryContract();
  }

  const rowCount = requireNonNegativeInteger(value.row_count);
  const matchingCount = requireNonNegativeInteger(
    value.matching_document_count,
  );
  const authoritativeCount = requireNonNegativeInteger(
    value.authoritative_document_count,
  );
  const unavailableCount = requireNonNegativeInteger(value.unavailable_count);
  const baseAvailable = requireBoolean(value.base_available);
  if (
    rowCount !== matchingCount ||
    authoritativeCount + unavailableCount !== matchingCount ||
    baseAvailable !== (unavailableCount === 0) ||
    value.amount_basis !== expectedAmountBasis
  ) {
    failMonetaryContract();
  }

  const baseCurrency = requireCurrency(value.base_currency);
  let baseTotal: string | null;
  if (value.base_total === null) {
    baseTotal = null;
  } else {
    baseTotal = requireDecimalString(value.base_total);
  }
  if (
    (matchingCount === 0 && baseTotal !== '0.00') ||
    (matchingCount > 0 && authoritativeCount === 0 && baseTotal !== null) ||
    (authoritativeCount > 0 && baseTotal === null)
  ) {
    failMonetaryContract();
  }
  if (
    !Array.isArray(value.by_currency) ||
    !Array.isArray(value.unavailable_by_currency) ||
    !isRecord(value.meta)
  ) {
    failMonetaryContract();
  }

  const byCurrency = value.by_currency.map((item): AuthorityCurrencyTotal => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        'currency',
        'amount',
        'base_amount',
        'count',
        'authoritative_document_count',
        'unavailable_count',
        'base_available',
      ])
    ) {
      failMonetaryContract();
    }
    const count = requireNonNegativeInteger(item.count);
    if (count === 0) failMonetaryContract();
    const itemAuthoritativeCount = requireNonNegativeInteger(
      item.authoritative_document_count,
    );
    const itemUnavailableCount = requireNonNegativeInteger(
      item.unavailable_count,
    );
    const itemBaseAvailable = requireBoolean(item.base_available);
    let itemBaseAmount: string | null;
    if (item.base_amount === null) {
      itemBaseAmount = null;
    } else {
      itemBaseAmount = requireDecimalString(item.base_amount);
    }
    if (
      itemAuthoritativeCount + itemUnavailableCount !== count ||
      itemBaseAvailable !== (itemUnavailableCount === 0) ||
      (itemAuthoritativeCount === 0 && itemBaseAmount !== null) ||
      (itemAuthoritativeCount > 0 && itemBaseAmount === null)
    ) {
      failMonetaryContract();
    }
    return {
      currency: requireCurrency(item.currency),
      amount: requireDecimalString(item.amount),
      base_amount: itemBaseAmount,
      count,
      authoritative_document_count: itemAuthoritativeCount,
      unavailable_count: itemUnavailableCount,
      base_available: itemBaseAvailable,
    };
  });
  requireSortedUniqueCurrencies(byCurrency.map((item) => item.currency));

  const unavailableByCurrency = value.unavailable_by_currency.map(
    (item): UnavailableCurrencyCount => {
      if (
        !isRecord(item) ||
        !hasExactKeys(item, ['currency', 'document_count'])
      ) {
        failMonetaryContract();
      }
      const documentCount = requireNonNegativeInteger(item.document_count);
      if (documentCount === 0) failMonetaryContract();
      return {
        currency: requireCurrency(item.currency),
        document_count: documentCount,
      };
    },
  );
  requireSortedUniqueCurrencies(
    unavailableByCurrency.map((item) => item.currency),
  );

  const expectedUnavailable = byCurrency
    .filter((item) => item.unavailable_count > 0)
    .map((item) => ({
      currency: item.currency,
      document_count: item.unavailable_count,
    }));
  if (
    JSON.stringify(unavailableByCurrency) !==
      JSON.stringify(expectedUnavailable) ||
    byCurrency.reduce((count, item) => count + item.count, 0) !==
      matchingCount ||
    byCurrency.reduce(
        (count, item) => count + item.authoritative_document_count,
        0,
      ) !== authoritativeCount ||
    byCurrency.reduce((count, item) => count + item.unavailable_count, 0) !==
      unavailableCount
  ) {
    failMonetaryContract();
  }

  if (
    !hasExactKeys(value.meta, [
      'contract_version',
      'base_currency',
      'multi_currency',
      'normalization_basis',
      'authority_basis',
    ]) ||
    value.meta.contract_version !== 2 ||
    value.meta.base_currency !== baseCurrency ||
    value.meta.multi_currency !== (byCurrency.length > 1) ||
    value.meta.normalization_basis !== expectedNormalizationBasis ||
    value.meta.authority_basis !==
      CURRENT_CONSISTENT_BOOKED_FX_DECISION_AUTHORITY
  ) {
    failMonetaryContract();
  }

  return {
    row_count: rowCount,
    matching_document_count: matchingCount,
    authoritative_document_count: authoritativeCount,
    unavailable_count: unavailableCount,
    base_available: baseAvailable,
    amount_basis: expectedAmountBasis,
    base_currency: baseCurrency,
    base_total: baseTotal,
    by_currency: byCurrency,
    unavailable_by_currency: unavailableByCurrency,
    meta: {
      contract_version: 2,
      base_currency: baseCurrency,
      multi_currency: byCurrency.length > 1,
      normalization_basis: expectedNormalizationBasis,
      authority_basis: CURRENT_CONSISTENT_BOOKED_FX_DECISION_AUTHORITY,
    },
  };
}

/**
 * Parse the deployment-transition contract without promoting v1 numeric totals
 * to v2 authority. Both summaries must be entirely v1 or entirely v2.
 */
export function parseMonetaryCollectionSummary(
  value: unknown,
  options: MonetaryCollectionParseOptions,
): MonetaryCollectionSummary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'current_balance_summary',
      'document_total_summary',
    ]) ||
    !isRecord(value.current_balance_summary) ||
    !isRecord(value.document_total_summary)
  ) {
    failMonetaryContract();
  }

  const currentMeta = isRecord(value.current_balance_summary.meta)
    ? value.current_balance_summary.meta
    : null;
  const documentMeta = isRecord(value.document_total_summary.meta)
    ? value.document_total_summary.meta
    : null;
  if (!currentMeta || !documentMeta) failMonetaryContract();

  const currentVersion = currentMeta.contract_version;
  const documentVersion = documentMeta.contract_version;
  const isV1 = currentVersion === undefined && documentVersion === undefined;
  const isV2 = currentVersion === 2 && documentVersion === 2;
  if (!isV1 && !isV2) failMonetaryContract();

  if (isV2) {
    return {
      current_balance_summary: parseV2Summary(
        value.current_balance_summary,
        options.currentAmountBasis,
        CURRENT_BALANCE_BOOKED_RATE_BASIS,
      ),
      document_total_summary: parseV2Summary(
        value.document_total_summary,
        ORIGINAL_DOCUMENT_AMOUNT_BASIS,
        ORIGINAL_BOOKED_BASE_BASIS,
      ),
    };
  }

  return {
    current_balance_summary: parseV1Summary(
      value.current_balance_summary,
      options.currentAmountBasis,
      CURRENT_BALANCE_BOOKED_RATE_BASIS,
    ),
    document_total_summary: parseV1Summary(
      value.document_total_summary,
      ORIGINAL_DOCUMENT_AMOUNT_BASIS,
      ORIGINAL_BOOKED_BASE_BASIS,
    ),
  };
}

export function buildStatementCurrencyBalances(
  movements: StatementCurrencyMovement[],
): StatementCurrencyBalance[] {
  const balances = new Map<string, StatementCurrencyBalance>();

  for (const movement of movements) {
    const currency = movement.currency.toUpperCase();
    const existing = balances.get(currency) ?? {
      currency,
      opening_balance: 0,
      total_debit: 0,
      total_credit: 0,
      closing_balance: 0,
    };

    existing.opening_balance = roundMoney(
      existing.opening_balance + (movement.opening_delta ?? 0),
    );
    existing.total_debit = roundMoney(
      existing.total_debit + (movement.debit ?? 0),
    );
    existing.total_credit = roundMoney(
      existing.total_credit + (movement.credit ?? 0),
    );
    existing.closing_balance = roundMoney(
      existing.opening_balance + existing.total_debit - existing.total_credit,
    );
    balances.set(currency, existing);
  }

  return [...balances.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );
}

export function applyStatementRunningBalances<
  T extends StatementRunningBalanceLine,
>(
  lines: T[],
  openingTransactionBalance: number,
  openingBaseBalance: number,
): {
  lines: T[];
  closing_transaction_balance: number;
  closing_base_balance: number;
} {
  let transactionBalance = openingTransactionBalance;
  let baseBalance = openingBaseBalance;

  for (const line of lines) {
    transactionBalance = roundMoney(
      transactionBalance + line.debit - line.credit,
    );
    baseBalance = roundMoney(baseBalance + line.base_debit - line.base_credit);
    line.balance = transactionBalance;
    line.transaction_balance = transactionBalance;
    line.base_balance = baseBalance;
  }

  return {
    lines,
    closing_transaction_balance: transactionBalance,
    closing_base_balance: baseBalance,
  };
}
