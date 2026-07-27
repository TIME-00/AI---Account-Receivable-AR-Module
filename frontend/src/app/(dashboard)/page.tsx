"use client";

import { useRouter } from "next/navigation";
import { useDashboardMetrics } from "@/hooks/use-dashboard";
import { ApiError } from "@/hooks/use-api";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatMoneySafe } from "@/lib/currency";
import {
  DollarSign,
  AlertTriangle,
  Wallet,
  TrendingUp,
  RefreshCw,
  Clock,
  ShieldAlert,
  Building2,
  UserCheck,
} from "lucide-react";

import { AgingChart, AGING_COLORS } from "@/components/features/dashboard/aging-chart";
import { CompositionChart } from "@/components/features/dashboard/composition-chart";
import { CollectionTrendChart } from "@/components/features/dashboard/collection-trend-chart";
import { CreditRiskChart } from "@/components/features/dashboard/credit-risk-chart";
import { QuickStats } from "@/components/features/dashboard/quick-stats";
import { TopCustomers } from "@/components/features/dashboard/top-customers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RATING_COLORS: Record<string, string> = {
  AAA: "#22c55e", AA: "#10b981", A: "#3b82f6",
  B: "#f59e0b", C: "#f97316", D: "#ef4444",
};

const SCOPE_LABELS: Record<string, string> = {
  assigned_customers: "Assigned Customers",
  company: "Company",
};

/** Format a YYYY-MM month key into a short axis label, e.g. "Jun 26". */
function monthLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/** Format an ISO timestamp for the "last updated" indicator. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a YYYY-MM-DD business date for display. */
function formatAsOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Dashboard Page ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { metrics, isLoading, isError, error, refetch } = useDashboardMetrics(6);

  const meta = metrics?.meta;
  // Batch 9D-D: the dashboard contract is company-base. Use the backend base
  // currency verbatim — never fall back to an assumed "MYR".
  const currency = meta?.base_currency ?? null;
  const kpis = metrics?.kpis;
  const statusCounts = metrics?.invoice_status_counts;

  // ── Access / error handling (never crash the dashboard) ──
  const isForbidden = error instanceof ApiError && error.status === 403;

  if (isError && !metrics) {
    return (
      <div className="space-y-6">
        <DashboardHeader meta={meta} />
        <div className="glass-card flex flex-col items-center justify-center gap-3 p-12 text-center">
          {isForbidden ? (
            <>
              <ShieldAlert className="h-10 w-10 text-amber-500" />
              <h2 className="text-lg font-semibold text-slate-900">Dashboard not available for your role</h2>
              <p className="max-w-md text-sm text-slate-500">
                Your role does not have access to the AR dashboard metrics. If you believe this is
                an error, contact your administrator.
              </p>
            </>
          ) : (
            <>
              <AlertTriangle className="h-10 w-10 text-red-500" />
              <h2 className="text-lg font-semibold text-slate-900">Couldn&apos;t load the dashboard</h2>
              <p className="max-w-md text-sm text-slate-500">
                {error instanceof Error ? error.message : "An unexpected error occurred."}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Derived chart data (nested live contract is the source of truth) ──
  const agingChartData =
    metrics?.aging_buckets.map((bucket, i) => ({
      name: bucket.label,
      amount: bucket.outstanding_base,
      count: bucket.invoice_count,
      fill: AGING_COLORS[i % AGING_COLORS.length],
    })) ?? [];

  const totalOutstanding = kpis?.total_outstanding_ar ?? 0;
  const overdueOutstanding = kpis?.overdue_outstanding ?? 0;
  const unappliedCash = kpis?.unapplied_cash ?? 0;

  const donutData = [
    { name: "Current Outstanding", value: Math.max(totalOutstanding - overdueOutstanding, 0) },
    { name: "Overdue Outstanding", value: overdueOutstanding },
    { name: "Unapplied Cash", value: unappliedCash },
  ].filter((d) => d.value > 0);

  const trendData =
    metrics?.collection_trend.map((point) => ({
      label: monthLabel(point.month),
      collected: point.collected_base,
      receipts: point.receipt_count,
    })) ?? [];

  const creditRatingData =
    metrics?.credit_rating_distribution.map((row) => ({
      rating: row.rating,
      count: row.customer_count,
      amount: row.outstanding_base,
      fill: RATING_COLORS[row.rating] ?? "#94a3b8",
    })) ?? [];

  return (
    <div className="space-y-6">
      <DashboardHeader meta={meta} />

      {/* ─── Primary KPI Cards (base currency) ─────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total Outstanding AR"
          value={formatMoneySafe(totalOutstanding, currency)}
          subtitle="Open, partially paid & overdue"
          icon={DollarSign}
          variant="info"
          isLoading={isLoading}
        />
        <KpiCard
          title="Overdue Outstanding"
          value={formatMoneySafe(overdueOutstanding, currency)}
          subtitle={`${kpis?.overdue_invoice_count ?? 0} overdue invoice(s)`}
          icon={AlertTriangle}
          variant="danger"
          isLoading={isLoading}
        />
        <KpiCard
          title="Unapplied Cash"
          value={formatMoneySafe(unappliedCash, currency)}
          subtitle="Posted receipts not yet applied"
          icon={Wallet}
          variant="warning"
          isLoading={isLoading}
        />
        <KpiCard
          title="Collections This Month"
          value={formatMoneySafe(kpis?.current_month_collections ?? 0, currency)}
          subtitle="Receipts posted this month"
          icon={TrendingUp}
          variant="success"
          isLoading={isLoading}
        />
      </div>

      {/* ─── Operational Counts ────────────────────────────────────── */}
      <QuickStats
        postedThisMonth={kpis?.current_month_posted_invoices ?? "-"}
        overdueInvoices={kpis?.overdue_invoice_count ?? "-"}
        unpaidInvoices={statusCounts?.unpaid_total ?? "-"}
        importReview={kpis?.import_rows_needing_review ?? "-"}
      />

      {/* ─── Invoice Status Counts ─────────────────────────────────── */}
      <div className="glass-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900">Invoice Status</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusPill label="Open" value={statusCounts?.open} color="text-blue-600" />
          <StatusPill label="Partially Paid" value={statusCounts?.partially_paid} color="text-amber-600" />
          <StatusPill label="Overdue" value={statusCounts?.overdue_status} color="text-red-600" />
          <StatusPill label="Paid" value={statusCounts?.paid} color="text-emerald-600" />
        </div>
      </div>

      {/* ─── Charts Row 1: Aging + Composition ────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgingChart data={agingChartData} isLoading={isLoading} currency={currency} />
        <CompositionChart data={donutData} currency={currency} isLoading={isLoading} />
      </div>

      {/* ─── Charts Row 2: Collection Trend + Credit Rating ───────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CollectionTrendChart data={trendData} currency={currency} isLoading={isLoading} />
        <CreditRiskChart
          data={creditRatingData}
          currency={currency}
          isLoading={isLoading}
          onSelectRating={(rating) =>
            router.push(`/reports/aging?credit_rating=${encodeURIComponent(rating)}`)
          }
        />
      </div>

      {/* ─── Top Outstanding Customers ─────────────────────────────── */}
      <TopCustomers
        data={metrics?.top_outstanding_customers ?? []}
        currency={currency}
        isLoading={isLoading}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DashboardHeader({
  meta,
}: {
  meta?: { scope: string; as_of_date: string; calculated_at: string } | undefined;
}) {
  const scopeLabel = meta ? SCOPE_LABELS[meta.scope] ?? meta.scope : null;
  const ScopeIcon = meta?.scope === "assigned_customers" ? UserCheck : Building2;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">AR Dashboard</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          {scopeLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <ScopeIcon className="h-3 w-3" /> {scopeLabel} scope
            </span>
          )}
          {meta && <span>As of {formatAsOf(meta.as_of_date)}</span>}
        </div>
      </div>

      {/* Auto-refreshes in the foreground (see useDashboardMetrics: 60s refetch
          interval, background-off). No manual refresh control is exposed. */}
      {meta && (
        <span className="text-xs text-slate-400">
          Updated {formatTimestamp(meta.calculated_at)}
        </span>
      )}
    </div>
  );
}

function StatusPill({
  label,
  value,
  color,
}: {
  label: string;
  value?: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${color}`}>{value ?? "-"}</p>
    </div>
  );
}
