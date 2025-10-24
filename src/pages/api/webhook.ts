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

type Role = "user" | "assistant";

type StoredMessageRow = {
  role?: string | null;
  text?: string | null;
  body?: string | null;
  content?: string | null;
  message_id?: string | null;
  ts?: string | null;
  created_at?: string | null;
};

type WebhookMessage = {
  id: string;
  from: string;
  text: string;
  timestamp?: number;
};

type LanguageCode = "ar" | "en";

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY || null;

const FALLBACK_REPLY: Record<LanguageCode, string> = {
  ar: "البيانات غير متاحة حالياً. جرّب: price BTCUSDT.",
  en: "Data unavailable right now. Try: price BTCUSDT.",
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
- If a tool fails, reply: AR «البيانات غير متاحة حالياً. جرّب: price BTCUSDT.» / EN “Data unavailable right now. Try: price BTCUSDT.”`;

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
let supabaseDisabled = false;
const processedMessageCache = new Set<string>();

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseDisabled) {
    return null;
  }
  if (!supabaseClient && SUPABASE_URL && SUPABASE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

function disableSupabase(reason: string, error: unknown) {
  if (!supabaseDisabled) {
    supabaseDisabled = true;
    supabaseClient = null;
    console.warn("[SUPABASE] disabled", { reason, error });
  }
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && code === "PGRST205";
}

function detectLanguage(text: string): LanguageCode {
  return /\p{Script=Arabic}/u.test(text) ? "ar" : "en";
}

function normaliseDigits(text: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return text.replace(/[٠-٩]/g, (char) => {
    const index = arabicDigits.indexOf(char);
    return index >= 0 ? String(index) : char;
  });
}

function parseTimestamp(row: StoredMessageRow): number | null {
  const candidates = [row.ts, row.created_at];
  for (const value of candidates) {
    if (typeof value === "string" && value) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function coerceRole(row: StoredMessageRow): Role | null {
  const raw = (row.role ?? "").toString().toLowerCase();
  if (["user", "in", "incoming", "inbound"].includes(raw)) return "user";
  if (["assistant", "out", "outgoing", "outbound", "bot"].includes(raw)) return "assistant";
  return null;
}

function extractBody(row: StoredMessageRow): string {
  const candidates = [row.text, row.body, row.content];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function persistMessage(params: {
  waId: string;
  role: Role;
  text: string;
  ts: string;
  messageId: string;
  replyTo?: string | null;
}) {
  const client = getSupabaseClient();
  if (!client) return;
  const payload: Record<string, unknown> = {
    wa_id: params.waId,
    role: params.role,
    text: params.text,
    body: params.text,
    content: params.text,
    ts: params.ts,
    message_id: params.messageId,
  };
  if (params.replyTo) {
    payload.reply_to_wamid = params.replyTo;
  }
  try {
    const { error } = await client.from("messages").insert(payload);
    if (error) {
      if (isMissingTableError(error)) {
        disableSupabase("missing_table", error);
        return;
      }
      console.warn("[SUPABASE] persist failed", error);
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      disableSupabase("missing_table_exception", error);
      return;
    }
    console.warn("[SUPABASE] persist exception", error);
  }
}

async function messageExists(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const client = getSupabaseClient();
  if (!client) {
    return processedMessageCache.has(messageId);
  }
  try {
    const { data, error } = await client
      .from("messages")
      .select("id")
      .eq("message_id", messageId)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      if (isMissingTableError(error)) {
        disableSupabase("missing_table", error);
        return processedMessageCache.has(messageId);
      }
      console.warn("[SUPABASE] duplicate check failed", error);
      return false;
    }
    return Boolean(data);
  } catch (error) {
    if (isMissingTableError(error)) {
      disableSupabase("missing_table_exception", error);
      return processedMessageCache.has(messageId);
    }
    console.warn("[SUPABASE] duplicate check exception", error);
    return false;
  }
}

async function loadRecentMessages(
  waId: string,
  limit = 10,
  excludeMessageId?: string,
): Promise<ChatCompletionMessageParam[]> {
  const client = getSupabaseClient();
  if (!client || !waId) {
    return [];
  }
  try {
    const { data, error } = await client
      .from("messages")
      .select("role,text,body,content,message_id,ts,created_at")
      .eq("wa_id", waId)
      .order("ts", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limit * 3);
    if (error) {
      if (isMissingTableError(error)) {
        disableSupabase("missing_table", error);
        return [];
      }
      console.warn("[SUPABASE] load history failed", error);
      return [];
    }
    const rows = Array.isArray(data) ? (data as StoredMessageRow[]) : [];
    const prepared = rows
      .filter((row) => row.message_id !== excludeMessageId)
      .map((row) => {
        const role = coerceRole(row);
        const text = extractBody(row);
        const ts = parseTimestamp(row) ?? 0;
        if (!role || !text) return null;
        return { role, text, ts };
      })
      .filter((value): value is { role: Role; text: string; ts: number } => Boolean(value));
    prepared.sort((a, b) => a.ts - b.ts);
    return prepared
      .slice(-limit)
      .map((item): ChatCompletionMessageParam => ({ role: item.role, content: item.text }));
  } catch (error) {
    if (isMissingTableError(error)) {
      disableSupabase("missing_table_exception", error);
      return [];
    }
    console.warn("[SUPABASE] load history exception", error);
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
    return {
      id: message.id,
      from: message.from,
      text: message.text.body,
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

type ToolCandle = { o: number; h: number; l: number; c: number; t: number };

type OhlcSnapshot = { symbol: string; timeframe: string; candles: ToolCandle[] };

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const cloned: Record<string, unknown> = { ...args };
  if (Array.isArray(cloned.candles)) {
    cloned.candles = `len:${cloned.candles.length}`;
  }
  return cloned;
}

function parseCandles(input: unknown): ToolCandle[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => ({
      o: Number((item as any)?.o),
      h: Number((item as any)?.h),
      l: Number((item as any)?.l),
      c: Number((item as any)?.c),
      t: Number((item as any)?.t),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.o) &&
        Number.isFinite(candle.h) &&
        Number.isFinite(candle.l) &&
        Number.isFinite(candle.c) &&
        Number.isFinite(candle.t),
    )
    .sort((a, b) => a.t - b.t);
}

function parseOhlcPayload(content: string): OhlcSnapshot | null {
  try {
    const outer = JSON.parse(content);
    if (!outer || typeof outer.text !== "string") {
      return null;
    }
    const inner = JSON.parse(outer.text);
    if (
      inner &&
      typeof inner.symbol === "string" &&
      typeof inner.timeframe === "string" &&
      Array.isArray(inner.candles)
    ) {
      const candles = parseCandles(inner.candles) ?? [];
      if (candles.length) {
        return { symbol: inner.symbol, timeframe: inner.timeframe, candles };
      }
    }
  } catch (error) {
    console.warn("[TOOLS] failed to parse OHLC payload", error);
  }
  return null;
}

function normaliseSymbolKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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
      throw new Error("no_completion_choice");
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
              let candles = parseCandles(parsed.candles);
              if (
                (!candles || candles.length < 50) &&
                lastOhlc &&
                normaliseSymbolKey(lastOhlc.symbol) === normaliseSymbolKey(symbol) &&
                lastOhlc.timeframe === timeframe
              ) {
                candles = lastOhlc.candles;
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
            default:
              throw new Error(`unknown_tool:${name}`);
          }
        } catch (error) {
          console.warn("[TOOLS] execution failed", { name }, error);
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
      return content ?? "";
    }
  }
  throw new Error("tool_loop_exceeded");
}

function toIsoTimestamp(timestamp?: number): string {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
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

  if (await messageExists(inbound.id)) {
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
    const isoTs = toIsoTimestamp(inbound.timestamp);
    try {
      await markReadAndShowTyping(inbound.id);
    } catch (error) {
      console.warn("[WEBHOOK] markRead/typing failed", {
        error,
        data: (error as { response?: { data?: unknown } })?.response?.data,
      });
    }

    await persistMessage({
      waId: inbound.from,
      role: "user",
      text: normalisedText,
      ts: isoTs,
      messageId: inbound.id,
    });

    const history = await loadRecentMessages(inbound.from, 10, inbound.id);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: normalisedText },
    ];

    let finalText = FALLBACK_REPLY[lang];
    try {
      const reply = await runChatLoop(messages, lang, lang);
      const trimmed = reply.trim();
      if (!trimmed) {
        throw new Error("empty_reply");
      }
      finalText = trimmed;
    } catch (error) {
      console.error("[WEBHOOK] processing failed", error);
    }

    const assistantMessageId =
      globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
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
    }

    await persistMessage({
      waId: inbound.from,
      role: "assistant",
      text: finalText,
      ts: new Date().toISOString(),
      messageId: assistantMessageId,
      replyTo: inbound.id,
    });
  })();
}

