import { strict as assert } from "node:assert";

export type LanguageCode = "ar" | "en";

export function detectArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function toLanguage(text: string): LanguageCode {
  return detectArabic(text) ? "ar" : "en";
}

function ensureDate(input: string | number | Date): Date {
  if (input instanceof Date) {
    return new Date(input.getTime());
  }
  if (typeof input === "number") {
    const ms = input > 10_000_000_000 ? input : input * 1000;
    return new Date(ms);
  }
  if (typeof input === "string" && input.trim()) {
    const parsed = new Date(input.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    const alt = new Date(`${input.trim().replace(/\s+/, "T")}Z`);
    if (!Number.isNaN(alt.getTime())) {
      return alt;
    }
  }
  throw new Error("INVALID_DATE");
}

export function formatUtcLabel(input: string | number | Date): string {
  const date = ensureDate(input);
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function formatPriceValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.00";
  }
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 10) return value.toFixed(3);
  if (abs >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

export interface PriceFormatterInput {
  symbol: string;
  price: number;
  timeISO: string;
}

export function priceFormatter(input: PriceFormatterInput, lang: LanguageCode): string {
  assert(input.symbol, "symbol required");
  const label = formatUtcLabel(input.timeISO);
  const price = formatPriceValue(input.price);
  if (lang === "ar") {
    return [`الوقت (UTC): ${label}`, `الرمز: ${input.symbol}`, `السعر: ${price}`].join("\n");
  }
  return [`time (UTC): ${label}`, `symbol: ${input.symbol}`, `price: ${price}`].join("\n");
}

export type ReasonToken = "bullish_pressure" | "bearish_pressure" | "no_clear_bias";

export interface SignalFormatterInput {
  symbol: string;
  timeframe: string;
  timeUTC: string;
  decision: "BUY" | "SELL" | "NEUTRAL";
  reason: ReasonToken;
  levels: { entry: number | null; sl: number | null; tp1: number | null; tp2: number | null };
  stale: boolean;
  ageMinutes: number;
}

function formatLevel(value: number | null, symbol: string): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return formatPriceValue(value);
}

const REASON_MAP: Record<LanguageCode, Record<ReasonToken, string>> = {
  ar: {
    bullish_pressure: "ضغط شراء فوق المتوسطات",
    bearish_pressure: "ضغط بيع تحت المتوسطات",
    no_clear_bias: "السوق بدون اتجاه واضح حالياً",
  },
  en: {
    bullish_pressure: "Buy pressure above short-term averages",
    bearish_pressure: "Bearish momentum below resistance",
    no_clear_bias: "No clear directional bias right now",
  },
};

export function signalFormatter(input: SignalFormatterInput, lang: LanguageCode): string {
  const age = Math.max(0, Math.round(input.ageMinutes));
  const reasonText = REASON_MAP[lang][input.reason] ?? REASON_MAP.en.no_clear_bias;
  const staleSuffix = input.stale
    ? lang === "ar"
      ? " (إشارة قديمة، للمراجعة فقط)"
      : " (stale review only)"
    : "";
  const lines: string[] = [];
  if (input.stale) {
    lines.push(
      lang === "ar"
        ? `تنبيه: البيانات متأخرة بحوالي ${age} دقيقة`
        : `Warning: data is delayed by ~${age} minutes`,
    );
  }
  if (lang === "ar") {
    lines.push(`الوقت (UTC): ${input.timeUTC}`);
    lines.push(`الرمز: ${input.symbol}`);
    lines.push(`الإطار الزمني: ${input.timeframe}`);
    lines.push(`الإشارة: ${input.decision}`);
    lines.push(`السبب: ${reasonText}${staleSuffix}`);
    lines.push("مناطق الدخول/الإدارة:");
    lines.push(`Entry: ${formatLevel(input.levels.entry, input.symbol)}`);
    lines.push(`SL: ${formatLevel(input.levels.sl, input.symbol)}`);
    lines.push(`TP1: ${formatLevel(input.levels.tp1, input.symbol)}`);
    lines.push(`TP2: ${formatLevel(input.levels.tp2, input.symbol)}`);
    return lines.join("\n");
  }
  lines.push(`time (UTC): ${input.timeUTC}`);
  lines.push(`symbol: ${input.symbol}`);
  lines.push(`timeframe: ${input.timeframe}`);
  lines.push(`SIGNAL: ${input.decision}`);
  lines.push(`Reason: ${reasonText}${staleSuffix}`);
  lines.push(`Entry: ${formatLevel(input.levels.entry, input.symbol)}`);
  lines.push(`SL: ${formatLevel(input.levels.sl, input.symbol)}`);
  lines.push(`TP1: ${formatLevel(input.levels.tp1, input.symbol)}`);
  lines.push(`TP2: ${formatLevel(input.levels.tp2, input.symbol)}`);
  return lines.join("\n");
}

export interface NewsItem {
  date: string | number | Date;
  source: string;
  title: string;
}

export function newsFormatter(rows: NewsItem[], lang: LanguageCode): string {
  const items = rows
    .filter((row) => row && row.title && row.source)
    .slice(0, 3)
    .map((row) => {
      const label = formatUtcLabel(row.date);
      const date = label.slice(0, 10);
      return `${date} — ${row.source} — ${row.title}`;
    });
  if (items.length) {
    return items.join("\n");
  }
  return lang === "ar" ? "لا يوجد أخبار متاحة الآن." : "No news available right now.";
}
