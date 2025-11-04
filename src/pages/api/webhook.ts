// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendWhatsApp, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { openai } from "../../lib/openai";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const NEWS_RE = /(news|اقتصاد|أخبار|الاخبار|الأخبار|economic)/i;

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

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).end();
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
    const from = inbound.from;
    const text = messageBody;
    const ORIGIN =
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      (typeof req !== "undefined" && req.headers?.host ? `http://${req.headers.host}` : "http://localhost:3000");

    try {
      await markReadAndShowTyping(inbound.id);
    } catch (e) {
      console.warn("[WEBHOOK] markRead error", e);
    }

    if (req.method === "POST" && NEWS_RE.test(text || "")) {
      try {
        const u = new URL(`/api/econ-news`, ORIGIN);
        u.searchParams.set("scope", "next");      // or infer from text later
        // optional: if you extract a symbol from the text, also do: u.searchParams.set("symbol", SYMBOL);
        const j = await fetch(u.toString()).then(r=>r.json()).catch(()=>null);
        const lines = j?.lines?.length ? j.lines.join("\n")
          : (text.match(/[اأإ]ل(?:يوم|آن)/) ? "لا أحداث مهمة اليوم." : "Which region/topic (US/EU/Global, FOMC/CPI/NFP)?");
        await sendWhatsApp(from, lines);
        return res.status(200).end();
      } catch {
        await sendWhatsApp(from, "Data unavailable right now. Try later.");
        return res.status(200).end();
      }
    }

    try {
      const workflowId = process.env.OPENAI_WORKFLOW_ID;
      if (!workflowId) throw new Error("Missing OPENAI_WORKFLOW_ID");

      const { conversationId, sessionId } = await getOrCreateWorkflowSession(inbound.from, workflowId);

      // Log user message (non-blocking)
      void logMessageAsync(conversationId, "user", messageBody || (isImage ? "[image]" : ""));

      let replyText: string | null = null;
      let workflowResponse: any = null;

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
          // Hard guard: ensure Workflows is available on this SDK
          // @ts-expect-error – property exists in >=4.67
          if (!openai.workflows?.runs?.create) throw new Error("workflows_api_not_available");

          // @ts-expect-error – types present in >=4.67
          const run = await openai.workflows.runs.create({
            workflow_id: workflowId,
            session_id: sessionId,
            // Send a simple input object; your Workflow should read `input.message`
            input: { message: messageBody, from: inbound.from },
            // optional but helpful for traceability
            user: `wa_${inbound.from}`,
          });

          workflowResponse = run?.output?.response ?? run?.output?.data ?? run?.output ?? null;
          const rawOutput = collectResponseText(run);
          const finalText = coerceTextIfJson(rawOutput, messageBody).trim();
          if (!finalText) throw new Error("empty_workflow_output");
          replyText = finalText;
        } catch (err: any) {
          // If key scope or API not available, you'll see specific errors:
          // - bad_api_key_scope_use_project_key  -> wrong key type
          // - workflows_api_not_available        -> old SDK or feature unavailable
          console.error("[WEBHOOK] Agent error, falling back:", err);
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
        await sendWhatsApp(from, finalText);
        void logMessageAsync(conversationId, "assistant", finalText);
      }

      try {
        if (workflowResponse?.kind === "signal" && typeof workflowResponse?.symbol === "string") {
          const u = new URL(`/api/econ-news`, ORIGIN);
          u.searchParams.set("scope", "next");
          u.searchParams.set("symbol", workflowResponse.symbol);
          const j = await fetch(u.toString()).then(r=>r.json()).catch(()=>null);
          if (j?.lines?.length) {
            await sendWhatsApp(from, j.lines.join("\n"));
          }
        }
      } catch {}
    } catch (error) {
      console.error("[WEBHOOK] Error:", error);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Fatal error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}