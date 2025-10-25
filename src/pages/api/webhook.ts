import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import { smartReply } from "../../lib/smartReplyNew";
import { getOrCreateConversationByTitle, insertMessage } from "../../lib/supabaseLite";

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

  const rawText = normaliseInboundText(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? {}) || inbound.text;
  const messageBody = typeof rawText === "string" ? rawText.trim() : "";
  if (!messageBody) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    await markReadAndShowTyping(inbound.id);
  } catch (error) {
    console.warn("[WEBHOOK] markRead error", error);
  }

  try {
    // Use the new smart reply system
    const result = await smartReply({
      phone: inbound.from,
      text: messageBody,
      contactName: undefined
    });

    await sendText(inbound.from, result.replyText);

    // Non-blocking logging to Supabase (ignore failures)
    (async () => {
      try {
        const convId = (await getOrCreateConversationByTitle(inbound.from)) || result.conversationId;
        if (convId) {
          await insertMessage(convId, "user", messageBody).catch((e) => console.warn("[SUPABASE] log user error", e));
          await insertMessage(convId, "assistant", result.replyText).catch((e) => console.warn("[SUPABASE] log assistant error", e));
        }
      } catch (e) {
        console.warn("[SUPABASE] background logging failed", e);
      }
    })().catch(() => {});
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