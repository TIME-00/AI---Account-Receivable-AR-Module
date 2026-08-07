"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
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
import { useDocumentDecisions } from "@/hooks/use-automation";
import {
  CLASSIFICATION_STATUSES,
  DOCUMENT_TYPES,
  type ClassificationStatus,
  type DocumentDecision,
  type DocumentType,
} from "@/lib/automation/contract";
import {
  CLASSIFICATION_STATUS_LABEL,
  CLASSIFICATION_STATUS_TONE,
  COMMAND_STATUS_LABEL,
  COMMAND_TYPE_LABEL,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_TONE,
  PROCESSING_STATUS_LABEL,
  PROCESSING_STATUS_TONE,
} from "@/lib/automation/labels";
import {
  formatBytes,
  formatConfidence,
  formatDateTime,
} from "@/lib/automation/format";

function DecisionDetail({ decision }: { decision: DocumentDecision }) {
  const { attachment, extraction } = decision;
  return (
    <div className="grid gap-3 bg-slate-50/70 p-4 md:grid-cols-3">
      {/* 1. AI candidate */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          1 · AI Candidate
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Type: {DOCUMENT_TYPE_LABEL[decision.document_type]}
        </p>
        <p className="text-xs text-slate-600">
          Confidence: {formatConfidence(decision.confidence)}
          {decision.critical_field_confidence !== null &&
          decision.critical_field_confidence !== undefined
            ? ` (critical ${formatConfidence(decision.critical_field_confidence)})`
            : ""}
        </p>
        <p className="text-[11px] text-slate-400">
          {decision.provider ?? "—"} / {decision.model ?? "—"} /{" "}
          {decision.provider_version ?? "—"}
        </p>
        <p className="mt-1 text-[11px] italic text-slate-400">
          A candidate only — never a financial approval.
        </p>
      </section>

      {/* 2. Deterministic validation */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          2 · Deterministic Validation
        </p>
        {extraction ? (
          <>
            <p className="mt-1 text-xs text-slate-600">
              Status: {extraction.validation_status}
            </p>
            <p className="text-xs text-slate-600">
              Customer: {extraction.customer_id ? "Resolved" : "Unresolved"}
              {extraction.customer_resolution_method
                ? ` · ${extraction.customer_resolution_method}`
                : ""}
            </p>
            {extraction.validation_codes.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1">
                {extraction.validation_codes.map((code) => (
                  <li
                    key={code}
                    className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                  >
                    {code}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            No extraction (unsupported/ambiguous documents produce no command).
          </p>
        )}
      </section>

      {/* 3. Authoritative result */}
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          3 · Authoritative Result
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Classification: {CLASSIFICATION_STATUS_LABEL[decision.status]}
        </p>
        {attachment ? (
          <p className="text-[11px] text-slate-500">
            {attachment.file_name} · {attachment.content_mime_type ?? "—"} ·{" "}
            {formatBytes(attachment.size_bytes)} ·{" "}
            {attachment.page_count ?? "—"} pp
          </p>
        ) : null}
        {attachment && (
          <p className="mt-1 text-[11px] text-slate-500">
            Scan: {attachment.scan_status ?? "—"} · Safety:{" "}
            {attachment.safety_status ?? "—"}
          </p>
        )}
        <p className="mt-1 text-[11px] text-slate-400">
          {formatDateTime(decision.created_at)}
        </p>

        {/* Linked authoritative command (re-derived, DB-authoritative). */}
        {decision.command ? (
          <p className="mt-1 text-[11px] text-slate-600">
            Command: {COMMAND_TYPE_LABEL[decision.command.command_type]} ·{" "}
            {COMMAND_STATUS_LABEL[decision.command.status]}
            {decision.command.resulting_invoice_id ? (
              <>
                {" · "}
                <Link
                  href={`/invoices/${decision.command.resulting_invoice_id}`}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  View invoice →
                </Link>
              </>
            ) : decision.command.resulting_receipt_id ? (
              <>
                {" · "}
                <Link
                  href={`/receipts/${decision.command.resulting_receipt_id}`}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  View receipt →
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <Link
            href="/automation/commands"
            className="mt-1 inline-block text-[11px] font-semibold text-brand-600 hover:underline"
          >
            View resulting commands →
          </Link>
        )}

        {/* Linked exceptions raised for this decision. */}
        {decision.linked_exception_ids.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-700">
            {decision.linked_exception_ids.length} linked exception
            {decision.linked_exception_ids.length === 1 ? "" : "s"} ·{" "}
            <Link
              href="/automation/exceptions"
              className="font-semibold hover:underline"
            >
              Review →
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

export default function DocumentDecisionsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<DocumentType | undefined>();
  const [status, setStatus] = useState<ClassificationStatus | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useDocumentDecisions({
    page,
    page_size: 15,
    document_type: type,
    status,
  });

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterSelect
          label="Type"
          value={type}
          options={DOCUMENT_TYPES}
          optionLabel={(t) => DOCUMENT_TYPE_LABEL[t]}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          options={CLASSIFICATION_STATUSES}
          optionLabel={(s) => CLASSIFICATION_STATUS_LABEL[s]}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
      </FilterBar>

      {isLoading ? (
        <AutomationLoading label="Loading document decisions" />
      ) : isError || !data ? (
        <AutomationError onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <AutomationEmpty
          title="No document decisions yet"
          description="Classified email attachments will appear here once document intelligence is configured and enabled."
        />
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Processing</th>
                  <th className="px-3 py-2 font-medium">Classification</th>
                  <th className="px-3 py-2 font-medium">Confidence</th>
                  <th className="px-3 py-2 font-medium sr-only">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((decision) => {
                  const open = openId === decision.id;
                  return (
                    <Fragment key={decision.id}>
                      <tr className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-2 text-slate-700">
                          {decision.attachment?.file_name ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <AutomationBadge
                            label={DOCUMENT_TYPE_LABEL[decision.document_type]}
                            tone={DOCUMENT_TYPE_TONE[decision.document_type]}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {decision.attachment && (
                            <AutomationBadge
                              label={
                                PROCESSING_STATUS_LABEL[
                                  decision.attachment.processing_status
                                ]
                              }
                              tone={
                                PROCESSING_STATUS_TONE[
                                  decision.attachment.processing_status
                                ]
                              }
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <AutomationBadge
                            label={CLASSIFICATION_STATUS_LABEL[decision.status]}
                            tone={CLASSIFICATION_STATUS_TONE[decision.status]}
                          />
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">
                          {formatConfidence(decision.confidence)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : decision.id)}
                            aria-expanded={open}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700"
                          >
                            {open ? "Hide" : "Detail"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <DecisionDetail decision={decision} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
