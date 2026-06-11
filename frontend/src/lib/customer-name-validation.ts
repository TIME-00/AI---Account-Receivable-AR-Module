import type { Customer } from "@/types";

const MIN_CUSTOMER_NAME_LENGTH = 3;
const INCOMPLETE_NAME_ERROR =
  "Customer name looks incomplete or invalid. Please enter a proper company name such as ABC Trading Sdn Bhd, or provide a registration number.";

const WEAK_SINGLE_TOKEN_NAMES = new Set([
  "abcde",
  "asdfgh",
  "customer",
  "dedaed",
  "demo",
  "dwadae",
  "lkjhg",
  "qweasd",
  "qwerty",
  "random",
  "sample",
  "test",
  "testing",
  "unknown",
]);

const BUSINESS_NAME_KEYWORDS = [
  "agency",
  "berhad",
  "bhd",
  "co",
  "company",
  "construction",
  "corp",
  "corporation",
  "enterprise",
  "engineering",
  "group",
  "holdings",
  "industries",
  "llp",
  "logistics",
  "ltd",
  "manufacturing",
  "marketing",
  "plt",
  "pte",
  "resources",
  "retail",
  "sdn",
  "services",
  "solutions",
  "supplies",
  "technology",
  "trading",
  "transport",
  "wholesale",
];

const LEGAL_SUFFIX_SUGGESTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bssn\s*bhd\b/i, replacement: "Sdn Bhd" },
  { pattern: /\bsdnbhd\b/i, replacement: "Sdn Bhd" },
  { pattern: /\bsdn\.?\s*bhd\.?\b/i, replacement: "Sdn Bhd" },
  { pattern: /\bpty\s*ltd\b/i, replacement: "Pte Ltd" },
  { pattern: /\bptd\s*ltd\b/i, replacement: "Pte Ltd" },
  { pattern: /\bpte\.?\s*ltd\.?\b/i, replacement: "Pte Ltd" },
];

export interface CustomerNameValidationResult {
  normalizedName: string;
  blockingError: string | null;
  suffixSuggestion: string | null;
}

export function normalizeCustomerDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateCustomerNameQuality(
  value: string,
  options: { enforceBusinessName?: boolean; registrationNo?: string | null } = {},
): CustomerNameValidationResult {
  const normalizedName = normalizeCustomerDisplayName(value);
  const compact = normalizedName.replace(/\s+/g, "");
  const hasRegistrationNo = Boolean(options.registrationNo?.trim());
  let blockingError: string | null = null;

  if (!normalizedName) {
    blockingError = "Customer name is required.";
  } else if (normalizedName.length < MIN_CUSTOMER_NAME_LENGTH) {
    blockingError = `Customer name must be at least ${MIN_CUSTOMER_NAME_LENGTH} characters.`;
  } else if (/^\d+$/.test(compact)) {
    blockingError = "Customer name cannot be numeric only.";
  } else if (!/[A-Za-z\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(normalizedName)) {
    blockingError = "Customer name must include letters.";
  } else if (isMostlyRepeatedCharacters(compact)) {
    blockingError = "Customer name cannot be mostly repeated characters.";
  } else if (isBlockedSingleToken(normalizedName)) {
    blockingError = INCOMPLETE_NAME_ERROR;
  } else if (options.enforceBusinessName && !hasRegistrationNo && !hasBusinessNameSignal(normalizedName)) {
    blockingError = INCOMPLETE_NAME_ERROR;
  }

  return {
    normalizedName,
    blockingError,
    suffixSuggestion: getLegalSuffixSuggestion(normalizedName),
  };
}

export function hasBusinessNameSignal(value: string): boolean {
  const normalizedName = normalizeCustomerDisplayName(value);
  const words = getMeaningfulWords(normalizedName);
  if (words.length >= 2) return true;

  const normalizedWords = words.map((word) => word.toLocaleLowerCase());
  return normalizedWords.some((word) => BUSINESS_NAME_KEYWORDS.includes(word));
}

export function findSimilarVisibleCustomer(
  customerName: string,
  visibleCustomers: Customer[],
): Customer | null {
  const candidateKey = canonicalizeCompanyName(customerName);
  if (!candidateKey || candidateKey.length < MIN_CUSTOMER_NAME_LENGTH) return null;

  return (
    visibleCustomers.find((customer) => {
      const existingKey = canonicalizeCompanyName(customer.customer_name);
      if (!existingKey) return false;
      if (existingKey === candidateKey) return true;
      if (candidateKey.length < 5 || existingKey.length < 5) return false;
      return existingKey.includes(candidateKey) || candidateKey.includes(existingKey);
    }) ?? null
  );
}

function getLegalSuffixSuggestion(customerName: string): string | null {
  for (const { pattern, replacement } of LEGAL_SUFFIX_SUGGESTIONS) {
    if (!pattern.test(customerName)) continue;
    const suggestion = normalizeCustomerDisplayName(customerName.replace(pattern, replacement));
    if (suggestion !== customerName) return suggestion;
  }

  return null;
}

function canonicalizeCompanyName(value: string): string {
  return normalizeCustomerDisplayName(value)
    .toLocaleLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(sdn\s*bhd|pte\s*ltd|berhad|bhd|limited|ltd|private)\b/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g, " ")
    .trim();
}

function isBlockedSingleToken(value: string): boolean {
  const words = getMeaningfulWords(value);
  if (words.length !== 1) return false;

  const token = words[0].toLocaleLowerCase();
  return WEAK_SINGLE_TOKEN_NAMES.has(token);
}

function getMeaningfulWords(value: string): string[] {
  return normalizeCustomerDisplayName(value)
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ""))
    .filter((word) => word.length > 0);
}

function isMostlyRepeatedCharacters(value: string): boolean {
  const alphanumeric = value.replace(/[^A-Za-z0-9]/g, "").toLocaleLowerCase();
  if (alphanumeric.length < 3) return false;

  const uniqueCharacters = new Set(alphanumeric.split(""));
  return uniqueCharacters.size === 1;
}
