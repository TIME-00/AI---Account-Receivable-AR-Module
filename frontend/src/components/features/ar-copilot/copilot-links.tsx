"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";
import { isSafeCopilotLink } from "@/lib/ar-copilot/links";
import type { CopilotLink } from "@/lib/ar-copilot/contract";

// ============================================================================
// Safe deep links.
//
// These are NAVIGATION controls and nothing else. There is no Post, Cancel,
// Allocate, Send Reminder, Change Status, or Enable Automation control here,
// and there is no code path in this feature that can produce one — the Copilot
// is read-only, so the most it can do is take you to the screen where the
// existing workflow already lives.
//
// Every href is re-validated at render time even though the parser already
// filtered the list. The cost is one predicate call; the benefit is that a link
// can never become clickable through a component used in a different context.
// ============================================================================

export function CopilotLinkList({ links }: { links: readonly CopilotLink[] }) {
  const safe = links.filter(isSafeCopilotLink);
  if (safe.length === 0) return null;

  return (
    <div className="mt-3">
      {/* Same measured reason as the Sources heading: muted is 4.32:1 on the
          elevated answer surface in Dark, which does not clear AA at 10px. */}
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-content-secondary">
        Go to
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {safe.map((link) => (
          <li key={`${link.entity_type}:${link.entity_id}:${link.href}`}>
            <Link
              href={link.href}
              data-copilot-link
              className={`ds-press inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-muted px-2.5 py-1 text-[11px] font-medium text-accent-hover transition-colors duration-fast ease-standard hover:border-accent/60 hover:bg-accent-muted/70 ${COMPOSABLE_FOCUS_RING}`}
            >
              {link.label}
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
