"use client";

import { useState } from "react";
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
import { useSyncRuns } from "@/hooks/use-automation";
import {
  PROVIDER_TYPES,
  RUN_STATUSES,
  type ProviderType,
  type RunStatus,
} from "@/lib/automation/contract";
import {
  PROVIDER_LABEL,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
} from "@/lib/automation/labels";
import { formatDateTime, safeCursor } from "@/lib/automation/format";

export default function ProcessingRunsPage() {
  const [page, setPage] = useState(1);
  const [provider, setProvider] = useState<ProviderType | undefined>();
  const [status, setStatus] = useState<RunStatus | undefined>();

  const { data, isLoading, isError, isFetching, refetch } = useSyncRuns({
    page,
    page_size: 15,
    provider_type: provider,
    status,
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSelect
          label="Provider"
          value={provider}
          options={PROVIDER_TYPES}
          optionLabel={(p) => PROVIDER_LABEL[p]}
          onChange={(v) => {
            setProvider(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={RUN_STATUSES}
          optionLabel={(s) => RUN_STATUS_LABEL[s]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </FilterBar>

      {isLoading ? (
        <AutomationLoading label="Loading processing runs" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No processing runs yet"
          description="Mailbox synchronization runs will appear here once automation is configured and enabled."
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium" title="Messages persisted / discovered">Msgs</th>
                  <th className="px-3 py-2 font-medium" title="Duplicate messages">Dup</th>
                  <th className="px-3 py-2 font-medium" title="Attachments persisted / discovered">Attach</th>
                  <th className="px-3 py-2 font-medium" title="Duplicate attachments">Dup</th>
                  <th className="px-3 py-2 font-medium">Processed</th>
                  <th className="px-3 py-2 font-medium">Cmds</th>
                  <th className="px-3 py-2 font-medium">Alloc</th>
                  <th className="px-3 py-2 font-medium">Fail</th>
                  <th className="px-3 py-2 font-medium" title="Attempt / max attempts">Try</th>
                  <th className="px-3 py-2 font-medium">Cursor</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((run) => (
                  <tr key={run.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2 text-slate-700">
                      {PROVIDER_LABEL[run.provider_type]}
                    </td>
                    <td className="px-3 py-2">
                      <AutomationBadge
                        label={RUN_STATUS_LABEL[run.status]}
                        tone={RUN_STATUS_TONE[run.status]}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatDateTime(run.started_at)}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDateTime(run.completed_at)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.messages_persisted}/{run.messages_discovered}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{run.duplicate_messages}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.attachments_persisted}/{run.attachments_discovered}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{run.duplicate_attachments}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.attachments_processed}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.commands_processed}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.allocations_completed}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{run.failures}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{run.attempt_count}/{run.max_attempts}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {safeCursor(run.cursor_before)} → {safeCursor(run.cursor_after)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {run.redacted_error_code ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} page={page} onPage={setPage} isFetching={isFetching} />
        </div>
      )}
    </div>
  );
}
