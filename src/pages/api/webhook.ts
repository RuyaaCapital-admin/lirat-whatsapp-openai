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

  if (lang === "ar") {
    return [
      `الوقت (UTC): ${time}`,
      `الرمز: ${symbol}`,
      `الإطار الزمني: ${timeframe}`,
      `الإشارة: ${decision}`,
      `السبب: ${reasonText}`,
    ].join("\n");
  }

  return [`time (UTC): ${time}`, `symbol: ${symbol}`, `timeframe: ${timeframe}`, `signal: ${decision}`, `reason: ${reasonText}`].join("\n");
}

function coerceTextIfJson(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      return fallback;
    }
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

// ---------------------- workflow runner (FIXED - uses beta.workflows) -------------------

async function runWorkflowMessage(opts: {
  workflowId: string;
  sessionId: string;
  userText: string;
}): Promise<string> {
  const { workflowId, sessionId, userText } = opts;

  // Try multiple API paths: beta.workflows, workflows, or direct API call
  const workflowsAPI = (openai as any).beta?.workflows || (openai as any).workflows;

  if (!workflowsAPI || !workflowsAPI.runs) {
    // If workflows API not available, throw to trigger fallback
    throw new Error("workflows_api_not_available");
  }

  // Optional: allow selecting a pinned workflow version
  const version = process.env.OPENAI_WORKFLOW_VERSION
    ? Number(process.env.OPENAI_WORKFLOW_VERSION)
    : undefined;

  try {
    // 1) Start run - try createAndPoll first (if available), then fallback to create + poll
    let run: any;

    if (workflowsAPI.runs?.createAndPoll) {
      // Use createAndPoll if available (newer SDK versions)
      run = await workflowsAPI.runs.createAndPoll({
        workflow_id: workflowId,
        session_id: sessionId,
        ...(version ? { version } : {}),
        input: { input_as_text: userText },
      });
    } else if (workflowsAPI.runs?.create && workflowsAPI.runs?.get) {
      // Fallback: create + manual polling
      run = await workflowsAPI.runs.create({
        workflow_id: workflowId,
        session_id: sessionId,
        ...(version ? { version } : {}),
        input: { input_as_text: userText },
      });

      // Poll until completion
      const start = Date.now();
      const timeout = 25000; // 25 seconds max

      while (run && !["completed", "failed", "cancelled"].includes(run.status)) {
        if (Date.now() - start > timeout) {
          throw new Error("workflow_timeout");
        }

        const ra = (run as any).required_action?.submit_tool_outputs;
        if (ra && Array.isArray(ra.tool_calls) && ra.tool_calls.length) {
          // We don't own any external tool handlers here; bail to fallback.
          throw new Error("workflow_requires_external_tool_outputs");
        }

        // Wait before next poll
        await new Promise((r) => setTimeout(r, 600));

        // Get updated run status
        run = await workflowsAPI.runs.get({ run_id: run.id });
      }
    } else {
      throw new Error("workflows_api_methods_not_available");
    }

    if (!run || run.status !== "completed") {
      throw new Error(`workflow_not_completed:${run?.status || "unknown"}`);
    }

    const raw = collectWorkflowOutput(run);
    return coerceTextIfJson(raw, userText).trim();
  } catch (error: any) {
    // Re-throw with more context
    if (error?.message?.includes("workflow")) {
      throw error;
    }
    throw new Error(`workflow_execution_error: ${error?.message || String(error)}`);
  }
}

// ------------------------------ API ------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[WEBHOOK] Verification successful");
      return res.status(200).send(challenge);
    }
    console.warn("[WEBHOOK] Verification failed");
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const payload = req.body;
    const inbound = extractMessage(payload);

    if (!inbound.from || !inbound.text) {
      return res.status(200).json({ received: true });
    }

    const messageKey = `${inbound.from}:${inbound.id}`;
    if (processedMessageCache.has(messageKey)) {
      console.log("[WEBHOOK] Duplicate message ignored:", messageKey);
      return res.status(200).json({ received: true });
    }
    processedMessageCache.add(messageKey);
    setTimeout(() => processedMessageCache.delete(messageKey), 60000);

    const messageBody = inbound.text.trim();
    if (!messageBody) {
      return res.status(200).json({ received: true });
    }

    const isImage = messageBody === "[image]";
    const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

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

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Fatal error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}