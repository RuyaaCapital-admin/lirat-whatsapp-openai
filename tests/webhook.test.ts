import assert from "node:assert";
import { processWebhookPayload } from "../api/webhook";

type TypingOverride = (phone: string, on: boolean) => Promise<void> | void;
type TextOverride = (phone: string, message: string) => Promise<void> | void;
type AgentOverride = (prompt: string) => Promise<string> | string;

type OverrideSet = {
  typing?: TypingOverride;
  text?: TextOverride;
  agent?: AgentOverride;
};

function buildPayload(id: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        time: Date.now(),
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id,
                  from: "15551234567",
                  timestamp: `${Date.now()}`,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  } as const;
}

function createDeps(overrides: OverrideSet = {}) {
  const typingCalls: Array<{ phone: string; on: boolean }> = [];
  const textCalls: Array<{ phone: string; message: string }> = [];
  const agentPrompts: string[] = [];

  return {
    typingCalls,
    textCalls,
    agentPrompts,
    deps: {
      typing: async (phone: string, on: boolean) => {
        typingCalls.push({ phone, on });
        if (overrides.typing) {
          await overrides.typing(phone, on);
        }
      },
      text: async (phone: string, message: string) => {
        textCalls.push({ phone, message });
        if (overrides.text) {
          await overrides.text(phone, message);
        }
      },
      agent: async (prompt: string) => {
        agentPrompts.push(prompt);
        if (overrides.agent) {
          return overrides.agent(prompt);
        }
        return "ack";
      },
    },
  } as const;
}

(async () => {
  {
    const { deps, typingCalls, textCalls, agentPrompts } = createDeps();
    await processWebhookPayload({}, deps);
    assert.strictEqual(typingCalls.length, 0);
    assert.strictEqual(textCalls.length, 0);
    assert.strictEqual(agentPrompts.length, 0);

    await processWebhookPayload(buildPayload("blank-1", "   "), deps);
    assert.strictEqual(typingCalls.length, 0);
    assert.strictEqual(textCalls.length, 0);
    assert.strictEqual(agentPrompts.length, 0);
  }

  {
    const { deps, typingCalls, textCalls, agentPrompts } = createDeps();
    const payload = buildPayload("dedup-1", "  hello world  ");
    await processWebhookPayload(payload, deps);
    assert.deepStrictEqual(agentPrompts, ["hello world"]);
    assert.deepStrictEqual(typingCalls, [
      { phone: "15551234567", on: true },
      { phone: "15551234567", on: false },
    ]);
    assert.strictEqual(textCalls.length, 1);
    assert.strictEqual(textCalls[0].message, "ack");

    const callsBefore = {
      typing: typingCalls.length,
      text: textCalls.length,
      agent: agentPrompts.length,
    };
    await processWebhookPayload(payload, deps);
    assert.strictEqual(typingCalls.length, callsBefore.typing);
    assert.strictEqual(textCalls.length, callsBefore.text);
    assert.strictEqual(agentPrompts.length, callsBefore.agent);
  }

  {
    const longReply = "x".repeat(5000);
    const { deps, typingCalls, textCalls, agentPrompts } = createDeps({
      agent: async () => longReply,
    });
    await processWebhookPayload(buildPayload("truncate-1", "send"), deps);
    assert.strictEqual(agentPrompts[0], "send");
    assert.strictEqual(textCalls[0].message.length, 4096);
    assert.strictEqual(typingCalls.length, 2);
  }

  {
    const { deps, typingCalls, textCalls } = createDeps({
      agent: async () => {
        throw new Error("boom");
      },
      typing: async (_phone, on) => {
        if (!on) {
          throw new Error("turn-off failed");
        }
      },
    });
    await processWebhookPayload(buildPayload("fallback-1", "ping"), deps);
    assert.strictEqual(textCalls.length, 1);
    assert.strictEqual(textCalls[0].message, "تعذر معالجة الطلب الآن. حاول لاحقًا.");
    assert.strictEqual(typingCalls.length, 2);
  }

  console.log("Webhook tests passed");
})();
