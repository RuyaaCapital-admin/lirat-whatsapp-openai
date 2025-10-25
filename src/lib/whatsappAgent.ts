// src/lib/whatsappAgent.ts
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionCreateParams,
} from "openai/resources/chat/completions";
import type { GetOhlcSuccess } from "../tools/ohlc";
import type { ConversationMemoryAdapter, HistoryMessage } from "./memory";
import { fallbackUnavailableMessage } from "./memory";

export type ToolResult = string | { text?: string } | { error?: string } | Record<string, unknown> | null;

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface SmartReplyDeps {
  chat: {
    create: (params: ChatCompletionCreateParams) => Promise<ChatCompletion>;
  };
  toolSchemas: readonly any[];
  toolHandlers: Record<string, ToolHandler>;
  systemPrompt: string;
  memory: ConversationMemoryAdapter;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface SmartReplyInput {
  userId: string;
  text: string;
  history?: HistoryMessage[];
}

function asMessage(historyMessage: HistoryMessage): ChatCompletionMessageParam {
  return {
    role: historyMessage.role,
    content: historyMessage.content,
  };
}

function isOhlcResult(result: unknown): result is GetOhlcSuccess {
  if (!result || typeof result !== "object") {
    return false;
  }
  const candidate = result as Partial<GetOhlcSuccess>;
  return (
    candidate.ok === true &&
    typeof candidate.symbol === "string" &&
    typeof candidate.timeframe === "string" &&
    Array.isArray(candidate.candles) &&
    typeof candidate.lastISO === "string" &&
    typeof candidate.ageMinutes === "number" &&
    typeof candidate.stale === "boolean" &&
    typeof candidate.provider === "string"
  );
}

function serialiseToolResult(result: ToolResult): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    if ("text" in result && typeof (result as any).text === "string") {
      return (result as any).text;
    }
    try {
      return JSON.stringify(result);
    } catch (error) {
      return String(result);
    }
  }
  return String(result);
}

function readMessageContent(message: ChatCompletion["choices"][0]["message"]): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  const content = message.content as any;
  if (Array.isArray(content)) {
    return content
      .map((chunk: any) => {
        if (!chunk) return "";
        if (typeof chunk === "string") return chunk;
        if (typeof chunk === "object" && "text" in chunk) {
          return typeof chunk.text === "string" ? chunk.text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function detectLanguage(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function formatFromPossibleJson(raw: string, userText: string): string {
  const text = (raw || "").trim();
  if (!text) return text;
  const first = text[0];
  if (first !== "{" && first !== "[") return text;
  try {
    const parsed = JSON.parse(text);
    const lang = detectLanguage(userText);
    const isArabic = lang === "ar";
    const lines: string[] = [];
    if (parsed && typeof parsed === "object") {
      if (parsed.timeUtc && parsed.symbol && typeof parsed.price === "number") {
        // Price payload
        lines.push(isArabic ? `الوقت (UTC): ${parsed.timeUtc}` : `time (UTC): ${parsed.timeUtc}`);
        lines.push(isArabic ? `الرمز: ${parsed.symbol}` : `symbol: ${parsed.symbol}`);
        lines.push(isArabic ? `السعر: ${parsed.price}` : `price: ${parsed.price}`);
        return lines.join("\n");
      }
      if (parsed.timeframe && parsed.signal && parsed.timeUtc && parsed.symbol) {
        // Signal payload
        const reasonKey = String(parsed.reason || "no_clear_bias");
        const reasonMap = isArabic
          ? { bullish_pressure: "ضغط شراء فوق المتوسطات", bearish_pressure: "ضغط بيع تحت المتوسطات", no_clear_bias: "السوق بدون اتجاه واضح حالياً" }
          : { bullish_pressure: "Buy pressure above short-term averages", bearish_pressure: "Bearish momentum below resistance", no_clear_bias: "No clear directional bias right now" };
        const reasonText = (reasonMap as any)[reasonKey] || reasonMap.no_clear_bias;
        lines.push(isArabic ? `الوقت (UTC): ${parsed.timeUtc}` : `time (UTC): ${parsed.timeUtc}`);
        lines.push(isArabic ? `الرمز: ${parsed.symbol}` : `symbol: ${parsed.symbol}`);
        lines.push(isArabic ? `الإطار الزمني: ${parsed.timeframe}` : `timeframe: ${parsed.timeframe}`);
        lines.push(`SIGNAL: ${parsed.signal}`);
        lines.push((isArabic ? "السبب" : "Reason") + ": " + reasonText);
        if (String(parsed.signal).toUpperCase() !== "NEUTRAL") {
          lines.push(`Entry: ${parsed.entry ?? "-"}`);
          lines.push(`SL: ${parsed.sl ?? "-"}`);
          lines.push(`TP1: ${parsed.tp1 ?? "-"}`);
          lines.push(`TP2: ${parsed.tp2 ?? "-"}`);
        } else {
          lines.push(`Entry: -`);
          lines.push(`SL: -`);
          lines.push(`TP1: -`);
          lines.push(`TP2: -`);
        }
        return lines.join("\n");
      }
    }
    return text;
  } catch {
    return text;
  }
}

export function createSmartReply(deps: SmartReplyDeps) {
  const {
    chat,
    toolSchemas,
    toolHandlers,
    systemPrompt,
    memory,
    model = "gpt-4o",
    temperature = 0,
    maxTokens = 700,
  } = deps;

  if (!chat?.create) {
    throw new Error("chat client with create(...) is required");
  }

  return async function smartReply({ userId, text, history: overrideHistory }: SmartReplyInput): Promise<string> {
    const trimmed = text?.trim() ?? "";
    const history = overrideHistory && overrideHistory.length ? overrideHistory : await memory.getHistory(userId);
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map(asMessage),
      { role: "user", content: trimmed },
    ];

    // Track last OHLC result for automatic candle injection
    let lastOhlcResult: GetOhlcSuccess | null = null;

    while (true) {
      const completion = await chat.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
        tool_choice: "auto",
        tools: toolSchemas as ChatCompletionCreateParams["tools"],
      });

      const message = completion.choices[0].message;
      const toolCalls = message.tool_calls || [];

      if (!toolCalls.length) {
        const finalText = readMessageContent(message).trim();
        const coerced = formatFromPossibleJson(finalText, trimmed);
        const output = coerced || fallbackUnavailableMessage(trimmed);
        await memory.appendHistory(userId, [
          { role: "user", content: trimmed },
          { role: "assistant", content: output },
        ]);
        return output;
      }

      messages.push({
        role: message.role,
        content: readMessageContent(message),
        tool_calls: message.tool_calls,
      } as ChatCompletionMessageParam);

      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        let args: Record<string, unknown> = {};
        try {
          const rawArgs: any = call.function?.arguments as any;
          if (typeof rawArgs === "string") {
            args = rawArgs ? JSON.parse(rawArgs) : {};
          } else if (rawArgs && typeof rawArgs === "object") {
            args = rawArgs;
          } else {
            args = {};
          }
        } catch (error) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "invalid_arguments" }),
          });
          continue;
        }

        let result: ToolResult;
        try {
          const handler = toolHandlers[name];
          if (!handler) {
            throw new Error(`unknown_tool:${name}`);
          }

          // Special handling for compute_trading_signal to inject candles from last get_ohlc
          if (name === "compute_trading_signal") {
            const symbol = String((args.ohlc as any)?.symbol ?? args.symbol ?? "").trim();
            const timeframe = String((args.ohlc as any)?.timeframe ?? args.timeframe ?? "").trim();
            // Inject last OHLC when it matches
            if (
              symbol &&
              timeframe &&
              lastOhlcResult &&
              lastOhlcResult.symbol === symbol &&
              lastOhlcResult.timeframe === timeframe
            ) {
              args.ohlc = lastOhlcResult;
              console.info(`[CANDLE_INJECTION] Auto-injecting OHLC for ${symbol} ${timeframe}`);
            }
            // If still missing candles but we have symbol/timeframe, fetch directly
            if ((!args.ohlc || !(args.ohlc as any).candles) && symbol && timeframe) {
              try {
                const fetched = await toolHandlers["get_ohlc"]({ symbol, timeframe, limit: 150 });
                if (fetched && (fetched as any).ok && (fetched as any).candles?.length) {
                  args.ohlc = fetched as any;
                }
              } catch {}
            }
          }

          result = await handler(args);

          // Track get_ohlc results for potential use by compute_trading_signal
          if (name === "get_ohlc" && isOhlcResult(result)) {
            lastOhlcResult = result;
          } else if (name === "get_ohlc") {
            lastOhlcResult = null;
          }
        } catch (error) {
          const err = error as Error;
          result = { error: err?.message || String(error) };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: serialiseToolResult(result),
        });
      }
    }
  };
}

export type SmartReply = ReturnType<typeof createSmartReply>;

