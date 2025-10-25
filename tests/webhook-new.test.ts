import assert from "node:assert";
import type { NextApiRequest, NextApiResponse } from "next";

import { createWebhookHandler } from "../src/pages/api/webhook";
import type { SignalFormatterInput } from "../src/utils/formatters";

type HandlerDeps = Parameters<typeof createWebhookHandler>[0];

type ConversationRecord = {
  id: string;
  isNew: boolean;
  lastSymbol?: string | null;
  lastTimeframe?: string | null;
  lastSignal?: SignalFormatterInput | null;
  messageCount: number;
};

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

async function runScenario(text: string, record: ConversationRecord) {
  let sent = "";
  const deps: HandlerDeps = {
    markReadAndShowTyping: async () => {},
    sendText: async (_to, body) => {
      sent = body;
    },
    createOrGetConversation: async () => ({
      conversation_id: record.id,
      phone: "97155",
      user_id: null,
      isNew: record.isNew,
      last_symbol: record.lastSymbol ?? null,
      last_tf: record.lastTimeframe ?? null,
      last_signal: record.lastSignal ? { payload: record.lastSignal } : null,
    }),
    getConversationMessageCount: async () => record.messageCount,
    getRecentContext: async () => [],
    logMessage: async () => {},
    updateConversationMetadata: async () => {},
  };
  const handler = createWebhookHandler(deps);
  const req = {
    method: "POST",
    body: makePayload(text, "97155", `${record.id}-${Math.random().toString(36).slice(2)}`),
  } as NextApiRequest;
  const res = makeRes();
  await handler(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { received: true });
  return sent;
}

async function testFirstGreeting() {
  const reply = await runScenario("مرحبا", {
    id: "conv-1",
    isNew: true,
    messageCount: 0,
  });
  assert.strictEqual(reply.trim(), "كيف فيني ساعدك؟");
}

async function testIdentityAnswer() {
  const reply = await runScenario("who are you?", {
    id: "conv-2",
    isNew: false,
    messageCount: 4,
  });
  assert.strictEqual(reply.trim(), "I'm Liirat assistant.");
}

async function testTimeframeRecall() {
  const payload: SignalFormatterInput = {
    symbol: "XAUUSD",
    timeframe: "5min",
    timeUTC: "2025-10-25 12:55",
    decision: "BUY",
    reason: "bullish_pressure",
    levels: { entry: 2375.2, sl: 2369.8, tp1: 2379.5, tp2: 2383.8 },
    stale: false,
    ageMinutes: 4,
  };
  const reply = await runScenario("which timeframe is that?", {
    id: "conv-3",
    isNew: false,
    messageCount: 6,
    lastSignal: payload,
    lastSymbol: "XAUUSD",
    lastTimeframe: "5min",
  });
  assert.ok(reply.includes("timeframe: 5min"));
  assert.ok(!reply.toLowerCase().includes("who are you"));
}

export async function runWebhookBehaviourTests() {
  await testFirstGreeting();
  await testIdentityAnswer();
  await testTimeframeRecall();
  console.log("webhook behaviour tests passed");
}
