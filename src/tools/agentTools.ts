// src/tools/agentTools.ts
// Tool functions that match Agent Builder exactly: get_price, get_ohlc, compute_trading_signal

import { Canonical, toCanonical, toFcsSymbol, toFmpSymbol } from './symbol';
import { getFcsLiveOr1m } from './fcs';
import { getFmpOhlc } from './fmp';
import { ema, rsi14, macd, atr14 } from './indicators';

// Signal computation function
function computeTradingSignal(data: {
  close: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
  macd?: number;
  signalLine?: number;
  atr?: number;
}): { signal: string; entry?: number; sl?: number; tp1?: number; tp2?: number } {
  const { close, ema20, ema50, rsi, macd, signalLine, atr } = data;
  
  // Default to NEUTRAL if insufficient data
  if (!ema20 || !ema50 || !rsi || !macd || !signalLine || !atr) {
    return { signal: 'NEUTRAL' };
  }
  
  let signal = 'NEUTRAL';
  
  // BUY conditions: price above EMA50, EMA20 above EMA50, RSI >= 55, MACD above signal
  if (close > ema50 && ema20 > ema50 && rsi >= 55 && macd > signalLine) {
    signal = 'BUY';
  }
  // SELL conditions: price below EMA50, EMA20 below EMA50, RSI <= 45, MACD below signal
  else if (close < ema50 && ema20 < ema50 && rsi <= 45 && macd < signalLine) {
    signal = 'SELL';
  }
  
  if (signal === 'NEUTRAL') {
    return { signal };
  }
  
  // Calculate entry, SL, TP levels
  const entry = close;
  const risk = atr * 1.0; // 1x ATR risk
  
  if (signal === 'BUY') {
    return {
      signal,
      entry,
      sl: entry - risk,
      tp1: entry + risk,
      tp2: entry + (2 * risk)
    };
  } else if (signal === 'SELL') {
    return {
      signal,
      entry,
      sl: entry + risk,
      tp1: entry - risk,
      tp2: entry - (2 * risk)
    };
  }
  
  return { signal };
}

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

    // Use FCS for live/1min data
    const result = await getFcsLiveOr1m(canonical);
    
    const timeUtc = new Date(result.timeUtc).toISOString().slice(11, 16);
    const dateUtc = new Date(result.timeUtc).toISOString().slice(0, 10).replace(/-/g, '');
    
    const text = `Time (UTC): ${timeUtc}
Symbol: ${result.symbol}
Interval: 1min
Last closed: ${dateUtc}_${timeUtc} UTC
Close: ${result.price}
Prev: N/A
EMA20: N/A
EMA50: N/A
RSI14: N/A
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: NEUTRAL`;

    return { text };
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

    // Map interval to valid timeframe
    const validTimeframes = ['1min', '5min', '15min', '30min', '1hour', '4hour', 'daily'] as const;
    const timeframe = validTimeframes.includes(interval as any) ? interval as any : '1min';
    
    // Use FMP for OHLC data
    const ohlcData = await getFmpOhlc(canonical, timeframe);
    const { candles, last } = ohlcData;
    
    if (candles.length < 50) {
      const timeUtc = new Date(last.timeUtc).toISOString().slice(11, 16);
      return {
        text: `Time (UTC): ${timeUtc}
Symbol: ${canonical}
Interval: ${timeframe}
Last closed: ${last.timeUtc.replace(/[-:]/g, '').replace('T', '_')} UTC
Close: ${last.close}
Prev: ${last.prev}
EMA20: N/A
EMA50: N/A
RSI14: N/A
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: NEUTRAL`
      };
    }
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const ema20 = ema(closes, 20).pop();
    const ema50 = ema(closes, 50).pop();
    const rsi = rsi14(closes);
    const macdResult = macd(closes);
    const atr = atr14(candles.map(c => ({ high: c.high, low: c.low, close: c.close })));
    
    const signalResult = computeTradingSignal({
      close: last.close,
      ema20,
      ema50,
      rsi,
      macd: macdResult?.macd,
      signalLine: macdResult?.signal,
      atr
    });
    
    const timeUtc = new Date(last.timeUtc).toISOString().slice(11, 16);
    const dateUtc = last.timeUtc.replace(/[-:]/g, '').replace('T', '_');
    
    let text = `Time (UTC): ${timeUtc}
Symbol: ${canonical}
Interval: ${timeframe}
Last closed: ${dateUtc} UTC
Close: ${last.close}
Prev: ${last.prev}
EMA20: ${ema20?.toFixed(2) || 'N/A'}
EMA50: ${ema50?.toFixed(2) || 'N/A'}
RSI14: ${rsi?.toFixed(2) || 'N/A'}
MACD(12,26,9): ${macdResult?.macd?.toFixed(2) || 'N/A'} / ${macdResult?.signal?.toFixed(2) || 'N/A'} (hist ${macdResult?.hist?.toFixed(2) || 'N/A'})
ATR14: ${atr?.toFixed(2) || 'N/A'}
SIGNAL: ${signalResult.signal}`;
    
    if (signalResult.signal !== 'NEUTRAL') {
      text += `
Entry: ${signalResult.entry}
SL: ${signalResult.sl}
TP1: ${signalResult.tp1} (R 1.0)
TP2: ${signalResult.tp2} (R 2.0)`;
    }
    
    return { text };
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

    // Map period to valid timeframe
    const validTimeframes = ['1min', '5min', '15min', '30min', '1hour', '4hour', 'daily'] as const;
    const timeframe = validTimeframes.includes(period as any) ? period as any : '1hour';
    
    // Use FMP for OHLC data
    const ohlcData = await getFmpOhlc(canonical, timeframe);
    const { candles, last } = ohlcData;
    
    if (candles.length < 50) {
      return { text: `لا توجد بيانات كافية لحساب الإشارة. نحتاج 50+ شمعة على الأقل.` };
    }
    
    const closes = candles.map(c => c.close);
    
    const ema20 = ema(closes, 20).pop();
    const ema50 = ema(closes, 50).pop();
    const rsi = rsi14(closes);
    const macdResult = macd(closes);
    const atr = atr14(candles.map(c => ({ high: c.high, low: c.low, close: c.close })));
    
    const signalResult = computeTradingSignal({
      close: last.close,
      ema20,
      ema50,
      rsi,
      macd: macdResult?.macd,
      signalLine: macdResult?.signal,
      atr
    });
    
    const timeUtc = new Date(last.timeUtc).toISOString().slice(11, 16);
    const dateUtc = last.timeUtc.replace(/[-:]/g, '').replace('T', '_');
    
    let text = `Time (UTC): ${timeUtc}
Symbol: ${canonical}
Interval: ${timeframe}
Last closed: ${dateUtc} UTC
Close: ${last.close}
Prev: ${last.prev}
EMA20: ${ema20?.toFixed(2) || 'N/A'}
EMA50: ${ema50?.toFixed(2) || 'N/A'}
RSI14: ${rsi?.toFixed(2) || 'N/A'}
MACD(12,26,9): ${macdResult?.macd?.toFixed(2) || 'N/A'} / ${macdResult?.signal?.toFixed(2) || 'N/A'} (hist ${macdResult?.hist?.toFixed(2) || 'N/A'})
ATR14: ${atr?.toFixed(2) || 'N/A'}
SIGNAL: ${signalResult.signal}`;
    
    if (signalResult.signal !== 'NEUTRAL') {
      text += `
Entry: ${signalResult.entry}
SL: ${signalResult.sl}
TP1: ${signalResult.tp1} (R 1.0)
TP2: ${signalResult.tp2} (R 2.0)`;
    }
    
    return { text };
  } catch (error) {
    console.error('[AGENT_TOOL] compute_trading_signal error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { text: `خطأ في حساب الإشارة: ${errorMessage}` };
  }
}
