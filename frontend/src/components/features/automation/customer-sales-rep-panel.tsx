"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import {
  useAssignSalesRepresentative,
  useAuditEvents,
  useCustomerAssignmentHistory,
  useCustomerCurrentAssignment,
  useSalesRepresentatives,
} from "@/hooks/use-automation";
import { useUserRole } from "@/hooks/use-user-role";
import { hasAutomationReadCapability } from "@/lib/automation/navigation";
import { ApiError } from "@/hooks/use-api";
import { AutomationBadge } from "@/components/features/automation/automation-badge";
import { AutomationDialog } from "@/components/features/automation/dialog";
import { Pagination } from "@/components/features/automation/collection";
import {
  AuditTimeline,
  AuditTimelineHeading,
} from "@/components/features/automation/audit-timeline";
import { ASSIGNMENT_SOURCES, type AssignmentSource } from "@/lib/automation/contract";
import { ASSIGNMENT_SOURCE_LABEL } from "@/lib/automation/labels";
import { formatDateTime } from "@/lib/automation/format";

const ASSIGN_ROLES = ["AR Supervisor", "Finance Manager"];

export function CustomerSalesRepPanel({ customerId }: { customerId: string }) {
  const { roles, isResolved } = useUserRole();
  const canAssign = roles.some((r) => ASSIGN_ROLES.includes(r));
  // Reading the responsible representative is a customer-scoped read (AR Clerk,
  // AR Supervisor, Finance Manager, Auditor). System Admin is configuration-only
  // and excluded — render a safe notice and issue no assignment/audit queries.
  const canRead = isResolved && hasAutomationReadCapability(roles, "customerAssignment");

  const current = useCustomerCurrentAssignment(customerId);
  const [historyPage, setHistoryPage] = useState(1);
  const history = useCustomerAssignmentHistory(customerId, {
    page: historyPage,
    page_size: 10,
  });
  const reps = useSalesRepresentatives({ page: 1, page_size: 100, is_active: true });
  const assign = useAssignSalesRepresentative(customerId);

  const currentAssignmentId = current.data?.assignment.id;
  // Entity-scoped audit for THIS assignment record (entity_type = table name,
  // entity_id = assignment id — see Migration 034 audit triggers).
  const audit = useAuditEvents({
    page: 1,
    page_size: 10,
    entity_type: "customer_sales_representative_assignments",
    entity_id: currentAssignmentId,
  });

  const [open, setOpen] = useState(false);
  const [repId, setRepId] = useState("");
  const [source, setSource] = useState<AssignmentSource>("manual_assignment");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeReps = reps.data?.rows ?? [];
  const isReassignment = Boolean(current.data);

  function submit() {
    if (!repId) {
      setError("Select an active sales representative.");
      return;
    }
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    setError(null);
    assign.mutate(
      { sales_representative_id: repId, assignment_source: source, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(
            isReassignment ? "Responsible representative reassigned." : "Representative assigned.",
          );
          setOpen(false);
          setRepId("");
          setReason("");
        },
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : "Assignment was rejected."),
      },
    );
  }

  if (!canRead) {
    return (
      <section className="glass-card space-y-2 p-6" aria-labelledby="sales-rep-heading">
        <h2
          id="sales-rep-heading"
          className="flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" /> Responsible Sales Representative
        </h2>
        <p className="text-xs text-slate-500">
          Customer representative assignment is not available for your role.
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card space-y-4 p-6" aria-labelledby="sales-rep-heading">
      <div className="flex items-center justify-between">
        <h2
          id="sales-rep-heading"
          className="flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <UserRound className="h-4 w-4" aria-hidden="true" /> Responsible Sales Representative
        </h2>
        {canAssign && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {isReassignment ? "Reassign" : "Assign"}
          </button>
        )}
      </div>

      {current.isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : current.isError ? (
        <p className="text-xs text-red-600">Assignment could not be loaded.</p>
      ) : current.data ? (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-slate-800">
            {current.data.sales_representative.name}{" "}
            <AutomationBadge
              label={current.data.sales_representative.is_active ? "Active" : "Inactive"}
              tone={current.data.sales_representative.is_active ? "success" : "muted"}
            />
          </p>
          <p className="text-xs text-slate-500">
            {current.data.sales_representative.email ?? "No email"} ·{" "}
            {current.data.sales_representative.phone ?? "No phone"}
          </p>
          <p className="text-xs text-slate-500">
            Source: {ASSIGNMENT_SOURCE_LABEL[current.data.assignment.assignment_source]} ·
            Assigned {formatDateTime(current.data.assignment.assigned_at)}
          </p>
          {current.data.assignment.assignment_reason && (
            <p className="text-xs text-slate-500">
              Reason: {current.data.assignment.assignment_reason}
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            Exactly one current representative is enforced by the backend.
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          No responsible representative assigned. Invoice reminders cannot be sent
          until one is assigned.
        </p>
      )}

      {/* History — shows the HISTORICAL representative identity for each row. */}
      {history.data && history.data.rows.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-600">
            Assignment history ({history.data.meta.total})
          </summary>
          <ul className="mt-2 space-y-2">
            {history.data.rows.map((row) => (
              <li
                key={row.assignment.id}
                className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"
              >
                <p className="font-medium text-slate-700">
                  {row.sales_representative.name}
                  <span className="ml-1 font-normal text-slate-400">
                    · {row.sales_representative.email ?? "No email"}
                  </span>
                </p>
                <p className="text-slate-500">
                  {ASSIGNMENT_SOURCE_LABEL[row.assignment.assignment_source]} ·{" "}
                  {formatDateTime(row.assignment.assigned_at)}
                  {row.assignment.superseded_at
                    ? ` → superseded ${formatDateTime(row.assignment.superseded_at)}`
                    : " · current"}
                </p>
                {row.assignment.assignment_reason && (
                  <p className="text-slate-400">Reason: {row.assignment.assignment_reason}</p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Pagination
              meta={history.data.meta}
              page={historyPage}
              onPage={setHistoryPage}
              isFetching={history.isFetching}
            />
          </div>
        </details>
      )}

      {/* Audit timeline for the current assignment record. */}
      {currentAssignmentId && audit.data && audit.data.rows.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <AuditTimelineHeading />
          <AuditTimeline events={audit.data.rows} />
        </div>
      )}

      <AutomationDialog
        open={open && canAssign}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title={isReassignment ? "Reassign representative" : "Assign representative"}
        description={
          isReassignment
            ? "Reassign this customer's responsible sales representative. This records a new assignment with a required reason and preserves the full immutable history; it has no direct financial impact."
            : "Assign a responsible sales representative to this customer. This records an assignment with a required reason; it has no direct financial impact."
        }
        visuallyHiddenDescription
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={assign.isPending}
              className="rounded-lg bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Confirm
            </button>
          </>
        }
      >
        <label className="block text-xs font-medium text-slate-700">
          Active representative
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select…</option>
            {activeReps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Assignment source
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AssignmentSource)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {ASSIGNMENT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {ASSIGNMENT_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Reason (required)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
          />
        </label>
        {error && (
          <p role="alert" aria-live="assertive" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </AutomationDialog>
    </section>
  );
}
