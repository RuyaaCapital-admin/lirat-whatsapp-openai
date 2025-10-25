import type { NextApiRequest, NextApiResponse } from "next";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { SYSTEM_PROMPT } from "../../lib/systemPrompt";
import { openai } from "../../lib/openai";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import {
  createOrGetConversation,
  getRecentContext,
  logMessage,
  getConversationMessageCount,
  updateConversationMetadata,
  type ConversationContextEntry,
} from "../../lib/supabase";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  search_web_news,
  about_liirat_knowledge,
  type PriceResult,
} from "../../tools/agentTools";
import { hardMapSymbol, toTimeframe, normalizeArabic, type TF } from "../../tools/normalize";
import { normaliseDigits } from "../../utils/webhookHelpers";
import {
  detectArabic,
  priceFormatter,
  signalFormatter,
  newsFormatter,
  type LanguageCode,
  type SignalFormatterInput,
} from "../../utils/formatters";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const processedMessageCache = new Set<string>();

type InboundMessage = {
  id: string;
  from: string;
  text: string;
};

type StoredSignalRecord = {
  payload: SignalFormatterInput;
};

function normaliseInboundText(message: any): string {
  if (!message || typeof message !== "object") return "";
  const candidates = [
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    message?.interactive?.list_reply?.description,
    message?.sticker?.emoji,
    message?.image?.caption,
    message?.video?.caption,
    message?.audio?.caption,
    message?.document?.caption,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  if (typeof message?.type === "string" && message.type.trim()) {
    return `[${message.type.trim()}]`;
  }
  return "";
}

function extractMessage(payload: any): InboundMessage {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value ?? {};
  const message = (Array.isArray(value.messages) ? value.messages[0] : undefined) ?? {};
  const contact = Array.isArray(value.contacts) ? value.contacts[0] : undefined;
  const waId = typeof contact?.wa_id === "string" ? contact.wa_id : undefined;
  const idCandidate =
    typeof message.id === "string" && message.id.trim()
      ? message.id.trim()
      : typeof value?.statuses?.[0]?.id === "string" && value.statuses[0].id.trim()
        ? value.statuses[0].id.trim()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fromCandidate =
    typeof message.from === "string" && message.from.trim()
      ? message.from.trim()
      : typeof waId === "string" && waId.trim()
        ? waId.trim()
        : "";
  const text = normaliseInboundText(message);
  return { id: idCandidate, from: fromCandidate, text };
}

function detectLanguage(text: string): LanguageCode {
  return detectArabic(text) ? "ar" : "en";
}

function normaliseUserText(text: string): string {
  return typeof text === "string" ? text.trim() : "";
}

function isIdentityQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  const patterns = [
    "مين انت",
    "من انت",
    "شو انت",
    "من حضرتك",
    "who are you",
    "who r u",
    "what are you",
  ];
  return patterns.some((pattern) => lower.includes(pattern));
}

function isGreeting(text: string): boolean {
  const normalized = normalizeArabic(text.trim().toLowerCase());
  if (!normalized) return false;
  const patterns = ["مرحبا", "اهلا", "هلا", "سلام", "hi", "hello", "hey"];
  return patterns.some((pattern) => normalized.startsWith(pattern));
}

function isInsult(text: string): boolean {
  const normalised = normalizeArabic(text.trim().toLowerCase());
  if (!normalised) return false;
  const insults = ["غبي", "تافه", "خرس", "fuck", "stupid", "asshole", "shit", "يا زب", "احمق"];
  return insults.some((word) => normalised.includes(word));
}

function applyPoliteness(reply: string, language: LanguageCode, userText: string): string {
  if (!isInsult(userText)) {
    return reply;
  }
  return language === "ar"
    ? "خلّينا نركّز على طلبك لنساعدك بأفضل شكل."
    : "Let's stay focused on your request so I can help you.";
}

const TIMEFRAME_PATTERNS: Array<{ tf: TF; regex: RegExp }> = [
  { tf: "1min", regex: /(\b1\s*(?:m|min|minute)\b|\bدقيقة\b|\bعال?دقيقة\b)/i },
  { tf: "5min", regex: /(\b5\s*(?:m|min)\b|\b5\s*(?:دق(?:ايق|ائق))\b|\bخمس دقائق\b)/i },
  { tf: "15min", regex: /(\b15\s*(?:m|min)?\b|\b١٥\s*(?:دقيقة|دقايق)\b|\bربع ساعة\b)/i },
  { tf: "30min", regex: /(\b30\s*(?:m|min)?\b|\b٣٠\s*(?:دقيقة|دقايق)\b|\bنص ساعة\b|\bنصف ساعة\b)/i },
  { tf: "1hour", regex: /(\b1\s*(?:h|hour)\b|\bساعة\b|\bساعه\b|\bعالساعة\b)/i },
  { tf: "4hour", regex: /(\b4\s*(?:h|hour)\b|\b٤\s*س\b|\bاربع ساعات\b|\b٤ ساعات\b)/i },
  { tf: "1day", regex: /(\bdaily\b|\bيومي\b|\bعلى اليومي\b|\bعلى اليوم\b|\bيوم\b)/i },
];

function detectTimeframeMention(text: string): { timeframe: TF | null; explicit: boolean } {
  if (!text.trim()) {
    return { timeframe: null, explicit: false };
  }
  const normalised = normalizeArabic(text.toLowerCase());
  for (const entry of TIMEFRAME_PATTERNS) {
    if (entry.regex.test(normalised)) {
      return { timeframe: entry.tf, explicit: true };
    }
  }
  return { timeframe: null, explicit: false };
}

function detectSymbolInText(text: string): string | null {
  const direct = hardMapSymbol(text);
  if (direct) {
    return direct;
  }
  const normalised = normalizeArabic(text).toLowerCase();
  const tokens = normalised.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const mapped = hardMapSymbol(token);
    if (mapped) {
      return mapped;
    }
    if (i < tokens.length - 1) {
      const combined = `${token} ${tokens[i + 1]}`;
      const mappedCombined = hardMapSymbol(combined);
      if (mappedCombined) {
        return mappedCombined;
      }
    }
  }
  return null;
}

function normalizeSymbol(input: string | null | undefined): string | null {
  if (!input) return null;
  return hardMapSymbol(input) ?? null;
}

function detectNewsIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\bnews\b/.test(lower) || lower.includes("خبر") || lower.includes("أخبار");
}

function detectPriceIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /price|سعر|كم سعر|بكم/.test(lower);
}

function detectSignalIntent(text: string): boolean {
  const lower = normalizeArabic(text.toLowerCase());
  return (
    /signal|trade|setup|analysis|تحليل|اشارة|إشارة|صفقة|توصية|call|entry/.test(lower) ||
    lower.includes("صفقه")
  );
}

function detectTimeframeFollowUp(text: string): boolean {
  const lower = normalizeArabic(text.toLowerCase());
  if (!lower) return false;
  const patterns = ["اي فريم", "على اي فريم", "عال?فريم", "timeframe", "what timeframe", "which timeframe", "على اي ساعة"];
  return patterns.some((pattern) => lower.includes(pattern));
}

function detectCompanyIntent(text: string): boolean {
  const lower = normalizeArabic(text.toLowerCase());
  if (!lower.includes("liirat") && !lower.includes("ليرات")) {
    return false;
  }
  const keywords = ["open", "account", "about", "contact", "join", "افتح", "حساب", "مين", "خدمات"];
  return keywords.some((word) => lower.includes(word));
}

interface ConversationState {
  id: string | null;
  isNew: boolean;
  messageCount: number;
  lastSymbol: string | null;
  lastTimeframe: string | null;
  lastSignal: StoredSignalRecord | null;
}

function parseStoredSignal(value: any): StoredSignalRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = (value as any).payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (typeof payload.symbol !== "string" || typeof payload.timeframe !== "string") {
    return null;
  }
  if (typeof payload.timeUTC !== "string" || typeof payload.decision !== "string") {
    return null;
  }
  return { payload: payload as SignalFormatterInput };
}

async function loadConversationState(
  phone: string,
  deps: Pick<WebhookDeps, "createOrGetConversation" | "getConversationMessageCount">,
): Promise<ConversationState> {
  const conversation = await deps.createOrGetConversation(phone);
  if (!conversation) {
    return {
      id: null,
      isNew: true,
      messageCount: 0,
      lastSymbol: null,
      lastTimeframe: null,
      lastSignal: null,
    };
  }
  const conversationId = conversation.conversation_id ?? null;
  let messageCount = 0;
  if (conversationId) {
    const count = await deps.getConversationMessageCount(conversationId);
    messageCount = typeof count === "number" ? count : 0;
  }
  return {
    id: conversationId,
    isNew: conversation.isNew,
    messageCount,
    lastSymbol: conversation.last_symbol ?? null,
    lastTimeframe: conversation.last_tf ?? null,
    lastSignal: parseStoredSignal(conversation.last_signal),
  };
}

async function generateGeneralReply(
  userText: string,
  history: ConversationContextEntry[],
  language: LanguageCode,
): Promise<string> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return language === "ar" ? "كيف فيني ساعدك؟" : "How can I help?";
  }
  const historyMessages: ChatCompletionMessageParam[] = history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyMessages,
    { role: "user", content: trimmed },
  ];
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 700,
      messages,
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (content) {
      return content;
    }
  } catch (error) {
    console.warn("[ASSISTANT] general reply error", error);
  }
  return language === "ar" ? "البيانات غير متاحة حالياً. جرّب لاحقاً." : "Data not available right now. Try later.";
}

function buildPriceReply(result: PriceResult, lang: LanguageCode): string {
  return priceFormatter({ symbol: result.symbol, price: result.price, timeISO: result.timeISO }, lang);
}

async function buildSignalReply(
  text: string,
  lang: LanguageCode,
  state: ConversationState,
  nowMs: number,
): Promise<
  | { type: "ASK_SYMBOL"; reply: string }
  | { type: "NO_DATA"; reply: string; updates: { last_symbol: string; last_tf: string } }
  | { type: "SIGNAL"; reply: string; updates: { last_symbol: string; last_tf: string; last_signal: StoredSignalRecord } }
> {
  const symbolFromText = normalizeSymbol(detectSymbolInText(text));
  const symbol = symbolFromText ?? state.lastSymbol;
  if (!symbol) {
    const reply =
      lang === "ar"
        ? "حدّد الأداة (ذهب، فضة، يورو، بيتكوين...)."
        : "Which instrument (gold, silver, euro, bitcoin...)?";
    return { type: "ASK_SYMBOL", reply };
  }
  const timeframeMention = detectTimeframeMention(text);
  const timeframe = timeframeMention.timeframe ?? (state.lastTimeframe ? toTimeframe(state.lastTimeframe) : null) ?? "5min";

  const ohlc = await get_ohlc(symbol, timeframe, 120, { nowMs });
  if (!ohlc.ok) {
    const reply =
      lang === "ar"
        ? "ما عندي بيانات لهالرمز/الفريم حالياً."
        : "No data for that symbol/timeframe right now.";
    return { type: "NO_DATA", reply, updates: { last_symbol: symbol, last_tf: timeframe } };
  }

  const signal = await compute_trading_signal({ ...ohlc, lang });
  const payload: SignalFormatterInput = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    timeUTC: signal.timeUTC,
    decision: signal.decision,
    reason: signal.reason,
    levels: signal.levels,
    stale: signal.stale,
    ageMinutes: signal.ageMinutes,
  };
  const reply = signalFormatter(payload, lang);
  return {
    type: "SIGNAL",
    reply,
    updates: {
      last_symbol: signal.symbol,
      last_tf: signal.timeframe,
      last_signal: { payload },
    },
  };
}

interface WebhookDeps {
  markReadAndShowTyping: typeof markReadAndShowTyping;
  sendText: typeof sendText;
  createOrGetConversation: typeof createOrGetConversation;
  getRecentContext: typeof getRecentContext;
  logMessage: typeof logMessage;
  updateConversationMetadata: typeof updateConversationMetadata;
  getConversationMessageCount: typeof getConversationMessageCount;
}

export function createWebhookHandler(deps: WebhookDeps) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        res.status(200).send(challenge ?? "");
        return;
      }
      res.status(403).end("forbidden");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    if (!req.body?.entry?.[0]?.changes?.[0]?.value) {
      res.status(200).json({ received: true });
      return;
    }

    const inbound = extractMessage(req.body);
    if (!inbound.from) {
      res.status(200).json({ received: true });
      return;
    }

    if (processedMessageCache.has(inbound.id)) {
      res.status(200).json({ received: true });
      return;
    }
    processedMessageCache.add(inbound.id);
    if (processedMessageCache.size > 5000) {
      const firstKey = processedMessageCache.values().next().value;
      if (firstKey) {
        processedMessageCache.delete(firstKey);
      }
    }

    const rawText = normaliseInboundText(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? {}) || inbound.text;
    const messageBody = normaliseUserText(rawText);
    if (!messageBody) {
      res.status(200).json({ received: true });
      return;
    }

    try {
      await deps.markReadAndShowTyping(inbound.id);
    } catch (error) {
      console.warn("[WEBHOOK] markRead error", error);
    }

    const normalisedText = normaliseDigits(messageBody);
    const language = detectLanguage(normalisedText || messageBody);
    const state = await loadConversationState(inbound.from, deps);

    if (state.id) {
      await deps.logMessage(state.id, "user", messageBody);
    }

    const history = state.id ? await deps.getRecentContext(state.id, 12) : [];

    const wantsIdentity = isIdentityQuestion(normalisedText || messageBody);
    const wantsTimeframeFollowUp = detectTimeframeFollowUp(normalisedText || messageBody);
    const wantsSignal = detectSignalIntent(normalisedText || messageBody);
    const wantsPrice = detectPriceIntent(normalisedText || messageBody);
    const wantsNews = detectNewsIntent(normalisedText || messageBody);
    const wantsCompany = detectCompanyIntent(normalisedText || messageBody);

    const nowMs = Date.now();
    let reply = "";
    let metadataUpdates: { last_symbol?: string | null; last_tf?: string | null; last_signal?: StoredSignalRecord | null } | null = null;

    if (wantsIdentity) {
      reply = language === "ar" ? "مساعد ليرات" : "I'm Liirat assistant.";
    } else if (wantsTimeframeFollowUp && state.lastSignal) {
      reply = signalFormatter(state.lastSignal.payload, language);
    } else if (wantsSignal) {
      try {
        const signalResult = await buildSignalReply(normalisedText || messageBody, language, state, nowMs);
        reply = signalResult.reply;
        if (signalResult.type === "SIGNAL") {
          metadataUpdates = {
            last_symbol: signalResult.updates.last_symbol,
            last_tf: signalResult.updates.last_tf,
            last_signal: signalResult.updates.last_signal,
          };
        } else if (signalResult.type === "NO_DATA") {
          metadataUpdates = {
            last_symbol: signalResult.updates.last_symbol,
            last_tf: signalResult.updates.last_tf,
            last_signal: state.lastSignal ?? null,
          };
        }
      } catch (error) {
        console.warn("[WEBHOOK] signal pipeline error", error);
        reply = language === "ar" ? "ما عندي بيانات لهالرمز/الفريم حالياً." : "No data for that symbol/timeframe right now.";
      }
    } else if (wantsPrice) {
      const symbol = normalizeSymbol(detectSymbolInText(normalisedText || messageBody));
      if (!symbol) {
        reply = language === "ar" ? "حدّد الرمز المطلوب." : "Please specify the instrument.";
      } else {
        try {
          const price = await get_price(symbol);
          reply = buildPriceReply(price, language);
        } catch (error) {
          console.warn("[WEBHOOK] price error", error);
          reply = language === "ar" ? "البيانات غير متاحة حالياً. جرّب لاحقاً." : "Data not available right now. Try later.";
        }
      }
    } else if (wantsNews) {
      try {
        const news = await search_web_news(normalisedText || messageBody, language, 3);
        reply = newsFormatter(news.rows, language);
      } catch (error) {
        console.warn("[WEBHOOK] news error", error);
        reply = language === "ar" ? "البيانات غير متاحة حالياً. جرّب لاحقاً." : "Data not available right now. Try later.";
      }
    } else if (wantsCompany) {
      try {
        reply = await about_liirat_knowledge(messageBody, language);
      } catch (error) {
        console.warn("[WEBHOOK] knowledge error", error);
        reply = language === "ar" ? "البيانات غير متاحة حالياً. جرّب لاحقاً." : "Data not available right now. Try later.";
      }
    } else if (state.messageCount === 0 && isGreeting(messageBody)) {
      reply = language === "ar" ? "كيف فيني ساعدك؟" : "How can I help?";
    } else if (state.messageCount === 0 && !wantsSignal && !wantsPrice && !wantsNews && !wantsCompany) {
      reply = language === "ar" ? "كيف فيني ساعدك؟" : "How can I help?";
    } else {
      reply = await generateGeneralReply(normalisedText || messageBody, history, language);
    }

    const finalReply = applyPoliteness(reply, language, messageBody);

    try {
      await deps.sendText(inbound.from, finalReply);
    } catch (error) {
      console.error("[WEBHOOK] send error", error);
    }

    if (state.id) {
      await deps.logMessage(state.id, "assistant", finalReply);
      if (metadataUpdates) {
        await deps.updateConversationMetadata(state.id, metadataUpdates);
      }
    }

    res.status(200).json({ received: true });
  };
}

export const webhookHandler = createWebhookHandler({
  markReadAndShowTyping,
  sendText,
  createOrGetConversation,
  getRecentContext,
  logMessage,
  updateConversationMetadata,
  getConversationMessageCount,
});

export default webhookHandler;
