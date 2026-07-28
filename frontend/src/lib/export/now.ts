// ============================================================================
// TSH Synergy AR — Gate C report export: local "as of today" helper
//
// The AR Aging and Customer Outstanding reports are presented "as of today".
// The backend export routes require an explicit as_of_date, so we send the
// viewer's LOCAL calendar date (matching the on-screen "As of: Today" label for
// a user in the business timezone) rather than a UTC-sliced date, which can be
// a day behind for UTC+8 users in the morning.
// ============================================================================

export function localTodayISODate(reference: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${reference.getFullYear()}-${pad(reference.getMonth() + 1)}-${pad(reference.getDate())}`;
}
