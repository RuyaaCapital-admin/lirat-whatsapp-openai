// pages/api/webhook.ts
import OpenAI from "openai";
import type { NextApiRequest, NextApiResponse } from "next";
import { markReadAndShowTyping, sendWhatsApp, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

export const config = { runtime: "nodejs" };

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}
if (!process.env.OPENAI_PROJECT) {
  throw new Error("Missing OPENAI_PROJECT");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  project: process.env.OPENAI_PROJECT!,
});

console.log(
  "[BOOT] OPENAI_PROJECT =",
  process.env.OPENAI_PROJECT,
  "BASE_URL set?",
  !!process.env.OPENAI_BASE_URL,
);

type WorkflowRunsApi = {
  create: (args: {
    workflow_id: string;
    version?: string;
    inputs?: Record<string, unknown>;
  }) => Promise<{ id: string }>;
  get: (id: string) => Promise<{ id: string; status: string; outputs?: unknown }>;
};

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

function collectWorkflowOutputText(outputs: any): string {
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
    if (typeof seg !== "object") return;
    const candidates = [
      seg.output_text,
      seg.text,
      seg.value,
      seg.content,
      seg.output,
      seg.message,
      seg.response,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        pieces.push(c.trim());
        return;
      }
    }
    if (Array.isArray(seg.content)) seg.content.forEach(pushSeg);
    if (Array.isArray(seg.messages)) seg.messages.forEach(pushSeg);
    if (Array.isArray(seg.outputs)) seg.outputs.forEach(pushSeg);
    if (typeof seg.output === "object") pushSeg(seg.output);
    if (typeof seg.value === "object") pushSeg(seg.value);
  };

  if (Array.isArray(outputs)) {
    outputs.forEach((entry) => {
      if (entry && typeof entry === "object" && "output" in entry) {
        pushSeg((entry as any).output);
      } else if (entry && typeof entry === "object" && "value" in entry) {
        pushSeg((entry as any).value);
      } else {
        pushSeg(entry);
      }
    });
  } else {
    pushSeg(outputs);
  }

  return pieces.join("\n").trim();
}

function findSignalPayload(outputs: any): any {
  let result: any = null;

  const visit = (node: any) => {
    if (result || node == null) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;
    if ((node as any).kind === "signal" && typeof (node as any).symbol === "string") {
      result = node;
      return;
    }
    if ("value" in node) visit((node as any).value);
    if ("output" in node) visit((node as any).output);
    if ("response" in node) visit((node as any).response);
    if ("data" in node) visit((node as any).data);
    if ("messages" in node) visit((node as any).messages);
    if ("content" in node) visit((node as any).content);
    if ("outputs" in node) visit((node as any).outputs);
  };

  visit(outputs);
  return result;
}

function getWorkflowRunsApi(): WorkflowRunsApi {
  const runs = (client as any)?.workflows?.runs;
  if (!runs?.create || !runs?.get) {
    throw new Error("workflows_api_not_available");
  }
  return runs as WorkflowRunsApi;
}

async function runWorkflowWithPolling(workflowId: string, text: string) {
  const runsApi = getWorkflowRunsApi();
  const run = await runsApi.create({
    workflow_id: workflowId,
    version: "production",
    inputs: { input_as_text: text ?? "" },
  });

  let outputs: any = null;
  for (let i = 0; i < 40; i++) {
    const status = await runsApi.get(run.id);
    if (status.status === "completed") {
      outputs = (status.outputs as any) ?? {};
      break;
    }
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(`workflow_${status.status}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }

  if (!outputs) {
    throw new Error("workflow_timeout");
  }

  return outputs;
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
        const workflowId = process.env.WORKFLOW_ID ?? process.env.OPENAI_WORKFLOW_ID;
        if (!workflowId) throw new Error("Missing WORKFLOW_ID");

        const { conversationId } = await getOrCreateWorkflowSession(inbound.from, workflowId);

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
            workflowResponse = await runWorkflowWithPolling(workflowId, text);
            const rawOutput = collectWorkflowOutputText(workflowResponse);
            const finalText = coerceTextIfJson(rawOutput, messageBody).trim();
            if (!finalText) throw new Error("empty_workflow_output");
            replyText = finalText;
          } catch (err: any) {
            console.error("[WEBHOOK] Workflow error, falling back:", err);
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
          const signalPayload = findSignalPayload(workflowResponse);
          if (signalPayload?.kind === "signal" && typeof signalPayload?.symbol === "string") {
            const u = new URL(`/api/econ-news`, ORIGIN);
            u.searchParams.set("scope", "next");
            u.searchParams.set("symbol", signalPayload.symbol);
            const j = await fetch(u.toString()).then(r => r.json()).catch(() => null);
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