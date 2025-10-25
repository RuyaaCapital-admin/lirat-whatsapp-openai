// src/pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { openai } from "../../lib/openai";
import { markReadAndShowTyping, sendText } from "../../lib/waba";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  search_web_news,
  about_liirat_knowledge,
} from "../../tools/agentTools";
import {
  detectLanguage,
  normaliseDigits,
  normaliseSymbolKey,
  parseCandles,
  parseOhlcPayload,
  type LanguageCode,
  type OhlcSnapshot,
  type ToolCandle,
} from "../../utils/webhookHelpers";
import {
  greetingResponse,
  isGreetingOnly,
  sanitizeAssistantReply,
} from "../../utils/replySanitizer";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_ANON_KEY ||
  null;
const TENANT_ID = process.env.TENANT_ID ?? "liirat";

const DATA_UNAVAILABLE: Record<LanguageCode, string> = {
  ar: "البيانات غير متاحة حالياً.",
  en: "Data is not available right now.",
};

const CLARIFY_FALLBACK: Record<LanguageCode, string> = {
  ar: "عذراً، لم أفهم. وضّح طلبك من فضلك.",
  en: "Sorry, I didn’t fully understand. Can you clarify?",
};

const SYSTEM_PROMPT = `You are Liirat Assistant (مساعد ليرات), a concise professional assistant. Always respond in the user’s language (formal Syrian Arabic if the user writes in Arabic, English otherwise). No greetings or emojis. Never reveal your identity unless the user explicitly asks; when they do, answer only: AR «مساعد ليرات» / EN “I’m Liirat assistant.” Clarifications such as “متأكد؟” or “شو يعني؟” must be answered with one short line.

Routing:
- Trading/signal/analysis → normalize symbol/timeframe, call get_ohlc then compute_trading_signal. If the signal is NEUTRAL respond exactly “- SIGNAL: NEUTRAL”. Otherwise reply with:
  - Time: {last_closed_utc}
  - Symbol: {UNSLASHED_SYMBOL}
  - SIGNAL: {BUY|SELL}
  - Entry: {entry}
  - SL: {sl}
  - TP1: {tp1} (R 1.0)
  - TP2: {tp2} (R 2.0)
- Price/quote → get_price and return the tool text verbatim.
- Liirat/company/support → about_liirat_knowledge(query) and return verbatim.
- News/economics → search_web_news(query, lang=detected) and return exactly three lines formatted “YYYY-MM-DD — Source — Title — impact”.
- If ambiguous, ask one short clarifying question (one line max).

Normalization:
- Convert ٠١٢٣٤٥٦٧٨٩ → 0123456789.
- Map: ذهب/دهب/GOLD→XAUUSD; فضة/SILVER→XAGUSD; نفط/WTI→XTIUSD; برنت→XBRUSD; بيتكوين/BTC→BTCUSDT; إيثيريوم/ETH→ETHUSDT; يورو→EURUSD; ين→USDJPY; فرنك→USDCHF; استرليني→GBPUSD; كندي→USDCAD; أسترالي→AUDUSD; نيوزلندي→NZDUSD.
- Timeframes: دقيقة→1min, 5 دقائق→5min, 15→15min, 30→30min, ساعة→1hour, 4 ساعات→4hour, يوم→1day.

Rules:
- Never fabricate data; only report tool results.
- Never output JSON.
- Do not mention tools or internal logic.
- If a tool fails, reply: AR «البيانات غير متاحة حالياً.» / EN “Data is not available right now.”`;

const TOOL_SCHEMAS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_price",
      description: "Return latest price text for a symbol.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "XAUUSD, EURUSD, BTCUSDT, … (UNSLASHED)",
          },
          timeframe: {
            type: "string",
            description: "e.g. 1min | 5min | 1hour | 1day",
          },
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
          symbol: { type: "string", description: "UNSLASHED symbol" },
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
      description: "Compute signal (BUY/SELL/NEUTRAL) from OHLC.",
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
                t: { type: "integer", description: "ms since epoch" },
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
      description: "Return an array of 3 market news rows for the topic and language.",
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
      description: "Answer company/support/platform questions from the Liirat KB.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
] as ChatCompletionTool[];

let supabaseClient: SupabaseClient | null = null;
const processedMessageCache = new Set<string>();

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

async function ensureConversation(
  waNumber: string,
  contactName?: string,
): Promise<string | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from("conversations")
      .select("id")
      .eq("user_id", waNumber)
      .eq("tenant_id", TENANT_ID)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      throw error;
    }
    if (data?.id) {
      return data.id as string;
    }
  } catch (error) {
    console.warn("[SUPABASE] ensureConversation lookup failed", error);
    return null;
  }

  try {
    const title = (contactName ?? "").trim() || waNumber;
    const { data, error } = await client
      .from("conversations")
      .insert({
        user_id: waNumber,
        tenant_id: TENANT_ID,
        title,
      })
      .select("id")
      .single();
    if (error) {
      throw error;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.warn("[SUPABASE] ensureConversation insert failed", error);
    return null;
  }
}

async function logMessage(
  conversationId: string,
  waNumber: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    const payload = {
      conversation_id: conversationId,
      user_id: role === "user" ? waNumber : "assistant",
      role,
      content,
    };
    const { error } = await client.from("messages").insert(payload);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[SUPABASE] logMessage failed", error);
  }
}

async function saveTurnToSupabase(
  incoming: WebhookMessage,
  assistantReplyText: string,
): Promise<void> {
  const conversationId = await ensureConversation(incoming.from, incoming.contactName);
  if (!conversationId) {
    return;
  }
  await logMessage(conversationId, incoming.from, "user", incoming.text);
  await logMessage(conversationId, incoming.from, "assistant", assistantReplyText);
}

type WebhookMessage = {
  id: string;
  from: string;
  text: string;
  contactName?: string;
  timestamp?: number;
};

async function loadRecentMessages(
  waNumber: string,
  limit = 10,
): Promise<ChatCompletionMessageParam[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }
  try {
    const { data: convRows, error: convError } = await client
      .from("conversations")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("user_id", waNumber)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (convError) {
      throw convError;
    }
    const conversationId = Array.isArray(convRows) && convRows[0]?.id ? convRows[0].id : null;
    if (!conversationId) {
      return [];
    }
    const { data: messageRows, error: messagesError } = await client
      .from("messages")
      .select("role,content,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (messagesError) {
      throw messagesError;
    }
    return (Array.isArray(messageRows) ? messageRows : [])
      .map((row) => {
        const role = row?.role === "assistant" ? "assistant" : row?.role === "user" ? "user" : null;
        const content = typeof row?.content === "string" ? row.content.trim() : "";
        if (!role || !content) {
          return null;
        }
        return { role, content } as ChatCompletionMessageParam;
      })
      .filter((item): item is ChatCompletionMessageParam => Boolean(item));
  } catch (error) {
    console.warn("[SUPABASE] loadRecentMessages failed", error);
    return [];
  }
}

function extractMessage(payload: any): WebhookMessage | null {
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }
    const message = messages[0];
    if (!message?.text?.body) {
      return null;
    }
    const timestamp = typeof message.timestamp === "string" ? Number(message.timestamp) : undefined;
    let contactName: string | undefined;
    const contact = Array.isArray(value?.contacts) ? value.contacts[0] : undefined;
    if (contact?.profile?.name && typeof contact.profile.name === "string") {
      contactName = contact.profile.name;
    }
    return {
      id: message.id,
      from: message.from,
      text: message.text.body,
      contactName,
      timestamp: Number.isFinite(timestamp) ? Number(timestamp) : undefined,
    };
  } catch (error) {
    console.warn("[WEBHOOK] extract failed", error);
    return null;
  }
}

class ToolExecutionError extends Error {
  constructor(
    readonly tool: string,
    readonly language: LanguageCode,
    cause?: unknown,
  ) {
    super(`tool_failed:${tool}`);
    if (cause) {
      this.stack = (cause as Error)?.stack;
    }
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const cloned: Record<string, unknown> = { ...args };
  if (Array.isArray(cloned.candles)) {
    cloned.candles = `len:${cloned.candles.length}`;
  }
  return cloned;
}

async function runChatLoop(
  baseMessages: ChatCompletionMessageParam[],
  lang: LanguageCode,
  userLang: LanguageCode,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [...baseMessages];
  let lastOhlc: OhlcSnapshot | null = null;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: TOOL_SCHEMAS,
      tool_choice: "auto",
      temperature: 0,
    });
    const choice = completion.choices[0];
    if (!choice) {
      break;
    }
    const message = choice.message;
    if (message?.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        const name = toolCall.function?.name;
        if (!name) {
          throw new Error("missing_tool_name");
        }
        const rawArgs = toolCall.function?.arguments ?? "{}";
        let parsed: Record<string, unknown>;
        try {
          parsed = rawArgs ? JSON.parse(rawArgs) : {};
        } catch (error) {
          console.warn("[TOOLS] invalid arguments", { name, rawArgs });
          throw new ToolExecutionError(name, lang, error);
        }
        console.info("[TOOLS]", { name, args: sanitizeArgs(parsed) });
        let content = "";
        try {
          switch (name) {
            case "get_price": {
              const symbol = String(parsed.symbol ?? "").trim();
              const timeframe = typeof parsed.timeframe === "string" ? parsed.timeframe : undefined;
              content = await get_price(symbol, timeframe);
              break;
            }
            case "get_ohlc": {
              const symbol = String(parsed.symbol ?? "").trim();
              const timeframe = String(parsed.timeframe ?? "").trim();
              const limit = typeof parsed.limit === "number" ? parsed.limit : undefined;
              content = await get_ohlc(symbol, timeframe, limit);
              lastOhlc = parseOhlcPayload(content);
              break;
            }
            case "compute_trading_signal": {
              const symbol = String(parsed.symbol ?? "").trim();
              const timeframe = String(parsed.timeframe ?? "").trim();
              let candles: ToolCandle[] | undefined = parseCandles(parsed.candles);
              const normalisedSymbol = normaliseSymbolKey(symbol);
              if (
                (!candles || candles.length < 50) &&
                lastOhlc &&
                normaliseSymbolKey(lastOhlc.symbol) === normalisedSymbol &&
                lastOhlc.timeframe === timeframe
              ) {
                candles = lastOhlc.candles;
              }
              if (!candles || candles.length < 50) {
                const freshOhlc = await get_ohlc(symbol, timeframe, 200);
                const parsedSnapshot = parseOhlcPayload(freshOhlc);
                if (parsedSnapshot) {
                  lastOhlc = parsedSnapshot;
                  candles = parsedSnapshot.candles;
                }
              }
              if (!candles || candles.length < 50) {
                throw new ToolExecutionError(name, lang, new Error("missing_candles"));
              }
              content = await compute_trading_signal(symbol, timeframe, candles);
              break;
            }
            case "search_web_news": {
              const query = String(parsed.query ?? "").trim();
              const count = typeof parsed.count === "number" ? parsed.count : 3;
              const requestedLang =
                typeof parsed.lang === "string" && ["ar", "en"].includes(parsed.lang)
                  ? (parsed.lang as LanguageCode)
                  : userLang;
              content = await search_web_news(query, requestedLang, count);
              break;
            }
            case "about_liirat_knowledge": {
              const query = String(parsed.query ?? "").trim();
              content = await about_liirat_knowledge(query, lang);
              break;
            }
            default: {
              throw new Error(`unknown_tool:${name}`);
            }
          }
        } catch (error) {
          console.warn("[TOOLS] execution failed", { name }, error);
          if (error instanceof ToolExecutionError) {
            throw error;
          }
          throw new ToolExecutionError(name, lang, error);
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content,
        });
      }
      continue;
    }
    const content = message?.content?.trim();
    if (content) {
      return content;
    }
    if (choice.finish_reason === "stop") {
      break;
    }
  }
  return "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.status(200).send(challenge ?? "");
      return;
    }
    res.status(403).send("Forbidden");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  if (!req.body?.entry?.[0]?.changes?.[0]?.value?.messages) {
    res.status(200).json({ received: true });
    return;
  }

  const inbound = extractMessage(req.body);
  if (!inbound || !inbound.text?.trim()) {
    res.status(200).json({ received: true });
    return;
  }

  if (processedMessageCache.has(inbound.id)) {
    res.status(200).json({ received: true });
    return;
  }

  res.status(200).json({ received: true });
  processedMessageCache.add(inbound.id);
  console.info(`[RECV ${inbound.id}]`, {
    from: inbound.from,
    preview: inbound.text.slice(0, 160),
  });

  void (async () => {
    const normalisedText = normaliseDigits(inbound.text.trim());
    const lang = detectLanguage(normalisedText);

    try {
      await markReadAndShowTyping(inbound.id);
    } catch (error) {
      console.warn("[WEBHOOK] markRead/typing failed", {
        error,
        data: (error as { response?: { data?: unknown } })?.response?.data,
      });
    }

    const greetingOnly = isGreetingOnly(normalisedText, lang);

    let finalText = greetingOnly ? greetingResponse(lang) : CLARIFY_FALLBACK[lang];
    if (!greetingOnly) {
      try {
        const history = await loadRecentMessages(inbound.from, 10);
        const messages: ChatCompletionMessageParam[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: normalisedText },
        ];
        const reply = await runChatLoop(messages, lang, lang);
        const sanitized = sanitizeAssistantReply(reply, lang);
        if (sanitized) {
          finalText = sanitized;
        }
      } catch (error) {
        if (error instanceof ToolExecutionError) {
          finalText = DATA_UNAVAILABLE[lang];
        } else {
          console.error("[WEBHOOK] processing failed", error);
          finalText = CLARIFY_FALLBACK[lang];
        }
      }
    }

    finalText = sanitizeAssistantReply(finalText, lang) || CLARIFY_FALLBACK[lang];

    try {
      await sendText(inbound.from, finalText);
      console.info("[SEND ok]", {
        to: inbound.from,
        preview: finalText.slice(0, 120),
      });
    } catch (error) {
      console.error("[SEND fail]", {
        to: inbound.from,
        error,
        data: (error as { response?: { data?: unknown } })?.response?.data,
      });
      return;
    }

    try {
      await saveTurnToSupabase(inbound, finalText);
    } catch (error) {
      console.warn("[SUPABASE] disabled", error);
    }
  })();
}
