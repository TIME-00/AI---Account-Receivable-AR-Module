"use client";

// ============================================================================
// TSH Synergy AR — Customer Statement view (Batch 9D-D, B9DD-FEIR-003)
//
// Renders the authoritative `CustomerStatement` contract. Every monetary value
// is backend-supplied; nothing here converts, re-rates or re-sums.
// ============================================================================

import { formatMoney, formatMoneySafe } from "@/lib/currency";
import { formatDate } from "@/lib/utils";
import { CurrencyTotals } from "@/components/ui/currency-subtotals";
import type { CustomerStatement, StatementLine } from "@/types";
import { AlertTriangle, Layers } from "lucide-react";

const BASIS_LABELS: Record<string, string> = {
  stored_booked_base_snapshot: "stored booked base snapshot",
  current_balance_x_booked_rate: "current balance × booked rate",
  original_booked_base_snapshot: "original booked base snapshot",
};

export interface StatementViewProps {
  statement: CustomerStatement;
}

export function StatementView({ statement }: StatementViewProps) {
  const {
    lines,
    base_currency,
    opening_balance_base,
    closing_balance_base,
    total_debit_base,
    total_credit_base,
    by_currency,
    meta,
    legacy_transaction_fields_valid,
    legacy_transaction_currency,
  } = statement;

  // The backend decides whether the legacy transaction-currency running balance
  // is meaningful (single-currency period). We never infer it ourselves.
  const singleCurrency = legacy_transaction_fields_valid;
  const multiCurrency = meta.multi_currency;

  return (
    <div className="space-y-6">
      {/* Period identity */}
      <div className="glass-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{statement.customer_name}</h2>
            <p className="font-mono text-xs text-slate-400">{statement.customer_code}</p>
            {statement.address && (
              <p className="mt-1 max-w-md text-xs text-slate-500">{statement.address}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Statement period
            </p>
            <p className="font-mono text-sm text-slate-700">
              {formatDate(statement.period_from)} — {formatDate(statement.period_to)}
            </p>
          </div>
        </div>
      </div>

      {/* Multi-currency notice — explicit, not colour-only */}
      {multiCurrency && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <Layers className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" aria-hidden="true" />
          <p className="text-xs text-blue-700">
            This statement spans multiple transaction currencies. A single running balance in one
            transaction currency is not meaningful, so the running balance is shown in the company
            base currency ({base_currency}) only. Per-currency opening and closing balances are listed
            below.
          </p>
        </div>
      )}

      {/* Company-base totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Opening balance", value: opening_balance_base },
          { label: "Total debit", value: total_debit_base },
          { label: "Total credit", value: total_credit_base },
          { label: "Closing balance", value: closing_balance_base },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {c.label} (company base)
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900">
              {formatMoney(c.value, base_currency)}
            </p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-[10px] text-slate-400">
        Basis: {BASIS_LABELS[meta.normalization_basis] ?? meta.normalization_basis}
        {multiCurrency && " — company-base totals are not the sum of the native balances below"}
      </p>

      {/* Per-currency opening/movement/closing balances */}
      <div className="glass-card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">Balances by transaction currency</h3>
        </div>
        {by_currency.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No movements in this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 text-left font-semibold">Currency</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Opening</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {by_currency.map((c) => (
                  <tr key={c.currency} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">
                      {c.currency}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatMoney(c.opening_balance, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                      {formatMoney(c.total_debit, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                      {formatMoney(c.total_credit, c.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-slate-800">
                      {formatMoney(c.closing_balance, c.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movements */}
      <div className="glass-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Movements
            <span className="ml-2 text-xs font-normal text-slate-400">({lines.length})</span>
          </h3>
          {singleCurrency && legacy_transaction_currency && (
            <p className="text-[10px] text-slate-400">
              Single-currency statement ({legacy_transaction_currency}) — a transaction-currency
              running balance is shown.
            </p>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-slate-500">No movements in this period</p>
            <p className="mt-1 text-xs text-slate-400">Try widening the date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">
                Customer statement movements for {statement.customer_name} from{" "}
                {statement.period_from} to {statement.period_to}
              </caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-xs uppercase text-slate-500">
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Type</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Reference</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Description</th>
                  <th scope="col" className="px-3 py-2.5 text-center font-semibold">Ccy</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Debit</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Credit</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Balance</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Base debit
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Base credit
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Base balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, index) => (
                  <StatementRow key={`${line.doc_no}-${index}`} line={line} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mobile-friendly per-currency recap */}
      <div className="lg:hidden">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Closing by currency
        </p>
        <CurrencyTotals
          byCurrency={by_currency.map((c) => ({
            currency: c.currency,
            amount: c.closing_balance,
            base_amount: 0,
            count: 1,
          }))}
        />
      </div>
    </div>
  );
}

function StatementRow({ line }: { line: StatementLine }) {
  // `transaction_balance` is null on a multi-currency statement — the backend
  // says a native running balance is not meaningful there. We render an explicit
  // marker rather than inventing one or falling back to the base balance.
  const nativeBalanceUnavailable = line.transaction_balance === null;

  return (
    <tr className="hover:bg-slate-50/80">
      <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(line.date)}</td>
      <td className="px-3 py-2.5 text-xs text-slate-600">{line.doc_type}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{line.doc_no}</td>
      <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-slate-500" title={line.description}>
        {line.description}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
          {line.currency}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700">
        {line.transaction_debit > 0 ? formatMoney(line.transaction_debit, line.currency) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-700">
        {line.transaction_credit > 0 ? formatMoney(line.transaction_credit, line.currency) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
        {nativeBalanceUnavailable ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] italic text-slate-400"
            title="A running balance in one transaction currency is not meaningful across a multi-currency statement. Use the company-base balance."
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            n/a — mixed currency
          </span>
        ) : (
          <span className="font-semibold text-slate-800">
            {formatMoney(line.transaction_balance as number, line.currency)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">
        {line.base_debit > 0 ? formatMoneySafe(line.base_debit, line.base_currency) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-slate-500">
        {line.base_credit > 0 ? formatMoneySafe(line.base_credit, line.base_currency) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-800">
        {formatMoneySafe(line.base_balance, line.base_currency)}
      </td>
    </tr>
  );
}
