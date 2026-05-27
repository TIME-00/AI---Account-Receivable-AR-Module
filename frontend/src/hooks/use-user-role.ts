// ============================================================================
// TSH Synergy AR — useUserRole Hook (Sprint F1 Frontend-Only Fallback)
//
// IMPORTANT: No supported role API or Edge Function exists in Sprint F1.
// This hook uses a FRONTEND-ONLY role fallback that is:
//   - READ-ONLY by default (no operational mutation permissions).
//   - Configurable via NEXT_PUBLIC_DEMO_USER_ROLE environment variable.
//
// How it works:
//   1. If NEXT_PUBLIC_DEMO_USER_ROLE is set to a valid operational role
//      ("AR Clerk", "AR Supervisor", or "Finance Manager"), the user
//      gets operational mutation permissions (post, cancel, create).
//   2. If NEXT_PUBLIC_DEMO_USER_ROLE is unset, empty, invalid, "Auditor",
//      or "System Admin", mutation permissions are FALSE (read-only).
//   3. No Supabase direct table queries are used.
//   4. No unsupported API endpoints are called.
//   5. Backend RLS + Edge Function auth remain the FINAL security authority.
//      This hook is purely for UX button visibility.
//
// To enable operator demo mode, set in .env.local:
//   NEXT_PUBLIC_DEMO_USER_ROLE=AR Clerk
//
// FUTURE: Replace this fallback with a real role API query, e.g.:
//   const { data } = useQuery({ queryFn: () => api.get("/auth/me") });
// ============================================================================

"use client";

import { useAuth } from "@/providers/auth-provider";
import type { UserRole } from "@/types";

// All valid UserRole values
const VALID_ROLES: UserRole[] = [
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
  "System Admin",
  "Auditor",
];

// Only these roles grant operational (mutation) permissions
const OPERATIONAL_ROLES: UserRole[] = [
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
];

/**
 * Resolve the demo role from NEXT_PUBLIC_DEMO_USER_ROLE.
 * Returns the role if it is a valid UserRole, otherwise null.
 */
function resolveDemoRole(): UserRole | null {
  const envValue = process.env.NEXT_PUBLIC_DEMO_USER_ROLE?.trim();
  if (!envValue) return null;
  if (VALID_ROLES.includes(envValue as UserRole)) {
    return envValue as UserRole;
  }
  // Invalid value — log a warning in development
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `[useUserRole] NEXT_PUBLIC_DEMO_USER_ROLE="${envValue}" is not a valid role. ` +
      `Valid values: ${VALID_ROLES.join(", ")}. Defaulting to read-only.`
    );
  }
  return null;
}

/**
 * useUserRole — Sprint F1 frontend-only role fallback.
 *
 * Default behavior (no env var set):
 *   - All users are READ-ONLY — no mutation buttons shown.
 *   - Auditor and System Admin never see operational actions.
 *
 * Demo/operator mode (NEXT_PUBLIC_DEMO_USER_ROLE set):
 *   - If set to "AR Clerk", "AR Supervisor", or "Finance Manager",
 *     mutation buttons (Post, Cancel, New Invoice/Receipt) are visible.
 *   - If set to "Auditor" or "System Admin", user remains read-only.
 *
 * Backend RLS + Edge Function auth remain the real enforcement layer.
 */
export function useUserRole() {
  const { user, isLoading: authLoading } = useAuth();

  const isAuthenticated = !!user;
  const demoRole = resolveDemoRole();

  // Build role list: use demo role if set and user is authenticated
  const roles: UserRole[] = isAuthenticated && demoRole ? [demoRole] : [];
  const highestRole: UserRole | null = roles.length > 0 ? roles[0] : null;

  // Derived permissions — only operational roles grant mutation access
  const isOperational = roles.some((r) => OPERATIONAL_ROLES.includes(r));
  const isReadOnly = !isOperational;
  const isAuditor = roles.includes("Auditor");
  const isSystemAdmin = roles.includes("System Admin") && !isOperational;

  return {
    role: highestRole,
    roles,
    isLoading: authLoading,

    // Permission flags
    isOperational,
    isReadOnly,
    isAuditor,
    isSystemAdmin,

    // Granular action permissions — only true for authenticated operational users
    canCreateInvoice: isOperational,
    canPostInvoice: isOperational,
    canCancelInvoice: isOperational,
    canCreateReceipt: isOperational,
    canPostReceipt: isOperational,
    canCancelReceipt: isOperational,
    canAllocate: isOperational,
  };
}
