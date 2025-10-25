// src/lib/smartReply.ts
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

import { openai } from "./openai";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  search_web_news,
  about_liirat_knowledge,
} from "../tools/agentTools";
import { detectLanguage, normaliseDigits, normaliseSymbolKey, type LanguageCode } from "../utils/webhookHelpers";
import { getOrCreateConversation, loadConversationHistory, type ConversationHistory } from "./supabase";
import { hardMapSymbol, toTimeframe } from "../tools/normalize";
import { formatNewsMsg, formatPriceMsg, formatSignalMsg } from "../utils/formatters";
import type { Candle } from "../tools/ohlc";

const SYSTEM_PROMPT = `You are Liirat Assistant (مساعد ليرات)، a concise professional trading assistant for Liirat clients.

General conduct:
- Always respond in the user's language (formal Syrian Arabic if the user writes in Arabic, or English otherwise).
- Never open with greetings unless this is clearly the first user message of the conversation.
- Keep answers short and factual.
- Use the conversation history to answer follow-ups ("شو يعني؟", "متأكد؟", "اي ساعة بتوقيت دبي؟") in context.
- Only mention your identity if the user explicitly asks who/what you are. Answer exactly "مساعد ليرات" in Arabic or "I'm Liirat assistant." in English.
- If a tool call fails or you truly can't answer, reply with one brief helpful sentence (in the correct language), not "Out of scope." and not "data unavailable" automatically. Example Arabic fallback: "ما وصلتني بيانات كافية، وضّح طلبك أكثر لو سمحت." Example English fallback: "I don't have enough data, please clarify what you need."
- For trading signals: ALWAYS call get_ohlc first, then compute_trading_signal with those candles. If the outcome is NEUTRAL reply exactly "- SIGNAL: NEUTRAL — Time: {timeUTC} ({interval}) — Symbol: {symbol}". Otherwise reply with the 7-line block (Time with interval, Symbol, SIGNAL, Entry, SL, TP1 with R 1.0, TP2 with R 2.0). Never invent prices.
- For price questions: call get_price and return ONLY that price text, no greeting.
- For economic news / market news: call search_web_news(query, lang, count=3). Return 3 bullet lines: "YYYY-MM-DD — Source — Title — impact".
- For Liirat company / platform / support questions: call about_liirat_knowledge(query, lang) and return that text directly.
- If the user message is empty or whitespace, ask them what they need: Arabic "ما الرسالة؟" / English "How can I help?".
- Do not mention tools or internal logic.
`;

const TOOL_SCHEMAS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_price",
      description: "Return latest price text for a symbol.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Unslashed symbol like XAUUSD" },
          timeframe: { type: "string", description: "Optional timeframe label" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ohlc",
      description: "Return OHLC candles for a symbol/timeframe.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          timeframe: {
            type: "string",
            enum: ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"],
          },
          limit: { type: "integer", minimum: 50, maximum: 400, default: 200 },
        },
        required: ["symbol", "timeframe"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_trading_signal",
      description: "Compute trading signal from recent candles.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          timeframe: {
            type: "string",
            enum: ["1min", "5min", "15min", "30min", "1hour", "4hour", "1day"],
          },
          candles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                o: { type: "number" },
                h: { type: "number" },
                l: { type: "number" },
                c: { type: "number" },
                t: { type: "integer", description: "unix seconds" },
              },
              required: ["o", "h", "l", "c", "t"],
              additionalProperties: false,
            },
            minItems: 50,
          },
        },
        required: ["symbol", "timeframe"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web_news",
      description: "Search market news and return formatted bullet list.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          lang: { type: "string", enum: ["ar", "en"], default: "en" },
          count: { type: "integer", minimum: 1, maximum: 5, default: 3 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "about_liirat_knowledge",
      description: "Answer Liirat company/support questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, lang: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

const FALLBACK_NEED_DATA: Record<LanguageCode, string> = {
  ar: "ما وصلتني بيانات كافية، وضّح طلبك أكثر لو سمحت.",
  en: "I don't have enough data, please clarify what you need.",
};

const FALLBACK_EMPTY: Record<LanguageCode, string> = {
  ar: "ما الرسالة؟",
  en: "How can I help?",
};

const GREETING: Record<LanguageCode, string> = {
  ar: "أنا مساعد ليرات، كيف فيني ساعدك؟",
  en: "I'm Liirat assistant. How can I help you?",
};

export interface SmartReplyDeps {
  chat: {
    create: (params: ChatCompletionCreateParamsNonStreaming) => Promise<ChatCompletion>;
  };
  tools: {
    get_price: typeof get_price;
    get_ohlc: typeof get_ohlc;
    compute_trading_signal: typeof compute_trading_signal;
    search_web_news: typeof search_web_news;
    about_liirat_knowledge: typeof about_liirat_knowledge;
  };
  supabase: {
    loadHistory: (phone: string, limit?: number) => Promise<ConversationHistory>;
    ensureConversation: (phone: string, contactName?: string) => Promise<string | null>;
  };
  model?: string;
  maxIterations?: number;
}

export interface SmartReplyInput {
  phone: string;
  text: string;
  contactName?: string;
}

export interface SmartReplyOutput {
  replyText: string;
  language: LanguageCode;
  conversationId: string | null;
}

function readMessageContent(message: ChatCompletion["choices"][0]["message"]): string {
  if (!message) return "";
  if (typeof message.content === "string") {
    return message.content;
  }
  const content = message.content as any;
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (!chunk) return "";
        if (typeof chunk === "string") return chunk;
        if (typeof chunk === "object" && typeof chunk.text === "string") {
          return chunk.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function sanitiseArgs(args: Record<string, unknown>) {
  const clone: Record<string, unknown> = { ...args };
  if (Array.isArray(clone.candles)) {
    clone.candles = `len:${clone.candles.length}`;
  }
  return clone;
}

function applyGreeting(text: string, shouldGreet: boolean, language: LanguageCode): string {
  const base = typeof text === "string" ? text.trim() : "";
  if (!shouldGreet) {
    return base || text || "";
  }
  const greeting = GREETING[language] ?? GREETING.en;
  if (!base) {
    return greeting;
  }
  if (base.startsWith(greeting)) {
    return base;
  }
  return `${greeting}\n${base}`;
}

type CandleSeries = Candle[];

interface ToolContext {
  lastCandlesBySymbolTimeframe: Record<string, CandleSeries>;
}

function keyFor(symbol: string, timeframe: string) {
  return `${normaliseSymbolKey(symbol)}:${timeframe}`;
}

export function createSmartReply(deps: SmartReplyDeps) {
  const {
    chat,
    tools,
    supabase,
    model = "gpt-4o-mini",
    maxIterations = 8,
  } = deps;

  if (!chat?.create) {
    throw new Error("smartReply requires chat.create");
  }

  return async function smartReply({ phone, text, contactName }: SmartReplyInput): Promise<SmartReplyOutput> {
    const normalisedText = normaliseDigits(text ?? "").trim();
    const language = detectLanguage(normalisedText);

    const history = await supabase.loadHistory(phone, 20);
    const isNewConversation = !history.conversationId || history.messages.length === 0;
    let conversationId: string | null = history.conversationId ?? null;

    const ensureConversation = async () => {
      if (conversationId) {
        return conversationId;
      }
      conversationId = await supabase.ensureConversation(phone, contactName);
      return conversationId;
    };

    const userMessageContent = normalisedText || " ";
    const baseMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.messages.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: "user", content: userMessageContent },
    ];

    const toolContext: ToolContext = { lastCandlesBySymbolTimeframe: {} };
    const messages = [...baseMessages];

    const respondWithFallback = async (fallback: string, greet: boolean) => {
      const ensured = await ensureConversation();
      return { replyText: applyGreeting(fallback, greet, language), language, conversationId: ensured };
    };

    try {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const completion = await chat.create({
          model,
          temperature: 0,
          max_tokens: 700,
          messages,
          tools: TOOL_SCHEMAS as ChatCompletionCreateParamsNonStreaming["tools"],
          tool_choice: "auto",
        });

        const choice = completion.choices?.[0];
        const message = choice?.message;

        if (!message) {
          break;
        }

        if (message.tool_calls?.length) {
          messages.push({
            role: "assistant",
            tool_calls: message.tool_calls,
            content: readMessageContent(message),
          } as ChatCompletionMessageParam);

          for (const call of message.tool_calls) {
            const toolName = call.function?.name ?? "";
            let parsed: Record<string, unknown> = {};
            try {
              parsed = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            } catch (error) {
              console.error("[TOOL] invalid arguments", { toolName, raw: call.function?.arguments });
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({ error: "invalid_arguments" }),
              });
              continue;
            }

            console.log("[TOOL]", toolName, sanitiseArgs(parsed));

            try {
              if (toolName === "get_price") {
                const symbol = String(parsed.symbol ?? "").trim();
                const timeframe = typeof parsed.timeframe === "string" ? parsed.timeframe : undefined;
                const price = await tools.get_price(symbol, timeframe);
                console.log("[TOOL] get_price -> ok", { symbol: price.symbol });
                const formatted = formatPriceMsg({
                  symbol: price.symbol,
                  price: price.price,
                  timeUTC: price.timeUTC,
                  source: price.source,
                });
                messages.push({ role: "tool", tool_call_id: call.id, content: formatted });
              } else if (toolName === "get_ohlc") {
                const symbolInput = String(parsed.symbol ?? normalisedText).trim();
                const timeframeInput = String(parsed.timeframe ?? normalisedText).trim();
                const limit = typeof parsed.limit === "number" ? parsed.limit : 200;
                const resolvedSymbol = hardMapSymbol(symbolInput);
                if (!resolvedSymbol) {
                  throw new Error("invalid_symbol");
                }
                const resolvedTimeframe = toTimeframe(timeframeInput);
                const candles = await tools.get_ohlc(resolvedSymbol, resolvedTimeframe, limit);
                const key = keyFor(resolvedSymbol, resolvedTimeframe);
                toolContext.lastCandlesBySymbolTimeframe[key] = candles;
                const last = candles.at(-1);
                const tfMs: Record<string, number> = {
                  "1min": 60_000,
                  "5min": 5 * 60_000,
                  "15min": 15 * 60_000,
                  "30min": 30 * 60_000,
                  "1hour": 60 * 60_000,
                  "4hour": 4 * 60 * 60_000,
                  "1day": 24 * 60 * 60_000,
                };
                const lastClosedUtc = last
                  ? (() => {
                      const iso = new Date(last.t).toISOString();
                      return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
                    })()
                  : "";
                const stale = last
                  ? Date.now() - last.t > (tfMs[resolvedTimeframe] ?? 60 * 60_000) * 3
                  : true;
                console.log("[TOOL] get_ohlc -> ok", {
                  symbol: resolvedSymbol,
                  timeframe: resolvedTimeframe,
                  candles: candles.length,
                });
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({
                    symbol: resolvedSymbol,
                    timeframe: resolvedTimeframe,
                    last_closed_utc: lastClosedUtc,
                    candles,
                    stale,
                  }),
                });
              } else if (toolName === "compute_trading_signal") {
                const symbolInput = String(parsed.symbol ?? normalisedText).trim();
                const timeframeInput = String(parsed.timeframe ?? normalisedText).trim();
                const resolvedSymbol = hardMapSymbol(symbolInput);
                if (!resolvedSymbol) {
                  throw new Error("invalid_symbol");
                }
                const resolvedTimeframe = toTimeframe(timeframeInput);
                const key = keyFor(resolvedSymbol, resolvedTimeframe);
                let candles = toolContext.lastCandlesBySymbolTimeframe[key];
                if (!candles || candles.length === 0) {
                  candles = await tools.get_ohlc(resolvedSymbol, resolvedTimeframe, 200);
                  toolContext.lastCandlesBySymbolTimeframe[key] = candles;
                }
                const signal = await tools.compute_trading_signal(resolvedSymbol, resolvedTimeframe, candles);
                const timeForMsg = signal.last_closed_utc
                  ? `${signal.last_closed_utc.replace(/\s+/, "T")}:00Z`
                  : new Date().toISOString();
                const trimmed = formatSignalMsg({
                  decision: signal.decision,
                  entry: signal.entry,
                  sl: signal.sl,
                  tp1: signal.tp1,
                  tp2: signal.tp2,
                  time: timeForMsg,
                  symbol: signal.symbol,
                }).trim();
                if (!trimmed) {
                  throw new Error("empty_signal");
                }
                console.log("[TOOL] compute_trading_signal -> ok", {
                  symbol: resolvedSymbol,
                  timeframe: resolvedTimeframe,
                });
                const ensured = await ensureConversation();
                const replyText = applyGreeting(trimmed, isNewConversation, language);
                return { replyText, language, conversationId: ensured };
              } else if (toolName === "search_web_news") {
                const query = String(parsed.query ?? normalisedText).trim();
                const news = await tools.search_web_news(query, language === "ar" ? "ar" : "en", 3);
                const formatted = formatNewsMsg(news.rows).trim();
                if (!formatted) {
                  throw new Error("insufficient_news");
                }
                console.log("[TOOL] search_web_news -> ok", { query, lang: language === "ar" ? "ar" : "en" });
                messages.push({ role: "tool", tool_call_id: call.id, content: formatted });
              } else if (toolName === "about_liirat_knowledge") {
                const query = String(parsed.query ?? normalisedText).trim();
                const content = await tools.about_liirat_knowledge(query, language);
                console.log("[TOOL] about_liirat_knowledge -> ok");
                messages.push({ role: "tool", tool_call_id: call.id, content });
              } else {
                throw new Error(`unknown_tool:${toolName}`);
              }
            } catch (error) {
              console.error("[TOOL] execution failed", { toolName, error });
              return respondWithFallback(FALLBACK_NEED_DATA[language], false);
            }
          }

          continue;
        }

        const content = readMessageContent(message).trim();
        if (content) {
          const ensured = await ensureConversation();
          const replyText = applyGreeting(content, isNewConversation, language);
          return { replyText, language, conversationId: ensured };
        }

        if (choice?.finish_reason === "stop") {
          break;
        }
      }
    } catch (error) {
      console.error("[SMART_REPLY] loop error", error);
    }

    const fallback = normalisedText ? FALLBACK_NEED_DATA[language] : FALLBACK_EMPTY[language];
    const greet = isNewConversation && fallback !== FALLBACK_NEED_DATA[language];
    return respondWithFallback(fallback, greet);
  };
}

let cachedSmartReply: ((input: SmartReplyInput) => Promise<SmartReplyOutput>) | null = null;

export async function smartReply(input: SmartReplyInput): Promise<SmartReplyOutput> {
  if (!cachedSmartReply) {
    const deps: SmartReplyDeps = {
      chat: {
        create: (params) => openai.chat.completions.create(params),
      },
      tools: {
        get_price,
        get_ohlc,
        compute_trading_signal,
        search_web_news,
        about_liirat_knowledge,
      },
      supabase: {
        loadHistory: loadConversationHistory,
        ensureConversation: getOrCreateConversation,
      },
    };
    cachedSmartReply = createSmartReply(deps);
  }
  return cachedSmartReply(input);
}

