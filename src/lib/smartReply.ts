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
  type TradingSignal,
} from "../tools/agentTools";
import { detectLanguage, normaliseDigits, normaliseSymbolKey, type LanguageCode } from "../utils/webhookHelpers";
import { getOrCreateConversation, loadConversationHistory, type ConversationHistory } from "./supabase";
import { hardMapSymbol, toTimeframe } from "../tools/normalize";
import { newsFormatter, priceFormatter, signalFormatter } from "../utils/formatters";
import type { GetOhlcSuccess } from "../tools/ohlc";

const SYSTEM_PROMPT = `You are Liirat Assistant (مساعد ليرات)، a concise professional trading assistant for Liirat clients.

General conduct:
- Always respond in the user's language (formal Syrian Arabic if the user writes in Arabic, or English otherwise).
- Never open with greetings unless this is clearly the first user message of the conversation.
- Keep answers short and factual.
- Use the conversation history to answer follow-ups ("شو يعني؟", "متأكد؟", "اي ساعة بتوقيت دبي؟") in context.
- Only mention your identity if the user explicitly asks who/what you are. Answer exactly "مساعد ليرات" in Arabic or "I'm Liirat assistant." in English.
- If a tool call fails or you truly can't answer, reply with one brief helpful sentence (in the correct language), not "Out of scope." and not "data unavailable" automatically. Example Arabic fallback: "ما وصلتني بيانات كافية، وضّح طلبك أكثر لو سمحت." Example English fallback: "I don't have enough data, please clarify what you need."
- For trading signals: ALWAYS call get_ohlc first, then compute_trading_signal with those candles. If the outcome is NEUTRAL reply exactly "- SIGNAL: NEUTRAL — Time: {timeUTC} ({interval}) — Symbol: {symbol}". Otherwise reply with the 7-line block (Time with interval, Symbol, SIGNAL, Entry, SL, TP1 with R 1.0, TP2 with R 2.0). Never invent prices.
- إذا حدّد المستخدم إطارًا زمنيًا T صراحةً → لا تغيّر T ولا تستخدم SWEEP. احسب على T فقط (مع إجبار الاتجاه داخل نفس T إن لزم).
- If the user explicitly specifies a timeframe T, do not sweep to other timeframes. Work on T only and use the forced-direction fallback within that same T when needed.
- إذا لم يحدّد إطارًا → استخدم SWEEP بالترتيب ["5min","15min","30min","1hour","4hour","daily"] وتوقف عند أول BUY/SELL واطبع نفس TF المستخدم.
- If the user does not provide a timeframe, sweep in order ["5min","15min","30min","1hour","4hour","daily"], stop at the first BUY/SELL, and report the timeframe used.
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
          limit: { type: "integer", minimum: 30, maximum: 60, default: 60 },
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
          ohlc: {
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
              },
              lastCandleUnix: { type: "integer" },
              lastCandleISO: { type: "string" },
              ageSeconds: { type: "number" },
              isStale: { type: "boolean" },
              tooOld: { type: "boolean" },
              provider: { type: "string" },
            },
            required: [
              "symbol",
              "timeframe",
              "candles",
              "lastCandleUnix",
              "lastCandleISO",
              "ageSeconds",
              "isStale",
              "tooOld",
              "provider",
            ],
            additionalProperties: false,
          },
          lang: { type: "string", enum: ["ar", "en"] },
        },
        required: ["ohlc"],
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

const SIGNAL_UNUSABLE: Record<LanguageCode, string> = {
  ar: "ما عندي بيانات كافية لهالتايم فريم حالياً. جرّب فريم أعلى (5min أو 1hour).",
  en: "Not enough recent data for that timeframe. Try 5min or 1hour.",
};

function signalUnavailable(language: LanguageCode): string {
  return SIGNAL_UNUSABLE[language] ?? SIGNAL_UNUSABLE.en;
}

function formatSignalBlock(result: TradingSignal, lang: LanguageCode): string {
  return signalFormatter(
    {
      symbol: result.symbol,
      timeframe: result.timeframe,
      timeUTC: result.timeUTC,
      decision: result.decision,
      reason: result.reason,
      levels: result.levels,
      stale: result.stale,
      ageMinutes: result.ageMinutes,
    },
    lang,
  );
}

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

// Remove any 'tool' messages that are not preceded by an assistant message with matching tool_calls
function pruneOrphanToolMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  const seen = new Set<string>();
  for (const m of messages) {
    if (m && m.role === "assistant" && Array.isArray((m as any).tool_calls)) {
      for (const call of (m as any).tool_calls as any[]) {
        const id = call?.id;
        if (typeof id === "string" && id) seen.add(id);
      }
    }
  }
  const pruned: ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m && m.role === "tool") {
      const id = (m as any).tool_call_id;
      if (typeof id === "string" && seen.has(id)) {
        pruned.push(m);
      } else {
        continue;
      }
    } else {
      pruned.push(m);
    }
  }
  return pruned;
}

function sanitiseArgs(args: Record<string, unknown>) {
  const clone: Record<string, unknown> = { ...args };
  if (Array.isArray(clone.candles)) {
    clone.candles = `len:${clone.candles.length}`;
  }
  if (clone.ohlc && typeof clone.ohlc === "object") {
    const ohlc = clone.ohlc as Record<string, unknown>;
    if (Array.isArray(ohlc.candles)) {
      clone.ohlc = { ...ohlc, candles: `len:${ohlc.candles.length}` };
    }
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

function pushToolOrAssistantMessage(
  messages: ChatCompletionMessageParam[],
  callId: string,
  content: string,
) {
  const payload = typeof content === "string" ? content : JSON.stringify(content);
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && Array.isArray((last as any).tool_calls) && last.tool_calls?.length) {
    messages.push({ role: "tool", tool_call_id: callId, content: payload } as ChatCompletionMessageParam);
  } else {
    messages.push({ role: "assistant", content: payload } as ChatCompletionMessageParam);
  }
}

interface ToolContext {
  lastOhlcBySymbolTimeframe: Record<string, GetOhlcSuccess>;
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

    const toolContext: ToolContext = { lastOhlcBySymbolTimeframe: {} };
    const messages = [...baseMessages];

    const respondWithFallback = async (fallback: string, greet: boolean) => {
      const ensured = await ensureConversation();
      return { replyText: applyGreeting(fallback, greet, language), language, conversationId: ensured };
    };

    try {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const safeMessages = pruneOrphanToolMessages(messages);
        const completion = await chat.create({
          model,
          temperature: 0,
          max_tokens: 700,
          messages: safeMessages,
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
              pushToolOrAssistantMessage(messages, call.id, JSON.stringify({ error: "invalid_arguments" }));
              continue;
            }

            console.log("[TOOL]", toolName, sanitiseArgs(parsed));

            try {
              if (toolName === "get_price") {
                const symbol = String(parsed.symbol ?? "").trim();
                const timeframe = typeof parsed.timeframe === "string" ? parsed.timeframe : undefined;
                const price = await tools.get_price(symbol, timeframe);
                console.log("[TOOL] get_price -> ok", { symbol: price.symbol });
                const formatted = priceFormatter(
                  { symbol: price.symbol, price: price.price, ts_utc: price.ts_utc },
                  language,
                );
                pushToolOrAssistantMessage(messages, call.id, formatted);
              } else if (toolName === "get_ohlc") {
                const symbolInput = String(parsed.symbol ?? normalisedText).trim();
                const timeframeInput = String(parsed.timeframe ?? normalisedText).trim();
                const limit = typeof parsed.limit === "number" ? parsed.limit : 60;
                const resolvedSymbol = hardMapSymbol(symbolInput);
                if (!resolvedSymbol) {
                  throw new Error("invalid_symbol");
                }
                const resolvedTimeframe = toTimeframe(timeframeInput);
                const ohlc = await tools.get_ohlc(resolvedSymbol, resolvedTimeframe, limit);
                if (!ohlc.ok) {
                  console.warn("[TOOL] get_ohlc -> no_data", {
                    symbol: resolvedSymbol,
                    timeframe: resolvedTimeframe,
                  });
                  pushToolOrAssistantMessage(messages, call.id, JSON.stringify(ohlc));
                  continue;
                }
                const key = keyFor(resolvedSymbol, resolvedTimeframe);
                toolContext.lastOhlcBySymbolTimeframe[key] = ohlc;
                console.log("[TOOL] get_ohlc -> ok", {
                  symbol: resolvedSymbol,
                  timeframe: resolvedTimeframe,
                  candles: ohlc.candles.length,
                  ageMinutes: ohlc.ageMinutes,
                  stale: ohlc.stale,
                });
                pushToolOrAssistantMessage(
                  messages,
                  call.id,
                  JSON.stringify({
                    symbol: ohlc.symbol,
                    timeframe: ohlc.timeframe,
                    lastISO: ohlc.lastISO,
                    ageMinutes: ohlc.ageMinutes,
                    stale: ohlc.stale,
                    provider: ohlc.provider,
                    candles: `len:${ohlc.candles.length}`,
                  }),
                );
              } else if (toolName === "compute_trading_signal") {
                const parsedOhlc = (parsed as any)?.ohlc ?? {};
                const symbolInput = String(parsedOhlc.symbol ?? normalisedText).trim();
                const timeframeInput = String(parsedOhlc.timeframe ?? normalisedText).trim();
                const resolvedSymbol = hardMapSymbol(symbolInput);
                if (!resolvedSymbol) {
                  throw new Error("invalid_symbol");
                }
                const resolvedTimeframe = toTimeframe(timeframeInput);
                const key = keyFor(resolvedSymbol, resolvedTimeframe);
                let ohlc = toolContext.lastOhlcBySymbolTimeframe[key];
                if (!ohlc) {
                  const fetched = await tools.get_ohlc(resolvedSymbol, resolvedTimeframe, 60);
                  if (!fetched.ok) {
                    return respondWithFallback(signalUnavailable(language), false);
                  }
                  ohlc = fetched;
                  toolContext.lastOhlcBySymbolTimeframe[key] = ohlc;
                }
                const signal = await tools.compute_trading_signal({ ...ohlc, lang: language });
                console.log("[TOOL] compute_trading_signal -> ok", {
                  symbol: resolvedSymbol,
                  timeframe: resolvedTimeframe,
                  candles: ohlc.candles.length,
                  stale: signal.stale,
                  ageMinutes: signal.ageMinutes,
                });
                const ensured = await ensureConversation();
                const block = formatSignalBlock(signal, language);
                const replyText = applyGreeting(block, isNewConversation, language);
                return { replyText, language, conversationId: ensured };
              } else if (toolName === "search_web_news") {
                const query = String(parsed.query ?? normalisedText).trim();
                const news = await tools.search_web_news(query, language === "ar" ? "ar" : "en", 3);
                const formatted = newsFormatter(news.rows, language).trim();
                if (!formatted) {
                  throw new Error("insufficient_news");
                }
                console.log("[TOOL] search_web_news -> ok", { query, lang: language === "ar" ? "ar" : "en" });
                pushToolOrAssistantMessage(messages, call.id, formatted);
              } else if (toolName === "about_liirat_knowledge") {
                const query = String(parsed.query ?? normalisedText).trim();
                const content = await tools.about_liirat_knowledge(query, language);
                console.log("[TOOL] about_liirat_knowledge -> ok");
                pushToolOrAssistantMessage(messages, call.id, content);
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

