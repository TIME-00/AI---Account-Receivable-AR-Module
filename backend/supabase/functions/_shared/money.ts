// ============================================================================
// Canonical TypeScript presentation/helper rounding for two-decimal money.
// PostgreSQL NUMERIC remains authoritative for persisted and SQL-aggregated data.
// ============================================================================

/**
 * Round a finite number to two decimals using PostgreSQL NUMERIC tie semantics:
 * exact half values are rounded away from zero.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;

  const roundedMagnitude = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return Math.sign(value) * roundedMagnitude;
}
