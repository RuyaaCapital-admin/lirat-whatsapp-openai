// src/utils/webhookHelpers.ts

export type ToolCandle = { o: number; h: number; l: number; c: number; t: number };

export type OhlcSnapshot = { symbol: string; timeframe: string; candles: ToolCandle[] };

export type LanguageCode = "ar" | "en";

export function detectLanguage(text: string): LanguageCode {
  return /\p{Script=Arabic}/u.test(text) ? "ar" : "en";
}

export function normaliseDigits(text: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return text.replace(/[٠-٩]/g, (char) => {
    const index = arabicDigits.indexOf(char);
    return index >= 0 ? String(index) : char;
  });
}

export function parseCandles(input: unknown): ToolCandle[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => ({
      o: Number((item as any)?.o),
      h: Number((item as any)?.h),
      l: Number((item as any)?.l),
      c: Number((item as any)?.c),
      t: Number((item as any)?.t),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.o) &&
        Number.isFinite(candle.h) &&
        Number.isFinite(candle.l) &&
        Number.isFinite(candle.c) &&
        Number.isFinite(candle.t),
    )
    .sort((a, b) => a.t - b.t);
}

export function parseOhlcPayload(content: string): OhlcSnapshot | null {
  try {
    const outer = JSON.parse(content);
    if (!outer || typeof outer.text !== "string") {
      return null;
    }
    const inner = JSON.parse(outer.text);
    if (
      inner &&
      typeof inner.symbol === "string" &&
      typeof inner.timeframe === "string" &&
      Array.isArray(inner.candles)
    ) {
      const candles = parseCandles(inner.candles) ?? [];
      if (candles.length) {
        return { symbol: inner.symbol, timeframe: inner.timeframe, candles };
      }
    }
  } catch (error) {
    console.warn("[TOOLS] failed to parse OHLC payload", error);
  }
  return null;
}

export function normaliseSymbolKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

