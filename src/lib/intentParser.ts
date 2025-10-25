// src/lib/intentParser.ts
import { hardMapSymbol, toTimeframe, normalizeArabic, type TF } from "../tools/normalize";

export type Intent =
  | { kind: "signal"; symbol: string; timeframe: string }
  | { kind: "price"; symbol: string; timeframe: string }
  | { kind: "about_liirat"; queryLang: "ar" | "en" }
  | { kind: "memory_question" }
  | { kind: "chat"; text: string }
  | { kind: "clarify_symbol"; missing: "symbol"; timeframe?: string }
  | { kind: "clarify_timeframe"; symbol: string; missing: "timeframe" }
  | { kind: "unsupported" };

export interface ConversationState {
  lastSymbol: string | null;
  lastTimeframe: string | null;
}

export function decideUserIntent(
  text: string,
  conversationState: ConversationState
): Intent {
  const normalizedText = normalizeArabic(text.trim().toLowerCase());
  
  if (!normalizedText) {
    return { kind: "unsupported" };
  }

  // Check for signal intent
  const signalKeywords = [
    "صفقة", "إشارة", "تحليل", "signal", "buy", "sell", "long", "short",
    "توصية", "call", "entry", "setup", "analysis", "صفقه"
  ];
  
  const hasSignalIntent = signalKeywords.some(keyword => 
    normalizedText.includes(keyword)
  );

  // Check for price intent
  const priceKeywords = [
    "سعر", "price", "quote", "كم", "قديش", "بكم", "كم سعر"
  ];
  
  const hasPriceIntent = priceKeywords.some(keyword => 
    normalizedText.includes(keyword)
  ) || isBareAssetName(normalizedText);

  // Check for about Liirat intent
  const liiratKeywords = [
    "مين ليرات", "شو هي ليرات", "وين مكاتبكم", "عندكم سيرفر تداول", 
    "بتشتغلوا على MT5", "افتح حساب", "حساب", "خدمات", "about liirat",
    "contact", "join", "open account"
  ];
  
  const hasLiiratIntent = liiratKeywords.some(keyword => 
    normalizedText.includes(keyword)
  );

  // Check for memory question
  const memoryKeywords = [
    "شو قلتلك أنا", "شو حكيت معك", "شو كان ردك", "شو حكينا قبل",
    "طيب شو قلتلي", "شو قلتلي قبل", "what did you say", "what did we talk about"
  ];
  
  const hasMemoryIntent = memoryKeywords.some(keyword => 
    normalizedText.includes(keyword)
  );

  // Extract symbol from text
  const extractedSymbol = extractSymbolFromText(normalizedText);
  
  // Extract timeframe from text
  const extractedTimeframe = extractTimeframeFromText(normalizedText);

  // Determine final symbol and timeframe
  const finalSymbol = extractedSymbol || conversationState.lastSymbol;
  const finalTimeframe = extractedTimeframe || conversationState.lastTimeframe || "5min";

  // Handle signal intent
  if (hasSignalIntent) {
    if (!finalSymbol) {
      return { kind: "clarify_symbol", missing: "symbol", timeframe: finalTimeframe };
    }
    return { 
      kind: "signal", 
      symbol: finalSymbol, 
      timeframe: finalTimeframe 
    };
  }

  // Handle price intent
  if (hasPriceIntent) {
    if (!finalSymbol) {
      return { kind: "clarify_symbol", missing: "symbol", timeframe: "5min" };
    }
    return { 
      kind: "price", 
      symbol: finalSymbol, 
      timeframe: finalTimeframe || "5min" 
    };
  }

  // Handle Liirat questions
  if (hasLiiratIntent) {
    return { 
      kind: "about_liirat", 
      queryLang: /[\u0600-\u06FF]/.test(text) ? "ar" : "en" 
    };
  }

  // Handle memory questions
  if (hasMemoryIntent) {
    return { kind: "memory_question" };
  }

  // Check if it's just timeframe follow-up (before other checks)
  if (extractedTimeframe && !extractedSymbol && conversationState.lastSymbol) {
    return {
      kind: "signal",
      symbol: conversationState.lastSymbol,
      timeframe: extractedTimeframe
    };
  }

  // Check if it's just symbol follow-up
  if (extractedSymbol && !extractedTimeframe && conversationState.lastTimeframe) {
    return {
      kind: "signal", 
      symbol: extractedSymbol,
      timeframe: conversationState.lastTimeframe
    };
  }

  // Check for general chat/insults
  const insultKeywords = [
    "غبي", "تافه", "خرس", "fuck", "stupid", "asshole", "shit", "يا زب", "احمق",
    "ينعل أبو سماك", "انت غبي", "شو جحش", "متأكد", "شو يعني"
  ];
  
  const hasInsultOrChat = insultKeywords.some(keyword => 
    normalizedText.includes(keyword)
  ) || isGeneralChat(normalizedText);

  if (hasInsultOrChat) {
    return { kind: "chat", text: normalizedText };
  }

  return { kind: "unsupported" };
}

function isBareAssetName(text: string): boolean {
  const assetNames = [
    "ذهب", "دهب", "فضة", "بيتكوين", "BTC", "EURUSD", "يورو", "ين", "فرنك",
    "استرليني", "باوند", "كندي", "أسترالي", "نيوزلندي", "نفط", "خام", "برنت",
    "gold", "silver", "bitcoin", "euro", "yen", "franc", "pound", "canadian",
    "australian", "newzealand", "oil", "brent"
  ];
  
  return assetNames.some(name => 
    text.includes(name) && text.length <= name.length + 3
  );
}

function extractSymbolFromText(text: string): string | null {
  // Try direct mapping first
  const direct = hardMapSymbol(text);
  if (direct) {
    return direct;
  }

  // Try token-based extraction
  const tokens = text.split(/[\s\p{P}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const mapped = hardMapSymbol(token);
    if (mapped) {
      return mapped;
    }
    
    // Try combined tokens
    if (i < tokens.length - 1) {
      const combined = `${token} ${tokens[i + 1]}`;
      const mappedCombined = hardMapSymbol(combined);
      if (mappedCombined) {
        return mappedCombined;
      }
    }
  }
  
  // Try Arabic-specific patterns
  const arabicPatterns = [
    { pattern: /دهب|ذهب|الذهب/g, symbol: 'XAUUSD' },
    { pattern: /فضة|الفضة/g, symbol: 'XAGUSD' },
    { pattern: /بيتكوين|بتكوين/g, symbol: 'BTCUSDT' },
    { pattern: /يورو/g, symbol: 'EURUSD' },
    { pattern: /ين|ين ياباني/g, symbol: 'USDJPY' },
    { pattern: /فرنك/g, symbol: 'USDCHF' },
    { pattern: /استرليني|باوند/g, symbol: 'GBPUSD' },
    { pattern: /كندي/g, symbol: 'USDCAD' },
    { pattern: /أسترالي|استرالي/g, symbol: 'AUDUSD' },
    { pattern: /نيوزلندي/g, symbol: 'NZDUSD' },
    { pattern: /نفط|خام/g, symbol: 'XTIUSD' },
    { pattern: /برنت/g, symbol: 'XBRUSD' }
  ];
  
  for (const { pattern, symbol } of arabicPatterns) {
    if (pattern.test(text)) {
      return symbol;
    }
  }
  
  return null;
}

function extractTimeframeFromText(text: string): string | null {
  const timeframe = toTimeframe(text);
  return timeframe !== "5min" || hasExplicitTimeframe(text) ? timeframe : null;
}

function hasExplicitTimeframe(text: string): boolean {
  const timeframePatterns = [
    /\b(1|5|15|30)\s*(m|min|minute|دقيقة|دقايق|دقائق)\b/,
    /\b(1|4)\s*(h|hour|ساعة|ساعات)\b/,
    /\b(دقيقة|دقايق|ساعة|ساعات|يومي|يوم|daily)\b/,
    /\b(ربع ساعة|نص ساعة|نصف ساعة|اربع ساعات)\b/,
    /عال?دقيقة/,
    /عال?ساعة/
  ];
  
  return timeframePatterns.some(pattern => pattern.test(text));
}

function isGeneralChat(text: string): boolean {
  const chatPatterns = [
    "شو يعني", "متأكد", "صح", "طيب", "حلو", "زين", "ممتاز", "شكرا", "شكراً",
    "what does it mean", "are you sure", "ok", "good", "thanks", "thank you",
    "yes", "no", "maybe", "perhaps", "probably"
  ];
  
  return chatPatterns.some(pattern => text.includes(pattern));
}