// src/tools/agentTools.ts
import { openai } from "../lib/openai";
import { getCurrentPrice } from "./price";
import { get_ohlc as fetchOhlc } from "./ohlc";
import { compute_trading_signal as computeSignal } from "./compute_trading_signal";
import { hardMapSymbol, toTimeframe, TF } from "./normalize";

type ToolPayload = { text: string } | Record<string, unknown>;

function detectLang(text?: string) {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
}

function formatPriceOutput(symbol: string, price: number, time: string | number | null, source: string) {
  let timeValue: string;
  if (typeof time === "number") {
    const date = new Date(time * (time > 10_000_000_000 ? 1 : 1000));
    const iso = date.toISOString();
    timeValue = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  } else if (typeof time === "string") {
    const parsed = new Date(time);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString();
      timeValue = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    } else {
      timeValue = `${new Date().toISOString().slice(0, 16)} UTC`;
    }
  } else {
    timeValue = `${new Date().toISOString().slice(0, 16)} UTC`;
  }
  return `Time (UTC): ${timeValue}\nSymbol: ${symbol.toUpperCase()}\nPrice: ${price}\nSource: ${source}`;
}

function responseText(response: any) {
  if (!response) return "";
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (Array.isArray(output)) {
    const chunks = output
      .flatMap((item: any) => (Array.isArray(item.content) ? item.content : item.content ? [item.content] : []))
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
      .filter(Boolean);
    return chunks.join("\n").trim();
  }
  return "";
}

export async function get_price(symbol: string, timeframe?: string): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const price = await getCurrentPrice(mappedSymbol);
  const text = formatPriceOutput(mappedSymbol, price.price, price.time ?? null, price.source);
  return { text };
}

export async function get_ohlc(symbol: string, timeframe: string, limit = 200): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  const data = await fetchOhlc(mappedSymbol, tf, Math.max(50, Math.min(limit, 400)));
  return { text: JSON.stringify(data) };
}

export async function compute_trading_signal(symbol: string, timeframe: string): Promise<ToolPayload> {
  const mappedSymbol = hardMapSymbol(symbol);
  if (!mappedSymbol) {
    throw new Error(`invalid_symbol:${symbol}`);
  }
  const tf = toTimeframe(timeframe) as TF;
  return await computeSignal(mappedSymbol, tf);
}

export async function about_liirat_knowledge(query: string, lang?: string): Promise<ToolPayload> {
  const vectorStore = process.env.OPENAI_VECTOR_STORE_ID;
  if (!vectorStore) {
    throw new Error("missing_vector_store");
  }
  const language = lang || detectLang(query);
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: `أجب عن أسئلة ليرات بالاعتماد على الملفات الداخلية فقط. اجعل الإجابة من سطر واحد أو سطرين بحد أقصى.` }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: query }],
      },
    ],
    tools: [{ type: "file_search", vector_store_ids: [vectorStore] }],
    max_output_tokens: 400,
  });
  let text = responseText(response);
  if (!text) {
    throw new Error("empty_knowledge_response");
  }
  if (language === "en") {
    text = text.replace(/\s+/g, " ").trim();
  }
  return { text };
}

export async function search_web_news(query: string, lang?: string, count = 3): Promise<ToolPayload> {
  const instruction = `Search for the latest market-moving headlines. Return valid JSON with exactly ${count} objects in an array. Each object must have date (YYYY-MM-DD), source, title, impact (2-6 words), and url.`;
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: [{ type: "input_text", text: instruction }] },
      { role: "user", content: [{ type: "input_text", text: query }] },
    ],
    tools: [{ type: "web_search" } as any],
    max_output_tokens: 600,
  });
  let text = responseText(response);
  if (!text) {
    throw new Error("empty_news_response");
  }
  text = text.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("invalid_news_json");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("news_not_array");
  }
  const items = parsed
    .slice(0, count)
    .map((item) => ({
      date: String(item.date ?? "").slice(0, 10),
      source: String(item.source ?? "").trim(),
      title: String(item.title ?? "").trim(),
      impact: String(item.impact ?? "").trim(),
      url: String(item.url ?? "").trim(),
    }))
    .filter((item) => item.date && item.source && item.title && item.impact && item.url);
  if (items.length !== count) {
    throw new Error("insufficient_news_items");
  }
  return { items };
}
