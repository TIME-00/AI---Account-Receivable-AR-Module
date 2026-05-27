// ============================================================================
// TSH Synergy AR — Receipt List Center
// Multi-dimensional filtering, allocation progress bars, and quick actions.
// ============================================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useReceipts, usePostReceipt, useCustomers } from "@/hooks/use-receipts";
import { useUserRole } from "@/hooks/use-user-role";
import { LoadingButton } from "@/components/ui/loading-button";
import { ReceiptFilters } from "@/components/features/receipts/receipt-filters";
import { ReceiptTable } from "@/components/features/receipts/receipt-table";
import { Plus, Wallet } from "lucide-react";

const PAGE_SIZE = 15;

export default function ReceiptsListPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  // ── Data ──────────────────────────────────────────────────────────
  const { data: customers = [] } = useCustomers();
  const { data: receipts = [], isLoading, isError } = useReceipts({
    status: statusFilter || undefined,
    customer_id: customerFilter || undefined,
    search: searchQuery || undefined,
    page,
    page_size: PAGE_SIZE,
  });

  // useApi returns raw Receipt[] — meta.total is not available.
  // Client-side count for prototype.
  const totalCount = receipts.length;
  const totalPages = 1; // No server-side total — single page view

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
        description: `${receiptNo}${(result as any).je_no ? ` · JE: ${(result as any).je_no}` : ""}`,
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
          <LoadingButton variant="primary" onClick={() => router.push("/receipts/new")}>
            <Plus className="h-4 w-4" />
            New Receipt
          </LoadingButton>
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
