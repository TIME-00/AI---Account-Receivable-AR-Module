"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CopilotEntityRegistration } from "@/lib/ar-copilot/context";

/**
 * Lets a detail screen tell the Copilot what it is actually showing.
 *
 * Two things the route alone cannot supply:
 *
 *   1. The precise entity type. `/invoices/[id]` renders Invoices, Credit
 *      Notes, and Debit Notes — they are one Invoice-family route — while the
 *      backend treats the three as distinct context types and reports a
 *      mismatched hint as unavailable context.
 *   2. A safe display number. The page has already loaded `INV-202608-00012`,
 *      so the context chip can name the record without a second fetch and
 *      without ever showing a raw UUID.
 *
 * A registration is a hint like the route itself. The Edge Function re-proves
 * company scope, role, and customer assignment for whatever is sent.
 */
const CopilotEntityContext = createContext<{
  registration: CopilotEntityRegistration | null;
  register: (value: CopilotEntityRegistration | null) => void;
} | null>(null);

export function CopilotEntityProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] =
    useState<CopilotEntityRegistration | null>(null);

  const register = useCallback((value: CopilotEntityRegistration | null) => {
    setRegistration((current) => {
      if (current === value) return current;
      if (
        current && value && current.entityId === value.entityId &&
        current.entityType === value.entityType &&
        current.displayNumber === value.displayNumber
      ) {
        return current;
      }
      return value;
    });
  }, []);

  const value = useMemo(
    () => ({ registration, register }),
    [registration, register],
  );

  return (
    <CopilotEntityContext.Provider value={value}>
      {children}
    </CopilotEntityContext.Provider>
  );
}

/**
 * Publish the record on screen. Safe to call outside the provider — a page
 * rendered in isolation (a unit test, a future standalone route) simply has no
 * Copilot to inform, which must never be a crash.
 */
export function useRegisterCopilotEntity(
  registration: CopilotEntityRegistration | null,
): void {
  const context = useContext(CopilotEntityContext);
  const register = context?.register;
  const entityType = registration?.entityType ?? null;
  const entityId = registration?.entityId ?? null;
  const displayNumber = registration?.displayNumber ?? null;

  useEffect(() => {
    if (!register) return;
    register(
      entityType && entityId ? { entityType, entityId, displayNumber } : null,
    );
    // Clearing on unmount stops a previous screen's record from labelling the
    // next one during navigation.
    return () => register(null);
  }, [register, entityType, entityId, displayNumber]);
}

/** The current registration, or `null` outside the provider. */
export function useCopilotEntityRegistration(): CopilotEntityRegistration | null {
  return useContext(CopilotEntityContext)?.registration ?? null;
}
