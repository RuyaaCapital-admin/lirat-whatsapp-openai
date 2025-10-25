// src/lib/smartReplyNew.ts
import { decideUserIntent, type Intent, type ConversationState } from "./intentParser";
import { get_price, get_ohlc, compute_trading_signal, search_web_news, about_liirat_knowledge } from "../tools/agentTools";
import { hardMapSymbol, toTimeframe } from "../tools/normalize";
import { priceFormatter, signalFormatter, newsFormatter, type LanguageCode } from "../utils/formatters";
import { 
  createOrGetConversation, 
  updateConversationMetadata, 
  logMessage, 
  getRecentContext,
  type ConversationLookupResult 
} from "./supabase";

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
  const conversation = await createOrGetConversation(phone);
  if (!conversation) {
    return {
      conversationId: null,
      lastSymbol: null,
      lastTimeframe: null
    };
  }
  
  return {
    conversationId: conversation.conversation_id,
    lastSymbol: conversation.last_symbol,
    lastTimeframe: conversation.last_tf
  };
}

async function handleSignalIntent(
  symbol: string, 
  timeframe: string, 
  language: LanguageCode,
  conversationId: string | null
): Promise<{ reply: string; updates: { last_symbol: string; last_tf: string } }> {
  try {
    const ohlc = await get_ohlc(symbol, timeframe, 200);
    
    if (!ohlc.ok) {
      const reply = language === "ar" 
        ? "ما عندي بيانات حديثة لهالإطار الزمني. جرّب فريم أعلى (5min أو 1hour)."
        : "No recent data for that timeframe. Try 5min or 1hour.";
      return { reply, updates: { last_symbol: symbol, last_tf: timeframe } };
    }

    const signal = await compute_trading_signal({ ...ohlc, lang: language });
    const reply = signalFormatter({
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      timeUTC: signal.timeUTC,
      decision: signal.decision,
      reason: signal.reason,
      levels: signal.levels,
      stale: signal.stale,
      ageMinutes: signal.ageMinutes
    }, language);

    return { reply, updates: { last_symbol: symbol, last_tf: timeframe } };
  } catch (error) {
    console.error("[SIGNAL] Error:", error);
    const reply = language === "ar" 
      ? "ما في إشارة جاهزة حالياً."
      : "No actionable signal right now.";
    return { reply, updates: { last_symbol: symbol, last_tf: timeframe } };
  }
}

async function handlePriceIntent(
  symbol: string,
  timeframe: string,
  language: LanguageCode,
  conversationId: string | null
): Promise<{ reply: string; updates: { last_symbol: string; last_tf: string } }> {
  try {
    const price = await get_price(symbol, timeframe);
    const reply = priceFormatter({
      symbol: price.symbol,
      price: price.price,
      ts_utc: price.ts_utc
    }, language);

    return { reply, updates: { last_symbol: symbol, last_tf: timeframe } };
  } catch (error) {
    console.error("[PRICE] Error:", error);
    const reply = language === "ar" 
      ? "البيانات غير متاحة حالياً. جرّب لاحقاً."
      : "Data not available right now. Try later.";
    return { reply, updates: { last_symbol: symbol, last_tf: timeframe } };
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
    const messages = await getRecentContext(conversationId, 4);
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

async function handleNewsIntent(
  query: string,
  language: LanguageCode
): Promise<string> {
  try {
    const news = await search_web_news(query, language, 3);
    return newsFormatter(news.rows, language);
  } catch (error) {
    console.error("[NEWS] Error:", error);
    return language === "ar" 
      ? "لا يوجد أخبار متاحة الآن."
      : "No news available right now.";
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
  
  // Load conversation state
  const state = await loadConversationState(phone);
  
  // Parse intent
  const intent = decideUserIntent(normalizedText, {
    lastSymbol: state.lastSymbol,
    lastTimeframe: state.lastTimeframe
  });
  
  let reply = "";
  let updates: { last_symbol?: string; last_tf?: string } = {};
  
  try {
    switch (intent.kind) {
      case "signal": {
        const result = await handleSignalIntent(intent.symbol, intent.timeframe, language, state.conversationId);
        reply = result.reply;
        updates = result.updates;
        break;
      }
      
      case "price": {
        const result = await handlePriceIntent(intent.symbol, intent.timeframe, language, state.conversationId);
        reply = result.reply;
        updates = result.updates;
        break;
      }
      
      case "memory_question": {
        reply = await handleMemoryQuestion(state.conversationId, language);
        break;
      }
      
      case "about_liirat": {
        reply = await handleAboutLiirat(normalizedText, language);
        break;
      }
      
      case "chat": {
        reply = handleChatIntent(normalizedText, language);
        break;
      }
      
      case "clarify_symbol": {
        reply = language === "ar" 
          ? "حدّد الأداة (ذهب، فضة، يورو، بيتكوين...)."
          : "Which instrument (gold, silver, euro, bitcoin...)?";
        break;
      }
      
      case "clarify_timeframe": {
        reply = language === "ar" 
          ? "حدّد الإطار الزمني (5min، 1hour، يومي...)."
          : "Which timeframe (5min, 1hour, daily...)?";
        break;
      }
      
      case "unsupported": {
        reply = language === "ar" 
          ? "ما وصلتني بيانات كافية، وضّح طلبك أكثر لو سمحت."
          : "I don't have enough data, please clarify what you need.";
        break;
      }
    }
  } catch (error) {
    console.error("[SMART_REPLY] Error:", error);
    reply = language === "ar" 
      ? "البيانات غير متاحة حالياً. جرّب لاحقاً."
      : "Data not available right now. Try later.";
  }
  
  // Log messages to database
  if (state.conversationId) {
    await logMessage(state.conversationId, "user", text);
    await logMessage(state.conversationId, "assistant", reply);
    
    // Update conversation metadata if we have updates
    if (Object.keys(updates).length > 0) {
      await updateConversationMetadata(state.conversationId, updates);
    }
  }
  
  return {
    replyText: reply,
    language,
    conversationId: state.conversationId
  };
}