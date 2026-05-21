// ============================================================================
// TSH Synergy AR — Receipt API Hooks (TanStack Query)
// CRUD operations, posting, cancel, and data queries for Receipt management.
// ============================================================================

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import type { Receipt, Customer, BankAccount } from "@/types";

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

      return api.get<{ receipts: Receipt[]; total: number }>("/receipts", { params });
    },
    staleTime: 30_000,
  });
}

// ─── Query: Single Receipt ──────────────────────────────────────────────────

export function useReceipt(id: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["receipts", id],
    queryFn: () => api.get<Receipt>(`/receipts/${id}`),
    enabled: !!id,
  });
}

// ─── Query: Customers (for customer selector) ───────────────────────────────

export function useCustomers() {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", "list"],
    queryFn: async () => {
      const result = await api.get<{ customers: Customer[]; total: number }>("/customers", {
        params: { page: 1, page_size: 200 },
      });
      return result.customers ?? [];
    },
    staleTime: 60_000,
  });
}

// ─── Query: Bank Accounts (for bank account selector) ───────────────────────

export function useBankAccounts() {
  const api = useApi();

  return useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const result = await api.get<{ bank_accounts: BankAccount[]; total: number }>("/bank-accounts", {
        params: { page: 1, page_size: 100, is_active: "true" },
      });
      return result.bank_accounts ?? [];
    },
    staleTime: 120_000,
  });
}

// ─── Query: Customer Outstanding Total ──────────────────────────────────────

export function useCustomerOutstanding(customerId: string) {
  const api = useApi();

  return useQuery({
    queryKey: ["customers", customerId, "outstanding"],
    queryFn: async () => {
      const result = await api.get<{ invoices: Array<{ outstanding: number }>; total: number }>(
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
      const invoices = result.invoices ?? [];
      const totalOutstanding = invoices
        .filter((inv: any) => ["Open", "Overdue", "Partially Paid"].includes(inv.status))
        .reduce((sum: number, inv: any) => sum + Number(inv.outstanding ?? 0), 0);
      const count = invoices.filter((inv: any) =>
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
