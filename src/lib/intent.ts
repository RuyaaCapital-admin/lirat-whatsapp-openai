// src/lib/intent.ts
import { normalizeArabic, hardMapSymbol, toTimeframe, type TF } from "../tools/normalize";

export type Intent =
  | { kind: "signal"; symbol: string; timeframe: TF }
  | { kind: "price"; symbol: string; timeframe: TF }
  | { kind: "about_liirat"; queryLang: "ar" | "en" }
  | { kind: "memory_question" }
  | { kind: "chat"; text: string }
  | { kind: "clarify_symbol"; missing: "symbol"; timeframe?: TF }
  | { kind: "clarify_timeframe"; symbol: string; missing: "timeframe" }
  | { kind: "unsupported" };

export interface ConversationStateForIntent {
  last_symbol: string | null;
  last_tf: string | null;
  language: "ar" | "en";
}

const SIGNAL_MARKERS = [
  "صفقة",
  "إشارة",
  "اشارة",
  "تحليل",
  "signal",
  "buy",
  "sell",
  "long",
  "short",
  "توصية",
];

const PRICE_MARKERS = ["سعر", "price", "quote", "كم", "قديش", "بكم"];

const MEMORY_MARKERS = [
  "شو حكيت معك",
  "شو قلتلك",
  "شو كان ردك",
  "شو حكينا قبل",
  "شو قلت لي",
];

const COMPANY_MARKERS = [
  "مين ليرات",
  "شو هي ليرات",
  "وين مكاتبكم",
  "liirat",
  "ليرات",
  "سيرفر تداول",
  "mt5",
  "من انتم",
  "من انت",
  "who is liirat",
  "about liirat",
];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = normalizeArabic(text.toLowerCase());
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function extractTimeframe(text: string): TF | null {
  const t = normalizeArabic(text.toLowerCase());
  const hasTfHint = /\b(1\s*(?:m|min|minute|h|hour)|5\s*(?:m|min)|15\s*(?:m|min)|30\s*(?:m|min)|4\s*(?:h|hour)|daily|day|دقيقة|دقايق|ربع ساعة|نص ساعة|ساعة|اربع ساعات|٤ ساعات|يومي|يوم)\b/.test(
    t,
  );
  if (!hasTfHint) return null;
  return toTimeframe(text);
}

function extractSymbol(text: string): string | null {
  return hardMapSymbol(text);
}

export function decideUserIntent(
  params: { text: string; conversationState: ConversationStateForIntent },
): Intent {
  const raw = params.text || "";
  const normalised = normalizeArabic(raw);
  const { last_symbol, last_tf } = params.conversationState;

  const isSignal = containsAny(normalised, SIGNAL_MARKERS);
  const isPrice = containsAny(normalised, PRICE_MARKERS);
  const isMemory = containsAny(normalised, MEMORY_MARKERS);
  const isCompany = containsAny(normalised, COMPANY_MARKERS);

  // Try to detect symbol/timeframe from text or memory
  const symbolDetected = extractSymbol(normalised);
  const timeframeDetected = extractTimeframe(normalised);

  const symbolFinal = symbolDetected ?? last_symbol ?? null;
  const tfFromMemory = (last_tf ? (toTimeframe(last_tf) as TF) : null) ?? null;

  if (isCompany) {
    return { kind: "about_liirat", queryLang: params.conversationState.language };
  }
  if (isMemory) {
    return { kind: "memory_question" };
  }

  if (isSignal) {
    if (!symbolDetected && symbolFinal && timeframeDetected) {
      return { kind: "signal", symbol: symbolFinal, timeframe: timeframeDetected };
    }
    if (symbolFinal) {
      const tf = (timeframeDetected ?? tfFromMemory ?? ("5min" as TF)) as TF;
      return { kind: "signal", symbol: symbolFinal, timeframe: tf };
    }
    return { kind: "clarify_symbol", missing: "symbol", timeframe: timeframeDetected ?? undefined };
  }

  if (isPrice || (!!symbolDetected && !isSignal)) {
    const finalSym = symbolFinal ?? symbolDetected;
    if (!finalSym) {
      return { kind: "clarify_symbol", missing: "symbol" };
    }
    const tf = (timeframeDetected ?? tfFromMemory ?? ("1min" as TF)) as TF;
    return { kind: "price", symbol: finalSym, timeframe: tf };
  }

  if (!symbolDetected && timeframeDetected && last_symbol) {
    return { kind: "signal", symbol: last_symbol, timeframe: timeframeDetected };
  }

  if (symbolDetected) {
    return { kind: "price", symbol: symbolDetected, timeframe: (timeframeDetected ?? ("1min" as TF)) as TF };
  }

  if (normalised.trim()) {
    return { kind: "chat", text: raw };
  }

  return { kind: "unsupported" };
}
