// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { openai } from "../../lib/openai";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";
const processedMessageCache = new Set<string>();

type InboundMessage = { id: string; from: string; text: string };

// ----------------------------- utils -----------------------------

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
  for (const c of candidates) if (typeof c === "string" && c.trim()) return c;
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
  if (lang === "ar") return [`الوقت (UTC): ${time}`, `الرمز: ${symbol}`, `السعر: ${price}`].join("\n");
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
    lines.push(`Entry: -`, `SL: -`, `TP1: -`, `TP2: -`);
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
      const joined = parsed.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n").trim();
      return joined || text;
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

function collectWorkflowOutput(run: any): string {
  // Workflows may return either output.messages (content array) or a plain output_text
  const out = run?.output ?? {};
  const pieces: string[] = [];

  const pushSeg = (seg: any) => {
    if (!seg) return;
    if (typeof seg === "string") {
      if (seg.trim()) pieces.push(seg.trim());
      return;
    }
    if (Array.isArray(seg)) {
      seg.forEach(pushSeg);
      return;
    }
    const txt = seg.output_text ?? seg.text ?? seg.content ?? "";
    if (typeof txt === "string" && txt.trim()) pieces.push(txt.trim());
    else if (Array.isArray(seg.content)) seg.content.forEach(pushSeg);
  };

  if (Array.isArray(out?.messages)) {
    out.messages.forEach((m: any) => pushSeg(m?.content));
  } else {
    pushSeg(out);
  }
  return pieces.join("\n").trim();
}

// ---------------------- workflow runner (fixed) -------------------

async function runWorkflowMessage(opts: {
  workflowId: string;
  sessionId: string;
  userText: string;
}): Promise<string> {
  const { workflowId, sessionId, userText } = opts;

  // Optional: allow selecting a pinned workflow version
  const version = process.env.OPENAI_WORKFLOW_VERSION
    ? Number(process.env.OPENAI_WORKFLOW_VERSION)
    : undefined;

  // 1) Start run
  // @ts-ignore (types may lag SDK)
  let run = await (openai as any).workflows.runs.create({
    workflow_id: workflowId,
    session_id: sessionId,
    ...(version ? { version } : {}),
    input: { input_as_text: userText },
  });

  // 2) Poll until completion. If it ever asks for tool outputs we don't control, fail fast to fallback.
  // Built-in tools (Web Search, hosted MCP) are executed server-side and should NOT require submit_tool_outputs.
  // @ts-ignore
  while (run && run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled") {
    const ra = (run as any).required_action?.submit_tool_outputs;
    if (ra && Array.isArray(ra.tool_calls) && ra.tool_calls.length) {
      // We don't own any external tool handlers here; bail to fallback.
      throw new Error("workflow_requires_external_tool_outputs");
    }
    // @ts-ignore
    run = await (openai as any).workflows.runs.get({ run_id: run.id });
  }

  if (!run || run.status !== "completed") {
    throw new Error(`workflow_not_completed:${run?.status || "unknown"}`);
  }

  const raw = collectWorkflowOutput(run);
  return coerceTextIfJson(raw, userText).trim();
}

// ------------------------------ API ------------------------------

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
  } catch (e) {
    console.warn("[WEBHOOK] markRead error", e);
  }

  try {
    const workflowId = process.env.OPENAI_WORKFLOW_ID;
    if (!workflowId) throw new Error("Missing OPENAI_WORKFLOW_ID");

    const { conversationId, sessionId } = await getOrCreateWorkflowSession(inbound.from, workflowId);

    // Log user message (non-blocking)
    void logMessageAsync(conversationId, "user", messageBody || (isImage ? "[image]" : ""));

    let replyText: string | null = null;

    if (isImage && msg?.image?.id) {
      try {
        const { base64, mimeType } = await downloadMediaBase64(String(msg.image.id));
        replyText = await generateImageReply({ base64, mimeType, caption: messageBody });
      } catch (err) {
        console.warn("[WEBHOOK] image handling error", err);
        replyText = /[\u0600-\u06FF]/.test(messageBody || "")
          ? "تعذر قراءة الصورة حالياً."
          : "Couldn't read the image right now.";
      }
    } else {
      try {
        // ✅ Correct Workflows call—no 'model' required.
        replyText = await runWorkflowMessage({ workflowId, sessionId, userText: messageBody });
      } catch (err) {
        console.error("[WEBHOOK] Agent error, falling back:", err);
        // Stable fallback
        const result = await smartReplyNew({ phone: inbound.from, text: messageBody });
        replyText = (result?.replyText || "").trim();
        if (!replyText) {
          replyText = /[\u0600-\u06FF]/.test(messageBody || "")
            ? "البيانات غير متاحة حالياً. جرّب: price BTCUSDT."
            : "Data unavailable right now. Try: price BTCUSDT.";
        }
      }
    }

    const finalText = sanitizeNewsLinks((replyText || "").trim());
    if (finalText) {
      await sendText(inbound.from, finalText);
      void logMessageAsync(conversationId, "assistant", finalText);
    }
  } catch (error) {
    console.error("[WEBHOOK] Error:", error);
  }

  res.status(200).json({ received: true });
}

// ---------------- test-friendly injectable handler ----------------

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

    // Exact-match identity only (doesn't catch other intents)
    const isIdentity = /^(?:who\s*are\s*you\??|who\s*r\s*you\??|what\s*are\s*you\??|مين\s*انت\??|مين\s*أنت\??|مين\s*إنت\??)$/i.test(text);
    if (isIdentity) {
      const isAr = /[\u0600-\u06FF]/.test(text);
      await depSendText(inbound.from, isAr ? "مساعد ليرات" : "I'm Liirat assistant.");
      res.status(200).json({ received: true });
      return;
    }

    const conv = (await depGetConv(inbound.from)) || null;
    const convId = conv?.conversation_id ?? null;
    const messageCount = convId ? await depMsgCount(convId) : 0;

    if (messageCount === 0 || conv?.isNew) {
      const greet = /[\u0600-\u06FF]/.test(text) ? "كيف فيني ساعدك؟" : "How can I help?";
      await depSendText(inbound.from, greet);
      res.status(200).json({ received: true });
      return;
    }

    const fallback = /[\u0600-\u06FF]/.test(text) ? "حدّد الأداة أو الإطار الزمني." : "Specify the asset or timeframe.";
    await depSendText(inbound.from, fallback);
    res.status(200).json({ received: true });
  };
}
