// src/lib/smartReplyNew.ts
import { decideUserIntent, type Intent, type ConversationState } from "./intentParser";
import { get_price, get_ohlc, compute_trading_signal, search_web_news, about_liirat_knowledge } from "../tools/agentTools";
import { hardMapSymbol, toTimeframe } from "../tools/normalize";
import { type LanguageCode } from "../utils/formatters";
import generateReply from "./generateReply";
import { getOrCreateConversationByTitle, fetchRecentContext } from "./supabaseLite";

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

async function loadConversationState(phone: string): Promise<ConversationState & { conversationId: string | null }> {
  try {
    const conversationId = await getOrCreateConversationByTitle(phone);
    return {
      conversationId: conversationId ?? null,
      lastSymbol: null,
      lastTimeframe: null,
    };
  } catch {
    return { conversationId: null, lastSymbol: null, lastTimeframe: null };
  }
}

async function handleSignalIntent(
  symbol: string,
  timeframe: string,
  language: LanguageCode,
  conversationId: string | null,
  lastUserMessage: string
): Promise<{ reply: string; tool: Record<string, unknown> } | { reply: string; tool: null }> {
  try {
    const ohlc = await get_ohlc(symbol, timeframe, 200);
    let tool_result: Record<string, unknown> | null = null;
    let tool_meta: Record<string, unknown> | null = null;
    if (ohlc.ok) {
      const signal = await compute_trading_signal({ ...ohlc, lang: language });
      const reasonText = language === "ar"
        ? (signal.reason === "bullish_pressure"
            ? "ضغط شراء فوق المتوسطات"
            : signal.reason === "bearish_pressure"
              ? "ضغط بيع تحت المتوسطات"
              : "مافي اتجاه واضح")
        : (signal.reason === "bullish_pressure"
            ? "Buy pressure above averages"
            : signal.reason === "bearish_pressure"
              ? "Bearish pressure below averages"
              : "No clear bias");
      const lastLabel = signal.timeUTC;
      const staleMinutes = Math.max(0, Math.round(signal.ageMinutes));
      const tooStale = (() => {
        const tf = String(signal.timeframe);
        if (tf === "1min" || tf === "5min" || tf === "15min") return staleMinutes > 10;
        if (tf === "1hour") return staleMinutes > 30;
        if (tf === "4hour") return staleMinutes > 180;
        return staleMinutes > 1440;
      })();
      const decided = (!ohlc.ok || tooStale) ? "STALE" : signal.decision;
      tool_result = {
        type: "signal",
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        decided,
        entry: signal.levels.entry,
        sl: signal.levels.sl,
        tp1: signal.levels.tp1,
        tp2: signal.levels.tp2,
        reason_short: decided === "STALE" ? (language === "ar" ? "البيانات متأخرة، ما فيني أعطي توصية مباشرة" : "Data is delayed; no direct trade") : reasonText,
        last_candle_time_utc: lastLabel,
        stale_minutes: staleMinutes,
        too_stale: tooStale,
      };
      tool_meta = {
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        time: lastLabel,
        staleMinutes,
      };
    } else {
      tool_result = { type: "signal", error: "NO_DATA", symbol, timeframe };
      tool_meta = { symbol, timeframe };
    }

    const context = conversationId ? await fetchRecentContext(conversationId, 10) : [];
    const reply = await generateReply({
      language,
      lastUserMessage,
      conversationContext: context.length ? context : [{ role: "user", content: lastUserMessage }],
      toolResult: tool_result,
      toolMeta: tool_meta ?? undefined,
    });

    return { reply, tool: tool_result };
  } catch (error) {
    console.error("[SIGNAL] Error:", error);
    const context = conversationId ? await fetchRecentContext(conversationId, 6) : [];
    const reply = await generateReply({
      language,
      lastUserMessage,
      conversationContext: context.length ? context : [{ role: "user", content: lastUserMessage }],
      toolResult: { type: "signal", error: "ERROR" },
    });
    return { reply, tool: null };
  }
}

async function handlePriceIntent(
  symbol: string,
  timeframe: string,
  language: LanguageCode,
  conversationId: string | null,
  lastUserMessage: string
): Promise<{ reply: string; tool: Record<string, unknown> } | { reply: string; tool: null }> {
  try {
    const price = await get_price(symbol, timeframe);
    const tool_result = {
      type: "price",
      symbol: price.symbol,
      price: price.price,
      ts_utc: price.ts_utc,
    } as const;
    const tool_meta = { symbol: price.symbol, timeframe };
    const context = conversationId ? await fetchRecentContext(conversationId, 10) : [];
    const reply = await generateReply({
      language,
      lastUserMessage,
      conversationContext: context.length ? context : [{ role: "user", content: lastUserMessage }],
      toolResult: tool_result as any,
      toolMeta: tool_meta,
    });
    return { reply, tool: tool_result as any };
  } catch (error) {
    console.error("[PRICE] Error:", error);
    const context = conversationId ? await fetchRecentContext(conversationId, 6) : [];
    const reply = await generateReply({
      language,
      lastUserMessage,
      conversationContext: context.length ? context : [{ role: "user", content: lastUserMessage }],
      toolResult: { type: "price", error: "ERROR" },
    });
    return { reply, tool: null };
  }
}

async function handleMemoryQuestion(
  conversationId: string | null,
  language: LanguageCode
): Promise<string> {
  if (!conversationId) {
    return language === "ar" 
      ? "ما في محادثة سابقة."
      : "No previous conversation.";
  }

  try {
    const messages = await fetchRecentContext(conversationId, 4);
    if (messages.length === 0) {
      return language === "ar" 
        ? "ما في محادثة سابقة."
        : "No previous conversation.";
    }

    // Create a simple recap
    const recap = messages.slice(-4).map(msg => {
      if (msg.role === "user") {
        return language === "ar" ? "طلبت: " + msg.content.substring(0, 50) + "..." : "You asked: " + msg.content.substring(0, 50) + "...";
      } else {
        return language === "ar" ? "ردت: " + msg.content.substring(0, 50) + "..." : "I replied: " + msg.content.substring(0, 50) + "...";
      }
    }).join("\n");

    return recap;
  } catch (error) {
    console.error("[MEMORY] Error:", error);
    return language === "ar" 
      ? "ما في محادثة سابقة."
      : "No previous conversation.";
  }
}

async function handleAboutLiirat(
  query: string,
  language: LanguageCode
): Promise<string> {
  try {
    return await about_liirat_knowledge(query, language);
  } catch (error) {
    console.error("[ABOUT_LIIRAT] Error:", error);
    return language === "ar" 
      ? "البيانات غير متاحة حالياً."
      : "Data not available right now.";
  }
}

function handleChatIntent(text: string, language: LanguageCode): string {
  const normalizedText = text.toLowerCase();
  
  // Check for insults
  const insultPatterns = [
    "غبي", "تافه", "خرس", "fuck", "stupid", "asshole", "shit", "يا زب", "احمق",
    "ينعل أبو سماك", "انت غبي", "شو جحش"
  ];
  
  const isInsult = insultPatterns.some(pattern => normalizedText.includes(pattern));
  
  if (isInsult) {
    return language === "ar" 
      ? "خلّينا نركّز على الصفقة أو السعر لحتى أساعدك بسرعة."
      : "Let's stay on the trade or price so I can help fast.";
  }
  
  // Check for clarification questions
  if (normalizedText.includes("شو يعني") || normalizedText.includes("what does it mean")) {
    return language === "ar" 
      ? "يعني ما في اتجاه واضح شراء/بيع بهالفريم حالياً."
      : "It means no clear buy/sell direction on that timeframe right now.";
  }
  
  // Default chat response
  return language === "ar" 
    ? "خلّينا نركّز على الصفقة أو السعر لحتى أساعدك بسرعة."
    : "Let's stay on the trade or price so I can help fast.";
}

export async function smartReply(input: SmartReplyInput): Promise<SmartReplyOutput> {
  const { phone, text, contactName } = input;
  const normalizedText = normalizeText(text);
  const language = detectLanguage(normalizedText);
  
  // Ensure conversation and load state-lite
  let conversationId: string | null = null;
  try {
    conversationId = await getOrCreateConversationByTitle(phone);
  } catch (e) {
    console.warn("[SUPABASE] conv ensure failed (ignored)", e);
  }
  const state = await (async () => {
    try {
      return await loadConversationState(phone);
    } catch {
      return { conversationId, lastSymbol: null, lastTimeframe: null };
    }
  })();
  
  // Parse intent
  const intent = decideUserIntent(normalizedText, {
    lastSymbol: state.lastSymbol,
    lastTimeframe: state.lastTimeframe
  });
  
  let reply = "";
  
  try {
    switch (intent.kind) {
      case "signal": {
        const result = await handleSignalIntent(intent.symbol, intent.timeframe, language, conversationId, normalizedText);
        reply = result.reply;
        break;
      }
      
      case "price": {
        const result = await handlePriceIntent(intent.symbol, intent.timeframe, language, conversationId, normalizedText);
        reply = result.reply;
        break;
      }
      
      case "memory_question": {
        const context = conversationId ? await fetchRecentContext(conversationId, 10) : [];
        reply = await generateReply({
          language,
          lastUserMessage: normalizedText,
          conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
          toolResult: { type: "memory_question" },
        });
        break;
      }
      
      case "about_liirat": {
        try {
          const text = await handleAboutLiirat(normalizedText, language);
          const context = conversationId ? await fetchRecentContext(conversationId, 6) : [];
          reply = await generateReply({
            language,
            lastUserMessage: normalizedText,
            conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
            toolResult: { type: "liirat_info", text },
          });
        } catch {
          reply = language === "ar" ? "البيانات غير متاحة حالياً." : "Data not available right now.";
        }
        break;
      }
      
      case "chat": {
        const context = conversationId ? await fetchRecentContext(conversationId, 10) : [];
        reply = await generateReply({
          language,
          lastUserMessage: normalizedText,
          conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
          toolResult: null,
        });
        break;
      }
      
      case "clarify_symbol": {
        const context = conversationId ? await fetchRecentContext(conversationId, 6) : [];
        reply = await generateReply({
          language,
          lastUserMessage: normalizedText,
          conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
          toolResult: { type: "clarify", missing: "symbol" },
        });
        break;
      }
      
      case "clarify_timeframe": {
        const context = conversationId ? await fetchRecentContext(conversationId, 6) : [];
        reply = await generateReply({
          language,
          lastUserMessage: normalizedText,
          conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
          toolResult: { type: "clarify", missing: "timeframe", symbol: intent.symbol },
        });
        break;
      }
      
      case "unsupported": {
        const context = conversationId ? await fetchRecentContext(conversationId, 4) : [];
        reply = await generateReply({
          language,
          lastUserMessage: normalizedText,
          conversationContext: context.length ? context : [{ role: "user", content: normalizedText }],
          toolResult: null,
        });
        break;
      }
    }
  } catch (error) {
    console.error("[SMART_REPLY] Error:", error);
    reply = language === "ar" ? "البيانات غير متاحة حالياً." : "Data not available right now.";
  }
  
  return {
    replyText: reply,
    language,
    conversationId
  };
}