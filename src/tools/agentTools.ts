// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { formatNewsMsg, formatPriceMsg, formatSignalMsg } from "../utils/formatters";
import { getCurrentPrice } from "./price";
import { Candle, get_ohlc as loadOhlc } from "./ohlc";
import { computeSignal } from "./compute_trading_signal";
import { fetchNews } from "./news";
import { hardMapSymbol, toTimeframe, TF } from "./normalize";

export interface PriceResult {
  symbol: string;
  price: number;
  timeUTC: string;
  source: string;
  formatted: string;
}

export interface OhlcResultPayload {
  symbol: string;
  interval: TF;
  candles: Candle[];
  lastClosedUTC: string;
}

export interface TradingSignalResult {
  decision: "BUY" | "SELL" | "NEUTRAL";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  time: string;
  symbol: string;
  interval: TF;
  formatted: string;
}

export interface NewsRow {
  date: string;
  source: string;
  title: string;
}

export interface NewsResult {
  rows: NewsRow[];
  formatted: string;
}

function toUtcIso(input: number | string | null | undefined): string {
  if (typeof input === "number") {
    const ms = input > 10_000_000_000 ? input : input * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof input === "string" && input.trim()) {
    const candidate = new Date(input.trim());
    if (!Number.isNaN(candidate.getTime())) {
      return candidate.toISOString();
    }
    const patched = `${input.trim().replace(/\s+/, "T")}Z`;
    const alt = new Date(patched);
    if (!Number.isNaN(alt.getTime())) {
      return alt.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeCandles(candles: Candle[]): Candle[] {
  return candles
    .map((candle) => ({
      o: Number(candle.o),
      h: Number(candle.h),
      l: Number(candle.l),
      c: Number(candle.c),
      t: Number(candle.t),
    }))
    .filter((candle) =>
      Number.isFinite(candle.o) &&
      Number.isFinite(candle.h) &&
      Number.isFinite(candle.l) &&
      Number.isFinite(candle.c) &&
      Number.isFinite(candle.t),
    )
    .sort((a, b) => a.t - b.t);
}

export async function get_price(symbol: string, timeframe?: string): Promise<PriceResult> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  void timeframe;
  const price = await getCurrentPrice(mappedSymbol);
  const timeUTC = toUtcIso(price.time ?? null);
  const source = price.source ?? "FCS latest";
  const formatted = formatPriceMsg({ symbol: mappedSymbol, price: price.price, timeUTC, source });
  return { symbol: mappedSymbol, price: price.price, timeUTC, source, formatted };
}

export async function get_ohlc(symbol: string, timeframe: string, limit = 200): Promise<OhlcResultPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  const requestedLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 200;
  const safeLimit = Math.max(50, Math.min(requestedLimit, 200));
  const series = await loadOhlc(mappedSymbol, tf, safeLimit);
  const candles = normalizeCandles(series.candles);
  const lastClosedUTC = toUtcIso(series.lastClosed?.t ?? candles.at(-1)?.t ?? null);
  return { symbol: mappedSymbol, interval: tf, candles, lastClosedUTC };
}

export async function compute_trading_signal(
  symbol: string,
  timeframe: string,
  candles?: Candle[],
): Promise<TradingSignalResult> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  let hydrated = Array.isArray(candles) ? normalizeCandles(candles) : undefined;
  if (!hydrated || hydrated.length < 50) {
    const snapshot = await get_ohlc(mappedSymbol, tf, 200);
    hydrated = snapshot.candles;
  }
  const payload = await computeSignal(mappedSymbol, tf, hydrated);
  const formatted = formatSignalMsg({
    decision: payload.signal,
    entry: payload.entry,
    sl: payload.sl,
    tp1: payload.tp1,
    tp2: payload.tp2,
    time: payload.timeUTC,
    symbol: payload.symbol,
  });
  return {
    decision: payload.signal,
    entry: payload.entry,
    sl: payload.sl,
    tp1: payload.tp1,
    tp2: payload.tp2,
    time: payload.timeUTC,
    symbol: payload.symbol,
    interval: payload.interval,
    formatted,
  };
}

function detectLang(text?: string) {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
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
        Array.isArray(item.content) ? item.content : item.content ? [item.content] : [],
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

export async function search_web_news(query: string, lang = "en", count = 3): Promise<NewsResult> {
  const language = lang === "ar" ? "ar" : "en";
  const safeCount = Math.max(1, Math.min(count, 5));
  const rowsRaw = await fetchNews(query, safeCount, language);
  const rows: NewsRow[] = rowsRaw.slice(0, safeCount).map((item) => ({
    date: toUtcIso(item.date ?? Date.now()),
    source: item.source ?? "",
    title: item.title ?? "",
  }));
  const formatted = formatNewsMsg(rows, "* ");
  return { rows, formatted };
}
