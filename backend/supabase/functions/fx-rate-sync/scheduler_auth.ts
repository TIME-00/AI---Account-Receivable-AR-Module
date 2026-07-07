import { AuthenticationError, BusinessError } from '../_shared/errors.ts';

export const SCHEDULER_SECRET_HEADER = 'X-FX-Scheduler-Secret';
export const SCHEDULER_SECRET_ENV = 'FX_SCHEDULER_SECRET';
export const SCHEDULER_COMPANY_ENV = 'FX_SCHEDULER_COMPANY_ID';

export function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function validateSchedulerSecret(req: Request, expectedSecret?: string): void {
  if (!expectedSecret) {
    throw new BusinessError('FX_SCHEDULER_AUTH_NOT_CONFIGURED', 'FX scheduler authentication is not configured.', 500);
  }
  const suppliedSecret = req.headers.get(SCHEDULER_SECRET_HEADER);
  if (!suppliedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    throw new AuthenticationError('Invalid FX scheduler authentication.');
  }
}
