"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Users, Search, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAllCustomers, useAgingByCustomerF2, formatCurrency } from "@/hooks/use-f2-data";
import type { Customer, CustomerAgingRow } from "@/types";
import { CUSTOMER_STATUSES, CREDIT_RATINGS } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";

// ─── Status / Rating badge helpers ──────────────────────────────────────────

const statusColor: Record<string, string> = {
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  Inactive: "bg-slate-50 text-slate-600 ring-slate-500/20",
  Blocked: "bg-red-50 text-red-700 ring-red-600/20",
  "On Hold": "bg-amber-50 text-amber-700 ring-amber-600/20",
};

const ratingColor: Record<string, string> = {
  AAA: "bg-emerald-50 text-emerald-700",
  AA: "bg-emerald-50 text-emerald-700",
  A: "bg-blue-50 text-blue-700",
  B: "bg-amber-50 text-amber-700",
  C: "bg-orange-50 text-orange-700",
  D: "bg-red-50 text-red-700",
};

type SortKey = "customer_name" | "credit_limit" | "outstanding";

export default function CustomersPage() {
  const { data: customers, isLoading, error } = useAllCustomers();
  const { data: agingRaw } = useAgingByCustomerF2();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [ratingFilter, setRatingFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortAsc, setSortAsc] = useState(true);

  // Normalize aging data (may be array or { rows })
  const agingRows: CustomerAgingRow[] = useMemo(() => {
    if (!agingRaw) return [];
    return Array.isArray(agingRaw) ? agingRaw : (agingRaw as any)?.rows ?? [];
  }, [agingRaw]);

  // Build outstanding map keyed by customer id
  const outstandingMap = useMemo(() => {
    const map = new Map<string, number>();
    agingRows.forEach((r) => map.set(r.customer_id, r.total_outstanding));
    return map;
  }, [agingRows]);

  // Filter & sort
  const filtered = useMemo(() => {
    if (!customers) return [];
    let list = [...customers];

    // Status filter
    if (statusFilter !== "All") {
      list = list.filter((c) => c.status === statusFilter);
    }
    // Rating filter
    if (ratingFilter !== "All") {
      list = list.filter((c) => c.credit_rating === ratingFilter);
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.customer_name.toLowerCase().includes(q) ||
          c.customer_id.toLowerCase().includes(q) ||
          c.contact_email.toLowerCase().includes(q)
      );
    }
    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "customer_name") {
        cmp = a.customer_name.localeCompare(b.customer_name);
      } else if (sortKey === "credit_limit") {
        cmp = a.credit_limit - b.credit_limit;
      } else if (sortKey === "outstanding") {
        cmp = (outstandingMap.get(a.id) ?? 0) - (outstandingMap.get(b.id) ?? 0);
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [customers, search, statusFilter, ratingFilter, sortKey, sortAsc, outstandingMap]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1></div>
        <div className="glass-card flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
            <p className="text-sm text-slate-500">Loading customers…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1></div>
        <div className="glass-card flex flex-col items-center justify-center gap-3 py-20">
          <p className="text-sm font-medium text-red-600">Failed to load customers</p>
          <p className="text-xs text-slate-400">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            {filtered.length} customer{filtered.length !== 1 ? "s" : ""} found
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, code, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Status:</span>
          {["All", ...CUSTOMER_STATUSES].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Rating chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 mr-1">Rating:</span>
          {["All", ...CREDIT_RATINGS].map((r) => (
            <button
              key={r}
              onClick={() => setRatingFilter(r)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                ratingFilter === r
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Users className="h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">No customers match your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("customer_name")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Customer Name <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Rating</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("credit_limit")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Credit Limit <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <button onClick={() => toggleSort("outstanding")} className="inline-flex items-center gap-1 hover:text-slate-700">
                      Outstanding <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="group transition-colors hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${c.id}`} className="font-mono text-xs text-slate-500 group-hover:text-blue-600">
                        {c.customer_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/customers/${c.id}`} className="font-medium text-slate-800 group-hover:text-blue-600">
                        {c.customer_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", statusColor[c.status] ?? "bg-slate-50 text-slate-600")}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", ratingColor[c.credit_rating] ?? "bg-slate-50 text-slate-600")}>
                        {c.credit_rating}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {formatCurrency(c.credit_limit)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">
                      {formatCurrency(outstandingMap.get(c.id) ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 truncate max-w-[200px]">
                      {c.contact_email}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
