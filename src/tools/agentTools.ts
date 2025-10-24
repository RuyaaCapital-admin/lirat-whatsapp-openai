// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { getCurrentPrice } from "./price";
import {
  get_ohlc as fetchOhlc,
  OhlcError,
  OhlcResult,
  Candle,
} from "./ohlc";
import {
  buildSignalFromSeries,
  SignalPayload,
  formatSignalPayload,
} from "./compute_trading_signal";
import { fetchNews } from "./news";
import { hardMapSymbol, toTimeframe, TF, TIMEFRAME_FALLBACKS } from "./normalize";

function detectLang(text?: string) {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
}

function toUtcString(input: number | string | null): string {
  if (typeof input === "number") {
    const epochMs = input > 10_000_000_000 ? input : input * 1000;
    const iso = new Date(epochMs).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }
  if (typeof input === "string" && input.trim()) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString();
      return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    }
  }
  const nowIso = new Date().toISOString();
  return `${nowIso.slice(0, 10)} ${nowIso.slice(11, 16)} UTC`;
}

function formatPriceOutput(symbol: string, price: number, time: number | string | null, source: string) {
  return [
    `Time (UTC): ${toUtcString(time)}`,
    `Symbol: ${symbol}`,
    `Price: ${price}`,
    `Source: ${source}`,
  ].join("\n");
}

function normaliseCandles(candles: Candle[]): Candle[] {
  return candles
    .map((candle) => ({
      o: Number(candle.o),
      h: Number(candle.h),
      l: Number(candle.l),
      c: Number(candle.c),
      t: Number(candle.t),
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

const TF_TO_MS: Record<TF, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const sorted = normaliseCandles(candles);
  if (!sorted.length) {
    throw new Error("missing_candles");
  }
  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const last = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;
  const now = Date.now();
  const candidate = last && now - last.t < tfMs * 0.5 ? prev ?? last : last;
  if (!candidate) {
    throw new Error("no_closed_candle");
  }
  return candidate;
}

async function computeWithFallback(symbol: string, requested: TF): Promise<SignalPayload> {
  const ladder = [requested, ...(TIMEFRAME_FALLBACKS[requested] ?? [])];
  let lastError: unknown;
  for (const tf of ladder) {
    try {
      const series = await fetchOhlc(symbol, tf, 320);
      if (tf !== requested) {
        console.info("[TF] fallback", { symbol, requested, used: tf });
      }
      return buildSignalFromSeries(symbol, series.timeframe, series);
    } catch (error) {
      lastError = error;
      if (error instanceof OhlcError && error.code === "NO_DATA_FOR_INTERVAL") {
        console.warn("[TF] no data", { symbol, requested, attempted: tf });
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("signal_unavailable");
}

async function computeSignalText(
  symbol: string,
  timeframe: TF,
  candles?: Candle[],
): Promise<string> {
  if (candles && candles.length > 0) {
    const sorted = normaliseCandles(candles);
    const lastClosed = deriveLastClosed(sorted, timeframe);
    const payload: OhlcResult = {
      candles: sorted,
      lastClosed,
      timeframe,
      source: "PROVIDED",
    };
    const signal = buildSignalFromSeries(symbol, timeframe, payload);
    return formatSignalPayload(signal);
  }

  const signal = await computeWithFallback(symbol, timeframe);
  return formatSignalPayload(signal);
}

export async function get_price(symbol: string, timeframe?: string): Promise<string> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const price = await getCurrentPrice(mappedSymbol);
  return formatPriceOutput(mappedSymbol, price.price, price.time ?? null, price.source);
}

export async function get_ohlc(symbol: string, timeframe: string, limit = 200): Promise<string> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  try {
    const data = await fetchOhlc(mappedSymbol, tf, Math.max(50, Math.min(limit, 400)));
    return JSON.stringify({
      candles: data.candles,
      lastClosed: data.lastClosed,
      timeframe: data.timeframe,
      source: data.source,
    });
  } catch (error) {
    if (error instanceof OhlcError && error.code === "NO_DATA_FOR_INTERVAL") {
      return JSON.stringify({ code: error.code, timeframe: tf });
    }
    throw error;
  }
}

export async function compute_trading_signal(
  symbol: string,
  timeframe: string,
  candles?: Candle[],
): Promise<string> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  const text = await computeSignalText(mappedSymbol, tf, candles);
  return text;
}

export async function about_liirat_knowledge(query: string, lang?: string): Promise<string> {
  const vectorStore = process.env.OPENAI_VECTOR_STORE_ID;
  if (!vectorStore) {
    throw new Error("missing_vector_store");
  }
  const language = lang || detectLang(query);
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "أجب عن أسئلة ليرات بالاعتماد على الملفات الداخلية فقط. اجعل الإجابة من سطر واحد أو سطرين بحد أقصى.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: query }],
      },
    ],
    tools: [{ type: "file_search", vector_store_ids: [vectorStore] }],
    max_output_tokens: 400,
  });
  let text = "";
  if (typeof (response as any)?.output_text === "string") {
    text = (response as any).output_text.trim();
  } else if (Array.isArray((response as any)?.output)) {
    const pieces = (response as any).output
      .flatMap((item: any) =>
        Array.isArray(item.content)
          ? item.content
          : item.content
          ? [item.content]
          : [],
      )
      .map((chunk: any) => (typeof chunk === "string" ? chunk : chunk?.text ?? ""))
      .filter(Boolean);
    text = pieces.join("\n").trim();
  }
  if (!text) {
    throw new Error("empty_knowledge_response");
  }
  if (language === "en") {
    text = text.replace(/\s+/g, " ").trim();
  }
  return text;
}

export async function search_web_news(query: string, lang = "en", count = 3): Promise<string> {
  const language = lang === "ar" ? "ar" : "en";
  const safeCount = Math.max(1, Math.min(count, 5));
  const rows = await fetchNews(query, safeCount, language);
  if (!rows.length) {
    return "";
  }
  const lines = rows.slice(0, safeCount).map((item) => {
    const impact = item.impact && item.impact.trim() ? item.impact.trim() : "-";
    return `${item.date} — ${item.source} — ${item.title} — ${impact}`;
  });
  return lines.join("\n");
}

