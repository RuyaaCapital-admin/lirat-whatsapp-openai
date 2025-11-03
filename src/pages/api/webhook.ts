// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const processedMessageCache = new Set<string>();

type InboundMessage = { id: string; from: string; text: string };

// ----------------------------- REST API Workflow Helpers -----------------------------

function requireEnv() {
  const key = process.env.OPENAI_API_KEY || "";
  const wf = process.env.OPENAI_WORKFLOW_ID || "";
  if (!key) throw new Error("OPENAI_API_KEY missing");
  if (!key.startsWith("sk-proj-")) throw new Error("bad_api_key_scope_use_project_key");
  if (!wf) throw new Error("OPENAI_WORKFLOW_ID missing");
  if (!wf.startsWith("wf_")) throw new Error("bad_workflow_id");
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWorkflowAndGetText(input: string, sessionId?: string): Promise<string> {
  requireEnv();

  const apiKey = process.env.OPENAI_API_KEY!;
  const wfId = process.env.OPENAI_WORKFLOW_ID!;

  // Create run
  const create = await fetch("https://api.openai.com/v1/workflows/runs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "workflows=v1",
    },
    body: JSON.stringify({ workflow_id: wfId, session_id: sessionId, input }),
  });

  if (!create.ok) {
    const errorText = await create.text();
    throw new Error(`wf_create_failed_${create.status}: ${errorText}`);
  }

  const created = await create.json();
  const runId = created.id;

  // Poll
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await fetch(`https://api.openai.com/v1/workflows/runs/${runId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "workflows=v1",
      },
    });

    if (!r.ok) {
      const errorText = await r.text();
      throw new Error(`wf_get_failed_${r.status}: ${errorText}`);
    }

    const data = await r.json();

    if (data.status === "completed") return extractTextFromWorkflow(data);

    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error(`workflow_${data.status}`);
    }

    await sleep(500);
  }

  throw new Error("workflow_timeout");
}

// Robust extractor for various workflow outputs
function extractTextFromWorkflow(run: any): string {
  const chunks: string[] = [];

  const push = (v: any) => {
    if (!v) return;
    if (typeof v === "string") {
      chunks.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === "object") {
      if (typeof v.output_text === "string") chunks.push(v.output_text);
      if (typeof v.text === "string") chunks.push(v.text);
      if (Array.isArray(v.content)) v.content.forEach(push);
      if (v.output) push(v.output);
      if (v.value) push(v.value);
    }
  };

  push(run);

  return chunks.join("\n").trim();
}

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
          // ✅ Use REST API instead of SDK
          const wfText = await runWorkflowAndGetText(messageBody, sessionId);
          const final = coerceTextIfJson(wfText, messageBody).trim();
          replyText = final || wfText || null;
          if (!replyText) throw new Error("empty_workflow_output");
        } catch (err) {
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