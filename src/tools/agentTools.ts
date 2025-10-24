// src/tools/agentTools.ts
// Tool functions that match Agent Builder exactly: get_price, get_ohlc, compute_trading_signal, about_liirat_knowledge, search_web_news

import { getCurrentPrice } from './price';
import { get_ohlc as fetchOhlc } from './ohlc';
import { compute_trading_signal as computeSignal } from './compute_trading_signal';
import { hardMapSymbol, toTimeframe, TF } from './normalize';
import { searchNews } from './news';
import OpenAI from "openai";


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Tool: get_price (called in "price" intent)
export async function get_price(symbol: string, timeframe?: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] get_price called:', { symbol, timeframe });

    const mappedSymbol = hardMapSymbol(symbol);
    if (!mappedSymbol) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const p = await getCurrentPrice(mappedSymbol);
    return {
      text: `Time (UTC): ${new Date().toISOString().slice(11,16)}\nSymbol: ${symbol}\nPrice: ${p.price}\nNote: ${p.source}`
    };
  } catch (error) {
    console.error('[AGENT_TOOL] get_price error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب السعر: ${errorMessage}` };
  }
}

// Tool: get_ohlc
export async function get_ohlc(symbol: string, timeframe: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] get_ohlc called:', { symbol, timeframe });

    const mappedSymbol = hardMapSymbol(symbol);
    if (!mappedSymbol) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const tf = toTimeframe(timeframe) as TF;
    const data = await fetchOhlc(mappedSymbol, tf);
    return { text: JSON.stringify(data) };
  } catch (error) {
    console.error('[AGENT_TOOL] get_ohlc error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب البيانات: ${errorMessage}` };
  }
}

// Tool: compute_trading_signal
export async function compute_trading_signal(symbol: string, timeframe: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] compute_trading_signal called:', { symbol, timeframe });

    const mappedSymbol = hardMapSymbol(symbol);
    if (!mappedSymbol) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const tf = toTimeframe(timeframe) as TF;
    return await computeSignal(mappedSymbol, tf);
  } catch (error) {
    console.error('[AGENT_TOOL] compute_trading_signal error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في حساب الإشارة: ${errorMessage}` };
  }
}

export async function search_web_news(query: string): Promise<{
  text: string;
}> {
  try {
    const rows = await searchNews(query);
    return { text: JSON.stringify(rows) };
  } catch (error) {
    console.error('[AGENT_TOOL] search_web_news error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب الأخبار: ${errorMessage}` };
  }
}

// Tool: about_liirat_knowledge (uses Responses + file_search)
export async function about_liirat_knowledge(
  query: string,
  lang: "ar" | "en" = "ar"
): Promise<{ text: string }> {
  try {
    console.log("[AGENT_TOOL] about_liirat_knowledge called:", { query, lang });

    const vs = process.env.OPENAI_VECTOR_STORE_ID;
    if (!vs) throw new Error("OPENAI_VECTOR_STORE_ID is missing");

    const sys =
      lang === "ar"
        ? "أجب في سطر أو سطرين فقط وبالاعتماد على ملفات ليرات حصراً. لا تضف معلومات من خارج الملفات."
        : "Answer in 1–2 short lines using ONLY Liirat files. Do not add any outside facts.";

    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: sys },
        { role: "user", content: query }
      ],
      tools: [{ type: "file_search", vector_store_ids: [vs] }],
      max_output_tokens: 160
    });

    const text = (resp.output_text || "").trim();
    return { text: text || (lang === "ar" ? "لا توجد معلومة في ملفات ليرات." : "No info found in Liirat files.") };
  } catch (error) {
    console.error("[AGENT_TOOL] about_liirat_knowledge error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return { text: (lang === "ar" ? "خطأ في جلب المعلومات: " : "Error: ") + msg };
  }
}
