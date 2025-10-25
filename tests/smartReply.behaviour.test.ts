import assert from "node:assert";

import { createSmartReply, type SmartReplyDeps } from "../src/lib/smartReply";
import type { ConversationHistory } from "../src/lib/supabase";

interface ChatCallRecord {
  params: any;
}

function createChatMock(responses: any[], calls: ChatCallRecord[]) {
  let index = 0;
  return async (params: any) => {
    calls.push({ params });
    const response = responses[index];
    if (!response) {
      throw new Error("unexpected chat invocation");
    }
    index += 1;
    return response;
  };
}

function makeHistory(messages: ConversationHistory["messages"], conversationId = "conv-1"): ConversationHistory {
  return { conversationId, messages };
}

export async function runSmartReplyTests() {
  await testPriceQuery();
  await testTradingSignalFlow();
  await testFollowUpReply();
  await testKnowledgeQuery();
  await testNewsToolLanguage();
  console.log("smartReply behaviour tests passed");
}

async function testPriceQuery() {
  const chatCalls: ChatCallRecord[] = [];
  const toolUsage: Record<string, number> = {
    get_price: 0,
    get_ohlc: 0,
    compute: 0,
    news: 0,
    knowledge: 0,
  };

  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tool1",
                type: "function",
                function: {
                  name: "get_price",
                  arguments: JSON.stringify({ symbol: "XAUUSD" }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: "XAUUSD price is 2300" },
          finish_reason: "stop",
        },
      ],
    },
  ];

  const deps: SmartReplyDeps = {
    chat: { create: createChatMock(responses, chatCalls) },
    tools: {
      get_price: async (symbol: string) => {
        toolUsage.get_price += 1;
        assert.strictEqual(symbol, "XAUUSD");
        return "XAUUSD price is 2300";
      },
      get_ohlc: async () => {
        toolUsage.get_ohlc += 1;
        throw new Error("get_ohlc should not be called");
      },
      compute_trading_signal: async () => {
        toolUsage.compute += 1;
        throw new Error("compute_trading_signal should not be called");
      },
      search_web_news: async () => {
        toolUsage.news += 1;
        throw new Error("search_web_news should not be called");
      },
      about_liirat_knowledge: async () => {
        toolUsage.knowledge += 1;
        throw new Error("about_liirat_knowledge should not be called");
      },
    },
    supabase: {
      loadHistory: async () => makeHistory([], "conv-123"),
      ensureConversation: async () => "conv-123",
    },
  };

  const smart = createSmartReply(deps);
  const result = await smart({ phone: "97155", text: "price gold" });

  assert.strictEqual(result.replyText, "I'm Liirat assistant. How can I help you?\nXAUUSD price is 2300");
  assert.strictEqual(result.conversationId, "conv-123");
  assert.strictEqual(toolUsage.get_price, 1);
  assert.strictEqual(chatCalls.length, 2);
}

async function testTradingSignalFlow() {
  const candles = Array.from({ length: 200 }, (_, index) => ({
    o: 100 + index,
    h: 101 + index,
    l: 99 + index,
    c: 100.5 + index,
    t: 1_700_000_000 + index * 60,
  }));

  const ohlcResponse = {
    symbol: "XAUUSD",
    timeframe: "5min",
    candles,
    lastCandleUnix: candles.at(-1)!.t,
    lastCandleISO: new Date(candles.at(-1)!.t * 1000).toISOString(),
    ageSeconds: 120,
    isStale: false,
    tooOld: false,
    provider: "TEST",
  };

  const signalResult = {
    status: "OK" as const,
    lang: "ar" as const,
    symbol: "XAUUSD",
    timeframe: "5min" as const,
    signal: "SELL" as const,
    entry: 2350.2,
    sl: 2355.8,
    tp1: 2345.0,
    tp2: 2340.0,
    reason: "الاتجاه العام هابط والمؤشرات تدعم البيع.",
    lastISO: ohlcResponse.lastCandleISO,
    ageSeconds: ohlcResponse.ageSeconds,
    isDelayed: false,
    provider: "TEST",
  };

  const expectedReason = "ضغط بيع تحت المتوسطات";
  const expectedBlock = [
    `time (UTC): ${signalResult.lastISO.slice(0, 10)} ${signalResult.lastISO.slice(11, 16)}`,
    "symbol: XAUUSD",
    "SIGNAL: SELL",
    `Reason: ${expectedReason}`,
    "Data age: 2m (fresh)",
    "Entry: 2350.20",
    "SL: 2355.80",
    "TP1: 2345.00",
    "TP2: 2340.00",
  ].join("\n");

  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "get_ohlc",
                  arguments: JSON.stringify({ symbol: "XAUUSD", timeframe: "5min", limit: 200 }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "compute_trading_signal",
                  arguments: JSON.stringify({ symbol: "XAUUSD", timeframe: "5min" }),
                },
              },
            ],
          },
        },
      ],
    },
  ];

  let ohlcCalls = 0;
  let computeCalls = 0;

  const deps: SmartReplyDeps = {
    chat: { create: createChatMock(responses, []) },
    tools: {
      get_price: async () => {
        throw new Error("get_price should not be called");
      },
      get_ohlc: async (symbol: string, timeframe: string, limit?: number) => {
        ohlcCalls += 1;
        assert.strictEqual(symbol, "XAUUSD");
        assert.strictEqual(timeframe, "5min");
        assert.strictEqual(limit, 60);
        return { ...ohlcResponse };
      },
      compute_trading_signal: async (input) => {
        computeCalls += 1;
        assert.strictEqual(input.symbol, "XAUUSD");
        assert.strictEqual(input.timeframe, "5min");
        assert.strictEqual(input.candles.length, candles.length);
        return signalResult;
      },
      search_web_news: async () => {
        throw new Error("search_web_news should not be called");
      },
      about_liirat_knowledge: async () => {
        throw new Error("about_liirat_knowledge should not be called");
      },
    },
    supabase: {
      loadHistory: async () => makeHistory([], "conv-xyz"),
      ensureConversation: async () => "conv-xyz",
    },
  };

  const smart = createSmartReply(deps);
  const result = await smart({ phone: "9715", text: "صفقة ذهب 5 دقايق" });

  assert.strictEqual(result.replyText, `أنا مساعد ليرات، كيف فيني ساعدك؟\n${expectedBlock}`);
  assert.strictEqual(ohlcCalls, 2);
  assert.strictEqual(computeCalls, 1);
}

async function testFollowUpReply() {
  const historyMessages = makeHistory(
    [
      { role: "user", content: "عطيني صفقة" },
      { role: "assistant", content: "- SIGNAL: BUY" },
    ],
    "conv-follow",
  );

  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "نعم، حسب آخر بيانات الأسعار.",
            tool_calls: undefined,
          },
          finish_reason: "stop",
        },
      ],
    },
  ];

  const recordedCalls: ChatCallRecord[] = [];

  const deps: SmartReplyDeps = {
    chat: { create: createChatMock(responses, recordedCalls) },
    tools: {
      get_price: async () => {
        throw new Error("get_price should not be called");
      },
      get_ohlc: async () => {
        throw new Error("get_ohlc should not be called");
      },
      compute_trading_signal: async () => {
        throw new Error("compute_trading_signal should not be called");
      },
      search_web_news: async () => {
        throw new Error("search_web_news should not be called");
      },
      about_liirat_knowledge: async () => {
        throw new Error("about_liirat_knowledge should not be called");
      },
    },
    supabase: {
      loadHistory: async () => historyMessages,
      ensureConversation: async () => "conv-follow",
    },
  };

  const smart = createSmartReply(deps);
  const result = await smart({ phone: "9715", text: "متأكد؟" });

  assert.strictEqual(result.replyText, "نعم، حسب آخر بيانات الأسعار.");
  assert.strictEqual(result.conversationId, "conv-follow");
  assert.strictEqual(recordedCalls.length, 1);
  const firstCallMessages = recordedCalls[0]?.params?.messages ?? [];
  assert.strictEqual(firstCallMessages.length, 4); // system + two history + user
}

async function testKnowledgeQuery() {
  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-knowledge",
                type: "function",
                function: {
                  name: "about_liirat_knowledge",
                  arguments: JSON.stringify({ query: "وين مكاتب ليرات؟" }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: "مكاتب ليرات في دبي مارينا." },
          finish_reason: "stop",
        },
      ],
    },
  ];

  let knowledgeCalls = 0;

  const deps: SmartReplyDeps = {
    chat: { create: createChatMock(responses, []) },
    tools: {
      get_price: async () => {
        throw new Error("get_price should not be called");
      },
      get_ohlc: async () => {
        throw new Error("get_ohlc should not be called");
      },
      compute_trading_signal: async () => {
        throw new Error("compute_trading_signal should not be called");
      },
      search_web_news: async () => {
        throw new Error("search_web_news should not be called");
      },
      about_liirat_knowledge: async (query: string) => {
        knowledgeCalls += 1;
        assert.strictEqual(query, "وين مكاتب ليرات؟");
        return "مكاتب ليرات في دبي مارينا.";
      },
    },
    supabase: {
      loadHistory: async () => makeHistory([], "conv-knowledge"),
      ensureConversation: async () => "conv-knowledge",
    },
  };

  const smart = createSmartReply(deps);
  const result = await smart({ phone: "97155", text: "وين مكاتب ليرات؟" });

  assert.strictEqual(result.replyText, "أنا مساعد ليرات، كيف فيني ساعدك؟\nمكاتب ليرات في دبي مارينا.");
  assert.strictEqual(knowledgeCalls, 1);
}

async function testNewsToolLanguage() {
  const newsLines = [
    "2024-01-01 — Bloomberg — Gold steadies — medium",
    "2024-01-02 — Reuters — Dollar slips — low",
    "2024-01-03 — CNBC — Fed minutes in focus — high",
  ];

  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "news-1",
                type: "function",
                function: {
                  name: "search_web_news",
                  arguments: JSON.stringify({ query: "اخبار الذهب", lang: "en" }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: newsLines.join("\n") },
          finish_reason: "stop",
        },
      ],
    },
  ];

  let receivedLang: string | null = null;
  let receivedCount: number | null = null;

  const deps: SmartReplyDeps = {
    chat: { create: createChatMock(responses, []) },
    tools: {
      get_price: async () => {
        throw new Error("get_price should not be called");
      },
      get_ohlc: async () => {
        throw new Error("get_ohlc should not be called");
      },
      compute_trading_signal: async () => {
        throw new Error("compute_trading_signal should not be called");
      },
      search_web_news: async (query: string, lang: string, count: number) => {
        receivedLang = lang;
        receivedCount = count;
        assert.strictEqual(query, "اخبار الذهب");
        return newsLines.join("\n");
      },
      about_liirat_knowledge: async () => {
        throw new Error("about_liirat_knowledge should not be called");
      },
    },
    supabase: {
      loadHistory: async () => makeHistory([], "conv-news"),
      ensureConversation: async () => "conv-news",
    },
  };

  const smart = createSmartReply(deps);
  const result = await smart({ phone: "971500", text: "اخبار الذهب" });

  assert.strictEqual(receivedLang, "ar");
  assert.strictEqual(receivedCount, 3);
  assert.strictEqual(result.replyText, `أنا مساعد ليرات، كيف فيني ساعدك؟\n${newsLines.join("\n")}`);
}

