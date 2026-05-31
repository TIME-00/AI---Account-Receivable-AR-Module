// ============================================================================
// TSH Synergy AR — Allocation API Hooks (TanStack Query)
// Handles data fetching and mutations for the Allocation Wizard.
// ============================================================================

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Receipt, Invoice, AllocationDetail, Customer } from "@/types";
import type { AllocationReceipt, AllocationInvoice } from "@/hooks/use-allocation-logic";
import { filterVisibleCustomerRecords } from "@/lib/customer-visibility";

// ─── Query: Fetch Posted Receipts with unallocated balance ──────────────────

export function usePostedReceipts(customerId?: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", "posted", customerId],
    queryFn: async () => {
      // useApi() returns json.data = Receipt[] (raw array).
      const [receipts, customers] = await Promise.all([
        api.get<Receipt[]>("/receipts", {
          params: {
            page: 1,
            page_size: 50,
            status: "Posted",
            customer_id: customerId,
          },
        }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);

      // Map to AllocationReceipt and filter those with unallocated balance
      const mapped: AllocationReceipt[] = filterVisibleCustomerRecords(receipts ?? [], customers)
        .filter((r) => r.unallocated_amount > 0.005)
        .map((r) => ({
          id: r.id,
          receipt_no: r.receipt_no,
          receipt_date: r.receipt_date,
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          currency: r.currency,
          exchange_rate: r.exchange_rate,
          receipt_amount: r.receipt_amount,
          unallocated_amount: r.unallocated_amount,
          payment_method: r.payment_method,
          status: r.status,
        }));

      return mapped;
    },
    enabled: true,
    staleTime: 30_000,
  });
}

// ─── Query: Fetch Outstanding Invoices for a customer ───────────────────────

export function useOutstandingInvoices(customerId: string, currency: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["invoices", "outstanding", customerId, currency],
    queryFn: async () => {
      // useApi() returns json.data = Invoice[] (raw array).
      const [invoices, customers] = await Promise.all([
        api.get<Invoice[]>("/invoices", {
          params: {
            page: 1,
            page_size: 100,
            customer_id: customerId,
            // Fetch Open + Overdue + Partially Paid
          },
        }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);

      const today = new Date();
      const mapped: AllocationInvoice[] = filterVisibleCustomerRecords(invoices ?? [], customers)
        .filter(
          (inv) =>
            ["Open", "Overdue", "Partially Paid"].includes(inv.status) &&
            inv.outstanding > 0.005 &&
            inv.currency === currency &&
            ["Invoice", "Debit Note"].includes(inv.doc_type)
        )
        .map((inv) => {
          const dueDate = inv.due_date ? new Date(inv.due_date) : null;
          const overdueDays = dueDate
            ? Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
            : 0;

          return {
            id: inv.id,
            invoice_no: inv.invoice_no,
            doc_type: inv.doc_type,
            invoice_date: inv.invoice_date,
            due_date: inv.due_date,
            currency: inv.currency,
            exchange_rate: inv.exchange_rate,
            total_amount: inv.total_amount,
            outstanding: inv.outstanding,
            overdue_days: overdueDays,
          };
        })
        .sort((a, b) => {
          // Sort by due_date ASC (oldest first) to match FIFO
          const dA = a.due_date ?? "9999-12-31";
          const dB = b.due_date ?? "9999-12-31";
          return dA.localeCompare(dB);
        });

      return mapped;
    },
    enabled: !!customerId && !!currency,
    staleTime: 15_000,
  });
}

// ─── Mutation: Execute Manual Allocation ─────────────────────────────────────

export function useManualAllocate() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      receipt_id: string;
      allocations: Array<{ invoice_id: string; amount: number; discount_amount?: number }>;
    }) => {
      return api.post<AllocationDetail[]>("/allocations/manual", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["allocations"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Execute Auto Allocation (DISABLED for Sprint F1) ───────────────
// IMPORTANT: POST /allocations/auto is NOT in the verified Sprint F1 endpoint list.
// This hook is disabled. Use useManualAllocate() instead.

export function useAutoAllocate() {
  return useMutation({
    mutationFn: async (_payload: { receipt_id: string; method: "FIFO" | "AmountMatch" }) => {
      // DISABLED: /allocations/auto is not a verified Sprint F1 endpoint.
      // This will be enabled when the endpoint is added to the verified list.
      throw new Error(
        "Auto-allocation is not available in the current sprint. Use manual allocation instead."
      );
    },
  });
}
