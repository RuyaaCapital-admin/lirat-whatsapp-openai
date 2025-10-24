// src/tools/agentTools.ts
// Tool functions that match Agent Builder exactly: get_price, get_ohlc, compute_trading_signal, about_liirat_knowledge, search_web_news

import { getCurrentPrice } from './price';
import { get_ohlc as fetchOhlc } from './ohlc';
import { compute_trading_signal as computeSignal } from './compute_trading_signal';
import { hardMapSymbol, toTimeframe, TF } from './normalize';
import { searchNews } from './news';

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
    const payload = await computeSignal(mappedSymbol, tf);
    return { text: JSON.stringify(payload) };
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

// Tool: about_liirat_knowledge
export async function about_liirat_knowledge(query: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] about_liirat_knowledge called:', { query });

    return {
      text: `Lirat هي علامة تجارية تقدم خدمات ومنتجات مبتكرة في مجال التكنولوجيا المالية. تسعى Lirat إلى تحسين تجربة المستخدمين من خلال حلول ذكية ومتكاملة تلبي احتياجاتهم المالية. تركز الشركة على تقديم خدمات موثوقة وآمنة تسهم في تعزيز الشمول المالي.`
    };
  } catch (error) {
    console.error('[AGENT_TOOL] about_liirat_knowledge error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب المعلومات: ${errorMessage}` };
  }
}
