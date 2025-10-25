import type { NextApiRequest, NextApiResponse } from "next";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { SYSTEM_PROMPT } from "../../lib/systemPrompt";
import { openai } from "../../lib/openai";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import {
  createOrGetConversation,
  logMessage,
  getRecentContext,
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
  type TradingSignalResult,
} from "../../tools/agentTools";
import { detectLanguage, normaliseDigits } from "../../utils/webhookHelpers";
import { formatNewsMsg, formatPriceMsg } from "../../utils/formatters";
import { formatTradingSignalWhatsapp } from "../../utils/tradingSignalFormatter";
import { hardMapSymbol, toTimeframe, normalizeArabic, type TF } from "../../tools/normalize";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const FALLBACK_EMPTY = {
  ar: "ما الرسالة؟",
  en: "How can I help?",
} as const;

const FALLBACK_UNAVAILABLE = {
  ar: "البيانات غير متاحة حالياً. جرّب لاحقاً.",
  en: "Data unavailable right now. Try later.",
} as const;

const SIGNAL_UNUSABLE = {
  ar: "ما عندي بيانات كافية لهالتايم فريم حالياً. جرّب فريم أعلى (5min أو 1hour).",
  en: "Not enough recent data for that timeframe. Try 5min or 1hour.",
} as const;

const processedMessageCache = new Set<string>();
const greetedUsers = new Set<string>();

type LanguageCode = "ar" | "en";

type InboundMessage = {
  id: string;
  from: string;
  text: string;
  contactName?: string;
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
  return { id: idCandidate, from: fromCandidate, text, contactName: contact?.profile?.name };
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function detectPreferredLanguage(text: string): LanguageCode {
  return hasArabic(text) ? "ar" : "en";
}

function isIdentityQuestion(text: string): boolean {
  const normalised = text.trim().toLowerCase();
  if (!normalised) return false;
  const candidates = ["مين انت", "من انت", "شو انت", "من حضرتك", "who are you", "who r u", "what are you"];
  return candidates.some((phrase) => normalised.includes(phrase));
}

function dataUnavailable(language: LanguageCode): string {
  return FALLBACK_UNAVAILABLE[language] ?? FALLBACK_UNAVAILABLE.en;
}

function signalUnavailable(language: LanguageCode): string {
  return SIGNAL_UNUSABLE[language] ?? SIGNAL_UNUSABLE.en;
}

function buildPriceReply(result: PriceResult): string {
  return formatPriceMsg({
    symbol: result.symbol,
    price: result.price,
    timeUTC: result.timeUTC,
    source: result.source,
  });
}

type TradingSignalOk = Extract<TradingSignalResult, { status: "OK" }>;

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

function normaliseSymbolInput(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  return hardMapSymbol(input);
}

interface ResolveSignalParamsArgs {
  userText: string;
  planSymbol?: string | null;
  planTimeframe?: string | null;
  lastSymbol?: string | null;
  lastTimeframe?: string | null;
}

interface ResolvedSignalParams {
  symbol: string | null;
  timeframe: TF | null;
  timeframeExplicit: boolean;
}

function resolveSignalParams(args: ResolveSignalParamsArgs): ResolvedSignalParams {
  const symbolFromPlan = normaliseSymbolInput(args.planSymbol);
  const symbolFromText = normaliseSymbolInput(detectSymbolInText(args.userText));
  const symbolFromContext = normaliseSymbolInput(args.lastSymbol);
  const symbol = symbolFromPlan ?? symbolFromText ?? symbolFromContext ?? null;

  const planTf = args.planTimeframe ? toTimeframe(args.planTimeframe) : null;
  const fromText = detectTimeframeMention(args.userText);
  const contextTf = args.lastTimeframe ? toTimeframe(args.lastTimeframe) : null;

  let timeframe: TF | null = planTf ?? fromText.timeframe ?? contextTf ?? null;
  if (!timeframe && symbol) {
    timeframe = "5min";
  }
  return { symbol, timeframe, timeframeExplicit: fromText.explicit || Boolean(planTf) };
}

function buildNewsReply(rows: { date: string; source: string; title: string; impact?: string }[]): string {
  return formatNewsMsg(rows);
}

type IntentType = "price" | "trading_signal" | "news" | "liirat_info" | "general";

interface IntentPlan {
  intent: IntentType;
  symbol?: string | null;
  timeframe?: string | null;
  query?: string | null;
}

async function classifyIntent(
  userText: string,
  language: LanguageCode,
  history: ConversationContextEntry[],
): Promise<IntentPlan> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return { intent: "general" };
  }
  const recentHistory = history
    .slice(-6)
    .map((item) => `${item.role.toUpperCase()}: ${item.content}`)
    .join("\n")
    .slice(-1800);
  const prompt = `You are an intent classifier for a trading assistant. Decide the best action for the latest user message.\nReturn strict JSON with keys: intent (price|trading_signal|news|liirat_info|general), symbol (string or null), timeframe (1min|5min|15min|30min|1hour|4hour|1day or null), query (string or null).\nInfer symbol/timeframe from conversation if obvious. If unsure, choose intent="general".`;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Language: ${language}\nHistory:\n${recentHistory || "(none)"}\n---\nUser: ${trimmed}`,
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw || "{}") as Partial<IntentPlan>;
    const intent = parsed.intent as IntentType | undefined;
    if (!intent || !["price", "trading_signal", "news", "liirat_info", "general"].includes(intent)) {
      return { intent: "general" };
    }
    return {
      intent,
      symbol: typeof parsed.symbol === "string" ? parsed.symbol : null,
      timeframe: typeof parsed.timeframe === "string" ? parsed.timeframe : null,
      query: typeof parsed.query === "string" ? parsed.query : null,
    };
  } catch (error) {
    console.warn("[ASSISTANT] classifyIntent error", error);
    return { intent: "general" };
  }
}

async function generateGeneralReply(
  userText: string,
  history: ConversationContextEntry[],
  language: LanguageCode,
): Promise<string> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return FALLBACK_EMPTY[language];
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
      temperature: 0.3,
      max_tokens: 700,
      messages,
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (content) {
      return content;
    }
  } catch (error) {
    console.error("[ASSISTANT] generateGeneralReply error", error);
  }
  return dataUnavailable(language);
}

interface SmartToolArgs {
  userText: string;
  language: LanguageCode;
  history: ConversationContextEntry[];
  identityQuestion: boolean;
  nowMs: number;
  lastSymbol?: string | null;
  lastTimeframe?: string | null;
}

interface SmartToolResult {
  text: string;
  skipGreeting?: boolean;
  contextUpdate?: { last_symbol?: string | null; last_tf?: string | null };
}

function normaliseSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const mapped = hardMapSymbol(symbol);
  return mapped ?? null;
}

async function smartToolLoop({
  userText,
  language,
  history,
  identityQuestion,
  nowMs,
  lastSymbol,
  lastTimeframe,
}: SmartToolArgs): Promise<SmartToolResult> {
  const trimmed = userText.trim();
  if (!trimmed) {
    return { text: FALLBACK_EMPTY[language] };
  }

  if (identityQuestion) {
    try {
      const text = await about_liirat_knowledge(trimmed, language);
      return { text };
    } catch (error) {
      console.warn("[TOOL] about_liirat_knowledge error", error);
      return { text: language === "ar" ? "مساعد ليرات" : "Liirat assistant." };
    }
  }

  const plan = await classifyIntent(trimmed, language, history);

  if (plan.intent === "liirat_info") {
    try {
      const text = await about_liirat_knowledge(trimmed, language);
      return { text };
    } catch (error) {
      console.warn("[TOOL] about_liirat_knowledge error", error);
      return { text: dataUnavailable(language) };
    }
  }

  if (plan.intent === "price") {
    const symbol = normaliseSymbol(plan.symbol ?? trimmed);
    if (!symbol) {
      const text = await generateGeneralReply(trimmed, history, language);
      return { text };
    }
    try {
      const result = await get_price(symbol);
      return { text: buildPriceReply(result) };
    } catch (error) {
      console.warn("[TOOL] get_price error", error);
      return { text: dataUnavailable(language) };
    }
  }

  if (plan.intent === "news") {
    const wantsArabic = language === "ar" || hasArabic(trimmed);
    const query = plan.query?.trim() || trimmed;
    try {
      const result = await search_web_news(query, wantsArabic ? "ar" : "en", 3);
      if (!result.rows.length) {
        return { text: dataUnavailable(language) };
      }
      return { text: buildNewsReply(result.rows) };
    } catch (error) {
      console.warn("[TOOL] search_web_news error", error);
      return { text: dataUnavailable(language) };
    }
  }

  if (plan.intent === "trading_signal") {
    const resolved = resolveSignalParams({
      userText: trimmed,
      planSymbol: plan.symbol,
      planTimeframe: plan.timeframe,
      lastSymbol,
      lastTimeframe,
    });
    const symbol = normaliseSymbol(resolved.symbol);
    if (!symbol) {
      const clarification =
        language === "ar"
          ? "حدد الأداة (ذهب، فضة، يورو، بيتكوين...)."
          : "Specify the instrument (gold, silver, euro, bitcoin...).";
      return { text: clarification, skipGreeting: true };
    }
    const timeframe = resolved.timeframe ?? "5min";
    try {
      console.log("[TOOL] invoke get_ohlc", { symbol, timeframe, limit: 60 });
      const ohlc = await get_ohlc(symbol, timeframe, 60, { nowMs });
      const signal = await compute_trading_signal({ ...ohlc, lang: language });
      if (signal.status !== "OK") {
        return { text: signalUnavailable(language), skipGreeting: true };
      }

      console.log("[SIGNAL_PIPELINE]", {
        symbol: ohlc.symbol,
        timeframe: ohlc.timeframe,
        candles: ohlc.candles.length,
        decision: signal.signal,
        stale: signal.isStale,
        age_min: signal.ageMinutes,
        last_iso: signal.lastTimeISO,
      });

      const reply = formatTradingSignalWhatsapp({ signal, lang: language });
      return {
        text: reply,
        contextUpdate: { last_symbol: signal.symbol, last_tf: signal.timeframe },
      };
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "NO_DATA") {
        return { text: signalUnavailable(language), skipGreeting: true };
      }
      console.warn("[TOOL] trading signal error", error);
      return { text: dataUnavailable(language), skipGreeting: true };
    }
  }

  const text = await generateGeneralReply(trimmed, history, language);
  return { text };
}

function removeLatestUserDuplicate(
  history: ConversationContextEntry[],
  latestContent: string,
): ConversationContextEntry[] {
  if (!history.length || !latestContent.trim()) {
    return history;
  }
  const trimmed = latestContent.trim();
  const last = history[history.length - 1];
  if (last && last.role === "user" && last.content.trim() === trimmed) {
    return history.slice(0, -1);
  }
  return history;
}

function prependGreeting(reply: string, language: LanguageCode, shouldGreet: boolean): string {
  if (!shouldGreet) {
    return reply;
  }
  const greeting =
    language === "ar" ? "مرحباً، أنا مساعد ليرات." : "Hi, I'm the Liirat assistant.";
  if (!reply.trim()) {
    return greeting;
  }
  return `${greeting}\n${reply}`;
}

function hasSeenUser(phone: string): boolean {
  return greetedUsers.has(phone);
}

function markUserSeen(phone: string) {
  greetedUsers.add(phone);
  if (greetedUsers.size > 2000) {
    const [first] = greetedUsers;
    if (first) {
      greetedUsers.delete(first);
    }
  }
}

interface WebhookDeps {
  markReadAndShowTyping: typeof markReadAndShowTyping;
  sendText: typeof sendText;
  createOrGetConversation: typeof createOrGetConversation;
  logMessage: typeof logMessage;
  getRecentContext: typeof getRecentContext;
  getConversationMessageCount: typeof getConversationMessageCount;
  updateConversationMetadata: typeof updateConversationMetadata;
  smartToolLoop?: typeof smartToolLoop;
}

function normaliseUserText(text: string): string {
  const trimmed = text.trim();
  return trimmed || "";
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
      res.status(403).send("Forbidden");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
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
      const [first] = processedMessageCache;
      if (first) {
        processedMessageCache.delete(first);
      }
    }

    const rawText = normaliseInboundText(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? {}) || inbound.text;
    const messageBody = normaliseUserText(rawText);
    if (!messageBody.trim()) {
      console.log("[WEBHOOK] no valid inbound text, skipping reply");
      res.status(200).json({ received: true });
      return;
    }

    const normalisedText = normaliseDigits(messageBody).trim();
    const language = detectLanguage(normalisedText || messageBody) as LanguageCode;
    const identityQuestion = isIdentityQuestion(normalisedText || messageBody);
    const preferredLang = detectPreferredLanguage(messageBody);

    try {
      await deps.markReadAndShowTyping(inbound.id);
    } catch (error) {
      console.warn("[WEBHOOK] markRead error", error);
    }

    const conversation = await deps.createOrGetConversation(inbound.from);
    const conversationId = conversation?.conversation_id ?? null;
    const conversationUserId = conversation?.user_id ?? null;
    let existingCount = 0;
    if (conversationId) {
      const count = await deps.getConversationMessageCount(conversationId);
      existingCount = typeof count === "number" && count > 0 ? count : 0;
    }

    if (conversationId) {
      await deps.logMessage(conversationId, "user", messageBody, conversationUserId);
    }

    let history: ConversationContextEntry[] = [];
    if (conversationId) {
      history = await deps.getRecentContext(conversationId, 12);
    }
    const trimmedHistory = removeLatestUserDuplicate(history, messageBody);

    if (existingCount > 0) {
      markUserSeen(inbound.from);
    }

    const nowMs = Date.now();

    const runSmartToolLoop = deps.smartToolLoop ?? smartToolLoop;
    const assistantOutcome = await runSmartToolLoop({
      userText: normalisedText || messageBody,
      language,
      history: trimmedHistory,
      identityQuestion,
      nowMs,
      lastSymbol: conversation?.last_symbol ?? null,
      lastTimeframe: conversation?.last_tf ?? null,
    });

    const assistantReply = assistantOutcome.text;
    const skipGreeting = Boolean(assistantOutcome.skipGreeting);

    const shouldGreet =
      !skipGreeting && !identityQuestion && (conversation?.isNew ?? existingCount === 0) && !hasSeenUser(inbound.from);
    const replyWithIntro = prependGreeting(assistantReply, preferredLang, shouldGreet);
    const finalReply = replyWithIntro.trim() ? replyWithIntro : dataUnavailable(preferredLang);

    console.log("[WEBHOOK] sending reply", {
      to: inbound.from,
      preview: finalReply.slice(0, 100),
    });
    try {
      await deps.sendText(inbound.from, finalReply);
    } catch (error) {
      console.error("[WEBHOOK] sendText error", error);
    }

    if (conversationId) {
      await deps.logMessage(conversationId, "assistant", finalReply, conversationUserId);
    }

    if (conversationId && assistantOutcome.contextUpdate) {
      await deps.updateConversationMetadata(conversationId, assistantOutcome.contextUpdate);
    }

    if (shouldGreet) {
      markUserSeen(inbound.from);
    }

    res.status(200).json({ received: true });
  };
}

export const webhookHandler = createWebhookHandler({
  markReadAndShowTyping,
  sendText,
  createOrGetConversation,
  logMessage,
  getRecentContext,
  getConversationMessageCount,
  updateConversationMetadata,
});

export default webhookHandler;
