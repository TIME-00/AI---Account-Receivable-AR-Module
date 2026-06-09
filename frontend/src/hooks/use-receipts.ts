// ============================================================================
// TSH Synergy AR — Receipt API Hooks (TanStack Query)
// CRUD operations, posting, cancel, and data queries for Receipt management.
// ============================================================================

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Receipt, Customer, BankAccount } from "@/types";
import {
  filterVisibleCustomerRecords,
  filterVisibleCustomers,
  isKnownHiddenCustomer,
} from "@/lib/customer-visibility";

// ─── Query: List Receipts (with filters) ────────────────────────────────────

export function useReceipts(filters: {
  status?: string;
  customer_id?: string;
  search?: string;
  page?: number;
  page_size?: number;
}) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", filters],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        page: filters.page ?? 1,
        page_size: filters.page_size ?? 20,
      };
      if (filters.status) params.status = filters.status;
      if (filters.customer_id) params.customer_id = filters.customer_id;
      if (filters.search) params.search = filters.search;

      // useApi() returns json.data = Receipt[] (raw array).
      // meta.total is discarded by useApi(). Client-side pagination for prototype.
      const [receipts, customers] = await Promise.all([
        api.get<Receipt[]>("/receipts", { params }),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);
      return filterVisibleCustomerRecords(receipts, customers);
    },
    staleTime: 30_000,
  });
}

// ─── Query: Single Receipt ──────────────────────────────────────────────────

export function useReceipt(id: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", id],
    queryFn: async () => {
      const [receipt, customers] = await Promise.all([
        api.get<Receipt>(`/receipts/${id}`),
        api.get<Customer[]>("/customers", { params: { page: 1, page_size: 500 } }),
      ]);
      if (isKnownHiddenCustomer(customers, receipt.customer_id)) {
        throw new Error("Receipt not found");
      }
      return receipt;
    },
    enabled: !!id,
  });
}

// ─── Query: Customers (for customer selector) ───────────────────────────────

export function useCustomers() {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", "list"],
    queryFn: async () => {
      // useApi() returns json.data = Customer[] (raw array).
      return filterVisibleCustomers(await api.get<Customer[]>("/customers", {
        params: { page: 1, page_size: 200 },
      }));
    },
    staleTime: 60_000,
  });
}

// ─── Query: Bank Accounts ───────────────────────────────────────────────────

export function useBankAccounts() {
  const api = useApi();

  return useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      return api.get<BankAccount[]>("/bank-accounts");
    },
    staleTime: 60_000,
  });
}

// ─── Query: Customer Outstanding Total ──────────────────────────────────────

export function useCustomerOutstanding(customerId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", customerId, "outstanding"],
    queryFn: async () => {
      // useApi() returns json.data = Invoice[] (raw array).
      const invoices = await api.get<Array<{ outstanding: number; status: string }>>(
        "/invoices",
        {
          params: {
            customer_id: customerId,
            page: 1,
            page_size: 200,
          },
        }
      );
      // Sum outstanding from Open/Overdue/Partially Paid invoices
      const totalOutstanding = (invoices ?? [])
        .filter((inv) => ["Open", "Overdue", "Partially Paid"].includes(inv.status))
        .reduce((sum: number, inv) => sum + Number(inv.outstanding ?? 0), 0);
      const count = (invoices ?? []).filter((inv) =>
        ["Open", "Overdue", "Partially Paid"].includes(inv.status)
      ).length;

      return { totalOutstanding, invoiceCount: count };
    },
    enabled: !!customerId,
    staleTime: 15_000,
  });
}

// ─── Mutation: Create Receipt ───────────────────────────────────────────────

export function useCreateReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.post<Receipt>("/receipts", data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Post Receipt ─────────────────────────────────────────────────

export function usePostReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, posting_period }: { id: string; posting_period?: string }) => {
      return api.post<Receipt & { je_no?: string }>(`/receipts/${id}/post`, {
        posting_period,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ─── Mutation: Cancel Receipt ───────────────────────────────────────────────

export function useCancelReceipt() {
  const api = useApi();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, cancel_reason }: { id: string; cancel_reason: string }) => {
      return api.post<Receipt>(`/receipts/${id}/cancel`, { cancel_reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
