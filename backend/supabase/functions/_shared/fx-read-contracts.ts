// ============================================================================
// Batch 9D-D FX / monetary read-contract helpers
// ============================================================================

export type FxPostingEligibilityReason =
  | 'missing_decision'
  | 'stale_decision'
  | 'non_current_decision'
  | 'pending_approval'
  | 'rejected'
  | 'blocked'
  | 'inconsistent_state'
  | 'approved'
  | 'not_required';

export interface FxPostingEligibility {
  gate: 'fx_governance';
  eligible: boolean;
  reason: FxPostingEligibilityReason;
}

export interface FxDecisionForReadContract {
  source_category: string;
  approval_status: string;
  lifecycle_status: string;
  stale_reference: boolean;
}

const CANONICAL_APPROVAL_LIFECYCLE_PAIRS = new Set([
  'NotRequired:Draft',
  'Pending:Pending',
  'Approved:Approved',
  'Rejected:Rejected',
]);

export function isBaseValueAvailable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return Number.isFinite(Number(value));
}

export function fxPostingEligibility(
  decision: FxDecisionForReadContract | null | undefined,
): FxPostingEligibility {
  if (!decision) {
    return { gate: 'fx_governance', eligible: false, reason: 'missing_decision' };
  }

  if (decision.source_category === 'LEGACY_UNVERIFIED') {
    return { gate: 'fx_governance', eligible: false, reason: 'blocked' };
  }

  if (decision.stale_reference) {
    return { gate: 'fx_governance', eligible: false, reason: 'stale_decision' };
  }

  if (decision.lifecycle_status === 'Superseded') {
    return { gate: 'fx_governance', eligible: false, reason: 'non_current_decision' };
  }

  if (decision.lifecycle_status === 'Posted') {
    return { gate: 'fx_governance', eligible: false, reason: 'blocked' };
  }

  if (!CANONICAL_APPROVAL_LIFECYCLE_PAIRS.has(`${decision.approval_status}:${decision.lifecycle_status}`)) {
    return { gate: 'fx_governance', eligible: false, reason: 'inconsistent_state' };
  }

  if (decision.approval_status === 'Pending' || decision.lifecycle_status === 'Pending') {
    return { gate: 'fx_governance', eligible: false, reason: 'pending_approval' };
  }

  if (decision.approval_status === 'Rejected' || decision.lifecycle_status === 'Rejected') {
    return { gate: 'fx_governance', eligible: false, reason: 'rejected' };
  }

  if (decision.approval_status === 'Approved') {
    return { gate: 'fx_governance', eligible: true, reason: 'approved' };
  }

  if (decision.approval_status === 'NotRequired') {
    return { gate: 'fx_governance', eligible: true, reason: 'not_required' };
  }

  return { gate: 'fx_governance', eligible: false, reason: 'blocked' };
}

export async function withOptionalReadEnrichment<T>(
  committedValue: T,
  enrich: () => Promise<T>,
): Promise<T> {
  try {
    return await enrich();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[fx-read-contracts] Optional read enrichment failed after committed mutation:', message);
    return committedValue;
  }
}
