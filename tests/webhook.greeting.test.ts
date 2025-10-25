import assert from "node:assert";
import type { NextApiRequest, NextApiResponse } from "next";

import { createWebhookHandler } from "../src/pages/api/webhook";

function makeRes() {
  return {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  } as NextApiResponse & { statusCode: number; body: any };
}

function makePayload(text: string, from = "97155", id = "wamid-test") {
  return {
    entry: [
      {
        id: "entry",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "User" }, wa_id: from }],
              messages: [
                {
                  id,
                  from,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function runCase({
  text,
  assistantReply,
  isNew,
  useDefaultAssistant = false,
  id = Math.random().toString(36).slice(2),
}: {
  text: string;
  assistantReply: string;
  isNew: boolean;
  useDefaultAssistant?: boolean;
  id?: string;
}) {
  let sentBody = "";
  const handler = createWebhookHandler({
    markReadAndShowTyping: async () => {},
    sendText: async (_to, body) => {
      sentBody = body;
    },
    findOrCreateConversation: async () => ({ id: "conv-1", isNew }),
    insertMessage: async () => {},
    fetchConversationMessages: async () => [],
    ...(useDefaultAssistant
      ? {}
      : {
          buildAssistantReply: async (
            _text: string,
            _history: Array<{ role: "user" | "assistant"; content: string }>,
            lang: "ar" | "en",
            identity: boolean,
          ) => (identity ? (lang === "ar" ? "مساعد ليرات" : "Liirat assistant.") : assistantReply),
        }),
  });
  const req = {
    method: "POST",
    body: makePayload(text, "97155", id),
  } as NextApiRequest;
  const res = makeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { received: true });
  return sentBody;
}

async function testReturningUserNoGreeting() {
  const body = await runCase({ text: "سعر الفضة", assistantReply: "- Time (UTC): 2025-10-24 17:44\n- Symbol: XAGUSD\n- Price: 48.6385", isNew: false });
  assert.ok(!body.startsWith("مرحباً"), "returning user should not get greeting");
  assert.ok(body.startsWith("- Time (UTC):"), "body should start with time line");
}

async function testIdentity() {
  const body = await runCase({ text: "مين انت", assistantReply: "ignored", isNew: false });
  assert.strictEqual(body.trim(), "مساعد ليرات");
}

async function testFirstContactGreeting() {
  const body = await runCase({ text: "مرحبا", assistantReply: "شكراً لتواصلك", isNew: true });
  assert.ok(body.startsWith("مرحباً، أنا مساعد ليرات"));
  assert.ok(body.includes("\nشكراً"));
}

export async function runWebhookGreetingTests() {
  await testReturningUserNoGreeting();
  await testIdentity();
  await testFirstContactGreeting();
  console.log("webhook greeting tests passed");
}
