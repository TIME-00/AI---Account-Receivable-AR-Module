// ============================================================================
// Batch 9D-D Monetary Aggregation Contracts
// Server-side helpers for company-base normalization and per-currency grouping.
// ============================================================================

export { roundMoney } from '../_shared/money.ts';
import { roundMoney } from '../_shared/money.ts';
import type { APIResponse } from '../_shared/types.ts';

export const CURRENT_BALANCE_BOOKED_RATE_BASIS = 'current_balance_x_booked_rate' as const;
export const ORIGINAL_BOOKED_BASE_BASIS = 'original_booked_base_snapshot' as const;
export const STORED_BOOKED_BASE_SNAPSHOT_BASIS = 'stored_booked_base_snapshot' as const;
export const CURRENT_OUTSTANDING_AMOUNT_BASIS = 'current_outstanding' as const;
export const CURRENT_UNALLOCATED_AMOUNT_BASIS = 'current_unallocated' as const;
export const ORIGINAL_DOCUMENT_AMOUNT_BASIS = 'original_document_total' as const;

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

export interface MonetaryCollectionSummary {
  current_balance_summary: MonetarySummary;
  document_total_summary: MonetarySummary;
}

/** Canonical success envelope for invoice/receipt collection contracts. */
export type MonetaryCollectionAPIResponse<T> = APIResponse<T, MonetaryCollectionSummary>;

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

export function currencyTotalsFromMap(totals: Map<string, CurrencyTotal>): CurrencyTotal[] {
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
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

    existing.opening_balance = roundMoney(existing.opening_balance + (movement.opening_delta ?? 0));
    existing.total_debit = roundMoney(existing.total_debit + (movement.debit ?? 0));
    existing.total_credit = roundMoney(existing.total_credit + (movement.credit ?? 0));
    existing.closing_balance = roundMoney(
      existing.opening_balance + existing.total_debit - existing.total_credit,
    );
    balances.set(currency, existing);
  }

  return [...balances.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function applyStatementRunningBalances<T extends StatementRunningBalanceLine>(
  lines: T[],
  openingTransactionBalance: number,
  openingBaseBalance: number,
): { lines: T[]; closing_transaction_balance: number; closing_base_balance: number } {
  let transactionBalance = openingTransactionBalance;
  let baseBalance = openingBaseBalance;

  for (const line of lines) {
    transactionBalance = roundMoney(transactionBalance + line.debit - line.credit);
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
