import assert from "node:assert";

import type { NextApiRequest, NextApiResponse } from "next";

import type { LanguageCode } from "../src/utils/webhookHelpers";

interface MockResponse extends Partial<NextApiResponse> {
  statusCode: number;
  body: any;
}

function createRes(): MockResponse {
  return {
    statusCode: 0,
    body: undefined,
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
  } as MockResponse;
}

function makePayload(text: string, id = "wamid-1", from = "97155"): any {
  return {
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "User" } }],
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

type SmartReplyOutput = {
  replyText: string;
  language: LanguageCode;
  conversationId: string | null;
};

let createWebhookHandlerRef: ((deps: any) => (req: NextApiRequest, res: NextApiResponse) => Promise<void>) | null = null;

export async function runWebhookHandlerTests() {
  const originalEnv = {
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    WHATSAPP_VERSION: process.env.WHATSAPP_VERSION,
  };

  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone";
  process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-token";
  process.env.WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || "v1.0";

  const mod = await import("../src/pages/api/webhook");
  createWebhookHandlerRef = mod.createWebhookHandler;

  try {
    await testHappyPath();
    await testSmartReplyFailure();
    await testEmptyTextStillCallsAssistant();
    await testInteractiveButton();
    console.log("webhook handler tests passed");
  } finally {
    process.env.WHATSAPP_PHONE_NUMBER_ID = originalEnv.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_TOKEN = originalEnv.WHATSAPP_TOKEN;
    process.env.WHATSAPP_VERSION = originalEnv.WHATSAPP_VERSION;
  }
}

function makeInteractivePayload(title: string, id = "wamid-int", from = "97155"): any {
  return {
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "User" }, wa_id: from }],
              messages: [
                {
                  id,
                  from,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  type: "interactive",
                  interactive: {
                    type: "button_reply",
                    button_reply: { id: "btn-1", title },
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function testHappyPath() {
  if (!createWebhookHandlerRef) throw new Error("handler factory not initialised");
  const smartReplyCalls: Array<{ phone: string; text: string }> = [];
  const saveCalls: Array<{ role: string; content: string }> = [];
  let getOrCreateCalls = 0;
  let sendTextCalls = 0;
  let markReadCalls = 0;

  const handler = createWebhookHandlerRef({
    smartReply: async ({ phone, text }): Promise<SmartReplyOutput> => {
      smartReplyCalls.push({ phone, text });
      return {
        replyText: "XAUUSD price is 2300",
        language: "en",
        conversationId: "conv-smart",
      };
    },
    markReadAndShowTyping: async () => {
      markReadCalls += 1;
    },
    sendText: async (_to, _text) => {
      sendTextCalls += 1;
    },
    getOrCreateConversation: async () => {
      getOrCreateCalls += 1;
      return "conv-created";
    },
    saveMessage: async (_conversationId, role, content) => {
      saveCalls.push({ role, content });
    },
  });

  const req = {
    method: "POST",
    body: makePayload("price gold", "wamid-happy"),
  } as NextApiRequest;
  const res = createRes();

  await handler(req, res as NextApiResponse);

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { received: true });
  assert.strictEqual(smartReplyCalls.length, 1);
  assert.deepStrictEqual(smartReplyCalls[0], { phone: "97155", text: "price gold" });
  assert.strictEqual(markReadCalls, 1);
  assert.strictEqual(getOrCreateCalls, 0, "conversationId from smartReply should be reused");
  assert.strictEqual(saveCalls.length, 2);
  assert.deepStrictEqual(saveCalls[0], { role: "user", content: "price gold" });
  assert.deepStrictEqual(saveCalls[1], { role: "assistant", content: "XAUUSD price is 2300" });
  assert.strictEqual(sendTextCalls, 1);
}

async function testSmartReplyFailure() {
  if (!createWebhookHandlerRef) throw new Error("handler factory not initialised");
  const saveCalls: Array<{ role: string; content: string }> = [];
  const handler = createWebhookHandlerRef({
    smartReply: async () => {
      throw new Error("boom");
    },
    markReadAndShowTyping: async () => {},
    sendText: async (_to, text) => {
      saveCalls.push({ role: "sent", content: text });
    },
    getOrCreateConversation: async () => "conv-fallback",
    saveMessage: async (_conversationId, role, content) => {
      saveCalls.push({ role, content });
    },
  });

  const req = {
    method: "POST",
    body: makePayload("hello", "wamid-error"),
  } as NextApiRequest;
  const res = createRes();

  await handler(req, res as NextApiResponse);

  const expectedFallback = "Sorry, there was an internal error. Please try again.";
  const sentRecord = saveCalls.find((item) => item.role === "sent");
  assert.ok(sentRecord, "fallback message should be sent");
  assert.strictEqual(sentRecord?.content, expectedFallback);
  const assistantRecord = saveCalls.find((item) => item.role === "assistant");
  assert.strictEqual(assistantRecord?.content, expectedFallback);
}

async function testEmptyTextStillCallsAssistant() {
  if (!createWebhookHandlerRef) throw new Error("handler factory not initialised");
  let calls = 0;
  const handler = createWebhookHandlerRef({
    smartReply: async ({ text }): Promise<SmartReplyOutput> => {
      calls += 1;
      return { replyText: text || "ما الرسالة؟", language: pickLanguage(text), conversationId: "conv-empty" };
    },
    markReadAndShowTyping: async () => {},
    sendText: async () => {},
    getOrCreateConversation: async () => "conv-empty",
    saveMessage: async () => {},
  });

  const req = {
    method: "POST",
    body: makePayload("", "wamid-empty"),
  } as NextApiRequest;
  const res = createRes();

  await handler(req, res as NextApiResponse);

  assert.strictEqual(calls, 1, "smartReply should be called even when text is empty");
}

async function testInteractiveButton() {
  if (!createWebhookHandlerRef) throw new Error("handler factory not initialised");
  let capturedText: string | null = null;
  const handler = createWebhookHandlerRef({
    smartReply: async ({ text }): Promise<SmartReplyOutput> => {
      capturedText = text;
      return { replyText: "ok", language: "ar", conversationId: "conv-int" };
    },
    markReadAndShowTyping: async () => {},
    sendText: async () => {},
    getOrCreateConversation: async () => "conv-int",
    saveMessage: async () => {},
  });

  const req = {
    method: "POST",
    body: makeInteractivePayload("زر الموافقة"),
  } as NextApiRequest;
  const res = createRes();

  await handler(req, res as NextApiResponse);

  assert.strictEqual(capturedText, "زر الموافقة");
}

function pickLanguage(text: string | undefined): LanguageCode {
  return text && /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

