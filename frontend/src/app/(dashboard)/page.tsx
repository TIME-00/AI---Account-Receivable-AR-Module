"use client";

import { useDashboardSummary, useAgingSummary } from "@/hooks/use-dashboard";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatCurrency } from "@/lib/utils";
import { DollarSign, AlertTriangle, FileText, Clock } from "lucide-react";

import { AgingChart, AGING_COLORS } from "@/components/features/dashboard/aging-chart";
import { CompositionChart } from "@/components/features/dashboard/composition-chart";
import { DsoTrendChart } from "@/components/features/dashboard/dso-trend-chart";
import { CreditRiskChart } from "@/components/features/dashboard/credit-risk-chart";
import { QuickStats } from "@/components/features/dashboard/quick-stats";

// ─── Chart Data Constants ───────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  AAA: "#22c55e", AA: "#10b981", A: "#3b82f6",
  B: "#f59e0b", C: "#f97316", D: "#ef4444",
};

// Mock DSO trend data (will be replaced with real API data)
const DSO_TREND_DATA = [
  { month: "Oct", dso: 42 }, { month: "Nov", dso: 38 },
  { month: "Dec", dso: 45 }, { month: "Jan", dso: 40 },
  { month: "Feb", dso: 36 }, { month: "Mar", dso: 33 },
];

// Mock credit risk distribution (will be replaced with real API data)
const CREDIT_RISK_DATA = [
  { rating: "AAA", count: 15, amount: 580000, fill: RISK_COLORS.AAA },
  { rating: "AA", count: 22, amount: 420000, fill: RISK_COLORS.AA },
  { rating: "A", count: 35, amount: 310000, fill: RISK_COLORS.A },
  { rating: "B", count: 12, amount: 180000, fill: RISK_COLORS.B },
  { rating: "C", count: 5, amount: 95000, fill: RISK_COLORS.C },
  { rating: "D", count: 2, amount: 45000, fill: RISK_COLORS.D },
];

// ─── Dashboard Page ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useDashboardSummary();
  const { data: aging, isLoading: agingLoading } = useAgingSummary();
  const isLoading = summaryLoading || agingLoading;

  // Prepare aging chart data
  const agingChartData = aging?.aging_summary?.map((bucket, i) => ({
    name: bucket.bucket_name,
    amount: bucket.total_outstanding,
    count: bucket.invoice_count,
    fill: AGING_COLORS[i],
  })) ?? [];

  // Prepare donut chart data
  const donutData = [
    { name: "Current Outstanding", value: (summary?.total_ar_balance ?? 0) - (summary?.total_overdue_balance ?? 0) },
    { name: "Overdue Balance", value: summary?.total_overdue_balance ?? 0 },
    { name: "Unapplied Receipts", value: summary?.total_credit_balance ?? 0 },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">AR Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Accounts Receivable Overview · Real-Time Data</p>
      </div>

      {/* ─── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total AR Balance"
          value={formatCurrency(summary?.total_ar_balance ?? 0)}
          subtitle="Total AR Balance"
          icon={DollarSign}
          variant="info"
          isLoading={isLoading}
        />
        <KpiCard
          title="Overdue Amount"
          value={formatCurrency(summary?.total_overdue_balance ?? 0)}
          subtitle={`${summary?.overdue_percentage?.toFixed(1) ?? "0.0"}% of Total AR`}
          icon={AlertTriangle}
          variant="danger"
          isLoading={isLoading}
          trend={
            summary?.overdue_percentage !== undefined
              ? { value: `${summary.overdue_percentage.toFixed(1)}% Overdue Rate`, isPositive: summary.overdue_percentage < 15 }
              : undefined
          }
        />
        <KpiCard
          title="Open Invoices"
          value={String(summary?.open_invoices ?? 0)}
          subtitle={`${summary?.total_invoices ?? 0} Total Invoices`}
          icon={FileText}
          variant="warning"
          isLoading={isLoading}
        />
        <KpiCard
          title="Overdue Invoices"
          value={String(summary?.overdue_invoices ?? 0)}
          subtitle={`${summary?.total_receipts ?? 0} Receipts Recorded`}
          icon={Clock}
          variant={(summary?.overdue_invoices ?? 0) > 10 ? "danger" : "success"}
          isLoading={isLoading}
        />
      </div>

      {/* ─── Charts Row 1: Aging + Composition ────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgingChart data={agingChartData} isLoading={isLoading} />
        <CompositionChart data={donutData} isLoading={isLoading} />
      </div>

      {/* ─── Charts Row 2: DSO + Credit Risk ──────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DsoTrendChart data={DSO_TREND_DATA} />
        <CreditRiskChart data={CREDIT_RISK_DATA} />
      </div>

      {/* ─── Quick Stats Row ─────────────────────────────────────── */}
      <QuickStats
        totalCustomers={aging?.total_customers ?? "-"}
        collectionRate={
          aging?.total_outstanding
            ? `${(100 - (aging.overdue_percentage ?? 0)).toFixed(1)}%`
            : "-"
        }
        totalReceipts={summary?.total_receipts ?? "-"}
        creditBalance={summary?.total_credit_balance ?? 0}
      />
    </div>
  );
}
