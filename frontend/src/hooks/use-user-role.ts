// ============================================================================
// TSH Synergy AR — useUserRole Hook (Batch 9A — Authenticated Context)
//
// Role and capability flags are derived from the authenticated backend context
// (GET /auth/me via useAuthContext). This hook NO LONGER reads any demo/env
// value (NEXT_PUBLIC_DEMO_USER_ROLE) for real UI behavior.
//
// Honesty rules:
//   1. While the auth context is loading, the user is treated as READ-ONLY
//      (no mutation controls shown) until the real role is known.
//   2. If the auth context fails to load, behavior defaults to conservative /
//      disabled (read-only, no capabilities) rather than guessing.
//   3. Backend RLS + Edge Function auth remain the FINAL security authority.
//      This hook only governs UX button visibility.
// ============================================================================

"use client";

import { useAuthContext } from "@/hooks/use-auth-context";
import type { AuthCapabilities, UserRole } from "@/types";

/** Conservative, fully read-only capability set used while loading or on error. */
const READ_ONLY_CAPABILITIES: AuthCapabilities = {
  can_read_operational_data: false,
  can_create_customer: false,
  can_update_customer: false,
  can_create_invoice: false,
  can_update_draft_invoice: false,
  can_post_invoice: false,
  can_cancel_invoice: false,
  can_create_receipt: false,
  can_post_receipt: false,
  can_cancel_receipt: false,
  can_allocate_receipt: false,
  can_reverse_allocation: false,
  can_handle_bounced_cheque: false,
  can_read_reports: false,
  can_execute_imports: false,
  can_review_import_rows: false,
  can_read_config: false,
  can_write_config: false,
  is_read_only: true,
  is_system_admin_only: false,
};

/**
 * useUserRole — authenticated role/capability source for UX gating.
 *
 * Derives the highest role, role list, and granular permission flags from the
 * server's view of the current user (GET /auth/me). Returns conservative
 * read-only defaults until the context resolves, and on error.
 */
export function useUserRole() {
  const { data, isLoading, isError } = useAuthContext();

  const resolved = !isLoading && !isError && !!data;
  const capabilities: AuthCapabilities = resolved ? data!.capabilities : READ_ONLY_CAPABILITIES;
  const roles: UserRole[] = resolved ? data!.roles : [];
  const highestRole: UserRole | null = resolved ? data!.highest_role : null;

  const isOperational = !capabilities.is_read_only;

  return {
    role: highestRole,
    roles,
    isLoading,
    // True only once the authenticated context has resolved successfully.
    isResolved: resolved,
    isError,

    // Permission flags (server-derived)
    isOperational,
    isReadOnly: capabilities.is_read_only,
    isAuditor: roles.includes("Auditor"),
    isSystemAdmin: capabilities.is_system_admin_only,

    // Granular action permissions — mirror backend capabilities exactly
    canCreateInvoice: capabilities.can_create_invoice,
    canPostInvoice: capabilities.can_post_invoice,
    canCancelInvoice: capabilities.can_cancel_invoice,
    canCreateReceipt: capabilities.can_create_receipt,
    canPostReceipt: capabilities.can_post_receipt,
    canCancelReceipt: capabilities.can_cancel_receipt,
    canAllocate: capabilities.can_allocate_receipt,

    // Full capability object + context for richer surfaces (e.g. profile page)
    capabilities,
    company: resolved ? data!.company : null,
    email: resolved ? data!.user.email : null,
    userId: resolved ? data!.user.id : null,
  };
}
