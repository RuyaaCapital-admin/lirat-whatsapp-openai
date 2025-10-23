import type { VercelRequest, VercelResponse } from "@vercel/node";
import { alreadyHandled } from "../src/idempotency";
import { wabaText, wabaTyping } from "../src/waba";
import { runAgent } from "../lib/agent";

const FALLBACK_REPLY = "تعذر معالجة الطلب الآن. حاول لاحقًا.";
const MAX_REPLY_LENGTH = 4096;

export const config = {
  runtime: "nodejs22.x",
};

type QueryValue = string | string[] | undefined;

type ProcessDeps = {
  typing: (phone: string, on: boolean) => Promise<void>;
  text: (phone: string, message: string) => Promise<void>;
  agent: (prompt: string) => Promise<string>;
};

const defaultDeps: ProcessDeps = {
  typing: wabaTyping,
  text: wabaText,
  agent: runAgent,
};

export async function processWebhookPayload(
  payload: unknown,
  deps: ProcessDeps = defaultDeps,
): Promise<void> {
  const entry = (payload as any)?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];
  const id: unknown = message?.id;
  const from: unknown = message?.from;
  const text: unknown = message?.text?.body;

  if (typeof id !== "string" || typeof from !== "string" || typeof text !== "string") {
    return;
  }

  if (!text.trim()) {
    return;
  }

  if (alreadyHandled(id)) {
    return;
  }

  await notifyTyping(deps.typing, from, true);

  let reply = "";
  try {
    reply = await deps.agent(text.trim());
  } catch (err) {
    console.error("agent_error", err);
    reply = FALLBACK_REPLY;
  }

  if (!reply) {
    reply = FALLBACK_REPLY;
  }

  try {
    await deps.text(from, reply.slice(0, MAX_REPLY_LENGTH));
  } catch (err) {
    console.error("message_send_error", err);
  } finally {
    await notifyTyping(deps.typing, from, false);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const mode = getQueryParam(req.query["hub.mode"]);
    const token = getQueryParam(req.query["hub.verify_token"]);
    const challenge = getQueryParam(req.query["hub.challenge"]);

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN && challenge) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
    return;
  }

  if (req.method === "POST") {
    const payload = await readBody(req);
    res.status(200).end();
    processWebhookPayload(payload).catch((err) => {
      console.error("webhook_error", err);
    });
    return;
  }

  res.status(405).end();
}

function getQueryParam(value: QueryValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

async function notifyTyping(
  typingFn: ProcessDeps["typing"],
  phone: string,
  on: boolean,
): Promise<void> {
  try {
    await typingFn(phone, on);
  } catch (err) {
    console.error(on ? "typing_on_error" : "typing_off_error", err);
  }
}

async function readBody(req: VercelRequest): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch (err) {
        console.error("body_parse_error", err);
        return {};
      }
    }
    return req.body;
  }

  req.setEncoding?.("utf8");
  let data = "";
  for await (const chunk of req) {
    data += chunk;
  }
  if (!data) {
    return {};
  }
  try {
    return JSON.parse(data);
  } catch (err) {
    console.error("body_parse_error", err);
    return {};
  }
}
