// src/tools/agentTools.ts
// Tool functions that match Agent Builder exactly: get_price, get_ohlc, compute_trading_signal

import { Canonical, toCanonical } from './symbol';
import { getCurrentPrice } from './price';
import { getTradingSignal } from './ohlc';
import { formatPriceBlock } from '../format';

// Tool: get_price
export async function get_price(symbol: string, timeframe?: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] get_price called:', { symbol, timeframe });
    
    const canonical = toCanonical(symbol);
    if (!canonical) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const result = await getCurrentPrice(canonical, timeframe);
    
    const priceResponse = {
      symbol: canonical,
      timestamp: Math.floor(Date.now() / 1000),
      price: result.price,
      note: result.source,
      utcTime: new Date().toISOString().slice(11, 16)
    };
    
    const priceBlock = formatPriceBlock(priceResponse);

    return { text: priceBlock };
  } catch (error) {
    console.error('[AGENT_TOOL] get_price error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب السعر: ${errorMessage}` };
  }
}

// Tool: get_ohlc
export async function get_ohlc(symbol: string, interval: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] get_ohlc called:', { symbol, interval });
    
    const canonical = toCanonical(symbol);
    if (!canonical) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const signalData = await getTradingSignal(canonical, interval);
    
    const timeUtc = new Date().toISOString().slice(11, 16);
    const lastClosed = signalData.lastClosed ? 
      (typeof signalData.lastClosed === 'string' ? signalData.lastClosed : new Date(signalData.lastClosed).toISOString().slice(11, 16)) : 
      timeUtc;
    
    const priceBlock = `Time (UTC): ${timeUtc}
Symbol: ${canonical}
Interval: ${interval}
Last closed: ${lastClosed} UTC
Close: ${signalData.close}
Prev: ${signalData.prev}
EMA20: ${signalData.ema20.toFixed(2)}
EMA50: ${signalData.ema50.toFixed(2)}
RSI14: ${signalData.rsi14.toFixed(2)}
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: ${signalData.signal}`;

    return { text: priceBlock };
  } catch (error) {
    console.error('[AGENT_TOOL] get_ohlc error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في جلب البيانات: ${errorMessage}` };
  }
}

// Tool: compute_trading_signal
export async function compute_trading_signal(symbol: string, period: string): Promise<{
  text: string;
}> {
  try {
    console.log('[AGENT_TOOL] compute_trading_signal called:', { symbol, period });
    
    const canonical = toCanonical(symbol);
    if (!canonical) {
      return { text: `رمز غير صحيح: ${symbol}. جرب: XAUUSD, EURUSD, BTCUSDT` };
    }

    const signalData = await getTradingSignal(canonical, period);
    
    const timeUtc = new Date().toISOString().slice(11, 16);
    const lastClosed = signalData.lastClosed ? 
      (typeof signalData.lastClosed === 'string' ? signalData.lastClosed : new Date(signalData.lastClosed).toISOString().slice(11, 16)) : 
      timeUtc;
    
    const priceBlock = `Time (UTC): ${timeUtc}
Symbol: ${canonical}
Interval: ${period}
Last closed: ${lastClosed} UTC
Close: ${signalData.close}
Prev: ${signalData.prev}
EMA20: ${signalData.ema20.toFixed(2)}
EMA50: ${signalData.ema50.toFixed(2)}
RSI14: ${signalData.rsi14.toFixed(2)}
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: ${signalData.signal}`;

    return { text: priceBlock };
  } catch (error) {
    console.error('[AGENT_TOOL] compute_trading_signal error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في حساب الإشارة: ${errorMessage}` };
  }
}
