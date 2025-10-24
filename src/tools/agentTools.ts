// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { getCurrentPrice } from "./price";
import { get_ohlc as fetchOhlc, OhlcError, OhlcResult } from "./ohlc";
import { buildSignalFromSeries, SignalPayload } from "./compute_trading_signal";
import { fetchNews } from "./news";
import { hardMapSymbol, toTimeframe, TF, TIMEFRAME_FALLBACKS } from "./normalize";

type ToolPayload = { text: string } | SignalPayload | Record<string, unknown>;

function detectLang(text?: string) {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
}

function formatPriceOutput(symbol: string, price: number, time: string | number | null, source: string) {
  let timeValue: string;
  if (typeof time === "number") {
    const date = new Date(time * (time > 10_000_000_000 ? 1 : 1000));
    const iso = date.toISOString();
    timeValue = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  } else if (typeof time === "string") {
    const parsed = new Date(time);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString();
      timeValue = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    } else {
      timeValue = `${new Date().toISOString().slice(0, 16)} UTC`;
    }
  } else {
    timeValue = `${new Date().toISOString().slice(0, 16)} UTC`;
  }
  return `Time (UTC): ${timeValue}\nSymbol: ${symbol.toUpperCase()}\nPrice: ${price}\nSource: ${source}`;
}

function responseText(response: any) {
  if (!response) return "";
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (Array.isArray(output)) {
    const chunks = output
      .flatMap((item: any) => (Array.isArray(item.content) ? item.content : item.content ? [item.content] : []))
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
      .filter(Boolean);
    return chunks.join("\n").trim();
  }
  return "";
}

export async function get_price(symbol: string, timeframe?: string): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const price = await getCurrentPrice(mappedSymbol);
  const text = formatPriceOutput(mappedSymbol, price.price, price.time ?? null, price.source);
  return { text };
}

export async function get_ohlc(symbol: string, timeframe: string, limit = 200): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  try {
    const data = await fetchOhlc(mappedSymbol, tf, Math.max(50, Math.min(limit, 400)));
    return {
      candles: data.candles,
      lastClosed: data.lastClosed,
      timeframe: data.timeframe,
      source: data.source,
    };
  } catch (error) {
    if (error instanceof OhlcError && error.code === "NO_DATA_FOR_INTERVAL") {
      return { code: error.code, timeframe: tf };
    }
    throw error;
  }
}

async function computeWithFallback(symbol: string, requested: TF): Promise<SignalPayload> {
  const ladder = [requested, ...TIMEFRAME_FALLBACKS[requested]];
  let lastError: unknown;
  for (const tf of ladder) {
    try {
      const series: OhlcResult = await fetchOhlc(symbol, tf, 320);
      if (tf !== requested) {
        console.info("[TF] ladder", { symbol, requested, used: tf, lastClosed: series.lastClosed.t });
      }
      const payload = buildSignalFromSeries(symbol, tf, series);
      console.info("[SIGNAL] resolved", {
        symbol,
        requested,
        used: tf,
        timeUTC: payload.timeUTC,
        signal: payload.signal,
      });
      return { ...payload, interval: tf };
    } catch (error) {
      if (error instanceof OhlcError && error.code === "NO_DATA_FOR_INTERVAL") {
        console.warn("[TF] no data", { symbol, requested, attempted: tf });
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("signal_unavailable");
}

export async function compute_trading_signal(symbol: string, timeframe: string): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  return computeWithFallback(mappedSymbol, tf);
}

export async function about_liirat_knowledge(query: string, lang?: string): Promise<ToolPayload> {
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
        content: [{ type: "input_text", text: `أجب عن أسئلة ليرات بالاعتماد على الملفات الداخلية فقط. اجعل الإجابة من سطر واحد أو سطرين بحد أقصى.` }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: query }],
      },
    ],
    tools: [{ type: "file_search", vector_store_ids: [vectorStore] }],
    max_output_tokens: 400,
  });
  let text = responseText(response);
  if (!text) {
    throw new Error("empty_knowledge_response");
  }
  if (language === "en") {
    text = text.replace(/\s+/g, " ").trim();
  }
  return { text };
}

export async function search_web_news(query: string, lang = "en", count = 3): Promise<ToolPayload> {
  const language = lang === "ar" ? "ar" : "en";
  const safeCount = Math.max(1, Math.min(count, 5));
  const rows = await fetchNews(query, safeCount, language);
  return { text: JSON.stringify({ items: rows, lang: language }) };
}
