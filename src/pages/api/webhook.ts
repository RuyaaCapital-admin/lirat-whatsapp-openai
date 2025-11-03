import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { openai } from "../../lib/openai";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const processedMessageCache = new Set<string>();

type InboundMessage = {
  id: string;
  from: string;
  text: string;
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

function detectLanguage(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function formatPriceFromJson(obj: any, lang: "ar" | "en"): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (!obj.timeUtc || !obj.symbol || typeof obj.price !== "number") return null;
  const time = String(obj.timeUtc);
  const symbol = String(obj.symbol);
  const price = Number(obj.price);
  if (lang === "ar") {
    return [`الوقت (UTC): ${time}`, `الرمز: ${symbol}`, `السعر: ${price}`].join("\n");
  }
  return [`time (UTC): ${time}`, `symbol: ${symbol}`, `price: ${price}`].join("\n");
}

const SIGNAL_REASON_MAP = {
  ar: {
    bullish_pressure: "ضغط شراء فوق المتوسطات",
    bearish_pressure: "ضغط بيع تحت المتوسطات",
    no_clear_bias: "السوق بدون اتجاه واضح حالياً",
  },
  en: {
    bullish_pressure: "Buy pressure above short-term averages",
    bearish_pressure: "Bearish momentum below resistance",
    no_clear_bias: "No clear directional bias right now",
  },
} as const;

function formatSignalFromJson(obj: any, lang: "ar" | "en"): string | null {
  if (!obj || typeof obj !== "object") return null;
  const required = obj.timeUtc && obj.symbol && obj.timeframe && obj.signal;
  if (!required) return null;
  const time = String(obj.timeUtc);
  const symbol = String(obj.symbol);
  const timeframe = String(obj.timeframe);
  const decision = String(obj.signal);
  const reasonKey = String(obj.reason || "no_clear_bias") as keyof typeof SIGNAL_REASON_MAP.en;
  const reasonText = (SIGNAL_REASON_MAP as any)[lang]?.[reasonKey] || SIGNAL_REASON_MAP.en.no_clear_bias;
  const lines: string[] = [];
  lines.push(lang === "ar" ? `الوقت (UTC): ${time}` : `time (UTC): ${time}`);
  lines.push(lang === "ar" ? `الرمز: ${symbol}` : `symbol: ${symbol}`);
  lines.push(lang === "ar" ? `الإطار الزمني: ${timeframe}` : `timeframe: ${timeframe}`);
  lines.push(`SIGNAL: ${decision}`);
  lines.push((lang === "ar" ? "السبب" : "Reason") + ": " + reasonText);
  if (decision.toUpperCase() !== "NEUTRAL") {
    lines.push(`Entry: ${obj.entry ?? "-"}`);
    lines.push(`SL: ${obj.sl ?? "-"}`);
    lines.push(`TP1: ${obj.tp1 ?? "-"}`);
    lines.push(`TP2: ${obj.tp2 ?? "-"}`);
  } else {
    lines.push(`Entry: -`);
    lines.push(`SL: -`);
    lines.push(`TP1: -`);
    lines.push(`TP2: -`);
  }
  return lines.join("\n");
}

function coerceTextIfJson(raw: string, userText: string): string {
  const text = (raw || "").trim();
  if (!text) return text;
  const first = text[0];
  if (first !== "{" && first !== "[") return text;
  try {
    const parsed = JSON.parse(text);
    const lang = detectLanguage(userText);
    if (Array.isArray(parsed)) {
      const maybe = parsed
        .map((chunk) => (typeof chunk === "string" ? chunk : JSON.stringify(chunk)))
        .join("\n")
        .trim();
      return maybe || text;
    }
    const price = formatPriceFromJson(parsed, lang);
    if (price) return price;
    const signal = formatSignalFromJson(parsed, lang);
    if (signal) return signal;
    return text;
  } catch {
    return text;
  }
}

function collectResponseText(response: any): string {
  if (!response) return "";
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const pieces: string[] = [];
  const outputs = Array.isArray(response.output) ? response.output : [];

  const append = (segment: any) => {
    if (!segment) return;
    if (typeof segment === "string" && segment.trim()) {
      pieces.push(segment.trim());
      return;
    }
    if (Array.isArray(segment)) {
      segment.forEach((part) => append(part));
      return;
    }
    if (typeof segment === "object") {
      if (typeof segment.text === "string") {
        append(segment.text);
        return;
      }
      if (Array.isArray((segment as any).content)) {
        append((segment as any).content);
        return;
      }
    }
  };

  outputs.forEach((item) => {
    append(item?.content ?? item?.output_text ?? item?.text ?? "");
  });

  if (!pieces.length && typeof response.response === "string") {
    append(response.response);
  }

  return pieces.join("\n").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const value = req.body?.entry?.[0]?.changes?.[0]?.value ?? {};
  const msg = (Array.isArray(value.messages) ? value.messages[0] : undefined) ?? {};
  const isImage = msg?.type === "image" && typeof msg?.image?.id === "string";
  const rawText = normaliseInboundText(msg) || inbound.text;
  const messageBody = typeof rawText === "string" ? rawText.trim() : "";
  if (!messageBody && !isImage) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    await markReadAndShowTyping(inbound.id);
  } catch (error) {
    console.warn("[WEBHOOK] markRead error", error);
  }

  try {
    const workflowId = process.env.OPENAI_WORKFLOW_ID;
    if (!workflowId) {
      throw new Error("Missing OPENAI_WORKFLOW_ID");
    }
    const { conversationId, sessionId } = await getOrCreateWorkflowSession(inbound.from, workflowId);

    // Log user message (non-blocking) — include placeholder for image caption if any
    void logMessageAsync(conversationId, "user", messageBody || (isImage ? "[image]" : ""));

    let replyText: string | null = null;
    if (isImage && msg?.image?.id) {
      try {
        const { base64, mimeType } = await downloadMediaBase64(String(msg.image.id));
        replyText = await generateImageReply({ base64, mimeType, caption: messageBody });
      } catch (err) {
        console.warn("[WEBHOOK] image handling error", err);
        const hasArabic = /[\u0600-\u06FF]/.test(messageBody || "");
        replyText = hasArabic ? "تعذر قراءة الصورة حالياً." : "Couldn't read the image right now.";
      }
    } else {
      try {
        const workflowResponse = await openai.responses.create({
          workflow_id: workflowId,
          session: sessionId,
          input: messageBody,
        });
        const rawOutput = collectResponseText(workflowResponse);
        const finalText = coerceTextIfJson(rawOutput, messageBody).trim();
        if (finalText) {
          replyText = finalText;
        } else if (rawOutput.trim()) {
          replyText = rawOutput.trim();
        } else {
          throw new Error("empty_workflow_output");
        }
      } catch (err: any) {
        console.error("[WEBHOOK] Agent error, falling back:", err);
        // Fallback: stable smart reply path to guarantee a response
        const result = await smartReplyNew({ phone: inbound.from, text: messageBody });
        replyText = result.replyText;
      }
    }

    const finalText = (replyText || "").trim();
    const sanitized = sanitizeNewsLinks(finalText);
    if (sanitized) {
      await sendText(inbound.from, sanitized);
      // Log assistant message (non-blocking)
      void logMessageAsync(conversationId, "assistant", sanitized);
    }
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
  }

  res.status(200).json({ received: true });
}

// Test-friendly injectable handler used by unit tests
export function createWebhookHandler(deps: {
  markReadAndShowTyping: (id: string) => Promise<void>;
  sendText: (to: string, body: string) => Promise<void>;
  createOrGetConversation: (phone: string) => Promise<{
    conversation_id: string;
    phone: string;
    user_id: string | null;
    isNew: boolean;
    last_symbol?: string | null;
    last_tf?: string | null;
    last_signal?: { payload?: { timeframe?: string; timeUTC?: string } | null } | null;
  } | null>;
  getConversationMessageCount: (conversationId: string) => Promise<number>;
  getRecentContext: (conversationId: string, limit?: number) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
  logMessage: (conversationId: string, role: "user" | "assistant", content: string) => Promise<void>;
  updateConversationMetadata: (conversationId: string, updates: any) => Promise<void>;
}) {
  const {
    markReadAndShowTyping: depMarkRead,
    sendText: depSendText,
    createOrGetConversation: depGetConv,
    getConversationMessageCount: depMsgCount,
    getRecentContext: depContext,
    logMessage: depLog,
  } = deps;

  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    if (!req.body?.entry?.[0]?.changes?.[0]?.value) {
      res.status(200).json({ received: true });
      return;
    }
    const inbound = extractMessage(req.body);
    const text = (inbound.text || "").trim();
    if (!inbound.from || !text) {
      res.status(200).json({ received: true });
      return;
    }

    try { await depMarkRead(inbound.id); } catch {}

    const isArabic = /[\u0600-\u06FF]/.test(text);
    const lower = text.toLowerCase();

    // Identity question exact handling
    if (/(who\s+are\s+you\??|مين\s*انت|مين انت\??)/i.test(text)) {
      const identity = isArabic ? "مساعد ليرات" : "I'm Liirat assistant.";
      await depSendText(inbound.from, identity);
      res.status(200).json({ received: true });
      return;
    }

    // Load conversation and basic context
    const conv = (await depGetConv(inbound.from)) || null;
    const convId = conv?.conversation_id ?? null;
    const messageCount = convId ? await depMsgCount(convId) : 0;

    // First-time gentle greeting
    if (messageCount === 0 || conv?.isNew) {
      const greet = isArabic ? "كيف فيني ساعدك؟" : "How can I help?";
      await depSendText(inbound.from, greet);
      res.status(200).json({ received: true });
      return;
    }

    // Follow-up: timeframe clarification using last signal from metadata
    const asksTimeframe = /(which\s+time(frame)?|هي\s+على\s+أي\s+وقت|على اي وقت|أي\s+وقت)/i.test(text);
    const lastPayload = conv?.last_signal?.payload as { timeframe?: string; timeUTC?: string } | undefined;
    if (asksTimeframe && lastPayload?.timeframe) {
      const tf = lastPayload.timeframe;
      const timeUTC = lastPayload.timeUTC || "";
      const reply = isArabic
        ? `آخر تحديث: ${timeUTC} UTC — timeframe: ${tf}`
        : `Last update: ${timeUTC} UTC — timeframe: ${tf}`;
      await depSendText(inbound.from, reply);
      res.status(200).json({ received: true });
      return;
    }

    // Default: concise nudge to ask asset/timeframe (kept minimal for tests)
    const fallback = isArabic ? "حدّد الأداة أو الإطار الزمني." : "Specify the asset or timeframe.";
    await depSendText(inbound.from, fallback);
    res.status(200).json({ received: true });
  };
}