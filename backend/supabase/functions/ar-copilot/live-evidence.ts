import type { CopilotContextHint, CopilotEntityType } from "./contract.ts";
import { minorToMoney, moneyToMinor } from "../reports/export-contract.ts";

export {
  liveEvidenceGrantsFromOutcome,
  validatedContextGrant,
} from "./live-evidence-grants.ts";

export type CompanyClaimCategory =
  | "ar_summary"
  | "outstanding"
  | "overdue"
  | "unapplied_cash"
  | "collections"
  | "invoice_summary"
  | "receipt_summary"
  | "customer_attention"
  | "priority"
  | "workflow_exception"
  | "aging"
  | "unresolved_money";

export type CompanyFactKind =
  | "summary"
  | "money"
  | "count"
  | "existence"
  | "trend"
  | "qualitative_state"
  | "complete_set"
  | "top_n";

export type TrendWindow =
  | "current_month_vs_previous_month"
  | "previous_month_vs_prior_month"
  | "current_day_vs_previous_day"
  | "specific_period_comparison"
  | "unresolved";

export type AggregationScope = "row" | "entity" | "aggregate" | "company_total";

export type EvidenceCoverageStatus =
  | "complete"
  | "bounded_incomplete"
  | "insufficient_evidence";

export interface EvidenceCoverage {
  status: EvidenceCoverageStatus;
  source_total: number | null;
  returned_rows: number | null;
  top_n_complete: boolean | null;
}

interface CompanyFactShape {
  scope: "company";
  claim_category: CompanyClaimCategory;
  fact_kind: CompanyFactKind;
  currency?: string | null;
  money_value?: string | null;
  count_value?: number | null;
  count_comparator?: "exact" | "at_least" | null;
  state_value?: "present" | "absent" | null;
  trend_direction?: "increased" | "decreased" | "unchanged" | null;
  qualitative_state?:
    | "improved"
    | "deteriorated"
    | "weak"
    | "strong"
    | "concentrated"
    | "shifted_older"
    | "shifted_newer"
    | "elevated"
    | "reduced"
    | "unresolved"
    | null;
  time_basis?: "current" | "previous" | "change" | "unspecified" | null;
  trend_window?: TrendWindow | null;
  period_key?: string | null;
  comparison_period_key?: string | null;
  aggregation_scope?: AggregationScope | null;
  row_label?: string | null;
  rank_direction?: "highest" | "lowest" | "top" | null;
  rank_label?: string | null;
  top_n_count?: number | null;
  coverage?: EvidenceCoverage | null;
}

export type CompanyEvidenceRequirement = CompanyFactShape;
export type CompanyEvidenceGrant = CompanyFactShape;

export type LiveEvidenceRequirement =
  | CompanyEvidenceRequirement
  | {
    scope: "entity";
    entity_type: CopilotEntityType | null;
    entity_id: string | null;
  };

export type LiveEvidenceGrant =
  | CompanyEvidenceGrant
  | {
    scope: "entity";
    entity_type: CopilotEntityType;
    entity_id: string;
  };

const CONCEPTUAL_QUESTION =
  /^(?:what (?:is|does|are)\b|how (?:do|can|should) i\b|how (?:does|is)\b|what happens when\b|can you explain(?:\s+how)?\b)|(?:\u4ec0\u4e48\u662f|\u4ec0\u4e48\u53eb|\u662f\u4ec0\u4e48\u610f\u601d|\u4ec0\u4e48\u610f\u601d|\u600e\u4e48\u8fdb\u884c|\u5982\u4f55)|(?:apa\s+maksud|apa\s+itu|apakah\s+maksud|macam\s+mana\s+nak|bagaimana\s+(?:proses|cara))/iu;

const CASUAL_QUESTION =
  /^(?:hi|hello|hey|thanks|thank you|how are you(?: today)?|can you explain (?:that|it) (?:more )?simply)[?.!\s]*$/i;

const ACTION_REQUEST =
  /(?:^(?:please\s+)?(?:post|cancel|allocate|reverse|send|change|delete|create)\s+(?:(?:this|that|the|my)\s+)?(?:invoice|receipt|allocation|reminder|customer|document|credit note|debit note)\b|^(?:can|could|would|will) you\s+(?:please\s+)?(?:post|cancel|allocate|reverse|send|change|delete|create)\s+(?:(?:this|that|the|my)\s+)?(?:invoice|receipt|allocation|reminder|customer|document|credit note|debit note)\b|(?:\u5e2e\u6211|\u66ff\u6211|\u8acb|\u8bf7|\u76f4\u63a5).{0,80}(?:post|cancel|allocate|reverse|reminder|\u53d1\u9001|\u53d1|\u53d6\u6d88|\u8fc7\u8d26|\u5206\u914d)|\b(?:tolong|sila)\s+(?:hantar|post|allocate|reverse|batalkan|peruntuk)\s+(?:reminder|invoice|invois|receipt|allocation|resit)\b|^(?:hantar|post|allocate|reverse|batalkan|peruntuk)\s+(?:reminder|invoice|invois|receipt|allocation|resit)(?:\s+(?:ini|sekarang))?[.!?\s]*$)/iu;

const COMPANY_QUESTION_CLAIM =
  /(?:\b(?:current|now|right now|today|latest|this month|last month|lately|this morning|how many|how much|largest|highest|which customer|which customers|which invoice|which invoices|which receipt|which receipts|anything urgent|who should i chase first|what needs attention|getting high|compare|compared with|snapshot)\b|(?:\u73b0\u5728|\u76ee\u524d|\u4eca\u5929|\u6700\u8fd1|\u591a\u5c11|\u54ea\u4e2a\u5ba2\u6237|\u54ea\u4e2a\s*invoice|\u6700\u9ad8|\u6700\u591a|\u6bd4\u8f83|\u8fd9\u4e2a\u6708|\u672c\u6708|\u4e0a\u4e2a\u6708|\u503c\u5f97.{0,12}\u7559\u610f)|(?:sekarang|hari\s+ini|berapa|paling|(?:customer|pelanggan)\s+mana|bulan\s+ini|bulan\s+lepas|bandingkan|terkini|keadaan\s+ar|patut\s+saya\s+tengok|apa-apa.{0,30}perlu.{0,20}tengok|banyak\s+tak))/iu;

const ENTITY_QUESTION_CLAIM =
  /(?:\bwhy (?:is|was|did)\b.{0,80}\b(?:customer|invoice|receipt|document|exception|journal|audit)\b|\b(?:this|that)\s+(?:customer|invoice|receipt|document|exception|journal|audit)\b.{0,60}\b(?:still|open|unapplied|overdue|status|happened|failed)\b|(?:\u8fd9\u4e2a|\u8fd9\u5f20|\u8fd9\u7b14).{0,20}(?:invoice|receipt|\u53d1\u7968|\u6536\u6b3e).{0,30}(?:\u8fd8|\u72b6\u6001|\u5931\u8d25)|(?:invoice|receipt|dokumen|pelanggan)\s+ini.{0,30}(?:masih|status|gagal))/iu;

const ENTITY_ANSWER_CLAIM =
  /(?:\b(?:this|the)\s+(?:customer|invoice|receipt|document|exception|journal|audit)\s+(?:is|was|has|remains|shows)|(?:\u8fd9\u4e2a|\u8fd9\u5f20|\u8fd9\u7b14).{0,20}(?:invoice|receipt|\u53d1\u7968|\u6536\u6b3e).{0,20}(?:\u662f|\u6709|\u8fd8)|(?:invoice|receipt|dokumen|pelanggan)\s+ini\s+(?:masih|ialah|ada))/iu;

const EXPLICIT_COMPANY_SCOPE =
  /(?:\byour company\b|\bthe company\b|\bacross (?:the )?(?:company|portfolio)\b|\ball (?:customers|invoices|receipts)\b|\btotal ar\b|\bcompany-wide\b|\u516c\u53f8|\u8d35\u516c\u53f8|\u5168\u90e8\u5ba2\u6237|syarikat|seluruh\s+syarikat)/iu;

const EXPLICIT_COMPANY_MONEY_SCOPE =
  /(?:\b(?:your|the)\s+company(?:'s)?\s+(?:(?:currently|today|now|last\s+month|previously)\s+)?has\b|\b(?:your|the)\s+company(?:'s)?\s+(?:(?:current|currently|today|now|last\s+month|previous)\s+)?(?:total\s+)?(?:outstanding|overdue|collections?|unapplied\s+cash|balance|exposure|ar)\s+(?:is|are|was|were|stands|amounts|reached|sits)\b|\bacross\s+(?:the\s+)?(?:company|portfolio)\s*,?\s*(?:outstanding|overdue|collections?|unapplied\s+cash|balance|exposure|ar)\s+(?:is|are|was|were|stands|amounts|reached|sits)\b|^\s*company(?:-wide|\s+total)?\s+(?:(?:current|currently|today|now|last\s+month|previous)\s+)?(?:outstanding|overdue|collections?|unapplied\s+cash|balance|exposure|ar)\s+(?:is|are|was|were|stands|amounts|reached|sits)\b|^\s*(?:portfolio\s+total|overall\s+(?:outstanding|overdue|collections?|unapplied\s+cash|balance|exposure|ar)|total\s+(?:outstanding|overdue|collections?|unapplied\s+cash|balance|exposure|ar))\s+(?:is|are|was|were|stands|amounts|reached|sits)\b|\u516c\u53f8.{0,30}(?:\u603b\u989d|\u7e3d\u984d|\u5e94\u6536|\u61c9\u6536).{0,10}\u662f|(?:keseluruhan|jumlah)\s+syarikat.{0,30}(?:ialah|berjumlah))/iu;

const COMPLETE_SET_CLAIM =
  /(?:\b(?:all|every|complete|entire|full set|total set)\b|\u5168\u90e8|\u6240\u6709|\u5b8c\u6574|semua|keseluruhan|senarai\s+lengkap)/iu;
const TOP_N_CLAIM =
  /(?:\b(?:highest|largest|number one|most|lowest|top\s+\d+)\b|(?<!\bat\s)\bleast\b|\u6700\u9ad8|\u6700\u591a|\u6700\u4f4e|\u7b2c\u4e00|\u524d\s*[0-9\u4e00-\u5341]+|paling\s+(?:tinggi|besar|banyak|rendah|sedikit)|\btop\s+\d+\b)/iu;
const TREND_CLAIM =
  /(?:\b(?:increased|increase|rose|higher|decreased|decrease|fell|lower|unchanged)\b|\u589e\u52a0|\u4e0a\u5347|\u4e0a\u6da8|\u51cf\u5c11|\u4e0b\u964d|\u6301\u5e73|meningkat|menaik|naik|menurun|turun|kekal)/iu;
const QUALITATIVE_STATE_CLAIM =
  /(?:\b(?:improved|better|deteriorated|worsened|worse|weak|strong|concentrated|elevated|reduced)\b|\bshift(?:ed|ing)?\s+(?:towards?\s+)?(?:the\s+)?(?:older|newer)\b|\u6539\u5584|\u597d\u8f6c|\u6076\u5316|\u60e1\u5316|\u8f83\u5f31|\u8f03\u5f31|\u5f3a\u52b2|\u5f37\u52c1|\u96c6\u4e2d|\u96c6\u4e2d\u5728|\u5411\u8f83\u65e7|\u5411\u8f03\u820a|\u5347\u9ad8|bertambah\s+baik|bertambah\s+buruk|merosot|lemah|kukuh|tertumpu|beralih\s+ke\s+(?:bucket\s+)?(?:lebih\s+)?(?:lama|baharu)|tinggi)/iu;

const SUPPORTED_CURRENCIES = new Set([
  "MYR",
  "SGD",
  "USD",
  "EUR",
  "GBP",
  "CNY",
]);
const MONEY_CLAIM = /\b(MYR|SGD|USD|EUR|GBP|CNY)\s*(-?\d[\d,]*(?:\.\d+)?)\b/giu;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  no: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  lapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  "dua belas": 12,
  "\u4e00": 1,
  "\u4e8c": 2,
  "\u4e24": 2,
  "\u4e09": 3,
  "\u56db": 4,
  "\u4e94": 5,
  "\u516d": 6,
  "\u4e03": 7,
  "\u516b": 8,
  "\u4e5d": 9,
  "\u5341": 10,
  "\u5341\u4e00": 11,
  "\u5341\u4e8c": 12,
};

const COUNT_WORD =
  "no|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dua\\s+belas|satu|dua|tiga|empat|lima|enam|tujuh|lapan|sembilan|sepuluh|sebelas|\\d+";
const EN_MS_COUNT = new RegExp(
  `\\b(exactly\\s+|at\\s+least\\s+)?(${COUNT_WORD}|several|many|dozens?|beberapa|banyak)\\s+(?:open\\s+|overdue\\s+|unpaid\\s+|unapplied\\s+|tertunggak\\s+)?(?:automation\\s+)?(invoices?|receipts?|customers?|accounts?|exceptions?|invois|resit|pelanggan)\\b`,
  "giu",
);
const ZH_QUANTITY =
  "\\d+|\\u5341\\u4e00|\\u5341\\u4e8c|\\u4e00|\\u4e8c|\\u4e24|\\u4e09|\\u56db|\\u4e94|\\u516d|\\u4e03|\\u516b|\\u4e5d|\\u5341|\\u51e0\\u4e2a|\\u591a\\u5f20|\\u591a\\u7b14|\\u591a\\u4e2a";
const ZH_COUNT_PREFIX = new RegExp(
  `(${ZH_QUANTITY})(?:\\u5f20|\\u7b14|\\u4e2a)?(?:\\u903e\\u671f|\\u672a\\u5206\\u914d)?(?:\\u53d1\\u7968|\\u6536\\u6b3e|\\u5ba2\\u6237)`,
  "gu",
);
const ZH_COUNT_SUFFIX = new RegExp(
  `(?:\\u903e\\u671f|\\u672a\\u5206\\u914d)?(?:\\u53d1\\u7968|\\u6536\\u6b3e|\\u5ba2\\u6237)(?:\\u6709|\\u4e3a|\\u662f)?(${ZH_QUANTITY})(?:\\u5f20|\\u7b14|\\u4e2a)?`,
  "gu",
);

interface CountClaim {
  value: number;
  comparator: "exact" | "at_least";
}

function canonicalMoney(value: unknown): string | null {
  try {
    return minorToMoney(moneyToMinor(value, "live_evidence.money"));
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function inferredEntityType(text: string): CopilotEntityType | null {
  return /(?:invoice|\u53d1\u7968|invois)/iu.test(text)
    ? "invoice"
    : /(?:receipt|\u6536\u6b3e|resit)/iu.test(text)
    ? "receipt"
    : /(?:customer|\u5ba2\u6237|pelanggan)/iu.test(text)
    ? "customer"
    : /(?:document|\u6587\u6863|dokumen)/iu.test(text)
    ? "automation_document"
    : /(?:exception|\u5f02\u5e38|pengecualian)/iu.test(text)
    ? "automation_exception"
    : /(?:journal|\u65e5\u8bb0)/iu.test(text)
    ? "journal_entry"
    : /(?:audit|\u5ba1\u8ba1)/iu.test(text)
    ? "audit_event"
    : null;
}

function entityRequirement(
  context: CopilotContextHint,
  text = "",
): LiveEvidenceRequirement {
  const inferred = inferredEntityType(text);
  const entityType = inferred ?? context.entity_type;
  return {
    scope: "entity",
    entity_type: entityType,
    entity_id: entityType !== null && entityType === context.entity_type
      ? context.entity_id
      : null,
  };
}

function companyFact(
  claim_category: CompanyClaimCategory,
  fact_kind: CompanyFactKind,
  detail: Omit<
    Partial<CompanyFactShape>,
    "scope" | "claim_category" | "fact_kind"
  > = {},
): CompanyFactShape {
  return { scope: "company", claim_category, fact_kind, ...detail };
}

function addCategory(
  categories: Set<CompanyClaimCategory>,
  category: CompanyClaimCategory,
): void {
  categories.add(category);
}

function companyCategories(text: string): CompanyClaimCategory[] {
  const categories = new Set<CompanyClaimCategory>();
  const overdue = /(?:overdue|past due|unpaid|\u903e\u671f|tertunggak|lewat)/iu
    .test(text);
  if (overdue) addCategory(categories, "overdue");
  if (
    /(?:unapplied|unallocated|\u672a\u5206\u914d|belum\s+diagih|tunai\s+belum\s+diagih|penerimaan\s+belum\s+diagih)/iu
      .test(text)
  ) {
    addCategory(categories, "unapplied_cash");
  }
  if (/(?:collection|collected|kutipan|\u6536\u6b3e)/iu.test(text)) {
    addCategory(categories, "collections");
  }
  if (/(?:exception|pengecualian|\u5f02\u5e38|\u7570\u5e38)/iu.test(text)) {
    addCategory(categories, "workflow_exception");
  }
  if (
    /(?:aging|ageing|bucket|penuaan|\u8d26\u9f84|\u5e33\u9f61)/iu.test(text)
  ) {
    addCategory(categories, "aging");
  }
  if (/(?:receipts?|resit|penerimaan|\u6536\u6b3e)/iu.test(text)) {
    addCategory(categories, "receipt_summary");
  }
  if (/(?:invoices?|invois|\u53d1\u7968|\u767c\u7968)/iu.test(text)) {
    addCategory(categories, "invoice_summary");
  }
  if (/(?:customers?|accounts?|pelanggan|\u5ba2\u6237)/iu.test(text)) {
    addCategory(categories, "customer_attention");
  }
  if (
    /(?:outstanding|receivables?\s+balance|total\s+ar|ar\s+(?:balance|exposure)|\bbalance\b|\u5e94\u6536\u4f59\u989d|\u61c9\u6536\u9918\u984d|baki)/iu
      .test(text) ||
    (!overdue && /\bexposure\b/iu.test(text))
  ) addCategory(categories, "outstanding");
  if (
    /(?:urgent|focus|attention|chase|perlu.{0,20}(?:tengok|perhatian)|\u9700\u8981\u5173\u6ce8|\u9700\u8981\u512a\u5148|\u503c\u5f97.{0,12}\u7559\u610f)/iu
      .test(text)
  ) addCategory(categories, "priority");
  if (/(?:snapshot|total\s+ar|keadaan\s+ar|ar\s+\u60c5\u51b5)/iu.test(text)) {
    addCategory(categories, "ar_summary");
  }
  if (
    /\bar\b.{0,40}\b(?:MYR|SGD|USD|EUR|GBP|CNY)\s*-?\d/iu.test(text)
  ) {
    addCategory(categories, "ar_summary");
  }
  return [...categories];
}

function questionFactKind(text: string): CompanyFactKind {
  if (COMPLETE_SET_CLAIM.test(text)) return "complete_set";
  if (TOP_N_CLAIM.test(text)) return "top_n";
  if (
    TREND_CLAIM.test(text) ||
    /(?:compare|compared|\u6bd4\u8f83|bandingkan)/iu.test(text)
  ) {
    return "trend";
  }
  if (/(?:\bhow many\b|\bberapa\b|\u591a\u5c11)/iu.test(text)) return "count";
  if (/(?:\bhow much\b|\u603b\u989d|\u7e3d\u984d|berjumlah)/iu.test(text)) {
    return "money";
  }
  if (
    /(?:urgent|attention|focus|chase|\u5173\u6ce8|\u7559\u610f|perhatian|tengok)/iu
      .test(text)
  ) {
    return "existence";
  }
  return "summary";
}

function companyQuestionRequirements(
  text: string,
): CompanyEvidenceRequirement[] {
  const categories = companyCategories(text);
  if (categories.length === 0) categories.push("ar_summary");
  const factKind = questionFactKind(text);
  return categories.map((category) =>
    companyFact(
      category,
      factKind,
      factKind === "count"
        ? {
          count_value: null,
          count_comparator: "exact",
          time_basis: timeBasis(text),
        }
        : factKind === "existence"
        ? { state_value: null }
        : factKind === "trend"
        ? { trend_window: trendWindow(text), time_basis: "change" }
        : {},
    )
  );
}

function parseCountWord(value: string): CountClaim | null {
  const normalized = value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number)
      ? { value: number, comparator: "exact" }
      : null;
  }
  const exact = NUMBER_WORDS[normalized];
  if (exact !== undefined) return { value: exact, comparator: "exact" };
  if (["several", "beberapa", "\u51e0\u4e2a"].includes(normalized)) {
    return { value: 2, comparator: "at_least" };
  }
  if (
    ["many", "banyak", "\u591a\u5f20", "\u591a\u7b14", "\u591a\u4e2a"].includes(
      normalized,
    )
  ) {
    return { value: 3, comparator: "at_least" };
  }
  if (/^dozens?$/.test(normalized)) {
    return { value: 12, comparator: "at_least" };
  }
  return null;
}

function countClaims(text: string): CountClaim[] {
  const result: CountClaim[] = [];
  for (const match of text.matchAll(EN_MS_COUNT)) {
    const claim = parseCountWord(match[2]);
    if (!claim) continue;
    const qualifier = (match[1] ?? "").trim().toLowerCase();
    result.push({
      value: claim.value,
      comparator: qualifier === "at least" ? "at_least" : claim.comparator,
    });
  }
  for (const pattern of [ZH_COUNT_PREFIX, ZH_COUNT_SUFFIX]) {
    for (const match of text.matchAll(pattern)) {
      const claim = parseCountWord(match[1]);
      if (claim) result.push(claim);
    }
  }
  return result;
}

function timeBasis(text: string): CompanyFactShape["time_basis"] {
  if (
    /(?:last month|previous|\bin\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\u4e0a\u4e2a\u6708|\u4e0a\u6708|bulan\s+lepas)/iu
      .test(text)
  ) return "previous";
  if (
    /(?:current|currently|now|today|this month|right now|\u73b0\u5728|\u76ee\u524d|\u4eca\u5929|\u8fd9\u4e2a\u6708|sekarang|hari\s+ini|bulan\s+ini)/iu
      .test(text)
  ) {
    return "current";
  }
  return "unspecified";
}

function trendWindow(text: string): TrendWindow {
  const currentVsPrevious =
    /(?:this\s+month.{0,50}(?:last|previous)\s+month|(?:compared|versus|vs\.?|relative)\s+(?:with|to)?\s*(?:last|previous)\s+month|\u8fd9\u4e2a\u6708.{0,30}\u4e0a(?:\u4e2a)?\u6708|\u672c\u6708.{0,30}\u4e0a\u6708|\u6bd4\u4e0a(?:\u4e2a)?\u6708|bulan\s+ini.{0,50}bulan\s+lepas|berbanding\s+(?:dengan\s+)?bulan\s+lepas)/iu;
  if (currentVsPrevious.test(text)) return "current_month_vs_previous_month";
  if (/(?:today|\u4eca\u5929|hari\s+ini)/iu.test(text)) {
    return "current_day_vs_previous_day";
  }
  if (
    /(?:last\s+month|previous\s+month|\u4e0a(?:\u4e2a)?\u6708|bulan\s+lepas)/iu
      .test(text)
  ) {
    return "previous_month_vs_prior_month";
  }
  if (
    /(?:\bin\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b20\d{2}-(?:0[1-9]|1[0-2])\b)/iu
      .test(
        text,
      )
  ) return "unresolved";
  return "unresolved";
}

function trendDirection(text: string): CompanyFactShape["trend_direction"] {
  if (
    /(?:increased|increase|rose|higher|\u589e\u52a0|\u4e0a\u5347|\u4e0a\u6da8|meningkat|menaik|naik)/iu
      .test(text)
  ) return "increased";
  if (
    /(?:decreased|decrease|fell|lower|\u51cf\u5c11|\u4e0b\u964d|menurun|turun)/iu
      .test(text)
  ) return "decreased";
  if (/(?:unchanged|\u6301\u5e73|kekal)/iu.test(text)) return "unchanged";
  return null;
}

function qualitativeState(
  text: string,
): CompanyFactShape["qualitative_state"] {
  if (
    /(?:\b(?:improved|better)\b|\u6539\u5584|\u597d\u8f6c|bertambah\s+baik)/iu
      .test(text)
  ) {
    return "improved";
  }
  if (
    /(?:\b(?:deteriorated|worsened|worse)\b|\u6076\u5316|\u60e1\u5316|bertambah\s+buruk|merosot)/iu
      .test(text)
  ) {
    return "deteriorated";
  }
  if (/(?:\bweak\b|\u8f83\u5f31|\u8f03\u5f31|lemah)/iu.test(text)) {
    return "weak";
  }
  if (/(?:\bstrong\b|\u5f3a\u52b2|\u5f37\u52c1|kukuh)/iu.test(text)) {
    return "strong";
  }
  if (
    /(?:\bconcentrated\b|\u96c6\u4e2d|\u96c6\u4e2d\u5728|tertumpu)/iu.test(text)
  ) {
    return "concentrated";
  }
  if (
    /(?:\bshift(?:ed|ing)?\s+(?:towards?\s+)?(?:the\s+)?older\b|\u5411\u8f83\u65e7|\u5411\u8f03\u820a|beralih\s+ke\s+(?:bucket\s+)?(?:lebih\s+)?lama)/iu
      .test(text)
  ) {
    return "shifted_older";
  }
  if (
    /(?:\bshift(?:ed|ing)?\s+(?:towards?\s+)?(?:the\s+)?newer\b|beralih\s+ke\s+(?:bucket\s+)?(?:lebih\s+)?baharu)/iu
      .test(text)
  ) {
    return "shifted_newer";
  }
  if (/(?:\belevated\b|\u5347\u9ad8|tinggi)/iu.test(text)) return "elevated";
  if (/\breduced\b/iu.test(text)) return "reduced";
  return QUALITATIVE_STATE_CLAIM.test(text) ? "unresolved" : null;
}

function rankDirection(text: string): CompanyFactShape["rank_direction"] {
  if (
    /(?:highest|largest|number one|most|\u6700\u9ad8|\u6700\u591a|\u7b2c\u4e00|paling\s+(?:tinggi|besar|banyak))/iu
      .test(text)
  ) return "highest";
  if (
    /(?:lowest|(?<!\bat\s)\bleast\b|\u6700\u4f4e|paling\s+(?:rendah|sedikit))/iu
      .test(
        text,
      )
  ) return "lowest";
  if (/(?:\btop\s+\d+\b|\u524d\s*[0-9\u4e00-\u5341]+)/iu.test(text)) {
    return "top";
  }
  return null;
}

function topNCount(text: string): number | null {
  const match = text.match(/\btop\s+(\d+)\b/iu);
  if (match) return positiveInteger(Number(match[1]));
  return null;
}

function normalizedLabel(value: string | undefined): string | null {
  const label = value?.trim().replace(/[.,;:!?\u3002\uff01\uff1f]+$/u, "")
    .toLocaleLowerCase();
  return label && label.length <= 100 ? label : null;
}

function rankLabel(text: string): string | null {
  const subjectFirst = text.match(
    /^\s*([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100}?)\s+(?:is|has|ialah|mempunyai)\s+(?:the\s+)?(?:highest|largest|lowest|least|paling)/iu,
  );
  if (subjectFirst) return normalizedLabel(subjectFirst[1]);
  const rankFirst = text.match(
    /(?:^(?:the|your)\s+|^)(?:highest|largest|lowest|least)\b.{0,80}?\b(?:customer|account)\s+(?:is|ialah)\s+([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100})$/iu,
  ) ?? text.match(
    /^(?:the\s+)?(?:customer|account)\s+with\s+(?:the\s+)?(?:highest|largest|lowest|least)\b.{0,80}?\s+(?:is|ialah)\s+([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100})$/iu,
  );
  if (rankFirst) return normalizedLabel(rankFirst[1]);
  const chinese = text.match(
    /(?:\u6700\u9ad8|\u6700\u591a|\u6700\u4f4e).{0,40}?(?:\u5ba2\u6237|\u5ba2\u6236)\s*\u662f\s*([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100})$/iu,
  );
  if (chinese) return normalizedLabel(chinese[1]);
  const malay = text.match(
    /(?:pelanggan|customer).{0,60}?paling\s+(?:tinggi|besar|banyak|rendah|sedikit).{0,30}?\s+ialah\s+([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100})$/iu,
  );
  return normalizedLabel(malay?.[1]);
}

function moneyAggregation(text: string): {
  aggregation_scope: AggregationScope;
  row_label: string | null;
  fact_text: string | null;
} {
  if (EXPLICIT_COMPANY_MONEY_SCOPE.test(text)) {
    return {
      aggregation_scope: "company_total",
      row_label: null,
      fact_text: text,
    };
  }
  const subject = text.match(
    /^\s*([\p{L}\p{N}][\p{L}\p{N}\s.,()'._&-]{0,100}?)\s+(?:(?:has|mempunyai)\s+(?:MYR|SGD|USD|EUR|GBP|CNY)\b|(?:outstanding|overdue|balance|baki)\s+(?:is|stands|amounts|ialah|berjumlah)\b)/iu,
  );
  const label = normalizedLabel(subject?.[1]);
  const reserved =
    /^(?:current|currently|today|now|last month|previous|outstanding|overdue|balance|total ar|company|your company)$/iu;
  if (label && !reserved.test(label)) {
    return {
      aggregation_scope: "row",
      row_label: label,
      fact_text: text.slice(subject?.[1].length ?? 0),
    };
  }
  return { aggregation_scope: "row", row_label: null, fact_text: null };
}

function moneyClaims(text: string): Array<{ currency: string; value: string }> {
  const result: Array<{ currency: string; value: string }> = [];
  for (const match of text.matchAll(MONEY_CLAIM)) {
    const currency = match[1].toUpperCase();
    const value = canonicalMoney(match[2].replaceAll(",", ""));
    if (SUPPORTED_CURRENCIES.has(currency) && value !== null) {
      result.push({ currency, value });
    }
  }
  return result;
}

function isNonFactualMoneyFormattingExample(text: string): boolean {
  const english =
    /^\s*(?:the\s+)?(?:example\s+value|sample\s+amount)\s+(?:MYR|SGD|USD|EUR|GBP|CNY)\s+-?\d[\d,]*(?:\.\d+)?\s+(?:is\s+)?(?:not\s+translated|not\s+(?:an?\s+)?actual(?:\s+value)?)\s*[.!?]?\s*$/iu;
  const malay =
    /^\s*(?:kod\s+contoh\s+[A-Z0-9][A-Z0-9-]{0,39}\s+dan\s+)?nilai\s+contoh\s+(?:MYR|SGD|USD|EUR|GBP|CNY)\s+-?\d[\d,]*(?:\.\d+)?\s+tidak\s+diterjemahkan\s*[.!?]?\s*$/iu;
  const chinese =
    /^\s*\u793a\u4f8b\u91d1\u989d\s*(?:MYR|SGD|USD|EUR|GBP|CNY)\s*-?\d[\d,]*(?:\.\d+)?\s*\u4e0d\u7ffb\u8bd1\s*[\u3002！？.!?]?\s*$/iu;
  return english.test(text) || malay.test(text) || chinese.test(text);
}

function positiveExistenceClaim(text: string): boolean {
  return /(?:\bthere (?:is|are|was|were|has been|have been|had been)\b|\b(?:has|have)\b.{0,30}\b(?:invoice|receipt|customer|account|exception)s?\b|\b(?:invoices?|receipts?|customers?|accounts?|exceptions?)\b.{0,30}\b(?:existed|remained)\b|\bat least one\b|\u6709|\u8fd8\u6709|masih\s+ada|\bada\b|\bterdapat\b|memerlukan\s+perhatian|perlu\s+diberi\s+perhatian)/iu
    .test(text);
}

function answerClauseRequirements(
  clause: string,
): CompanyEvidenceRequirement[] {
  const monies = isNonFactualMoneyFormattingExample(clause)
    ? []
    : moneyClaims(clause);
  const categories = companyCategories(clause);
  if (
    categories.length === 0 && monies.length === 0 &&
    !EXPLICIT_COMPANY_SCOPE.test(clause)
  ) {
    return [];
  }
  if (categories.length === 0 && monies.length === 0) {
    categories.push("ar_summary");
  }
  const requirements: CompanyEvidenceRequirement[] = [];
  const trend = trendDirection(clause);
  const topClaim = TOP_N_CLAIM.test(clause);
  if (trend !== null) {
    const aggregation = monies.length > 0 ? moneyAggregation(clause) : null;
    const predicateCategories = aggregation?.aggregation_scope === "row" &&
        aggregation.row_label
      ? companyCategories(aggregation.fact_text ?? "").filter((category) =>
        ![
          "customer_attention",
          "invoice_summary",
          "receipt_summary",
        ].includes(category)
      )
      : categories;
    const trendCategories: CompanyClaimCategory[] =
      predicateCategories.length > 0
        ? predicateCategories
        : monies.length > 0
        ? ["unresolved_money"]
        : [];
    for (const category of trendCategories) {
      requirements.push(companyFact(category, "trend", {
        trend_direction: trend,
        currency: monies[0]?.currency ?? null,
        money_value: monies[0]?.value ?? null,
        time_basis: "change",
        trend_window: trendWindow(clause),
      }));
    }
  } else {
    for (const money of monies) {
      const aggregation = moneyAggregation(clause);
      const predicateCategories = aggregation.aggregation_scope === "row"
        ? companyCategories(aggregation.fact_text ?? "").filter((category) =>
          ![
            "customer_attention",
            "invoice_summary",
            "receipt_summary",
          ].includes(category)
        )
        : categories;
      const moneyCategories: CompanyClaimCategory[] =
        predicateCategories.length > 0
          ? predicateCategories
          : ["unresolved_money"];
      for (const category of moneyCategories) {
        requirements.push(companyFact(category, "money", {
          currency: money.currency,
          money_value: money.value,
          time_basis: timeBasis(clause),
          aggregation_scope: aggregation.aggregation_scope,
          row_label: aggregation.row_label,
        }));
      }
    }
  }
  if (!topClaim) {
    for (const count of countClaims(clause)) {
      for (const category of categories) {
        requirements.push(companyFact(category, "count", {
          count_value: count.value,
          count_comparator: count.comparator,
          time_basis: timeBasis(clause),
        }));
      }
    }
  }
  if (COMPLETE_SET_CLAIM.test(clause)) {
    for (const category of categories) {
      requirements.push(companyFact(category, "complete_set"));
    }
  }
  if (topClaim) {
    for (const category of categories) {
      requirements.push(companyFact(category, "top_n", {
        rank_direction: rankDirection(clause),
        rank_label: rankLabel(clause),
        top_n_count: topNCount(clause),
      }));
    }
  }
  if (
    requirements.length === 0 &&
    (positiveExistenceClaim(clause) ||
      /(?:attention|urgent|\u5173\u6ce8|\u4f18\u5148\u8ddf\u8fdb|perhatian)/iu
        .test(clause))
  ) {
    for (const category of categories) {
      requirements.push(
        companyFact(category, "existence", {
          state_value: "present",
          time_basis: timeBasis(clause),
        }),
      );
    }
  }
  if (requirements.length === 0) {
    const state = qualitativeState(clause);
    if (state !== null) {
      for (const category of categories) {
        requirements.push(companyFact(category, "qualitative_state", {
          qualitative_state: state,
          time_basis: timeBasis(clause),
        }));
      }
    }
  }
  if (requirements.length === 0 && EXPLICIT_COMPANY_SCOPE.test(clause)) {
    for (const category of categories) {
      requirements.push(companyFact(category, "summary"));
    }
  }
  return requirements;
}

function uniqueRequirements(
  requirements: LiveEvidenceRequirement[],
): LiveEvidenceRequirement[] {
  const found = new Map<string, LiveEvidenceRequirement>();
  for (const requirement of requirements) {
    const key = requirement.scope === "entity"
      ? `entity:${requirement.entity_type ?? "unknown"}:${
        requirement.entity_id ?? "unresolved"
      }`
      : JSON.stringify(requirement);
    found.set(key, requirement);
  }
  return [...found.values()];
}

export function questionLiveEvidenceRequirements(
  question: string,
  context: CopilotContextHint,
): LiveEvidenceRequirement[] {
  const text = question.trim();
  if (
    CASUAL_QUESTION.test(text) || CONCEPTUAL_QUESTION.test(text) ||
    ACTION_REQUEST.test(text)
  ) {
    return [];
  }
  const requirements: LiveEvidenceRequirement[] = [];
  if (ENTITY_QUESTION_CLAIM.test(text)) {
    requirements.push(entityRequirement(context, text));
  }
  if (COMPANY_QUESTION_CLAIM.test(text)) {
    requirements.push(...companyQuestionRequirements(text));
  }
  return uniqueRequirements(requirements);
}

export function questionMayNeedLiveEvidence(
  question: string,
  context: CopilotContextHint,
): boolean {
  return questionLiveEvidenceRequirements(question, context).length > 0;
}

function answerLiveEvidenceRequirements(
  answer: string,
  context: CopilotContextHint,
): LiveEvidenceRequirement[] {
  const requirements: LiveEvidenceRequirement[] = [];
  const sentences = answer.split(
    /\n+|[!?\u3002\uff01\uff1f]+|\.(?=\s+[A-Z\u4e00-\u9fff]|$)/u,
  )
    .map((item) => item.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const entityClaim = ENTITY_ANSWER_CLAIM.test(sentence);
    if (entityClaim) requirements.push(entityRequirement(context, sentence));
    if (entityClaim && !EXPLICIT_COMPANY_SCOPE.test(sentence)) continue;
    const clauses = sentence.split(
      /\s+(?:and|but|while|whereas|dan|tetapi)\s+|[;ï¼›]|(?:\u4ee5\u53ca|\u800c\u4e14|\u4f46\u662f)/iu,
    );
    for (const clause of clauses) {
      requirements.push(...answerClauseRequirements(clause));
    }
  }
  return uniqueRequirements(requirements);
}

function coverageCompatible(
  requirement: CompanyEvidenceRequirement,
  grant: CompanyEvidenceGrant,
): boolean {
  if (requirement.fact_kind === "complete_set") {
    return grant.coverage?.status === "complete";
  }
  if (requirement.fact_kind === "top_n") {
    return grant.coverage?.status === "complete" ||
      grant.coverage?.top_n_complete === true;
  }
  return true;
}

function temporalCompatible(
  requirement: CompanyEvidenceRequirement,
  grant: CompanyEvidenceGrant,
): boolean {
  const required = requirement.time_basis;
  if (
    required === null || required === undefined || required === "unspecified"
  ) {
    return true;
  }
  return grant.time_basis === required;
}

function companyGrantSatisfies(
  requirement: CompanyEvidenceRequirement,
  grant: CompanyEvidenceGrant,
): boolean {
  if (requirement.claim_category === "unresolved_money") return false;
  if (
    grant.claim_category !== requirement.claim_category ||
    grant.fact_kind !== requirement.fact_kind ||
    !coverageCompatible(requirement, grant)
  ) return false;
  if (requirement.fact_kind === "money") {
    if (
      requirement.aggregation_scope === "row" && !requirement.row_label
    ) return false;
    return (requirement.currency === null ||
      requirement.currency === undefined ||
      grant.currency === requirement.currency) &&
      (requirement.money_value === null ||
        requirement.money_value === undefined ||
        grant.money_value === requirement.money_value) &&
      temporalCompatible(requirement, grant) &&
      (requirement.aggregation_scope === null ||
        requirement.aggregation_scope === undefined ||
        grant.aggregation_scope === requirement.aggregation_scope) &&
      (requirement.row_label === null || requirement.row_label === undefined ||
        grant.row_label === requirement.row_label);
  }
  if (requirement.fact_kind === "count") {
    if (grant.count_value === null || grant.count_value === undefined) {
      return false;
    }
    if (
      requirement.count_comparator !== "at_least" &&
      grant.count_comparator !== "exact"
    ) return false;
    if (
      requirement.count_value === null || requirement.count_value === undefined
    ) return true;
    if (!temporalCompatible(requirement, grant)) return false;
    return requirement.count_comparator === "at_least"
      ? grant.count_value >= requirement.count_value
      : grant.count_value === requirement.count_value;
  }
  if (requirement.fact_kind === "existence") {
    return (requirement.state_value === null ||
      requirement.state_value === undefined ||
      grant.state_value === requirement.state_value) &&
      temporalCompatible(requirement, grant);
  }
  if (requirement.fact_kind === "trend") {
    return (requirement.trend_direction === null ||
      requirement.trend_direction === undefined ||
      grant.trend_direction === requirement.trend_direction) &&
      (requirement.currency === null || requirement.currency === undefined ||
        grant.currency === requirement.currency) &&
      (requirement.money_value === null ||
        requirement.money_value === undefined ||
        grant.money_value === requirement.money_value) &&
      requirement.trend_window !== null &&
      requirement.trend_window !== undefined &&
      requirement.trend_window !== "unresolved" &&
      grant.trend_window === requirement.trend_window &&
      (requirement.period_key === null ||
        requirement.period_key === undefined ||
        grant.period_key === requirement.period_key) &&
      (requirement.comparison_period_key === null ||
        requirement.comparison_period_key === undefined ||
        grant.comparison_period_key === requirement.comparison_period_key);
  }
  if (requirement.fact_kind === "qualitative_state") {
    return requirement.qualitative_state !== null &&
      requirement.qualitative_state !== undefined &&
      requirement.qualitative_state !== "unresolved" &&
      grant.qualitative_state === requirement.qualitative_state &&
      temporalCompatible(requirement, grant);
  }
  if (requirement.fact_kind === "top_n") {
    if (
      (requirement.rank_direction === "highest" ||
        requirement.rank_direction === "lowest") && !requirement.rank_label
    ) return false;
    return (requirement.rank_direction === null ||
      requirement.rank_direction === undefined ||
      grant.rank_direction === requirement.rank_direction) &&
      (requirement.rank_label === null ||
        requirement.rank_label === undefined ||
        grant.rank_label === requirement.rank_label) &&
      (requirement.top_n_count === null ||
        requirement.top_n_count === undefined ||
        grant.top_n_count === requirement.top_n_count);
  }
  return true;
}

function grantSatisfies(
  requirement: LiveEvidenceRequirement,
  grant: LiveEvidenceGrant,
): boolean {
  if (requirement.scope === "company") {
    return grant.scope === "company" &&
      companyGrantSatisfies(requirement, grant);
  }
  return requirement.entity_type !== null && requirement.entity_id !== null &&
    grant.scope === "entity" && grant.entity_type === requirement.entity_type &&
    grant.entity_id === requirement.entity_id;
}

export function verifyFinalAnswerLiveEvidence(input: {
  question: string;
  answer: string;
  context: CopilotContextHint;
  grants: readonly LiveEvidenceGrant[];
}): { allowed: boolean; requirements: LiveEvidenceRequirement[] } {
  const requirements = uniqueRequirements([
    ...questionLiveEvidenceRequirements(input.question, input.context),
    ...answerLiveEvidenceRequirements(input.answer, input.context),
  ]);
  return {
    allowed: requirements.every((requirement) =>
      input.grants.some((grant) => grantSatisfies(requirement, grant))
    ),
    requirements,
  };
}
