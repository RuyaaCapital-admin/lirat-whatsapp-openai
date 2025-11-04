// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { markReadAndShowTyping, sendWhatsApp, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";

export const config = { runtime: "nodejs" } as const;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const openAIConfig: { apiKey: string; project?: string } = {
  apiKey: process.env.OPENAI_API_KEY,
};

if (process.env.OPENAI_PROJECT) {
  openAIConfig.project = process.env.OPENAI_PROJECT;
}

const client = new OpenAI(openAIConfig);
console.log("[WEBHOOK] OpenAI project:", process.env.OPENAI_PROJECT ?? "(none)");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const NEWS_RE = /(news|economic\s*calendar|economy|calendar|econ)|أخبار|الاخبار|الأخبار|اقتصاد(?:ي|ية)?|الاقتصاد/iu;

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
    const origin =
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      (typeof req !== "undefined" && req.headers?.host ? `http://${req.headers.host}` : "http://localhost:3000");

    try {
      await markReadAndShowTyping(inbound.id);
    } catch (e) {
      console.warn("[WEBHOOK] markRead error", e);
    }

    if (req.method === "POST" && NEWS_RE.test(text || "")) {
      const wantsToday = /(?:اليوم|today)/i.test(text) || /[اأإ]ل(?:يوم|آن)/.test(text);
      const scope = wantsToday ? "today" : "next";
      try {
        const url = new URL(`/api/econ-news`, origin);
        url.searchParams.set("scope", scope);
        const response = await fetch(url.toString());
        const payload = response.ok ? await response.json().catch(() => null) : null;
        const lines = Array.isArray(payload?.lines) ? payload.lines : [];
        await sendWhatsApp(
          from,
          lines.length
            ? lines.join("\n")
            : wantsToday
            ? "لا أحداث مهمة اليوم."
            : "Which region/topic (US/EU/Global, FOMC/CPI/NFP)?",
        );
        return res.status(200).end();
      } catch (err) {
        console.warn("[WEBHOOK] econ-news fetch failed", err);
        await sendWhatsApp(from, "Data unavailable right now. Try later.");
        return res.status(200).end();
      }
    }

    try {
      const workflowId = process.env.OPENAI_WORKFLOW_ID;
      if (!workflowId) throw new Error("Missing OPENAI_WORKFLOW_ID");

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
            const run = await client.workflows.runs.create({
              workflow_id: workflowId,
              version: "production",
              inputs: { input: messageBody },
            });

            let workflowRun = run;
            const terminalStatuses = new Set(["completed", "failed", "cancelled", "expired"]);
            const maxPolls = 30;

            for (let attempt = 0; attempt < maxPolls; attempt += 1) {
              const status = workflowRun?.status ?? "";
              if (terminalStatuses.has(status)) break;
              await new Promise((resolve) => setTimeout(resolve, 1000));
              workflowRun = await client.workflows.runs.get(workflowRun.id);
            }

            const finalStatus = workflowRun?.status ?? "unknown";
            if (finalStatus !== "completed") {
              throw new Error(`workflow_run_not_completed:${finalStatus}`);
            }

            const outputs = (workflowRun?.outputs ?? {}) as any;
            workflowResponse = outputs?.response ?? outputs;

            const textCandidates: Array<string | undefined> = [];
            if (typeof outputs?.text === "string") textCandidates.push(outputs.text);
            if (typeof outputs?.response?.text === "string") textCandidates.push(outputs.response.text);
            if (typeof outputs?.response === "string") textCandidates.push(outputs.response);
            if (typeof outputs === "string") textCandidates.push(outputs);

            if (Array.isArray(outputs)) {
              for (const item of outputs) {
                if (typeof item === "string") textCandidates.push(item);
                else if (item && typeof item === "object" && typeof item.text === "string") {
                  textCandidates.push(item.text);
                }
              }
            } else if (outputs && typeof outputs === "object") {
              for (const value of Object.values(outputs)) {
                if (typeof value === "string") {
                  textCandidates.push(value);
                } else if (value && typeof value === "object" && typeof (value as any).text === "string") {
                  textCandidates.push((value as any).text);
                }
              }
            }

            const outputText = textCandidates.find((candidate) => typeof candidate === "string" && candidate.trim());
            if (!outputText) {
              throw new Error("empty_workflow_output");
            }

            const finalText = coerceTextIfJson(outputText, messageBody).trim();
            if (!finalText) throw new Error("empty_workflow_output");
            replyText = finalText;
          } catch (err: any) {
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
            const url = new URL(`/api/econ-news`, origin);
            url.searchParams.set("scope", "next");
            url.searchParams.set("symbol", String(workflowResponse.symbol));
            const response = await fetch(url.toString());
            const payload = response.ok ? await response.json().catch(() => null) : null;
            const lines = Array.isArray(payload?.lines) ? payload.lines : [];
            if (lines.length) {
              await sendWhatsApp(from, lines.join("\n"));
            }
          }
        } catch (error) {
          console.warn("[WEBHOOK] post-signal econ fetch error", error);
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