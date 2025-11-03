import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { runWorkflowMessage } from "../../lib/workflowRunner";
import generateImageReply from "../../lib/imageReply";

// --- Env (no hardcoding) ----------------------------------------------------
const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";
const WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID ?? ""; // required
const WORKFLOW_VERSION = Number(process.env.OPENAI_WORKFLOW_VERSION ?? "96"); // keep in sync with Agent Builder

// --- Dedup cache to avoid double replies on the same WhatsApp message -------
const processedMessageCache = new Set<string>();

// --- Types -------------------------------------------------------------------
type InboundMessage = {
  id: string;
  from: string;
  text: string;
};

// --- Helpers -----------------------------------------------------------------
function hasArabic(s: string) {
  return /[\u0600-\u06FF]/.test(s);
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
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  if (typeof message?.type === "string" && message.type.trim()) return `[${message.type.trim()}]`;
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
    (typeof message.id === "string" && message.id.trim()) ||
    (typeof value?.statuses?.[0]?.id === "string" && value.statuses[0].id.trim()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const fromCandidate =
    (typeof message.from === "string" && message.from.trim()) ||
    (typeof waId === "string" && waId.trim()) ||
    "";

  const text = normaliseInboundText(message);
  return { id: String(idCandidate), from: String(fromCandidate), text: String(text ?? "") };
}

// --- Main handler ------------------------------------------------------------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // WhatsApp webhook verification
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

  // Deduplicate
  if (processedMessageCache.has(inbound.id)) {
    res.status(200).json({ received: true });
    return;
  }
  processedMessageCache.add(inbound.id);
  if (processedMessageCache.size > 5000) {
    const firstKey = processedMessageCache.values().next().value;
    if (firstKey) processedMessageCache.delete(firstKey);
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
  } catch (err) {
    console.warn("[WEBHOOK] markRead error", err);
  }

  try {
    if (!WORKFLOW_ID) {
      throw new Error("OPENAI_WORKFLOW_ID is not set");
    }

    const { conversationId, sessionId } = await getOrCreateWorkflowSession(inbound.from, WORKFLOW_ID);

    // Log user message (non-blocking)
    void logMessageAsync(conversationId, "user", messageBody || (isImage ? "[image]" : ""));

    let replyText: string | null = null;

    if (isImage && msg?.image?.id) {
      // Image branch (caption-aware)
      try {
        const { base64, mimeType } = await downloadMediaBase64(String(msg.image.id));
        replyText = await generateImageReply({ base64, mimeType, caption: messageBody });
      } catch (err) {
        console.warn("[WEBHOOK] image handling error", err);
        replyText = hasArabic(messageBody) ? "تعذر قراءة الصورة حالياً." : "Couldn't read the image right now.";
      }
    } else {
      // Agent Builder workflow (single source of truth for tools/news/signals)
      try {
        replyText = await runWorkflowMessage({
          sessionId,
          workflowId: WORKFLOW_ID,
          version: WORKFLOW_VERSION,
          userText: messageBody,
        });
      } catch (err) {
        console.error("[WEBHOOK] Agent error:", err);
        // Do NOT call any legacy smartReply/news path.
        replyText = hasArabic(messageBody)
          ? "البيانات غير متاحة حالياً. حاول بعد قليل."
          : "Data unavailable right now. Try again shortly.";
      }
    }

    const finalText = (replyText || "").trim();
    if (finalText) {
      const sanitized = sanitizeNewsLinks(finalText); // masks/cleans links & headlines formatting
      if (sanitized) {
        await sendText(inbound.from, sanitized);
        void logMessageAsync(conversationId, "assistant", sanitized);
      }
    }
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
  }

  res.status(200).json({ received: true });
}

// --- Test-friendly injectable handler (no legacy news calls) -----------------
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
  updateConversationMetadata?: (conversationId: string, updates: any) => Promise<void>;
}) {
  const {
    markReadAndShowTyping: depMarkRead,
    sendText: depSendText,
    createOrGetConversation: depGetConv,
    getConversationMessageCount: depMsgCount,
    // getRecentContext: depContext, // keep available for future use
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

    const isAr = hasArabic(text);

    // Exact identity question
    if (/(^|\s)(who\s+are\s+you\??|مين\s*انت\??|مين\s*أنت\??|مين\s*إنت\??)($|\s)/i.test(text)) {
      await depSendText(inbound.from, isAr ? "مساعد ليرات" : "I'm Liirat assistant.");
      res.status(200).json({ received: true });
      return;
    }

    // Minimal onboarding on first message
    const conv = (await depGetConv(inbound.from)) || null;
    const convId = conv?.conversation_id ?? null;
    const count = convId ? await depMsgCount(convId) : 0;

    if (count === 0 || conv?.isNew) {
      const greet = isAr ? "كيف فيني ساعدك؟" : "How can I help?";
      await depSendText(inbound.from, greet);
      if (convId) void depLog(convId, "assistant", greet);
      res.status(200).json({ received: true });
      return;
    }

    // Timing clarification using last stored signal payload
    const asksTimeframe = /(which\s+time(frame)?|هي\s+على\s+أي\s+وقت|على اي وقت|أي\s+وقت)/i.test(text);
    const lastPayload = conv?.last_signal?.payload as { timeframe?: string; timeUTC?: string } | undefined;
    if (asksTimeframe && lastPayload?.timeframe) {
      const tf = lastPayload.timeframe;
      const timeUTC = lastPayload.timeUTC || "";
      const reply = isAr ? `آخر تحديث: ${timeUTC} UTC — timeframe: ${tf}` : `Last update: ${timeUTC} UTC — timeframe: ${tf}`;
      await depSendText(inbound.from, reply);
      if (convId) void depLog(convId, "assistant", reply);
      res.status(200).json({ received: true });
      return;
    }

    // Default minimal nudge (no legacy news path here)
    const fallback = isAr ? "حدّد الأداة أو الإطار الزمني." : "Specify the asset or timeframe.";
    await depSendText(inbound.from, fallback);
    if (convId) void depLog(convId, "assistant", fallback);
    res.status(200).json({ received: true });
  };
}
