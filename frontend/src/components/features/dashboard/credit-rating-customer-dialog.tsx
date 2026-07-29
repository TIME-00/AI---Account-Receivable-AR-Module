"use client";

import { useRef } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { CUSTOMER_PAGE_SIZE, type CustomerListResult } from "@/hooks/use-customers";
import type { CreditRating } from "@/types";

export type ReconciliationState = "matched" | "refreshing" | "persistent";

interface CreditRatingCustomerDialogProps {
  open: boolean;
  rating: CreditRating | null;
  page: number;
  result: CustomerListResult | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  reconciliationState: ReconciliationState;
  triggerElement: HTMLButtonElement | null;
  onOpenChange: (open: boolean) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onRefresh: () => void;
}

export function CreditRatingCustomerDialog({
  open,
  rating,
  page,
  result,
  isLoading,
  isFetching,
  isError,
  reconciliationState,
  triggerElement,
  onOpenChange,
  onPageChange,
  onRetry,
  onRefresh,
}: CreditRatingCustomerDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = rating ? `Customers rated ${rating}` : "Customers by credit rating";
  const total = result?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const reconciling = reconciliationState === "refreshing";
  const persistentMismatch = reconciliationState === "persistent";
  const showRows =
    !isLoading && !isError && !reconciling && !persistentMismatch && Boolean(result);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/45" />
        <Dialog.Content
          aria-modal="true"
          className="fixed inset-x-4 top-1/2 z-[90] mx-auto flex max-h-[calc(100vh-2rem)] w-auto max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl focus:outline-none sm:inset-x-auto sm:left-1/2 sm:w-[min(760px,calc(100vw-2rem))] sm:-translate-x-1/2"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerElement?.focus();
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-slate-900">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-500">
                {rating
                  ? `All visible customers in credit rating ${rating}, including customers with no outstanding balance.`
                  : "Select a customer credit rating."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div aria-live="polite" className="sr-only">
              {isLoading || isFetching
                ? `Loading customers rated ${rating ?? ""}.`
                : ""}
            </div>

            {reconciling && (
              <div role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Customer data changed. Refreshing the latest list.
              </div>
            )}

            {persistentMismatch && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>Customer data changed. Refresh to view the latest list.</p>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Refresh
                </button>
              </div>
            )}

            {!reconciling && !persistentMismatch && isLoading && (
              <div role="status" className="flex min-h-48 items-center justify-center text-sm text-slate-500">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading customers for this rating.
              </div>
            )}

            {!reconciling && !persistentMismatch && isError && (
              <div role="alert" className="flex min-h-48 flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-red-700">
                  Unable to load customers for this rating.
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  Retry
                </button>
              </div>
            )}

            {showRows && result!.rows.length === 0 && (
              <p className="py-16 text-center text-sm text-slate-500">
                No customers with rating {rating}.
              </p>
            )}

            {showRows && result!.rows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  {total} matching customer{total === 1 ? "" : "s"}
                </p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {result!.rows.map((customer) => (
                    <li key={customer.id} className="p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          {customer.customer_name}
                        </Link>
                        <p className="mt-0.5 break-all text-xs text-slate-500">
                          {customer.customer_id}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center gap-2 sm:mt-0">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {customer.credit_rating}
                        </span>
                        <StatusBadge status={customer.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <Link
              href={rating ? `/reports/aging?credit_rating=${encodeURIComponent(rating)}` : "/reports/aging"}
              className="text-sm font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              View aging report
            </Link>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                aria-label="Previous customer page"
                onClick={() => onPageChange(page - 1)}
                disabled={page <= 1 || isFetching || !showRows}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next customer page"
                onClick={() => onPageChange(page + 1)}
                disabled={page >= totalPages || isFetching || !showRows}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
