import { AuthenticationError, BusinessError } from "../_shared/errors.ts";
import { constantTimeEqual } from "../fx-rate-sync/scheduler_auth.ts";

export const AUTOMATION_WORKER_SECRET_HEADER = "X-Automation-Worker-Secret";
export const AUTOMATION_WORKER_SECRET_ENV = "AUTOMATION_WORKER_SECRET";

/**
 * Fail-closed custom boundary for an external scheduler. Migration 034 does
 * not install or activate a scheduler and no user JWT can substitute for this
 * independently provisioned secret.
 */
export function validateAutomationWorker(
  request: Request,
  expectedSecret: string | undefined,
): void {
  if (!expectedSecret) {
    throw new BusinessError(
      "AUTOMATION_WORKER_NOT_CONFIGURED",
      "Automation worker authentication is not configured.",
      503,
    );
  }
  const supplied = request.headers.get(AUTOMATION_WORKER_SECRET_HEADER);
  if (!supplied || !constantTimeEqual(supplied, expectedSecret)) {
    throw new AuthenticationError("Invalid automation worker authentication.");
  }
}
