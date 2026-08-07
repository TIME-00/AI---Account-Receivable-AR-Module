"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import {
  AutomationEmpty,
  AutomationError,
  AutomationLoading,
} from "@/components/features/automation/states";
import {
  FilterBar,
  FilterSelect,
  Pagination,
} from "@/components/features/automation/collection";
import { useAllocateCommand, useAutomationCommands } from "@/hooks/use-automation";
import { useUserRole } from "@/hooks/use-user-role";
import { ApiError } from "@/hooks/use-api";
import {
  COMMAND_STATUSES,
  COMMAND_TYPES,
  type CommandStatus,
  type CommandType,
} from "@/lib/automation/contract";
import {
  COMMAND_STATUS_LABEL,
  COMMAND_STATUS_TONE,
  COMMAND_TYPE_LABEL,
} from "@/lib/automation/labels";
import { formatDateTime } from "@/lib/automation/format";

const ALLOCATE_ROLES = ["AR Clerk", "AR Supervisor", "Finance Manager"];

export default function AutomationCommandsPage() {
  const { roles } = useUserRole();
  const canAllocate = roles.some((r) => ALLOCATE_ROLES.includes(r));

  const [page, setPage] = useState(1);
  const [type, setType] = useState<CommandType | undefined>();
  const [status, setStatus] = useState<CommandStatus | undefined>();

  const { data, isLoading, isError, isFetching, refetch } = useAutomationCommands({
    page,
    page_size: 15,
    command_type: type,
    status,
  });
  const allocate = useAllocateCommand();

  function runAllocation(id: string) {
    // Posts exactly {}. The backend re-derives receipt, invoices, amounts,
    // evidence, tenant, customer, and FX — the frontend supplies none of them.
    allocate.mutate(id, {
      onSuccess: () => toast.success("Allocation completed by the database."),
      onError: (error) =>
        toast.error(error instanceof ApiError ? error.message : "Allocation was rejected."),
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500">
        Commands are database-authoritative. The allocation action sends an empty
        request; the backend re-derives all financial authority.
      </div>

      <FilterBar>
        <FilterSelect
          label="Type"
          value={type}
          options={COMMAND_TYPES}
          optionLabel={(t) => COMMAND_TYPE_LABEL[t]}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={COMMAND_STATUSES}
          optionLabel={(s) => COMMAND_STATUS_LABEL[s]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </FilterBar>

      {isLoading ? (
        <AutomationLoading label="Loading commands" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No automation commands yet"
          description="Invoice, receipt, and allocation commands will appear here once documents are processed."
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Command</th>
                  <th className="px-3 py-2 font-medium">Mode</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((command) => {
                  // Allocation eligibility mirrors the backend EXACTLY: only a
                  // completed create_receipt command that produced a Receipt is
                  // eligible. allocate_receipt commands and result-less or
                  // non-completed create_receipt commands are never offered —
                  // the backend would refuse them with
                  // ALLOCATION_EVIDENCE_INSUFFICIENT.
                  const canRun =
                    canAllocate &&
                    command.command_type === "create_receipt" &&
                    command.status === "completed" &&
                    command.resulting_receipt_id !== null;
                  return (
                    <tr key={command.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-3 py-2 font-medium text-slate-700">
                        {COMMAND_TYPE_LABEL[command.command_type]}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{command.operating_mode}</td>
                      <td className="px-3 py-2">
                        <AutomationBadge
                          label={COMMAND_STATUS_LABEL[command.status]}
                          tone={COMMAND_STATUS_TONE[command.status]}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {command.resulting_invoice_id ? (
                          <Link
                            href={`/invoices/${command.resulting_invoice_id}`}
                            className="font-semibold text-brand-600 hover:underline"
                          >
                            View invoice →
                          </Link>
                        ) : command.resulting_receipt_id ? (
                          <Link
                            href={`/receipts/${command.resulting_receipt_id}`}
                            className="font-semibold text-brand-600 hover:underline"
                          >
                            View receipt →
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">
                        {command.failure_code ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDateTime(command.created_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canRun && (
                          <button
                            type="button"
                            onClick={() => runAllocation(command.id)}
                            disabled={allocate.isPending}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                          >
                            Run allocation
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} page={page} onPage={setPage} isFetching={isFetching} />
        </div>
      )}
    </div>
  );
}
