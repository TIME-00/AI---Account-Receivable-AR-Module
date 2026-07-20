import { constantTimeEqual } from "../fx-rate-sync/scheduler_auth.ts";

export const DAILY_OVERDUE_SECRET_HEADER = "X-Cron-Secret";

export interface DailyOverdueAuthFailure {
  status: 401 | 500;
  code: "UNAUTHORIZED" | "SCHEDULED_AUTH_NOT_CONFIGURED";
  message: string;
}

/** Authenticate the custom scheduler boundary before any admin client exists. */
export function validateDailyOverdueCronAuth(
  req: Request,
  expectedSecret: string | undefined,
): DailyOverdueAuthFailure | null {
  if (
    typeof expectedSecret !== "string" || expectedSecret.trim().length === 0
  ) {
    return {
      status: 500,
      code: "SCHEDULED_AUTH_NOT_CONFIGURED",
      message: "Scheduled task authentication is not configured.",
    };
  }

  const suppliedSecret = req.headers.get(DAILY_OVERDUE_SECRET_HEADER);
  if (
    typeof suppliedSecret !== "string" ||
    suppliedSecret.trim().length === 0 ||
    !constantTimeEqual(suppliedSecret, expectedSecret)
  ) {
    return {
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid scheduled task authentication.",
    };
  }

  return null;
}
