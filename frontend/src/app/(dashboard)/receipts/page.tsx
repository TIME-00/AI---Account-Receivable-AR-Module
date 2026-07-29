// ============================================================================
// TSH Synergy AR — Receipt List Center
// Multi-dimensional filtering, allocation progress bars, and quick actions.
// ============================================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useReceipts, usePostReceipt, useCustomers } from "@/hooks/use-receipts";
import { totalPagesFrom } from "@/hooks/use-invoices";
import { useUserRole } from "@/hooks/use-user-role";
import { LoadingButton } from "@/components/ui/loading-button";
import { ReceiptFilters } from "@/components/features/receipts/receipt-filters";
import { ReceiptTable } from "@/components/features/receipts/receipt-table";
import { MoneySummary } from "@/components/ui/money-summary";
import { FileSpreadsheet, Plus, Wallet } from "lucide-react";

const PAGE_SIZE = 15;

export default function ReceiptsListPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  // ── Data ──────────────────────────────────────────────────────────
  const { data: customers = [] } = useCustomers();
  const { data, isLoading, isError } = useReceipts({
    status: statusFilter || undefined,
    customer_id: customerFilter || undefined,
    search: searchQuery || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  // Rows for the CURRENT PAGE (backend-scoped; no client re-filtering).
  const receipts = data?.rows ?? [];
  // Batch 9D-D authoritative aggregation (per-currency subtotals + base total).
  const summary = data?.summary;
  const summaryUnavailable = data?.summaryUnavailable;

  // B9DD-FEIR-001: real backend pagination — `total` is the filtered
  // COLLECTION size, not this page's row count.
  const pagination = data?.pagination;
  const totalCount = pagination?.total ?? 0;
  const totalPages = totalPagesFrom(pagination);

  // ── Role gating ────────────────────────────────────────────────────
  const { canPostReceipt, canCreateReceipt } = useUserRole();

  // ── Post mutation ─────────────────────────────────────────────────
  const postMutation = usePostReceipt();
  const [postingId, setPostingId] = useState<string | null>(null);

  const handlePost = async (id: string, receiptNo: string) => {
    setPostingId(id);
    try {
      const result = await postMutation.mutateAsync({ id });
      toast.success("Receipt Posted", {
        description: `${receiptNo}${result.je_no ? ` · JE: ${result.je_no}` : ""}`,
      });
    } catch {
      // Error handled by useApi
    } finally {
      setPostingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Wallet className="h-6 w-6 text-emerald-500" />
            Receipt Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">{totalCount} receipt records</p>
        </div>
        {canCreateReceipt && (
          <div className="flex items-center gap-2">
            <LoadingButton variant="secondary" onClick={() => router.push("/receipts/import")}>
              <FileSpreadsheet className="h-4 w-4" />
              Import CSV/Excel
            </LoadingButton>
            <LoadingButton variant="primary" onClick={() => router.push("/receipts/new")}>
              <Plus className="h-4 w-4" />
              New Receipt
            </LoadingButton>
          </div>
        )}
      </div>

      {/* Filters */}
      <ReceiptFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        customerFilter={customerFilter}
        onCustomerFilterChange={setCustomerFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        customers={customers}
        onResetPage={() => setPage(1)}
      />

      {/* Authoritative multi-currency aggregation (Batch 9D-D) */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneySummary summary={summary.documentTotal} title="Received" />
          <MoneySummary summary={summary.currentBalance} title="Unapplied" />
        </div>
      )}
      {summaryUnavailable && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {summaryUnavailable}
        </p>
      )}

      {/* Table */}
      <ReceiptTable
        receipts={receipts}
        isLoading={isLoading}
        isError={!!isError}
        page={page}
        totalCount={totalCount}
        totalPages={totalPages}
        onPageChange={setPage}
        onPost={handlePost}
        postingId={postingId}
        isPostPending={postMutation.isPending}
        canPostReceipt={canPostReceipt}
      />
    </div>
  );
}
