"use client";

import { cn } from "@/lib/utils";
import { Search, XCircle } from "lucide-react";

const STATUS_TABS = [
  { value: "",               label: "All statuses" },
  { value: "Draft",          label: "Draft" },
  { value: "Posted",         label: "Posted" },
  { value: "Fully Allocated",label: "Fully Allocated" },
  { value: "Cancelled",      label: "Cancelled" },
  { value: "Bounced",        label: "Bounced" },
] as const;

interface Customer { id: string; customer_name: string; }

interface ReceiptFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  customerFilter: string;
  onCustomerFilterChange: (id: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  customers: Customer[];
  onResetPage: () => void;
}

export function ReceiptFilters({
  searchQuery, onSearchChange,
  customerFilter, onCustomerFilterChange,
  statusFilter, onStatusFilterChange,
  customers, onResetPage,
}: ReceiptFiltersProps) {
  const hasFilters = searchQuery || customerFilter || statusFilter;

  return (
    <div className="glass-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { onSearchChange(e.target.value); onResetPage(); }}
            placeholder="Search receipt no., customer, reference..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {/* Customer filter */}
        <select
          value={customerFilter}
          onChange={(e) => { onCustomerFilterChange(e.target.value); onResetPage(); }}
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">All Customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.customer_name}</option>
          ))}
        </select>

        {/* Reset */}
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              onSearchChange(""); onCustomerFilterChange(""); onStatusFilterChange(""); onResetPage();
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
          >
            <XCircle className="h-3 w-3" />
            Clear Filters
          </button>
        )}
      </div>

      {/* Status Tabs */}
      <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-200 pt-3">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => { onStatusFilterChange(tab.value); onResetPage(); }}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-all",
              statusFilter === tab.value
                ? "bg-brand-50 text-brand-600 ring-1 ring-brand-200"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
