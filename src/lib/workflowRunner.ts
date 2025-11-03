// src/lib/workflowRunner.ts
import { openai } from "./openai";
import type { ChatCompletion, ChatCompletionCreateParams } from "openai/resources/chat/completions";
import { TOOL_SCHEMAS } from "./toolSchemas";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { memory } from "./memory";
import { createSmartReply } from "./whatsappAgent";
import {
  get_price,
  get_ohlc,
  compute_trading_signal,
  type TradingSignal,
  about_liirat_knowledge,
  get_time_now,
} from "../tools/agentTools";
import { normaliseAgentNewsItems, runAgentNews } from "./newsAgent";

export type ToolResult = any;

const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL?.trim() || "gpt-4o-mini";

function detectLanguage(text: string): "ar" | "en" {
  return /[\u0600-\u06FF]/.test(text) ? "ar" : "en";
}

function formatPriceFromJson(obj: any, lang: "ar" | "en"): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (!obj.timeUtc || !obj.symbol || typeof obj.price !== "number") return null;
  const time = String(obj.timeUtc);
  const symbol = String(obj.symbol);
  const price = Number(obj.price);
  if (lang === "ar") {
    return [`الوقت (UTC): ${time}`, `الرمز: ${symbol}`, `السعر: ${price}`].join("\n");
  }
  return [`time (UTC): ${time}`, `symbol: ${symbol}`, `price: ${price}`].join("\n");
}

const REASON_MAP = {
  ar: {
    bullish_pressure: "ضغط شراء فوق المتوسطات",
    bearish_pressure: "ضغط بيع تحت المتوسطات",
    no_clear_bias: "السوق بدون اتجاه واضح حالياً",
  },
  en: {
    bullish_pressure: "Buy pressure above short-term averages",
    bearish_pressure: "Bearish momentum below resistance",
    no_clear_bias: "No clear directional bias right now",
  },
} as const;

function formatSignalFromJson(obj: any, lang: "ar" | "en"): string | null {
  if (!obj || typeof obj !== "object") return null;
  const hasFields = obj.timeUtc && obj.symbol && obj.timeframe && obj.signal;
  if (!hasFields) return null;
  const time = String(obj.timeUtc);
  const symbol = String(obj.symbol);
  const timeframe = String(obj.timeframe);
  const decision = String(obj.signal);
  const reasonKey = String(obj.reason || "no_clear_bias") as keyof typeof REASON_MAP.en;
  const reasonText = (REASON_MAP as any)[lang]?.[reasonKey] || REASON_MAP.en.no_clear_bias;
  const entry = obj.entry;
  const sl = obj.sl;
  const tp1 = obj.tp1;
  const tp2 = obj.tp2;

  const lines: string[] = [];
  lines.push(lang === "ar" ? `الوقت (UTC): ${time}` : `time (UTC): ${time}`);
  lines.push(lang === "ar" ? `الرمز: ${symbol}` : `symbol: ${symbol}`);
  lines.push(lang === "ar" ? `الإطار الزمني: ${timeframe}` : `timeframe: ${timeframe}`);
  lines.push(`SIGNAL: ${decision}`);
  lines.push((lang === "ar" ? "Reason".replace("Reason", "السبب") : "Reason") + ": " + reasonText);
  if (String(decision).toUpperCase() !== "NEUTRAL") {
    lines.push(`Entry: ${entry ?? "-"}`);
    lines.push(`SL: ${sl ?? "-"}`);
    lines.push(`TP1: ${tp1 ?? "-"}`);
    lines.push(`TP2: ${tp2 ?? "-"}`);
  } else {
    lines.push(`Entry: -`);
    lines.push(`SL: -`);
    lines.push(`TP1: -`);
    lines.push(`TP2: -`);
  }
  return lines.join("\n");
}

function coerceTextIfJson(raw: string, userText: string): string {
  const text = (raw || "").trim();
  if (!text) return text;
  const first = text[0];
  if (first !== "{" && first !== "[") return text;
  try {
    const parsed = JSON.parse(text);
    const lang = detectLanguage(userText);
    if (Array.isArray(parsed)) {
      const maybe = parsed.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
      if (maybe.trim()) return maybe.trim();
      return text;
    }
    const price = formatPriceFromJson(parsed, lang);
    if (price) return price;
    const signal = formatSignalFromJson(parsed, lang);
    if (signal) return signal;
    return text;
  } catch {
    return text;
  }
}

function salvageArgs(raw: string): Record<string, any> | null {
  if (typeof raw !== "string" || !raw) return null;
  const sym = raw.match(/"symbol"\s*:\s*"([A-Za-z0-9/_-]+)"/);
  const tf = raw.match(/"timeframe"\s*:\s*"([A-Za-z0-9]+)"/);
  if (sym && tf) {
    return { symbol: sym[1], timeframe: tf[1] };
  }
  return null;
}

const toolHandlers: Record<string, (args: Record<string, any>) => Promise<ToolResult>> = {
  async get_price(args) {
    const symbol = String(args.symbol || "").trim();
    const tf = typeof args.timeframe === "string" ? args.timeframe : undefined;
    const res = await get_price(symbol, tf);
    return { timeUtc: res.ts_utc, symbol: res.symbol, price: res.price };
  },
  async get_ohlc(args) {
    const symbol = String(args.symbol || "").trim();
    const timeframe = String(args.timeframe || "").trim();
    const limit = Number.isFinite(args.limit) ? Number(args.limit) : 60;
    return await get_ohlc(symbol, timeframe, limit);
  },
  async compute_trading_signal(args) {
    let ohlc = args.ohlc || args;
    const desiredSymbol = String(ohlc.symbol || args.symbol || "").trim();
    const desiredTf = String(ohlc.timeframe || args.timeframe || "").trim();

    if (!ohlc?.candles || !Array.isArray(ohlc.candles)) {
      const sym = String(ohlc.symbol || args.symbol || "").trim();
      const tf = String(ohlc.timeframe || args.timeframe || "").trim();
      if (sym && tf) {
        const fetched = await get_ohlc(sym, tf, 60);
        if (fetched && (fetched as any).ok) {
          ohlc = fetched;
        }
      }
    }
    if (!ohlc?.candles || ohlc.candles.length < 30) {
      if (desiredSymbol && desiredTf) {
        const fetched = await get_ohlc(desiredSymbol, desiredTf, 150);
        if (fetched && (fetched as any).ok && (fetched as any).candles?.length >= 30) {
          ohlc = fetched;
        }
      }
    }
    const signal: TradingSignal = await compute_trading_signal(ohlc);
    return {
      timeUtc: signal.timeUTC,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      signal: signal.decision,
      reason: signal.reason,
      entry: signal.levels.entry,
      sl: signal.levels.sl,
      tp1: signal.levels.tp1,
      tp2: signal.levels.tp2,
      isFresh: !signal.stale,
      stale: Boolean(signal.stale),
    };
  },
  async agent_reuters_news(args) {
    const query = String(args.query || "").trim();
    if (!query) {
      return { news: { items: [] } };
    }
    const payload = await runAgentNews(query);
    const items = normaliseAgentNewsItems(payload);
    return { news: { items } };
  },
  async about_liirat_knowledge(args) {
    const query = String(args.query || "").trim();
    const lang = typeof args.lang === "string" ? args.lang : undefined;
    const answer = await about_liirat_knowledge(query, lang);
    return { answer };
  },
  async get_time_now(args) {
    const tz = typeof args.timezone === "string" ? args.timezone : undefined;
    return await get_time_now(tz);
  },
};

function serialiseToolResult(result: ToolResult): string {
  if (result == null) return "";
  try { return JSON.stringify(result); } catch { return String(result); }
}

export async function runWorkflowMessage({
  sessionId,
  workflowId,
  version,
  userText,
}: {
  sessionId: string;
  workflowId: string;
  version?: number;
  userText: string;
}): Promise<string> {
  const wf: any = (openai as any).workflows;

  // --- If Workflows API not available, use Chat-Completions tool loop -----------
  if (!wf?.runs?.create) {
    const smartReply = createSmartReply({
      chat: {
        create: (params: ChatCompletionCreateParams): Promise<ChatCompletion> =>
          openai.chat.completions
            .create({
              // CRITICAL: ensure model is present to avoid 400
              model: (params as any).model || FALLBACK_MODEL,
              ...(params as any),
              stream: false,
            })
            .then((r: any) => r as ChatCompletion),
      },
      toolSchemas: TOOL_SCHEMAS,
      toolHandlers,
      systemPrompt: SYSTEM_PROMPT,
      memory,
      // also tell smartReply our preferred model for any calls it creates
      model: FALLBACK_MODEL,
      temperature: 0,
      maxTokens: 700,
    });
    return await smartReply({ userId: sessionId, text: userText });
  }

  // --- Prefer official Workflows runner ----------------------------------------
  // Optional dynamic user entrypoint (if provided)
  if ((openai as any).agents?.Runner) {
    try {
      const modulePath = process.env.OPENAI_WORKFLOW_ENTRY || "";
      if (modulePath) {
        const mod = await import(modulePath);
        if (mod?.runWorkflow) {
          const result = await mod.runWorkflow({ input_as_text: userText });
          const out = (result?.output_text ?? "").toString().trim();
          if (out) return out;
        }
      }
    } catch {
      // fall through to workflows API
    }
  }

  // Run workflow
  let run = await wf.runs.create({
    workflow_id: workflowId,
    version,
    session_id: sessionId,
    input: { input_as_text: userText },
  });

  // Poll + handle required tool calls
  while (true) {
    const toolCalls: any[] = Array.isArray(run?.required_action?.submit_tool_outputs?.tool_calls)
      ? run.required_action.submit_tool_outputs.tool_calls
      : [];

    if (toolCalls.length) {
      const outputs: Array<{ tool_call_id: string; output: string }> = [];
      for (const call of toolCalls) {
        const name = call?.function?.name || "";
        const id = call?.id || "";
        let args: Record<string, any> = {};
        try {
          const raw = (call as any)?.function?.arguments;
          if (typeof raw === "string") args = raw ? JSON.parse(raw) : {};
          else if (raw && typeof raw === "object") args = raw as Record<string, any>;
          else args = {};
        } catch {
          const raw = (call as any)?.function?.arguments;
          const rescued = typeof raw === "string" ? salvageArgs(raw) : null;
          args = rescued || {};
        }
        try {
          const handler = toolHandlers[name];
          const result = handler ? await handler(args) : { error: `unknown_tool:${name}` };
          outputs.push({ tool_call_id: id, output: serialiseToolResult(result) });
        } catch (error) {
          outputs.push({ tool_call_id: id, output: JSON.stringify({ error: String(error) }) });
        }
      }
      run = await wf.runs.submitToolOutputs({
        run_id: run.id,
        tool_outputs: outputs,
      });
      continue;
    }

    // Completed? extract assistant output robustly
    const completed = run?.status === "completed" || (run?.status === "requires_action" && !toolCalls.length);
    if (completed) {
      // Prefer explicit output_text if present
      const outText = (run as any).output_text;
      if (typeof outText === "string" && outText.trim()) {
        return coerceTextIfJson(outText.trim(), userText);
      }

      const messages = (run?.output?.messages ?? run?.output ?? []) as any[];
      let finalText = "";
      const collect = (msg: any) => {
        if (!msg) return;
        const c = msg.content ?? msg.text ?? msg.output_text ?? "";
        if (typeof c === "string") {
          finalText += (finalText ? "\n" : "") + c;
        } else if (Array.isArray(c)) {
          for (const chunk of c) {
            if (typeof chunk === "string") finalText += (finalText ? "\n" : "") + chunk;
            else if (chunk?.text) finalText += (finalText ? "\n" : "") + chunk.text;
          }
        }
      };
      if (Array.isArray(messages)) messages.forEach(collect);
      else collect(messages);
      return coerceTextIfJson(finalText, userText);
    }

    run = await wf.runs.get({ run_id: run.id });
  }
}
