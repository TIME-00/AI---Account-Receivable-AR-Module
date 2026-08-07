"use client";

import { History } from "lucide-react";
import type { AuditEvent } from "@/lib/automation/contract";
import { AUDIT_ACTOR_TYPES, filterSafeMetadata } from "@/lib/automation/contract";
import { formatDateTime } from "@/lib/automation/format";
import { AutomationEmpty } from "@/components/features/automation/states";

function actorLabel(event: AuditEvent): string {
  // Backend-normalized actor types (dto.ts): user | system | provider.
  if (event.actor_type === "user") return "User";
  if (event.actor_type === "provider") return "Provider";
  return "System";
}

function humanize(value: string): string {
  return value
    .split(/[_.]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * Reusable Gate E audit timeline. Renders only safe, non-sensitive fields —
 * event, actor/system, timestamp, entity, and a bounded safe summary. Never
 * renders secrets, tokens, raw provider bodies, raw documents, or stack traces.
 */
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <AutomationEmpty title="No audit events yet" />;
  }
  return (
    <ol className="space-y-3" aria-label="Audit timeline">
      {events.map((event) => {
        // Render ONLY allowlisted scalar metadata (mirrors the backend
        // safe-metadata allowlist). A sensitive scalar is never shown merely
        // because it is a primitive.
        const summary = filterSafeMetadata(event.safe_metadata)
          .slice(0, 6)
          .map(([key, value]) =>
            `${humanize(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`
          )
          .join(" · ");
        return (
          <li key={event.id} className="flex gap-3">
            <div className="mt-1 flex flex-col items-center">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-brand-400"
              />
              <span aria-hidden="true" className="mt-1 w-px flex-1 bg-slate-200" />
            </div>
            <div className="flex-1 rounded-lg border border-slate-100 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">
                  {humanize(event.event_type)}
                </p>
                <time className="text-[11px] text-slate-400">
                  {formatDateTime(event.created_at)}
                </time>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {humanize(event.entity_type)} · {actorLabel(event)}
              </p>
              {summary && (
                <p className="mt-1 text-[11px] text-slate-600">{summary}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Header used above an embedded timeline. */
export function AuditTimelineHeading() {
  return (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
      <History className="h-4 w-4 text-slate-400" aria-hidden="true" />
      Audit Timeline
    </h3>
  );
}

export { AUDIT_ACTOR_TYPES };
