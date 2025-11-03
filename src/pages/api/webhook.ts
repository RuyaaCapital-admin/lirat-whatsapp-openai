// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { Agent, Runner, hostedMcpTool, setDefaultOpenAIClient, webSearchTool } from "@openai/agents";
import { z } from "zod";
import { markReadAndShowTyping, sendText, downloadMediaBase64 } from "../../lib/waba";
import { sanitizeNewsLinks } from "../../utils/replySanitizer";
import { detectArabic } from "../../utils/formatters";
import { getOrCreateWorkflowSession, logMessageAsync } from "../../lib/sessionManager";
import { openai } from "../../lib/openai";
import { smartReply as smartReplyNew } from "../../lib/smartReplyNew";
import generateImageReply from "../../lib/imageReply";
import SYSTEM_PROMPT from "../../lib/systemPrompt";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const processedMessageCache = new Set<string>();

setDefaultOpenAIClient(openai as any);

const AGENT_SESSION_SCOPE = process.env.OPENAI_WORKFLOW_ID || "liirat_whatsapp_agent";
const TIME_CONNECTOR_ID = process.env.OPENAI_MCP_TIME_CONNECTOR_ID?.trim() || null;
const TIME_SERVER_URL = process.env.OPENAI_MCP_TIME_SERVER_URL?.trim() || null;
const TIME_SERVER_AUTH = process.env.OPENAI_MCP_TIME_AUTHORIZATION?.trim() || null;

const SignalSchema = z
  .object({
    symbol: z.string(),
    timeframe: z.string(),
    timeUtc: z.string(),
    decision: z.enum(["BUY", "SELL", "NEUTRAL"]),
    reason: z.string(),
    entry: z.union([z.number(), z.string()]).nullable(),
    sl: z.union([z.number(), z.string()]).nullable(),
    tp1: z.union([z.number(), z.string()]).nullable(),
    tp2: z.union([z.number(), z.string()]).nullable(),
  })
  .strict();

const NewsItemSchema = z
  .object({
    title: z.string(),
    url: z.string().url(),
    summary: z.string().nullable(),
    publishedAt: z.string().nullable(),
  })
  .strict();

const NewsSchema = z
  .object({
    items: z.array(NewsItemSchema).min(1),
  })
  .strict();

const LiiratAiSchema = z
  .object({
    kind: z.enum(["text", "signal", "news"]),
    text: z.string().nullable(),
    symbol: z.string().nullable(),
    signal: SignalSchema.nullable(),
    news: NewsSchema.nullable(),
    language: z.enum(["ar", "en"]).nullable(),
  })
  .strict();

type LiiratAiOutput = z.infer<typeof LiiratAiSchema>;

const webSearch = webSearchTool({
  filters: { allowedDomains: ["reuters.com"] },
  searchContextSize: "medium",
});

const timeNow = (() => {
  if (TIME_CONNECTOR_ID && TIME_SERVER_URL) {
    console.warn(
      "[WEBHOOK] Both OPENAI_MCP_TIME_CONNECTOR_ID and OPENAI_MCP_TIME_SERVER_URL are set. Using connector ID and ignoring server URL.",
    );
  }
  if (TIME_CONNECTOR_ID) {
    return hostedMcpTool({
      serverLabel: "time-now",
      connectorId: TIME_CONNECTOR_ID,
    });
  }
  if (TIME_SERVER_URL) {
    return hostedMcpTool({
      serverLabel: "time-now",
      serverUrl: TIME_SERVER_URL,
      ...(TIME_SERVER_AUTH ? { authorization: TIME_SERVER_AUTH } : {}),
    });
  }
  console.info("[WEBHOOK] Time MCP tool disabled: no OPENAI_MCP_TIME_CONNECTOR_ID or OPENAI_MCP_TIME_SERVER_URL set.");
  return null;
})();

const liiratTools = timeNow ? [webSearch, timeNow] : [webSearch];

const LIIRAT_AGENT_INSTRUCTIONS = `${SYSTEM_PROMPT}

When you finish a task, emit your final answer strictly as JSON matching this schema:
{
  "kind": "text" | "signal" | "news",
  "text"?: string,
  "symbol"?: string,
  "signal"?: {
    "symbol": string,
    "timeframe": string,
    "timeUtc": string,
    "decision": "BUY" | "SELL" | "NEUTRAL",
    "reason": string,
    "entry"?: number | string | null,
    "sl"?: number | string | null,
    "tp1"?: number | string | null,
    "tp2"?: number | string | null
  },
  "news"?: {
    "items": Array<{
      "title": string,
      "url": string,
      "summary"?: string,
      "publishedAt"?: string
    }>
  },
  "language"?: "ar" | "en"
}

Rules:
- Mirror the user's language; set language to "ar" or "en".
- Use kind "signal" only when you have a full structured trading signal.
- Use kind "news" only for Reuters search updates (max 3 most relevant links).
- Use kind "text" for any other response and populate text.
- Always populate signal.symbol/timeframe/timeUtc/decision/reason when kind is "signal".
- Keep Reuters URLs unchanged; never include other domains.
- Prefer ISO-like timestamps (YYYY-MM-DD HH:MM) for timeUtc.
- Any field that does not apply MUST be present with the value null (do not omit fields).
`;

const liiratAi = new Agent({
  name: "Liirat AI",
  instructions: LIIRAT_AGENT_INSTRUCTIONS,
  model: "gpt-5-nano",
  tools: liiratTools,
  outputType: LiiratAiSchema,
});

const FORMATTER_INSTRUCTIONS = `You format Liirat agent structured outputs for WhatsApp.
You receive the user's latest message and a JSON payload with keys: kind, text, symbol, signal, news, language.

Formatting rules:
- Output plain text only. Never emit JSON, quotes, markdown, or explanations.
- Mirror the language field if provided ("ar" for Arabic, otherwise default to English). If the field is missing, infer from the user message.
- When kind = "news":
  • Return one line per item as "• <title> — <url>". If a summary exists, append " — <summary>" in the same line.
  • List at most three items.
- When kind = "signal":
  • Produce exactly seven lines in this order:
    1) time (UTC): {timeUtc}
    2) symbol: {symbol}
    3) timeframe: {timeframe}
    4) SIGNAL: {decision} — Reason: {reason}
    5) Entry: {entry or "-"}
    6) SL: {sl or "-"}
    7) Targets: TP1 {tp1 or "-"} | TP2 {tp2 or "-"}
- When kind = "text" or the payload is incomplete: return the text field trimmed.
- Fields may be null; treat null as missing/unused data and do not print literal "null".
- If URLs are present, keep them exactly as provided.
- Never mention schema names, tools, or internal notes.`;

const formatter = new Agent({
  name: "Liirat Formatter",
  instructions: FORMATTER_INSTRUCTIONS,
  model: "gpt-4.1-mini",
  outputType: "text",
});

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

function prepareFormatterPayload(output: LiiratAiOutput, userMessage: string): LiiratAiOutput {
  const inferredLanguage = detectArabic(userMessage) ? "ar" : "en";
  const language = output.language ?? inferredLanguage;
  const symbol = output.symbol ?? output.signal?.symbol ?? null;
  const newsItems = output.news?.items?.slice(0, 3) ?? null;

  const enriched: LiiratAiOutput = {
    ...output,
    kind: output.kind,
    text: output.text ?? (output.kind === "text" ? "" : null),
    language,
    symbol,
    news: newsItems && newsItems.length ? { items: newsItems } : null,
    signal: output.signal ?? null,
  };

  if (enriched.signal) {
    const sig = enriched.signal;
    enriched.signal = {
      ...sig,
      symbol: sig.symbol,
      timeframe: sig.timeframe,
      timeUtc: sig.timeUtc,
      decision: sig.decision,
      reason: sig.reason,
      entry: sig.entry ?? null,
      sl: sig.sl ?? null,
      tp1: sig.tp1 ?? null,
      tp2: sig.tp2 ?? null,
    };
  }

  return enriched;
}

function buildFormatterPrompt(userMessage: string, output: LiiratAiOutput): string {
  const payload = prepareFormatterPayload(output, userMessage);
  return [
    "User message:",
    userMessage || "(empty)",
    "",
    "Liirat structured output JSON:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
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
      const { conversationId, sessionId } = await getOrCreateWorkflowSession(inbound.from, AGENT_SESSION_SCOPE);

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
          const runnerConfig = inbound.from ? { groupId: `wa:${inbound.from}` } : {};
          const liiratRun = await new Runner(runnerConfig).run(liiratAi, messageBody, {
            conversationId: sessionId,
          });

          const structured = liiratRun.finalOutput;
          if (!structured) {
            throw new Error("liirat_agent_no_output");
          }

          const formatterInput = buildFormatterPrompt(messageBody, structured);
          const formatterRun = await new Runner().run(formatter, formatterInput);
          const formattedText = typeof formatterRun.finalOutput === "string" ? formatterRun.finalOutput.trim() : "";
          if (!formattedText) {
            throw new Error("formatter_empty_output");
          }
          replyText = formattedText;
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