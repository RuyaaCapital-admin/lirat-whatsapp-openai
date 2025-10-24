// src/pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import { openai } from "../../lib/openai";
import type { HistoryMessage } from "../../lib/memory";
import { memory, fallbackUnavailableMessage } from "../../lib/memory";
import {
  fetchHistoryFromSupabase,
  logSupabaseMessage,
  reserveMessageProcessing,
  isSupabaseEnabled,
} from "../../lib/supabase";
import { createSmartReply } from "../../lib/whatsappAgent";
import { TOOL_SCHEMAS } from "../../lib/toolSchemas";
import SYSTEM_PROMPT from "../../lib/systemPrompt";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  about_liirat_knowledge,
  search_web_news,
} from "../../tools/agentTools";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const toolHandlers = {
  async get_price(args: Record<string, unknown>) {
    const symbol = String(args.symbol ?? "").trim();
    const timeframe = typeof args.timeframe === "string" ? args.timeframe : undefined;
    if (!symbol) throw new Error("missing_symbol");
    return get_price(symbol, timeframe);
  },
  async get_ohlc(args: Record<string, unknown>) {
    const symbol = String(args.symbol ?? "").trim();
    const timeframe = String(args.timeframe ?? "").trim();
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    if (!symbol || !timeframe) throw new Error("missing_symbol_or_timeframe");
    return get_ohlc(symbol, timeframe, limit);
  },
  async compute_trading_signal(args: Record<string, unknown>) {
    const symbol = String(args.symbol ?? "").trim();
    const timeframe = String(args.timeframe ?? "").trim();
    if (!symbol || !timeframe) throw new Error("missing_symbol_or_timeframe");
    return compute_trading_signal(symbol, timeframe);
  },
  async about_liirat_knowledge(args: Record<string, unknown>) {
    const query = String(args.query ?? "").trim();
    const lang = typeof args.lang === "string" ? args.lang : undefined;
    if (!query) throw new Error("missing_query");
    return about_liirat_knowledge(query, lang);
  },
  async search_web_news(args: Record<string, unknown>) {
    const query = String(args.query ?? "").trim();
    const lang = typeof args.lang === "string" ? args.lang : undefined;
    const count = typeof args.count === "number" ? args.count : undefined;
    if (!query) throw new Error("missing_query");
    return search_web_news(query, lang, count ?? 3);
  },
};

const smartReply = createSmartReply({
  chat: {
    create: (params) => openai.chat.completions.create(params) as Promise<ChatCompletion>,
  },
  toolSchemas: TOOL_SCHEMAS,
  toolHandlers,
  systemPrompt: SYSTEM_PROMPT,
  memory,
  model: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
  temperature: 0,
  maxTokens: 700,
});

type WebhookMessage = {
  id: string;
  from: string;
  text: string;
  timestamp?: string;
  contactName?: string;
};

function extractMessage(payload: any): WebhookMessage | null {
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null;
    const contact = value?.contacts?.[0];
    return {
      id: message.id,
      from: message.from,
      text: message.text?.body ?? "",
      timestamp: message.timestamp,
      contactName: contact?.profile?.name,
    };
  } catch (error) {
    console.warn("[WEBHOOK] extract message failed", error);
    return null;
  }
}

function polite(reply: string, userText: string) {
  if (/[^\w](حمار|غبي|يا حيوان|fuck|idiot)/i.test(userText)) {
    return "أنا هنا للمساعدة. دعنا نركّز على سؤالك لنقدّم لك أفضل إجابة.";
  }
  return reply;
}

function detectLanguage(text: string) {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

async function handleMessage(message: WebhookMessage, history: HistoryMessage[]) {
  const text = message.text.trim();
  if (!text) {
    return "";
  }

  const reply = await smartReply({ userId: message.from, text, history });
  return polite(reply, text);
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

    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  if (!req.body?.entry?.[0]?.changes?.[0]?.value?.messages) {
    res.status(200).json({ received: true });
    return;
  }

  const message = extractMessage(req.body);
  if (!message) {
    res.status(200).json({ received: true });
    return;
  }

  let shouldProcess = true;
  try {
    shouldProcess = await reserveMessageProcessing(message.id);
  } catch (error) {
    console.warn("[WEBHOOK] reserve processing failed", error);
    shouldProcess = true;
  }

  res.status(200).json({ received: true });

  if (!shouldProcess) {
    return;
  }

  void (async () => {
    let sent = false;
    let finalReply = "";
    const text = message.text || "";
    const lang = detectLanguage(text);
    const supabaseActive = isSupabaseEnabled();

    try {
      try {
        await markReadAndShowTyping(message.id);
      } catch (error) {
        console.warn("[WEBHOOK] markReadAndShowTyping failed", error);
      }

      const historyResult = supabaseActive
        ? await fetchHistoryFromSupabase(message.from, 15)
        : { messages: [] as HistoryMessage[], lastInboundAt: null };
      const history = historyResult.messages;

      if (supabaseActive) {
        void logSupabaseMessage({
          waId: message.from,
          role: "user",
          content: text,
          lang,
          messageId: message.id,
          contactName: message.contactName,
        });
      }

      const reply = await handleMessage(message, history);
      const baseReply = reply || fallbackUnavailableMessage(text);
      finalReply = baseReply.trim();

      if (finalReply) {
        console.info("[WEBHOOK] sending reply", {
          to: message.from,
          preview: finalReply.slice(0, 120),
        });
        await sendText(message.from, finalReply);
        sent = true;
        if (supabaseActive) {
          void logSupabaseMessage({
            waId: message.from,
            role: "assistant",
            content: finalReply,
            lang,
          });
        }
      }
    } catch (error) {
      console.error("[WEBHOOK] processing error", error);
      const fallback = fallbackUnavailableMessage(text);
      if (!sent && fallback) {
        try {
          await sendText(message.from, fallback);
          sent = true;
          if (supabaseActive) {
            void logSupabaseMessage({
              waId: message.from,
              role: "assistant",
              content: fallback,
              lang,
            });
          }
        } catch (sendError) {
          console.error("[WEBHOOK] failed to send fallback", sendError);
        }
      }
    }
  })();
}
