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
  search_web_news,
  about_liirat_knowledge,
} from "../tools/agentTools";

export type ToolResult = any;

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
    const ohlc = args.ohlc || args;
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
  async search_web_news(args) {
    const query = String(args.query || "").trim();
    const lang = String(args.lang || "en");
    const count = Number.isFinite(args.count) ? Number(args.count) : 3;
    return await search_web_news(query, lang, count);
  },
  async about_liirat_knowledge(args) {
    const query = String(args.query || "").trim();
    const lang = typeof args.lang === "string" ? args.lang : undefined;
    const answer = await about_liirat_knowledge(query, lang);
    return { answer };
  },
};

function serialiseToolResult(result: ToolResult): string {
  if (result == null) return "";
  try { return JSON.stringify(result); } catch { return String(result); }
}

export async function runWorkflowMessage(
  {
    sessionId,
    workflowId,
    version,
    userText,
  }: {
    sessionId: string;
    workflowId: string;
    version?: number;
    userText: string;
  },
): Promise<string> {
  const wf: any = (openai as any).workflows;
  if (!wf?.runs?.create) {
    // Fallback to Chat Completions tool-call loop with persistent memory keyed by sessionId
    const smartReply = createSmartReply({
      chat: {
        create: (params: ChatCompletionCreateParams): Promise<ChatCompletion> =>
          openai.chat.completions
            .create({ ...(params as any), stream: false })
            .then((r: any) => r as ChatCompletion),
      },
      toolSchemas: TOOL_SCHEMAS,
      toolHandlers,
      systemPrompt: SYSTEM_PROMPT,
      memory,
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 700,
    });
    return await smartReply({ userId: sessionId, text: userText });
  }

  // Send user message into the workflow session
  // Prefer official Agent Builder runner if present
  if ((openai as any).agents?.Runner) {
    try {
      // Dynamically import user-provided workflow entrypoint when available in env
      const modulePath = process.env.OPENAI_WORKFLOW_ENTRY || "";
      if (modulePath) {
        const mod = await import(modulePath);
        if (mod?.runWorkflow) {
          const result = await mod.runWorkflow({ input_as_text: userText });
          const out = (result?.output_text ?? "").toString().trim();
          if (out) return out;
        }
      }
    } catch (e) {
      // Fallthrough to Workflows API path
    }
  }

  let run = await wf.runs.create({
    workflow_id: workflowId,
    version,
    session_id: sessionId,
    input: { input_as_text: userText },
  });

  // Loop until final
  while (true) {
    // Handle tool calls if any
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
          args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {}
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

    // If the run has an output, extract final assistant text
    const isCompleted = run?.status === "completed" || run?.status === "requires_action" && !toolCalls.length;
    if (isCompleted) {
      const messages = (run?.output?.messages ?? run?.output ?? []) as any[];
      let finalText = "";
      const collect = (msg: any) => {
        if (!msg) return;
        const content = msg.content ?? msg.text ?? msg.output_text ?? "";
        if (typeof content === "string") {
          finalText += (finalText ? "\n" : "") + content;
        } else if (Array.isArray(content)) {
          for (const chunk of content) {
            if (typeof chunk === "string") finalText += (finalText ? "\n" : "") + chunk;
            else if (chunk?.text) finalText += (finalText ? "\n" : "") + chunk.text;
          }
        }
      };
      if (Array.isArray(messages)) messages.forEach(collect); else collect(messages);
      return finalText.trim();
    }

    // Poll next state
    run = await wf.runs.get({ run_id: run.id });
  }
}
