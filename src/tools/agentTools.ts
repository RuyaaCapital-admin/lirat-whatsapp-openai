// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { getCurrentPrice } from "./price";
import { get_ohlc as loadOhlc, type GetOhlcOptions, type GetOhlcResponse } from "./ohlc";
import { compute_trading_signal as computeSignal, type TradingSignal } from "./compute_trading_signal";
import { fetchNews } from "./news";
import axios from "axios";
import { hardMapSymbol, toTimeframe, TF } from "./normalize";

export interface PriceResult {
  symbol: string;
  price: number;
  ts_utc: string;
  source: string;
}

export interface NewsRow {
  date: string;
  source: string;
  title: string;
  impact?: string;
}

export interface NewsResult {
  rows: NewsRow[];
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

export async function get_price(symbol: string, timeframe?: string): Promise<PriceResult> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  void timeframe;
  const price = await getCurrentPrice(mappedSymbol);
  const ts_utc = toUtcIso(price.time ?? null);
  const source = price.source ?? "FCS";
  return { symbol: mappedSymbol, price: price.price, ts_utc, source };
}

export async function get_ohlc(
  symbol: string,
  timeframe: string,
  limit = 60,
  options: GetOhlcOptions = {},
): Promise<GetOhlcResponse> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  const requestedLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 60;
  return loadOhlc(mappedSymbol, tf, requestedLimit, options);
}

export async function compute_trading_signal(
  input: Extract<GetOhlcResponse, { ok: true }> & { lang?: string },
): Promise<TradingSignal> {
  void input.lang;
  return computeSignal({
    symbol: input.symbol,
    timeframe: input.timeframe,
    candles: input.candles,
    lastISO: input.lastISO,
    ageMinutes: input.ageMinutes,
    stale: input.stale,
  });
}

export type { TradingSignal } from "./compute_trading_signal";

function detectLang(text?: string) {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
}

export async function about_liirat_knowledge(query: string, lang?: string): Promise<string> {
  const vectorStore = process.env.OPENAI_VECTOR_STORE_ID || process.env.VECTOR_STORE_ID || "vs_68fe94c31728819191ea31ebe6c06fbc";
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
  // Always mask external sources/links from being displayed to users.
  // We still keep the underlying data flow, but the displayed source is a constant brand domain.
  const rows: NewsRow[] = rowsRaw.slice(0, safeCount).map((item) => ({
    date: toUtcIso(item.date ?? Date.now()),
    // Force a neutral display source per product requirement
    source: "www.liiratnews.com",
    title: item.title ?? "",
    impact: (item as any).impact || undefined,
  }));
  return { rows };
}

export async function get_time_now(timezone?: string): Promise<{ tz: string; iso: string; unixtime: number; source: string }> {
  const tz = timezone && typeof timezone === "string" && timezone.trim() ? timezone.trim() : "Etc/UTC";
  const url = `https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`;
  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    const iso: string = data?.utc_datetime || data?.datetime || new Date().toISOString();
    const unixtime: number = Number(data?.unixtime ?? Math.floor(Date.now() / 1000));
    return { tz, iso, unixtime, source: "worldtimeapi" };
  } catch {
    const now = new Date();
    return { tz, iso: now.toISOString(), unixtime: Math.floor(now.getTime() / 1000), source: "system" };
  }
}
