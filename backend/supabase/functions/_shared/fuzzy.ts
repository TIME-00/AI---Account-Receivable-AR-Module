// Conservative fuzzy matching helpers for import review suggestions.
// These constants intentionally favor human review over aggressive matching.

export const FUZZY_CUSTOMER_REVIEW_THRESHOLD = 0.72;
export const FUZZY_INVOICE_REVIEW_THRESHOLD = 0.78;
export const FUZZY_CANDIDATE_LIMIT = 3;

export interface FuzzyCandidate<T> {
  item: T;
  confidence: number;
  reason: string;
}

export function normalizeForFuzzy(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeIdentifier(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function scoreFuzzyText(input: string, candidate: string): { confidence: number; reason: string } {
  const a = normalizeForFuzzy(input);
  const b = normalizeForFuzzy(candidate);
  if (!a || !b) return { confidence: 0, reason: 'empty_input' };
  if (a === b) return { confidence: 1, reason: 'normalized_exact' };

  const compactA = normalizeIdentifier(input);
  const compactB = normalizeIdentifier(candidate);
  if (compactA && compactA === compactB) {
    return { confidence: 0.96, reason: 'punctuation_spacing_match' };
  }

  const tokenScore = jaccard(tokens(a), tokens(b));
  const editScore = normalizedEditSimilarity(compactA, compactB);
  const prefixScore = commonPrefixScore(compactA, compactB);
  const confidence = roundConfidence(Math.max(
    tokenScore * 0.92,
    editScore * 0.9,
    (tokenScore * 0.6) + (editScore * 0.35) + (prefixScore * 0.05),
  ));

  const reason = tokenScore >= editScore
    ? 'token_similarity'
    : prefixScore > 0.7
      ? 'prefix_similarity'
      : 'edit_similarity';
  return { confidence, reason };
}

export function topFuzzyCandidates<T>(
  input: string,
  items: T[],
  label: (item: T) => string,
  threshold: number,
  limit = FUZZY_CANDIDATE_LIMIT,
): Array<FuzzyCandidate<T>> {
  return items
    .map((item) => {
      const scored = scoreFuzzyText(input, label(item));
      return { item, confidence: scored.confidence, reason: scored.reason };
    })
    .filter((candidate) => candidate.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence || label(a.item).localeCompare(label(b.item)))
    .slice(0, limit);
}

function tokens(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizedEditSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - (levenshtein(a, b) / maxLen);
}

function commonPrefixScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const maxPrefix = Math.min(a.length, b.length);
  let count = 0;
  while (count < maxPrefix && a[count] === b[count]) count += 1;
  return count / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
