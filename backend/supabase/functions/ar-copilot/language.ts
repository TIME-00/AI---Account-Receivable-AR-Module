export const COPILOT_LANGUAGES = ["en", "zh-CN", "ms"] as const;
export type CopilotLanguage = typeof COPILOT_LANGUAGES[number];

const CHINESE = /[\u3400-\u9fff]/u;
const MALAY =
  /\b(?:ada|apa|apakah|bagaimana|bandingkan|banyak|berapa|bila|boleh|bulan|dalam|dan|dengan|hari|hantar|ini|invois|itu|keadaan|kenapa|kutipan|lepas|macam|mana|masih|maksud|nak|paling|patut|pelanggan|perlu|proses|saya|sekarang|sila|tengok|terangkan|terkini|tertunggak|tolong|yang)\b/i;

function explicitLanguage(text: string): CopilotLanguage | null {
  if (
    /(?:answer|reply|respond)\s+in\s+english|(?:\u7528|\u4f7f\u7528)\u82f1\u8bed\u56de\u7b54/i
      .test(text)
  ) {
    return "en";
  }
  if (
    /(?:answer|reply|respond)\s+in\s+(?:simplified\s+)?chinese|(?:\u7528|\u4f7f\u7528)(?:\u7b80\u4f53)?\u4e2d\u6587\u56de\u7b54/i
      .test(text)
  ) {
    return "zh-CN";
  }
  if (
    /(?:answer|reply|respond)\s+in\s+(?:bahasa\s+)?melayu|jawab\s+(?:dalam\s+)?bahasa\s+melayu/i
      .test(text)
  ) {
    return "ms";
  }
  return null;
}

export function detectCopilotLanguage(text: string): CopilotLanguage | null {
  if (CHINESE.test(text)) return "zh-CN";
  if (MALAY.test(text)) return "ms";
  return /[A-Za-z]/.test(text) ? "en" : null;
}

export function selectCopilotLanguage(
  currentMessage: string,
  recentMessages: readonly { role: "user" | "assistant"; content: string }[],
): CopilotLanguage {
  const explicit = explicitLanguage(currentMessage);
  if (explicit) return explicit;

  for (let index = recentMessages.length - 2; index >= 0; index -= 1) {
    if (recentMessages[index].role !== "user") continue;
    const detected = detectCopilotLanguage(recentMessages[index].content);
    if (detected && detected !== "en") return detected;
  }
  return detectCopilotLanguage(currentMessage) ?? "en";
}

export function languageInstruction(language: CopilotLanguage): string {
  return language === "zh-CN"
    ? "Respond in natural Simplified Chinese. Preserve document numbers, currency codes, amounts, statuses, and tool identifiers exactly."
    : language === "ms"
    ? "Respond in natural Bahasa Melayu suitable for Malaysian AR operations. Preserve document numbers, currency codes, amounts, statuses, and tool identifiers exactly."
    : "Respond in English. Preserve document numbers, currency codes, amounts, statuses, and tool identifiers exactly.";
}

export function multilingualIntentSignals(text: string): {
  definition: boolean;
  live: boolean;
  write: boolean;
} {
  const lower = text.toLowerCase();
  return {
    definition:
      /(?:\u4ec0\u4e48\u662f|\u4ec0\u4e48\u53eb|\u662f\u4ec0\u4e48\u610f\u601d|\u4ec0\u4e48\u610f\u601d|\u89e3\u91ca|\u600e\u4e48\u8fdb\u884c|\u5982\u4f55).{0,40}(?:unapplied|allocation|allocate|post|posting|straight-through|\u672a\u5206\u914d|\u672a\u6838\u9500|\u5206\u914d|\u8fc7\u8d26)|(?:unapplied|allocation|straight-through|\u672a\u5206\u914d|\u672a\u6838\u9500|\u5206\u914d).{0,30}(?:\u662f\u4ec0\u4e48\u610f\u601d|\u4ec0\u4e48\u610f\u601d)|(?:apa\s+maksud|apa\s+itu|apakah\s+maksud|macam\s+mana\s+nak|bagaimana\s+(?:proses|cara)).{0,60}(?:unapplied|allocation|allocate|post|posting|straight-through|cash|invoice|receipt)/iu
        .test(lower),
    live:
      /(?:\u73b0\u5728|\u76ee\u524d|\u5f53\u524d|\u4eca\u5929|\u6700\u8fd1|\u591a\u5c11|\u54ea\u4e2a|\u54ea\u4e00\u4e2a|\u6700\u591a|\u6700\u9ad8|\u9700\u8981\u5904\u7406|\u503c\u5f97.{0,12}\u7559\u610f|\u8ddf.{0,20}\u76f8\u6bd4|\u672c\u6708|\u8fd9\u4e2a\u6708|\u4e0a\u4e2a\u6708|\u4e3a\u4ec0\u4e48.*(?:\u8fd8|\u73b0\u5728)|\u5206\u6790|\u62a5\u544a|\u98ce\u9669|\u91cd\u70b9|\u6536\u6b3e|\u589e\u52a0|\u53d8\u5316|\u6bd4\u8f83|sekarang|terkini|berapa|paling|hari\s+ini|(?:pelanggan|customer)\s+mana|bandingkan|bulan\s+ini|bulan\s+lepas|keadaan\s+ar|patut\s+saya\s+tengok|apa-apa.{0,30}perlu.{0,20}tengok|banyak\s+tak|perlu\s+(?:fokus|saya\s+tengok|ditangani)|masih\s+(?:overdue|open|unapplied|belum)|kenapa.*(?:masih|belum|sekarang)|tertunggak|analisis|laporan|risiko|fokus|kutipan|meningkat|peningkatan|perbandingan)/iu
        .test(lower),
    write:
      /(?:\u5e2e\u6211|\u66ff\u6211|\u8acb|\u8bf7|\u76f4\u63a5).{0,80}(?:post|cancel|allocate|reverse|reminder|\u53d1\u9001|\u53d1|\u53d6\u6d88|\u8fc7\u8d26|\u5206\u914d)|\b(?:tolong|sila)\s+(?:hantar|post|allocate|reverse|batalkan|peruntuk)\s+(?:reminder|invoice|invois|receipt|allocation|resit)\b|^(?:hantar|post|allocate|reverse|batalkan|peruntuk)\s+(?:reminder|invoice|invois|receipt|allocation|resit)(?:\s+(?:ini|sekarang))?[.!?\s]*$/iu
        .test(lower),
  };
}
