// src/lib/smartReplyNew.ts
import { get_price, get_ohlc, compute_trading_signal, search_web_news, about_liirat_knowledge } from "../tools/agentTools";
import { hardMapSymbol, toTimeframe } from "../tools/normalize";
import { type LanguageCode } from "../utils/formatters";
import generateReply from "./generateReply";
import { getOrCreateConversationByTitle, fetchRecentContext } from "./supabaseLite";
import { classifyIntent, type ClassifiedIntent } from "./intentClassifier";

export interface SmartReplyInput {
  phone: string;
  text: string;
  contactName?: string;
}

export interface SmartReplyOutput {
  replyText: string;
  language: LanguageCode;
  conversationId: string | null;
}

function detectLanguage(text: string): LanguageCode {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function normalizeText(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632));
}

// No persistent state used; classifier will leverage history for context

async function buildSignalToolResult(symbol: string, timeframe: string, language: LanguageCode) {
  const ohlc = await get_ohlc(symbol, timeframe, 150);
  if (!ohlc.ok) {
    return { tool_result: { type: "signal_error", symbol, timeframe, error: "NO_DATA" as const } };
  }
  const signal = await compute_trading_signal({ ...ohlc, lang: language });
  const staleMinutes = Math.max(0, Math.round(ohlc.ageMinutes));
  const reasonText = language === "ar"
    ? (signal.reason === "bullish_pressure" ? "ضغط شراء فوق المتوسطات"
      : signal.reason === "bearish_pressure" ? "ضغط بيع تحت المتوسطات" : "السوق بدون اتجاه واضح حالياً.")
    : (signal.reason === "bullish_pressure" ? "Buy pressure above averages"
      : signal.reason === "bearish_pressure" ? "Bearish pressure below averages" : "No clear directional bias right now.");

  const tool_result: Record<string, unknown> = {
    type: "signal",
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    utc_candle_time: ohlc.lastISO,
    stale_minutes: staleMinutes,
    decision: signal.decision,
    reason: reasonText,
  };
  if (signal.decision !== "NEUTRAL") {
    Object.assign(tool_result, {
      entry: signal.levels.entry,
      sl: signal.levels.sl,
      tp1: signal.levels.tp1,
      tp2: signal.levels.tp2,
    });
  }
  return { tool_result };
}

async function buildPriceToolResult(symbol: string, timeframe: string) {
  const price = await get_price(symbol, timeframe);
  const now = Date.now();
  const tsMs = Date.parse(price.ts_utc);
  const staleMinutes = Number.isFinite(tsMs) ? Math.max(0, Math.round((now - tsMs) / 60000)) : 0;
  const tool_result = {
    type: "price",
    symbol: price.symbol,
    utc_time: price.ts_utc,
    price: price.price,
    source: price.source,
    stale_minutes: staleMinutes,
  } as const;
  return { tool_result };
}

// memory recap handled by generator via history

async function buildLiiratToolResult(query: string, language: LanguageCode) {
  const answer = await about_liirat_knowledge(query, language);
  return { tool_result: { type: "liirat_info", answer } };
}

// Chat/general handled by generator

export async function smartReply(input: SmartReplyInput): Promise<SmartReplyOutput> {
  const { phone, text } = input;
  const normalizedText = normalizeText(text || "").trim();
  // Ensure conversation exists
  let conversationId: string | null = null;
  try {
    conversationId = await getOrCreateConversationByTitle(phone);
  } catch (e) {
    console.warn("[SUPABASE] conv ensure failed (ignored)", e);
  }

  // Load recent history and append latest user turn for the generator
  const recentHistory = conversationId ? await fetchRecentContext(conversationId, 8) : [];
  const conversationHistory = [...recentHistory, { role: "user" as const, content: normalizedText }];

  // Classify with context
  let classified: ClassifiedIntent;
  try {
    classified = await classifyIntent(normalizedText, recentHistory);
  } catch (e) {
    const lang = detectLanguage(normalizedText);
    classified = { intent: "general", symbol: null, timeframe: null, query: null, language: lang };
  }

  const language = classified.language as LanguageCode;

  // Execute tools pipeline per intent
  let tool_result: Record<string, unknown> | null = null;
  try {
    if (classified.intent === "price" && classified.symbol) {
      const tfInput = classified.timeframe === "day" ? "1day" : (classified.timeframe || "1min");
      const { tool_result: tr } = await buildPriceToolResult(classified.symbol, tfInput);
      tool_result = tr;
    } else if (classified.intent === "trading_signal" && (classified.symbol || hardMapSymbol(normalizedText))) {
      const symbol = classified.symbol || hardMapSymbol(normalizedText)!;
      const tfCandidate = classified.timeframe === "day" ? "1day" : (classified.timeframe || "");
      const timeframe = tfCandidate ? toTimeframe(tfCandidate) : "5min";
      const { tool_result: tr } = await buildSignalToolResult(symbol, timeframe, language);
      tool_result = tr;
    } else if (classified.intent === "news") {
      const query = classified.query && classified.query.trim() ? classified.query : (language === "ar" ? "أخبار السوق" : "market news");
      try {
        const news = await search_web_news(query, language, 3);
        const items = (news.rows || []).slice(0, 3).map((row) => ({
          date: String(row.date).slice(0, 10),
          source: row.source,
          title: row.title,
          impact: (row as any).impact ?? undefined,
        }));
        tool_result = { type: "news", items } as any;
      } catch (e) {
        tool_result = { type: "news", items: [] } as any;
      }
    } else if (classified.intent === "liirat_info") {
      const q = classified.query || normalizedText;
      const { tool_result: tr } = await buildLiiratToolResult(q, language);
      tool_result = tr;
    } else {
      tool_result = {
        type: "general_followup",
        symbol: classified.symbol ?? undefined,
        timeframe: classified.timeframe ?? undefined,
      } as any;
    }
  } catch (e) {
    console.warn("[TOOLS] pipeline error", e);
    tool_result = tool_result ?? { type: "general_followup" };
  }

  // Generate final reply always through model
  const reply = await generateReply({
    conversationHistory,
    tool_result,
    intentInfo: {
      intent: classified.intent,
      symbol: classified.symbol,
      timeframe: classified.timeframe,
      language,
      query: classified.query ?? null,
    },
  });

  return { replyText: reply, language, conversationId };
}