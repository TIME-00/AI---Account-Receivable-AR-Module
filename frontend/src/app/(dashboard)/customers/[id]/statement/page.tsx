"use client";

// ============================================================================
// TSH Synergy AR — Customer Statement (Batch 9D-D, B9DD-FEIR-003)
//
// Real UI integration for the already-accepted backend contract
// `GET /reports/statement/:customerId`. Previously only the TypeScript types
// existed and no surface consumed them.
// ============================================================================

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { useCustomerStatement } from "@/hooks/use-statement";
import { StatementView } from "@/components/features/reports/statement-view";
import { ApiError } from "@/hooks/use-api";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CustomerStatementPage() {
  const params = useParams();
  const customerId = params.id as string;

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return toDateStr(d);
  }, []);
  const defaultTo = useMemo(() => toDateStr(new Date()), []);

  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);

  const { data, isLoading, isError, error } = useCustomerStatement(customerId, {
    periodFrom,
    periodTo,
  });

  const rangeInvalid = periodFrom > periodTo;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/customers" className="hover:text-blue-600">
          Customers
        </Link>
        <span>/</span>
        <Link href={`/customers/${customerId}`} className="hover:text-blue-600">
          {data?.customer_name ?? "Customer"}
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-800">Statement</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <FileSpreadsheet className="h-6 w-6 text-brand-500" />
          Customer Statement
        </h1>
        <Link
          href={`/customers/${customerId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600"
        >
          <ArrowLeft className="h-4 w-4" /> Back to customer
        </Link>
      </div>

      {/* Period filters — required by the backend contract */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="period-from" className="text-xs font-medium text-slate-500">
          From:
        </label>
        <input
          id="period-from"
          type="date"
          value={periodFrom}
          onChange={(e) => setPeriodFrom(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <label htmlFor="period-to" className="text-xs font-medium text-slate-500">
          To:
        </label>
        <input
          id="period-to"
          type="date"
          value={periodTo}
          onChange={(e) => setPeriodTo(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        {rangeInvalid && (
          <p role="alert" className="text-xs font-medium text-red-600">
            The “From” date must be on or before the “To” date.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading statement…</p>
          </div>
        </div>
      ) : isError ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load statement</p>
          <p className="max-w-md text-center text-xs text-slate-400">
            {error instanceof ApiError
              ? error.message
              : "The statement could not be loaded for this period."}
          </p>
        </div>
      ) : !data ? (
        <div className="glass-card flex flex-col items-center justify-center py-20">
          <p className="text-sm text-slate-500">No statement available</p>
        </div>
      ) : (
        <StatementView statement={data} />
      )}
    </div>
  );
}
