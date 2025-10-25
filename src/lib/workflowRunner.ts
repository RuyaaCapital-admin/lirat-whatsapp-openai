// src/lib/workflowRunner.ts
import { openai } from "./openai";
import { TOOL_SCHEMAS } from "./toolSchemas";
import { get_price, get_ohlc, compute_trading_signal, type TradingSignal } from "../tools/agentTools";

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
};

function serialiseToolResult(result: ToolResult): string {
  if (result == null) return "";
  try { return JSON.stringify(result); } catch { return String(result); }
}

export async function runWorkflowMessage({
  sessionId: string;
  workflowId: string;
  version?: number;
  userText: string;
}): Promise<string> {
  const wf: any = (openai as any).workflows;
  if (!wf?.runs?.create) {
    throw new Error("workflows_not_supported");
  }

  // Send user message into the workflow session
  let run = await wf.runs.create({
    workflow_id: workflowId,
    version,
    session_id: sessionId,
    input: { text: userText },
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
