import type { NextApiRequest, NextApiResponse } from "next";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { SYSTEM_PROMPT } from "../../lib/systemPrompt";
import { TOOL_SCHEMAS } from "../../lib/toolSchemas";
import { openai } from "../../lib/openai";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import {
  findOrCreateConversation,
  insertMessage,
  fetchConversationMessages,
  type ConversationRole,
} from "../../lib/supabase";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  search_web_news,
  about_liirat_knowledge,
  type TradingSignalResult,
  type OhlcResultPayload,
} from "../../tools/agentTools";
import { detectLanguage, normaliseDigits } from "../../utils/webhookHelpers";
import { formatNewsMsg } from "../../utils/formatters";
import { hardMapSymbol, toTimeframe } from "../../tools/normalize";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const FALLBACK_EMPTY = {
  ar: "ما الرسالة؟",
  en: "How can I help?",
} as const;

const FALLBACK_UNAVAILABLE = {
  ar: "البيانات غير متاحة حالياً. جرّب: price BTCUSDT.",
  en: "Data unavailable right now. Try: price BTCUSDT.",
} as const;

const GREETING = {
  ar: "مرحباً، أنا مساعد ليرات. كيف فيني ساعدك؟",
  en: "Hi, I'm Liirat assistant. How can I help you?",
} as const;

const processedMessageCache = new Set<string>();
const lastSeenByUser = new Map<string, number>();
const CONVERSATION_IDLE_MS = 30 * 60 * 1000;

function getLastSeen(phone: string): number {
  return lastSeenByUser.get(phone) ?? 0;
}

function touchLastSeen(phone: string) {
  const now = Date.now();
  lastSeenByUser.set(phone, now);
  if (lastSeenByUser.size > 1000) {
    let oldestKey: string | null = null;
    let oldestValue = Number.POSITIVE_INFINITY;
    for (const [key, value] of lastSeenByUser.entries()) {
      if (value < oldestValue) {
        oldestValue = value;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      lastSeenByUser.delete(oldestKey);
    }
  }
}

type LanguageCode = "ar" | "en";

type InboundMessage = {
  id: string;
  from: string;
  text: string;
  contactName?: string;
};

type ToolContext = {
  candles: Map<string, OhlcResultPayload>;
};

class ToolFallbackError extends Error {
  fallback: string;

  constructor(message: string, fallback: string) {
    super(message);
    this.name = "ToolFallbackError";
    this.fallback = fallback;
  }
}

function dataUnavailable(language: LanguageCode): string {
  return FALLBACK_UNAVAILABLE[language] ?? FALLBACK_UNAVAILABLE.en;
}

function shouldUseDataFallback(toolName: string, error: unknown): boolean {
  const code = typeof (error as any)?.code === "string" ? (error as any).code.toUpperCase() : "";
  const message = typeof (error as any)?.message === "string" ? (error as any).message.toUpperCase() : "";
  if (toolName === "search_web_news" || toolName === "get_price") {
    return true;
  }
  if (toolName === "get_ohlc" || toolName === "compute_trading_signal") {
    if (code && (code.includes("STALE") || code.includes("HTTP") || code.includes("NO_DATA") || code.includes("NETWORK"))) {
      return true;
    }
    if (message && (message.includes("STALE") || message.includes("HTTP") || message.includes("NETWORK") || message.includes("TIMEOUT"))) {
      return true;
    }
  }
  return false;
}

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

function makeGreeting(language: LanguageCode): string {
  return GREETING[language] ?? GREETING.en;
}

function sanitiseToolArgs(args: Record<string, unknown>) {
  const clone: Record<string, unknown> = { ...args };
  if (Array.isArray(clone.candles)) {
    clone.candles = `len:${clone.candles.length}`;
  }
  return clone;
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  language: LanguageCode,
) {
  try {
    switch (toolName) {
      case "get_price": {
        const symbol = String(args.symbol ?? "");
        const result = await get_price(symbol);
        return { ...result };
      }
      case "get_ohlc": {
        const symbol = String(args.symbol ?? "");
        const timeframe = String(args.timeframe ?? "");
        const snapshot = await get_ohlc(symbol, timeframe, 200);
        const key = `${snapshot.symbol}:${snapshot.interval}`;
        ctx.candles.set(key, snapshot);
        return snapshot;
      }
      case "compute_trading_signal": {
        const symbol = hardMapSymbol(String(args.symbol ?? "")) ?? String(args.symbol ?? "");
        const timeframe = toTimeframe(String(args.timeframe ?? ""));
        const key = `${symbol}:${timeframe}`;
        let candles = Array.isArray(args.candles) ? (args.candles as any[]) : undefined;
        if (!candles || !candles.length) {
          const cached = ctx.candles.get(key);
          if (cached) {
            candles = cached.candles;
          } else {
            const snapshot = await get_ohlc(symbol, timeframe, 200);
            ctx.candles.set(key, snapshot);
            candles = snapshot.candles;
          }
        }
        const signal: TradingSignalResult = await compute_trading_signal(symbol, timeframe, candles as any[]);
        return signal;
      }
      case "search_web_news": {
        const query = String(args.query ?? "");
        const lang = language === "ar" ? "ar" : "en";
        const count = typeof args.count === "number" ? args.count : 3;
        const result = await search_web_news(query, lang, count);
        return { ...result, formatted: formatNewsMsg(result.rows, "* ") };
      }
      case "about_liirat_knowledge": {
        const query = String(args.query ?? "");
        const lang = typeof args.lang === "string" ? args.lang : language;
        const result = await about_liirat_knowledge(query, lang);
        return { text: result };
      }
      default:
        throw new Error(`unknown_tool:${toolName}`);
    }
  } catch (error) {
    if (shouldUseDataFallback(toolName, error)) {
      throw new ToolFallbackError(`${toolName}_fallback`, dataUnavailable(language));
    }
    throw error;
  }
}

async function runAssistant(
  baseMessages: ChatCompletionMessageParam[],
  language: LanguageCode,
): Promise<string> {
  const messages = [...baseMessages];
  const ctx: ToolContext = { candles: new Map() };
  let lastAssistantContent = "";
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 700,
      messages,
      tools: TOOL_SCHEMAS as any,
      tool_choice: "auto",
    });
    const choice = completion.choices?.[0];
    const message = choice?.message;
    if (!message) {
      break;
    }
    if (message.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      } as ChatCompletionMessageParam);
      for (const call of message.tool_calls) {
        const name = call.function?.name ?? "";
        let parsed: Record<string, unknown> = {};
        try {
          parsed = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (error) {
          console.warn("[TOOL] invalid arguments", { name, error });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "invalid_arguments" }),
          });
          continue;
        }
        console.log("[TOOL] invoke", name, sanitiseToolArgs(parsed));
        try {
          const result = await callTool(name, parsed, ctx, language);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          console.error("[TOOL] failed", { name, error });
          if (error instanceof ToolFallbackError) {
            return error.fallback;
          }
          if (shouldUseDataFallback(name, error)) {
            return dataUnavailable(language);
          }
          return dataUnavailable(language);
        }
      }
      continue;
    }
    const content = (typeof message.content === "string" ? message.content : "").trim();
    if (content) {
      lastAssistantContent = content;
      return content;
    }
    if (choice?.finish_reason === "stop") {
      break;
    }
  }
  return lastAssistantContent || dataUnavailable(language);
}

async function handleIdentity(language: LanguageCode): Promise<string> {
  return language === "ar" ? "مساعد ليرات" : "Liirat assistant.";
}

async function buildAssistantReply(
  userText: string,
  history: Array<{ role: ConversationRole; content: string }>,
  language: LanguageCode,
  identityQuestion: boolean,
): Promise<string> {
  if (identityQuestion) {
    return handleIdentity(language);
  }
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((msg) => ({ role: msg.role, content: msg.content })),
    { role: "user", content: userText },
  ];
  const trimmedUser = userText.trim();
  if (!trimmedUser) {
    return FALLBACK_EMPTY[language];
  }
  try {
    return await runAssistant(messages, language);
  } catch (error) {
    console.error("[ASSISTANT] error", error);
    return dataUnavailable(language);
  }
}

function prependGreeting(reply: string, language: LanguageCode, shouldGreet: boolean): string {
  if (!shouldGreet) return reply;
  const greeting = makeGreeting(language);
  if (!reply) return greeting;
  return `${greeting}\n${reply}`;
}

interface WebhookDeps {
  markReadAndShowTyping: typeof markReadAndShowTyping;
  sendText: typeof sendText;
  findOrCreateConversation: typeof findOrCreateConversation;
  insertMessage: typeof insertMessage;
  fetchConversationMessages: typeof fetchConversationMessages;
  buildAssistantReply?: typeof buildAssistantReply;
}

async function saveMessageSafe(
  deps: WebhookDeps,
  conversationId: string | null,
  phone: string,
  role: ConversationRole,
  content: string,
) {
  if (!conversationId) return;
  try {
    await deps.insertMessage({ conversationId, phone, role, content });
  } catch (error) {
    console.warn("[SUPABASE] failed to log conversation", error);
  }
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

  const normalisedText = normaliseDigits(inbound.text ?? "").trim();
  const language = detectLanguage(normalisedText) as LanguageCode;
  const identityQuestion = isIdentityQuestion(normalisedText);
  const messageForLang = (inbound.text ?? "").trim() || normalisedText;
  const preferredLang = detectPreferredLanguage(messageForLang || "");
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  console.debug("[SUPABASE] target", {
    url: supabaseUrl ? `${supabaseUrl.slice(0, 30)}${supabaseUrl.length > 30 ? "..." : ""}` : "",
    key: supabaseKey ? `${supabaseKey.slice(0, 6)}***` : "",
  });

  const lastSeen = getLastSeen(inbound.from);
  const now = Date.now();
  const isNewSession = !lastSeen || now - lastSeen > CONVERSATION_IDLE_MS;
  const userContentForLog = messageForLang;

  try {
    await deps.markReadAndShowTyping(inbound.id);
  } catch (error) {
    console.warn("[WEBHOOK] markRead error", error);
  }

  const conversation = await deps.findOrCreateConversation(inbound.from, userContentForLog);
  const conversationId = conversation?.id ?? null;
  const history = conversationId ? await deps.fetchConversationMessages(conversationId, 10) : [];

  const buildReply = deps.buildAssistantReply ?? buildAssistantReply;
  const assistantReply = await buildReply(normalisedText || " ", history, language, identityQuestion);
  const shouldGreet = isNewSession && !identityQuestion;
  const finalReply = prependGreeting(assistantReply, preferredLang, shouldGreet);
  const bodyToSend = finalReply.trim() ? finalReply : dataUnavailable(preferredLang);

  if (conversationId) {
    await saveMessageSafe(deps, conversationId, inbound.from, "user", userContentForLog);
  }

  console.log("[WEBHOOK] sending reply", { to: inbound.from, preview: bodyToSend.slice(0, 100) });
  try {
    await deps.sendText(inbound.from, bodyToSend);
  } catch (error) {
    console.error("[WEBHOOK] sendText error", error);
  } finally {
    touchLastSeen(inbound.from);
  }

  if (conversationId) {
    await saveMessageSafe(deps, conversationId, inbound.from, "assistant", bodyToSend);
  }

  res.status(200).json({ received: true });
  };
}

export const webhookHandler = createWebhookHandler({
  markReadAndShowTyping,
  sendText,
  findOrCreateConversation,
  insertMessage,
  fetchConversationMessages,
  buildAssistantReply,
});

export default webhookHandler;
