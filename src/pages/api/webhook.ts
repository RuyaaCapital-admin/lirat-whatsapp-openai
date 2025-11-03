// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { detectArabic } from "../../utils/formatters";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { openai } from "../../lib/openai";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const processedMessageCache = new Set<string>();
const WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID ?? "";
const WORKFLOW_VERSION = (process.env.OPENAI_WORKFLOW_VERSION ?? "production").trim() || "production";

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

function collectResponseText(run: any): string {
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
      const workflowId = WORKFLOW_ID;
      if (!workflowId) {
        throw new Error("Missing OPENAI_WORKFLOW_ID");
      }
      const workflowVersion = WORKFLOW_VERSION;
      console.info("[WEBHOOK] Using workflow", { workflowId, workflowVersion });

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
          replyText = detectArabic(messageBody || "")
            ? "تعذر قراءة الصورة حالياً."
            : "Couldn't read the image right now.";
        }
      } else {
        try {
          const workflowsApi: any = (openai as any)?.workflows;
          if (!workflowsApi?.runs?.create) {
            throw new Error("workflows_api_not_available");
          }

          const run = await workflowsApi.runs.create({
            workflow_id: workflowId,
            workflow_version: workflowVersion,
            session_id: sessionId,
            input: { message: messageBody, from: inbound.from },
            user: `wa_${inbound.from}`,
          });

          const rawOutput = collectResponseText(run);
          const finalText = coerceTextIfJson(rawOutput, messageBody).trim();
          if (!finalText) {
            throw new Error("empty_workflow_output");
          }
          replyText = finalText;
        } catch (err) {
          console.error("[WEBHOOK] Agent error, falling back:", err);
          const result = await smartReplyNew({ phone: inbound.from, text: messageBody });
          replyText = (result?.replyText || "").trim();
          if (!replyText) {
            replyText = detectArabic(messageBody || "")
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