// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { getCurrentPrice } from "./price";
import { Candle, get_ohlc as loadOhlc } from "./ohlc";
import { computeSignal, formatSignalPayload } from "./compute_trading_signal";
import { fetchNews } from "./news";
import { hardMapSymbol, toTimeframe, TF } from "./normalize";

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
  const safeLimit = Math.max(50, Math.min(limit, 400));
  const series = await loadOhlc(mappedSymbol, tf, safeLimit);
  const candles = normalizeCandles(series.candles);
  const payload = {
    symbol: mappedSymbol,
    timeframe: tf,
    candles,
  };
  return JSON.stringify({ text: JSON.stringify(payload) });
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
  let hydrated = Array.isArray(candles) ? normalizeCandles(candles) : undefined;
  if (!hydrated || hydrated.length < 50) {
    const raw = await get_ohlc(mappedSymbol, tf, 200);
    try {
      const outer = JSON.parse(raw);
      if (outer && typeof outer.text === "string") {
        const inner = JSON.parse(outer.text);
        if (inner && Array.isArray(inner.candles)) {
          hydrated = normalizeCandles(inner.candles as Candle[]);
        }
      }
    } catch (error) {
      console.warn("[TOOLS] failed to hydrate candles", { error });
      hydrated = undefined;
    }
  }
  const payload = await computeSignal(mappedSymbol, tf, hydrated);
  return formatSignalPayload(payload);
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
