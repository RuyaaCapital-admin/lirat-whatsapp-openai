// src/tools/agentTools.ts
// Tool functions that match Agent Builder exactly: get_price, get_ohlc, compute_trading_signal

import { Canonical, toCanonical } from './symbol';
import { getCurrentPrice, formatPriceBlock } from './price';
import { getTradingSignal } from './ohlc';

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
    
    const priceBlock = formatPriceBlock({
      symbol: canonical,
      interval: timeframe || '1min',
      lastClosed: result.time,
      close: result.price,
      prev: 'N/A',
      ema20: 'N/A',
      ema50: 'N/A',
      rsi14: 'N/A',
      macd: { macd: 'N/A', signal: 'N/A', hist: 'N/A' },
      atr14: 'N/A',
      signal: 'NEUTRAL'
    });

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
    
    const priceBlock = formatPriceBlock({
      symbol: canonical,
      interval: interval,
      lastClosed: signalData.lastClosed,
      close: signalData.close,
      prev: signalData.prev,
      ema20: signalData.ema20.toFixed(2),
      ema50: signalData.ema50.toFixed(2),
      rsi14: signalData.rsi14.toFixed(2),
      macd: { macd: 'N/A', signal: 'N/A', hist: 'N/A' },
      atr14: 'N/A',
      signal: signalData.signal
    });

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
    
    const priceBlock = formatPriceBlock({
      symbol: canonical,
      interval: period,
      lastClosed: signalData.lastClosed,
      close: signalData.close,
      prev: signalData.prev,
      ema20: signalData.ema20.toFixed(2),
      ema50: signalData.ema50.toFixed(2),
      rsi14: signalData.rsi14.toFixed(2),
      macd: { macd: 'N/A', signal: 'N/A', hist: 'N/A' },
      atr14: 'N/A',
      signal: signalData.signal
    });

    return { text: priceBlock };
  } catch (error) {
    console.error('[AGENT_TOOL] compute_trading_signal error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في حساب الإشارة: ${errorMessage}` };
  }
}
