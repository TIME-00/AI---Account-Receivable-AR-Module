"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  applyEntityRegistration,
  copilotContextForPath,
  copilotContextLabel,
} from "@/lib/ar-copilot/context";
import type { CopilotContextHint } from "@/lib/ar-copilot/contract";
import { useCopilotEntityRegistration } from "@/providers/copilot-entity-provider";

export interface CopilotContextState {
  /** Exactly what is sent as the request `context`. */
  hint: CopilotContextHint;
  /** Chip text: a display number when known, otherwise the screen name. */
  label: string;
  /** True when the context names a specific record rather than a screen. */
  isEntityContext: boolean;
}

/**
 * The Copilot's view of where the user is.
 *
 * Derived from the live route, then refined by whatever the current detail page
 * published. Recomputed on navigation so the NEXT message carries the new
 * context — messages already sent keep the context they were asked under.
 */
export function useCopilotContext(): CopilotContextState {
  const pathname = usePathname();
  const registration = useCopilotEntityRegistration();

  return useMemo(() => {
    const routeHint = copilotContextForPath(pathname ?? "/");
    const hint = applyEntityRegistration(routeHint, registration);
    const displayNumber = registration &&
        registration.entityId === hint.entity_id
      ? registration.displayNumber
      : null;
    return {
      hint,
      label: copilotContextLabel(hint, displayNumber),
      isEntityContext: hint.entity_id !== null,
    };
  }, [pathname, registration]);
}
