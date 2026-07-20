"use client";

import { cn } from "@/lib/utils";
import { formatMoneySafe } from "@/lib/currency";

interface Customer {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_type: string;
  default_currency: string;
  credit_rating: string;
  credit_limit: number;
  payment_term_id?: string | null;
}

interface CustomerSearchOverlayProps {
  customers: Customer[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showList: boolean;
  onShowList: (show: boolean) => void;
  selectedName: string;
  onSelect: (customer: Customer) => void;
  error?: string;
  className?: string;
}

export function CustomerSearchOverlay({
  customers,
  searchQuery,
  onSearchChange,
  showList,
  onShowList,
  selectedName,
  onSelect,
  error,
  className,
}: CustomerSearchOverlayProps) {
  return (
    <div className={cn("md:col-span-2", className)}>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">
        Customer <span className="text-red-400">*</span>
      </label>
      <div className="relative">
        <input
          type="text"
          value={selectedName || searchQuery}
          onChange={(e) => {
            onSearchChange(e.target.value);
            onShowList(true);
          }}
          onFocus={() => onShowList(true)}
          placeholder="Search customer name or ID..."
          className={cn(
            "input-premium w-full",
            error && "!border-red-500 !ring-red-500/30"
          )}
        />

        {showList && customers.length > 0 && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            {customers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-700">{c.customer_name}</p>
                  <p className="text-[11px] text-slate-500">
                    {c.customer_id} · {c.customer_type} · {c.default_currency}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      c.credit_rating === "D"
                        ? "bg-red-50 text-red-600"
                        : c.credit_rating === "C"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-emerald-50 text-emerald-600"
                    )}
                  >
                    {c.credit_rating}
                  </span>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Limit: {formatMoneySafe(c.credit_limit, c.default_currency)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
