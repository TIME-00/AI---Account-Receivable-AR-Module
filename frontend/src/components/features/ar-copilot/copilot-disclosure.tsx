"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import {
  COPILOT_PRIVACY_DETAILS,
  COPILOT_PRIVACY_DETAIL_HEADING,
  COPILOT_PRIVACY_SUMMARY,
} from "@/lib/ar-copilot/disclosure";

/**
 * Privacy disclosure.
 *
 * Always visible in summary form — a user should not have to open anything to
 * learn that their question goes to OpenAI. The detail list expands for the
 * specifics, and every claim in it is limited to what the reviewed backend
 * actually enforces.
 */
export function CopilotDisclosure() {
  return (
    <details
      data-copilot-disclosure
      className="group border-b border-line bg-surface-muted"
    >
      <summary
        className={`flex cursor-pointer list-none items-start gap-2 px-4 py-2.5 ${COMPOSABLE_FOCUS_RING}`}
      >
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted"
          aria-hidden="true"
        />
        <p className="flex-1 text-[11px] leading-relaxed text-content-secondary">
          {COPILOT_PRIVACY_SUMMARY}
        </p>
        <ChevronDown
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-fast ease-standard group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="px-4 pb-3 pl-[2.1rem]">
        {/* Muted measured 4.34:1 on the muted disclosure surface in Light —
            below AA at 10px — so the heading uses the secondary text token. */}
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
          {COPILOT_PRIVACY_DETAIL_HEADING}
        </p>
        <ul className="space-y-1">
          {COPILOT_PRIVACY_DETAILS.map((detail) => (
            <li
              key={detail}
              className="flex gap-1.5 text-[11px] leading-relaxed text-content-secondary"
            >
              <span aria-hidden="true" className="text-content-muted">
                ·
              </span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
