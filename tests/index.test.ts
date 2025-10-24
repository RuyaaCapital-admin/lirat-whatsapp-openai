import assert from "node:assert";
import { createSmartReply } from "../src/lib/whatsappAgent";
import { SYSTEM_PROMPT } from "../src/lib/systemPrompt";
import { TOOL_SCHEMAS } from "../src/lib/toolSchemas";
import type { ConversationMemoryAdapter, HistoryMessage } from "../src/lib/memory";

type CompletionHandler = (params: any) => any;

class StubMemory implements ConversationMemoryAdapter {
  private store = new Map<string, HistoryMessage[]>();

  async getHistory(userId: string): Promise<HistoryMessage[]> {
    return this.store.get(userId) ?? [];
  }

  async appendHistory(userId: string, messages: HistoryMessage[]): Promise<void> {
    const existing = this.store.get(userId) ?? [];
    const combined = [...existing, ...messages].slice(-12);
    this.store.set(userId, combined);
  }
}

class ScriptedChatClient {
  private index = 0;
  constructor(private readonly script: CompletionHandler[]) {}

  async create(params: any) {
    const handler = this.script[this.index++];
    if (!handler) {
      throw new Error(`unexpected create call at index ${this.index - 1}`);
    }
    return handler(params);
  }

  ensureComplete() {
    assert.strictEqual(this.index, this.script.length, "not all scripted responses were consumed");
  }
}

const PRICE_TEXT = "Time (UTC): 2024-01-01 10:00 UTC\nSymbol: XAUUSD\nPrice: 2400\nSource: TEST";
const SIGNAL_TEXT = [
  "- Time: 2024-01-01 10:00 UTC",
  "- Symbol: XAUUSD",
  "- SIGNAL: BUY",
  "- Entry: 1",
  "- SL: 0.5",
  "- TP1: 1.5 (R 1.0)",
  "- TP2: 2.5 (R 2.0)",
].join("\n");
const TIME_TEXT = [
  "- Time: 2024-01-01 11:00 UTC",
  "- Symbol: XAUUSD",
  "- SIGNAL: BUY",
  "- Entry: 1",
  "- SL: 0.5",
  "- TP1: 1.5 (R 1.0)",
  "- TP2: 2.5 (R 2.0)",
].join("\n");

const signalOutputs = [
  {
    signal: "BUY",
    entry: 1,
    sl: 0.5,
    tp1: 1.5,
    tp2: 2.5,
    timeUTC: "2024-01-01 10:00 UTC",
    symbol: "XAUUSD",
    interval: "1h",
  },
  {
    signal: "BUY",
    entry: 1,
    sl: 0.5,
    tp1: 1.5,
    tp2: 2.5,
    timeUTC: "2024-01-01 11:00 UTC",
    symbol: "XAUUSD",
    interval: "1h",
  },
];
const toolCalls: string[] = [];

const toolHandlers = {
  async get_price() {
    toolCalls.push("get_price");
    return { text: PRICE_TEXT };
  },
  async get_ohlc() {
    toolCalls.push("get_ohlc");
    return { text: JSON.stringify({ candles: "mock" }) };
  },
  async compute_trading_signal() {
    toolCalls.push("compute_trading_signal");
    const signal = signalOutputs.shift() ?? signalOutputs[0];
    return { text: SIGNAL_TEXT };
  },
  async about_liirat_knowledge() {
    return { text: "معلومات ليرات" };
  },
  async search_web_news() {
    return { text: "- 2024-01-01 — Source — Title — impact" };
  },
};

const scriptedChat = new ScriptedChatClient([
  (params: any) => {
    const last = params.messages.at(-1);
    assert.strictEqual(last.content, "سعر الذهب");
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                function: { name: "get_price", arguments: JSON.stringify({ symbol: "XAUUSD" }) },
              },
            ],
          },
        },
      ],
    };
  },
  () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: PRICE_TEXT,
        },
      },
    ],
  }),
  (params: any) => {
    const last = params.messages.at(-1);
    assert.strictEqual(last.content, "شو يعني؟");
    const hasPrice = params.messages.some(
      (msg: any) => msg.role === "assistant" && typeof msg.content === "string" && msg.content.includes("Price:")
    );
    assert.ok(hasPrice, "history should include prior price response");
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: "شرح موجز",
          },
        },
      ],
    };
  },
  (params: any) => {
    const last = params.messages.at(-1);
    assert.strictEqual(last.content, "عطيني صفقة عالدهب");
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-2",
              function: { name: "get_ohlc", arguments: JSON.stringify({ symbol: "XAUUSD", timeframe: "1h" }) },
              },
            ],
          },
        },
      ],
    };
  },
  () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-3",
              function: { name: "compute_trading_signal", arguments: JSON.stringify({ symbol: "XAUUSD", timeframe: "1h" }) },
            },
          ],
        },
      },
    ],
  }),
  () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: SIGNAL_TEXT,
        },
      },
    ],
  }),
  (params: any) => {
    const last = params.messages.at(-1);
    assert.strictEqual(last.content, "على أي وقت؟");
    const hasSignal = params.messages.some(
      (msg: any) => msg.role === "assistant" && typeof msg.content === "string" && msg.content.includes("- SIGNAL:")
    );
    assert.ok(hasSignal, "history should include prior signal response");
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-4",
              function: { name: "compute_trading_signal", arguments: JSON.stringify({ symbol: "XAUUSD", timeframe: "1h" }) },
              },
            ],
          },
        },
      ],
    };
  },
  () => ({
    choices: [
      {
        message: {
          role: "assistant",
          content: TIME_TEXT,
        },
      },
    ],
  }),
]);

const memory = new StubMemory();

const smartReply = createSmartReply({
  chat: { create: (params) => scriptedChat.create(params) },
  toolSchemas: TOOL_SCHEMAS,
  toolHandlers,
  systemPrompt: SYSTEM_PROMPT,
  memory,
  model: "gpt-test",
  temperature: 0,
  maxTokens: 200,
});

const USER_ID = "user-1";

async function runScenario() {
  const price = await smartReply({ userId: USER_ID, text: "سعر الذهب" });
  assert.strictEqual(price, PRICE_TEXT);

  const followUp = await smartReply({ userId: USER_ID, text: "شو يعني؟" });
  assert.strictEqual(followUp, "شرح موجز");

  const signal = await smartReply({ userId: USER_ID, text: "عطيني صفقة عالدهب" });
  assert.strictEqual(signal, SIGNAL_TEXT);

  const timing = await smartReply({ userId: USER_ID, text: "على أي وقت؟" });
  assert.strictEqual(timing, TIME_TEXT);

  scriptedChat.ensureComplete();
  assert.deepStrictEqual(toolCalls, [
    "get_price",
    "get_ohlc",
    "compute_trading_signal",
    "compute_trading_signal",
  ]);

  const history = await memory.getHistory(USER_ID);
  assert.ok(history.length >= 8, "history should capture conversation turns");
}

runScenario()
  .then(() => {
    console.log("All integration tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
