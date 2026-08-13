"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardMetrics } from "@/hooks/use-dashboard";
import { useRatingCustomers } from "@/hooks/use-customers";
import { useAuthContext } from "@/hooks/use-auth-context";
import { ApiError } from "@/hooks/use-api";
import { useCompanyStore } from "@/stores/company-store";
import { KpiCard } from "@/components/ui/kpi-card";
import { Reveal } from "@/components/ui/reveal";
import { RATING_COLORS } from "@/lib/theme/chart-theme";
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
import {
  CreditRatingCustomerDialog,
  type ReconciliationState,
} from "@/components/features/dashboard/credit-rating-customer-dialog";
import { QuickStats } from "@/components/features/dashboard/quick-stats";
import { TopCustomers } from "@/components/features/dashboard/top-customers";
import type { CreditRating } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DASHBOARD_RATINGS = ["AAA", "AA", "A", "B", "C", "D"] as const;

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
  const {
    metrics,
    isLoading,
    isError,
    error,
    refetch: refetchDashboard,
  } = useDashboardMetrics(6);
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth } = useAuthContext();
  const userId = auth?.user.id ?? "";
  const [selectedRating, setSelectedRating] = useState<CreditRating | null>(null);
  const [customerPage, setCustomerPage] = useState(1);
  const [reconciliationState, setReconciliationState] =
    useState<ReconciliationState>("matched");
  const [triggerElement, setTriggerElement] =
    useState<HTMLButtonElement | null>(null);
  const ratingButtons = useRef(
    new Map<string, HTMLButtonElement>(),
  );
  const attemptedIdentity = useRef<string | null>(null);
  const previousIdentity = useRef(`${companyId}:${userId}`);
  const customerQuery = useRatingCustomers({
    rating: selectedRating,
    page: customerPage,
    open: selectedRating !== null,
  });

  const meta = metrics?.meta;
  // Batch 9D-D: the dashboard contract is company-base. Use the backend base
  // currency verbatim — never fall back to an assumed "MYR".
  const currency = meta?.base_currency ?? null;
  const kpis = metrics?.kpis;
  const statusCounts = metrics?.invoice_status_counts;

  // ── Access / error handling (never crash the dashboard) ──
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

  const customerRatingRows =
    metrics?.customer_credit_rating_distribution?.rows ?? [];
  const creditRatingData = DASHBOARD_RATINGS.map((rating) => ({
    rating,
    count:
      customerRatingRows.find((row) => row.rating === rating)?.customer_count ??
      0,
    fill: RATING_COLORS[rating],
  }));

  const selectedChartCount =
    metrics?.customer_credit_rating_distribution?.rows.find(
      (row) => row.rating === selectedRating,
    )?.customer_count;
  const reconciliationIdentity =
    selectedRating === null
      ? null
      : `${companyId}:${userId}:${selectedRating}`;

  const runReconciliation = useCallback(async () => {
    if (!selectedRating) return;
    setReconciliationState("refreshing");
    const [dashboardResult, customerResult] = await Promise.all([
      refetchDashboard(),
      customerQuery.refetch(),
    ]);
    if (dashboardResult.isError || customerResult.isError) {
      setReconciliationState("matched");
      return;
    }
    const refreshedChartCount =
      dashboardResult.data?.customer_credit_rating_distribution?.rows.find(
        (row) => row.rating === selectedRating,
      )?.customer_count;
    const refreshedListCount = customerResult.data?.pagination.total;
    setReconciliationState(
      refreshedChartCount !== undefined &&
          refreshedListCount !== undefined &&
          refreshedChartCount === refreshedListCount
        ? "matched"
        : "persistent",
    );
  }, [customerQuery, refetchDashboard, selectedRating]);

  useEffect(() => {
    const identity = `${companyId}:${userId}`;
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      attemptedIdentity.current = null;
      setSelectedRating(null);
      setCustomerPage(1);
      setReconciliationState("matched");
    }
  }, [companyId, userId]);

  useEffect(() => {
    const listCount = customerQuery.data?.pagination.total;
    if (
      !reconciliationIdentity ||
      selectedChartCount === undefined ||
      listCount === undefined ||
      customerQuery.isLoading ||
      customerQuery.isError
    ) {
      return;
    }
    if (selectedChartCount === listCount) {
      attemptedIdentity.current = null;
      setReconciliationState("matched");
      return;
    }
    if (attemptedIdentity.current !== reconciliationIdentity) {
      attemptedIdentity.current = reconciliationIdentity;
      void runReconciliation();
    }
  }, [
    customerQuery.data,
    customerQuery.isError,
    customerQuery.isLoading,
    reconciliationIdentity,
    runReconciliation,
    selectedChartCount,
  ]);

  const selectRating = (rating: string) => {
    const typedRating = rating as CreditRating;
    setTriggerElement(ratingButtons.current.get(rating) ?? null);
    attemptedIdentity.current = null;
    setCustomerPage(1);
    setReconciliationState("matched");
    setSelectedRating(typedRating);
  };

  const closeDialog = () => {
    setSelectedRating(null);
    setCustomerPage(1);
    setReconciliationState("matched");
    attemptedIdentity.current = null;
  };

  const isForbidden = error instanceof ApiError && error.status === 403;
  if (isError && !metrics) {
    return (
      <div className="space-y-6">
        <DashboardHeader meta={meta} />
        <div className="glass-card flex flex-col items-center justify-center gap-3 p-12 text-center">
          {isForbidden ? (
            <>
              <ShieldAlert className="h-10 w-10 text-amber-500" />
              <h2 className="text-lg font-semibold text-slate-900">
                Dashboard not available for your role
              </h2>
              <p className="max-w-md text-sm text-slate-500">
                Your role does not have access to the AR dashboard metrics. If
                you believe this is an error, contact your administrator.
              </p>
            </>
          ) : (
            <>
              <AlertTriangle className="h-10 w-10 text-red-500" />
              <h2 className="text-lg font-semibold text-slate-900">
                Couldn&apos;t load the dashboard
              </h2>
              <p className="max-w-md text-sm text-slate-500">
                {error instanceof Error
                  ? error.message
                  : "An unexpected error occurred."}
              </p>
              <button
                onClick={() => refetchDashboard()}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent-fill px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-fill-hover"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader meta={meta} />

      {/* ─── Primary KPI Cards (base currency) ─────────────────────── */}
      <div className="ds-aurora grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      <Reveal className="glass-card p-4">
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
      </Reveal>

      {/* ─── Charts Row 1: Aging + Composition ────────────────────── */}
      <Reveal className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgingChart data={agingChartData} isLoading={isLoading} currency={currency} />
        <CompositionChart data={donutData} currency={currency} isLoading={isLoading} />
      </Reveal>

      {/* ─── Charts Row 2: Collection Trend + Credit Rating ───────── */}
      <Reveal className="grid grid-cols-1 gap-6 lg:grid-cols-2" delayMs={60}>
        <CollectionTrendChart data={trendData} currency={currency} isLoading={isLoading} />
        <CreditRiskChart
          data={creditRatingData}
          isLoading={isLoading}
          onSelectRating={selectRating}
          onButtonRef={(rating, element) => {
            if (element) ratingButtons.current.set(rating, element);
            else ratingButtons.current.delete(rating);
          }}
          activeRating={selectedRating}
        />
      </Reveal>

      <CreditRatingCustomerDialog
        open={selectedRating !== null}
        rating={selectedRating}
        page={customerPage}
        result={customerQuery.data}
        isLoading={customerQuery.isLoading}
        isFetching={customerQuery.isFetching}
        isError={customerQuery.isError}
        reconciliationState={reconciliationState}
        triggerElement={triggerElement}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        onPageChange={setCustomerPage}
        onRetry={() => {
          void customerQuery.refetch();
        }}
        onRefresh={() => {
          attemptedIdentity.current = reconciliationIdentity;
          void runReconciliation();
        }}
      />

      {/* ─── Top Outstanding Customers ─────────────────────────────── */}
      <Reveal>
        <TopCustomers
          data={metrics?.top_outstanding_customers ?? []}
          currency={currency}
          isLoading={isLoading}
        />
      </Reveal>
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
