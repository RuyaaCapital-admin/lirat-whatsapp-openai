// src/pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";

import { smartReply, type SmartReplyOutput } from "../../lib/smartReply";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import { getOrCreateConversation, saveMessage } from "../../lib/supabase";
import { detectLanguage, normaliseDigits, type LanguageCode } from "../../utils/webhookHelpers";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN ?? "";

const INTERNAL_ERROR_FALLBACK: Record<LanguageCode, string> = {
  ar: "عذراً، حدث خطأ داخلي. من فضلك أعد المحاولة.",
  en: "Sorry, there was an internal error. Please try again.",
};

type InboundMessage = {
  id: string;
  from: string;
  text: string;
  contactName?: string;
  timestamp?: number;
};

export interface WebhookDeps {
  smartReply: typeof smartReply;
  markReadAndShowTyping: typeof markReadAndShowTyping;
  sendText: typeof sendText;
  getOrCreateConversation: typeof getOrCreateConversation;
  saveMessage: typeof saveMessage;
}

const processedMessageCache = new Set<string>();

function extractMessage(payload: any): InboundMessage | null {
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message || typeof message.id !== "string" || typeof message.from !== "string") {
      return null;
    }
    const timestamp = typeof message.timestamp === "string" ? Number(message.timestamp) : undefined;
    const textBody = typeof message.text?.body === "string" ? message.text.body : "";
    let contactName: string | undefined;
    const contact = Array.isArray(value?.contacts) ? value.contacts[0] : undefined;
    if (contact?.profile?.name && typeof contact.profile.name === "string") {
      contactName = contact.profile.name;
    }
    return {
      id: message.id,
      from: message.from,
      text: textBody,
      contactName,
      timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
    };
  } catch (error) {
    console.error("[WEBHOOK] extract error", error);
    return null;
  }
}

function chooseLanguage(message: InboundMessage): LanguageCode {
  const text = normaliseDigits(message.text ?? "");
  return detectLanguage(text);
}

function formatReplyLog(text: string): string {
  return text.includes("\n") ? `\n${text}` : ` ${text}`;
}

export function createWebhookHandler(deps: WebhookDeps) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (!req.body?.entry?.[0]?.changes?.[0]?.value) {
      res.status(200).json({ received: true });
      return;
    }

    const inbound = extractMessage(req.body);
    if (!inbound) {
      console.warn("[WEBHOOK] no message parsed");
      res.status(200).json({ received: true });
      return;
    }

    if (processedMessageCache.has(inbound.id)) {
      res.status(200).json({ received: true });
      return;
    }
    processedMessageCache.add(inbound.id);

    console.log("[WEBHOOK] extracted", {
      id: inbound.id,
      from: inbound.from,
      text: inbound.text,
      contactName: inbound.contactName,
      timestamp: inbound.timestamp,
    });

    const language = chooseLanguage(inbound);

    try {
      await deps.markReadAndShowTyping(inbound.id);
    } catch (error) {
      console.error("[WEBHOOK] markReadAndShowTyping error", error);
    }

    let reply: SmartReplyOutput | null = null;
    let replyText: string;
    const startLanguage = language;

    try {
      console.log("[WEBHOOK] calling smartReply()");
      reply = await deps.smartReply({
        phone: inbound.from,
        text: inbound.text ?? "",
        contactName: inbound.contactName,
      });
      replyText = reply.replyText?.trimEnd() ?? "";
      if (!replyText) {
        replyText = INTERNAL_ERROR_FALLBACK[reply.language ?? startLanguage] ?? INTERNAL_ERROR_FALLBACK.en;
      }
      console.log("[WEBHOOK] assistant reply", formatReplyLog(replyText));
    } catch (error) {
      console.error("[WEBHOOK] smartReply error", {
        message: (error as Error)?.message,
        stack: (error as Error)?.stack,
      });
      const langForFallback = reply?.language ?? startLanguage;
      replyText = INTERNAL_ERROR_FALLBACK[langForFallback] ?? INTERNAL_ERROR_FALLBACK.en;
      console.log("[WEBHOOK] assistant reply", formatReplyLog(replyText));
    }

    const conversationId =
      reply?.conversationId ?? (await deps.getOrCreateConversation(inbound.from, inbound.contactName));

    try {
      if (conversationId) {
        await deps.saveMessage(conversationId, "user", inbound.text ?? "", { userId: inbound.from });
        await deps.saveMessage(conversationId, "assistant", replyText, { userId: "assistant" });
        console.log("[WEBHOOK] supabase save ok", { conversationId });
      } else {
        console.warn("[WEBHOOK] supabase save not ok", { reason: "no_conversation" });
      }
    } catch (error) {
      console.error("[WEBHOOK] supabase save not ok", {
        conversationId,
        error: (error as Error)?.message ?? error,
      });
    }

    try {
      await deps.sendText(inbound.from, replyText);
      console.log("[WEBHOOK] sendText ok");
      console.log("[REPLY SENT]", formatReplyLog(replyText));
    } catch (error) {
      console.error("[WEBHOOK] sendText not ok", {
        to: inbound.from,
        error: (error as Error)?.message ?? error,
      });
    }

    res.status(200).json({ received: true });
  };
}

const defaultHandler = createWebhookHandler({
  smartReply,
  markReadAndShowTyping,
  sendText,
  getOrCreateConversation,
  saveMessage,
});

export default defaultHandler;

