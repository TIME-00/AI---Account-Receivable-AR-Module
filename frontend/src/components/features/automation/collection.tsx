"use client";

import { cn } from "@/lib/utils";
import type { CollectionMeta } from "@/lib/automation/contract";

/** Labelled enum filter. "All" clears the filter (undefined value). */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  optionLabel: (value: T) => string;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      <select
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : (event.target.value as T))
        }
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Simple page-based pagination driven by collection meta + has_more. */
export function Pagination({
  meta,
  page,
  onPage,
  isFetching,
}: {
  meta: CollectionMeta | undefined;
  page: number;
  onPage: (page: number) => void;
  isFetching?: boolean;
}) {
  const hasPrev = page > 1;
  const hasNext = Boolean(meta?.has_more);
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <span>
        Page {page}
        {meta ? ` · ${meta.total} total` : ""}
        {isFetching ? " · updating…" : ""}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => onPage(page - 1)}
          className={cn(
            "rounded-lg border px-2 py-1 font-semibold",
            hasPrev
              ? "border-slate-300 text-slate-700 hover:bg-slate-50"
              : "border-slate-200 text-slate-300",
          )}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
          className={cn(
            "rounded-lg border px-2 py-1 font-semibold",
            hasNext
              ? "border-slate-300 text-slate-700 hover:bg-slate-50"
              : "border-slate-200 text-slate-300",
          )}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Filter toolbar container that stays usable on mobile (wraps, scrolls). */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      {children}
    </div>
  );
}
