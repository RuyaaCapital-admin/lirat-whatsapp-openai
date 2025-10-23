import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../src/env";
import { alreadyHandled } from "../src/idempotency";
import { wabaText, wabaTyping } from "../src/waba";
import { runAgent } from "../lib/agent";

export const MAX_REPLY_LENGTH = 4096;
export const FALLBACK_MESSAGE = "تعذر معالجة الطلب الآن. حاول لاحقًا.";

type WebhookMessage = {
  id: string;
  from: string;
  text: string;
};

type WebhookDeps = {
  typing: (phone: string, on: boolean) => Promise<void> | void;
  text: (phone: string, message: string) => Promise<void> | void;
  agent: (prompt: string) => Promise<string> | string;
};

const defaultDeps: WebhookDeps = {
  typing: wabaTyping,
  text: wabaText,
  agent: runAgent,
};

function firstTextMessage(payload: any): WebhookMessage | null {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "messages") continue;
      const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        if (message.type !== "text") continue;
        const text = message?.text?.body;
        if (typeof text !== "string") continue;
        const id = typeof message.id === "string" ? message.id : "";
        const from = typeof message.from === "string" ? message.from : "";
        if (!id || !from) continue;
        return { id, from, text };
      }
    }
  }
  return null;
}

function normaliseQueryValue(value: undefined | string | string[]): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function processWebhookPayload(
  payload: unknown,
  deps: WebhookDeps = defaultDeps
): Promise<boolean> {
  const message = firstTextMessage(payload);
  if (!message) return false;

  const prompt = message.text.trim();
  if (!prompt) return false;

  if (!message.id || alreadyHandled(message.id)) {
    return false;
  }

  try {
    await deps.typing(message.from, true);
  } catch (err) {
    console.warn("[webhook] failed to start typing", err);
  }

  let reply: string;
  try {
    const output = await deps.agent(prompt);
    reply = typeof output === "string" && output.trim() ? output : FALLBACK_MESSAGE;
  } catch (err) {
    console.error("[webhook] agent failure", err);
    reply = FALLBACK_MESSAGE;
  }

  if (reply.length > MAX_REPLY_LENGTH) {
    reply = reply.slice(0, MAX_REPLY_LENGTH);
  }

  let delivered = false;
  try {
    await deps.text(message.from, reply);
    delivered = true;
  } catch (err) {
    console.error("[webhook] failed to send message", err);
  }

  try {
    await deps.typing(message.from, false);
  } catch (err) {
    console.warn("[webhook] failed to stop typing", err);
  }

  return delivered;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const mode = normaliseQueryValue(req.query["hub.mode"]);
    const token = normaliseQueryValue(req.query["hub.verify_token"]);
    const challenge = normaliseQueryValue(req.query["hub.challenge"]);

    if (mode === "subscribe" && token === env.VERIFY_TOKEN && typeof challenge === "string") {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    try {
      const handled = await processWebhookPayload(req.body);
      return res.status(200).json({ received: handled });
    } catch (err) {
      console.error("[webhook] unexpected error", err);
      return res.status(200).json({ received: false });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
