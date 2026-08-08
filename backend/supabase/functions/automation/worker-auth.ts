import { AuthenticationError, BusinessError } from "../_shared/errors.ts";
import { callRpc, getAdminClient } from "../_shared/db.ts";
import { constantTimeEqual } from "../fx-rate-sync/scheduler_auth.ts";

export const AUTOMATION_WORKER_SECRET_HEADER = "X-Automation-Worker-Secret";
export const AUTOMATION_WORKER_SECRET_ENV = "AUTOMATION_WORKER_SECRET";
export const AUTOMATION_WORKER_TOKEN_MAX_AGE_MS = 3 * 60 * 1000;
export const AUTOMATION_WORKER_TOKEN_MAX_FUTURE_MS = 30 * 1000;

export type AutomationWorkerNonceClaimer = (
  nonce: string,
  issuedAt: string,
) => Promise<boolean>;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function workerSignature(
  secret: string,
  issuedAtSeconds: number,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const message = `gate-e-automation-worker:v1:${issuedAtSeconds}:${nonce}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function signAutomationWorkerInvocation(
  secret: string,
  issuedAt: Date,
  nonce: string,
): Promise<string> {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
  if (
    !/^[A-Za-z0-9_-]{43,128}$/.test(secret) ||
    !Number.isSafeInteger(issuedAtSeconds) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(nonce)
  ) {
    throw new Error("Automation worker signing configuration is invalid.");
  }
  const signature = await workerSignature(secret, issuedAtSeconds, nonce);
  return `v1.${issuedAtSeconds}.${nonce}.${signature}`;
}

async function claimProductionNonce(
  nonce: string,
  issuedAt: string,
): Promise<boolean> {
  return await callRpc<boolean>(
    getAdminClient(),
    "automation_worker_nonce_claim",
    { p_nonce: nonce, p_issued_at: issuedAt },
  );
}

/**
 * Fail-closed custom boundary for an external scheduler. Migration 034 does
 * not install or activate a scheduler and no user JWT can substitute for this
 * independently provisioned secret.
 */
export function validateAutomationWorker(
  request: Request,
  expectedSecret: string | undefined,
  claimNonce: AutomationWorkerNonceClaimer = claimProductionNonce,
  now: Date = new Date(),
): void | Promise<void> {
  if (!expectedSecret) {
    throw new BusinessError(
      "AUTOMATION_WORKER_NOT_CONFIGURED",
      "Automation worker authentication is not configured.",
      503,
    );
  }
  const supplied = request.headers.get(AUTOMATION_WORKER_SECRET_HEADER);
  if (supplied && constantTimeEqual(supplied, expectedSecret)) return;
  const match = supplied?.match(
    /^v1\.([0-9]{10})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i,
  );
  if (!match || !/^[A-Za-z0-9_-]{43,128}$/.test(expectedSecret)) {
    throw new AuthenticationError("Invalid automation worker authentication.");
  }
  const issuedAtSeconds = Number(match[1]);
  const issuedAtMilliseconds = issuedAtSeconds * 1000;
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtMilliseconds < now.getTime() - AUTOMATION_WORKER_TOKEN_MAX_AGE_MS ||
    issuedAtMilliseconds > now.getTime() + AUTOMATION_WORKER_TOKEN_MAX_FUTURE_MS
  ) {
    throw new AuthenticationError("Invalid automation worker authentication.");
  }

  return (async () => {
    const expectedSignature = await workerSignature(
      expectedSecret,
      issuedAtSeconds,
      match[2],
    );
    if (!constantTimeEqual(match[3].toLowerCase(), expectedSignature)) {
      throw new AuthenticationError(
        "Invalid automation worker authentication.",
      );
    }
    const claimed = await claimNonce(
      match[2],
      new Date(issuedAtMilliseconds).toISOString(),
    );
    if (!claimed) {
      throw new AuthenticationError(
        "Invalid automation worker authentication.",
      );
    }
  })();
}
