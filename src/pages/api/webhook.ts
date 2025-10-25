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

  const timestampRaw =
    typeof message.timestamp === "string" && message.timestamp.trim()
      ? Number(message.timestamp)
      : undefined;

  let contactName: string | undefined;
  if (contact?.profile?.name && typeof contact.profile.name === "string") {
    contactName = contact.profile.name;
  }

  const text = normaliseInboundText(message);

  return {
    id: idCandidate,
    from: fromCandidate,
    text,
    contactName,
    timestamp: Number.isFinite(timestampRaw) ? timestampRaw : undefined,
  };
}

function normaliseInboundText(message: any): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const textBody = message?.text?.body;
  if (typeof textBody === "string" && textBody.trim()) {
    return textBody;
  }

  const buttonText = message?.button?.text;
  if (typeof buttonText === "string" && buttonText.trim()) {
    return buttonText;
  }

  const interactive = message?.interactive;
  if (interactive && typeof interactive === "object") {
    const type = interactive.type;
    if (type === "button_reply") {
      const title = interactive?.button_reply?.title;
      if (typeof title === "string" && title.trim()) {
        return title;
      }
    }
    if (type === "list_reply") {
      const title = interactive?.list_reply?.title;
      if (typeof title === "string" && title.trim()) {
        return title;
      }
      const description = interactive?.list_reply?.description;
      if (typeof description === "string" && description.trim()) {
        return description;
      }
    }
  }

  const stickerEmoji = message?.sticker?.emoji;
  if (typeof stickerEmoji === "string" && stickerEmoji.trim()) {
    return stickerEmoji;
  }

  const mediaCaption =
    message?.image?.caption ||
    message?.video?.caption ||
    message?.audio?.caption ||
    message?.document?.caption;
  if (typeof mediaCaption === "string" && mediaCaption.trim()) {
    return mediaCaption;
  }

  if (typeof textBody === "string") {
    return textBody;
  }

  if (typeof message.type === "string" && message.type.trim()) {
    return `[${message.type.trim()}]`;
  }

  return "";
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

