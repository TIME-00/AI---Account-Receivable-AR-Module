// ============================================================================
// TSH Synergy AR — Gate C report export: presentation helpers
//
// All monetary formatting is pure string manipulation over the backend's exact
// decimal strings — no Number() parsing, no floating-point arithmetic — so no
// value is ever rounded or reconstructed on the client.
// ============================================================================

/**
 * Add thousands separators to an exact decimal string, preserving the sign and
 * every fractional digit verbatim. `"1234567.50"` → `"1,234,567.50"`.
 * Non-decimal input is returned unchanged (defensive; parser guarantees shape).
 */
export function formatDecimalString(value: string): string {
  const match = value.match(/^(-?)(\d+)(\.\d+)?$/);
  if (!match) return value;
  const [, sign, whole, fraction = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction}`;
}

/** Format an amount with its currency code, e.g. `"MYR 1,234.50"`. */
export function formatMoneyWithCurrency(value: string, currency: string): string {
  return `${currency} ${formatDecimalString(value)}`;
}

// Excel and compatible spreadsheet applications may ignore leading spaces
// before interpreting a formula marker. Tabs/newlines are themselves unsafe
// leading control characters. Prefix the complete original value once so its
// visible content is preserved while the cell is forced to text.
const DANGEROUS_SPREADSHEET_PREFIX =
  /^[ \u00a0\ufeff]*[=+\-@\t\r\n]/u;

/**
 * Neutralize a spreadsheet cell string so it can never be interpreted as a
 * formula. Direct formula prefixes, leading tab/newline controls, and formula
 * prefixes hidden behind leading spaces are prefixed with one apostrophe (the
 * spreadsheet text-literal marker). Existing apostrophe-prefixed text is left
 * unchanged, so neutralization is idempotent.
 */
export function neutralizeSpreadsheetText(value: string): string {
  if (DANGEROUS_SPREADSHEET_PREFIX.test(value)) {
    return `'${value}`;
  }
  return value;
}
