// src/tools/livePrice.ts
import { Canonical, extractSymbolFromText, extractTimeframeFromText } from "./symbol";
import { getFcsLiveOr1m } from "./fcs";
import { getFmpOhlc } from "./fmp";
import { ema, rsi14, macd, atr14 } from "./indicators";
import { computeSignal, calculateEntrySlTp } from "./signal";

export async function resolveQuote(
  userText: string,
  opts?: { timeframe?: '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily' }
): Promise<{
  block: string;
  intent: 'price';
  canonical: Canonical;
}> {
  // Extract symbol from text
  const symbol = extractSymbolFromText(userText);
  if (!symbol) {
    throw new Error('No symbol found in text');
  }
  
  // Extract or use provided timeframe
  const timeframe = opts?.timeframe || extractTimeframeFromText(userText) || '1min';
  
  // Ensure timeframe is valid
  const validTimeframes = ['1min', '5min', '15min', '30min', '1hour', '4hour', 'daily'] as const;
  const validTimeframe = validTimeframes.includes(timeframe as any) ? timeframe as any : '1min';
  
  console.log('[PRICE] Resolving quote:', { symbol, timeframe: validTimeframe });
  
  let result: any;
  
  if (validTimeframe === '1min') {
    // Use FCS for live/1min data
    result = await getFcsLiveOr1m(symbol);
    
    // Build the output block
    const timeUtc = new Date(result.timeUtc).toISOString().slice(11, 16);
    const dateUtc = new Date(result.timeUtc).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
    
    return {
      block: `Time (UTC): ${timeUtc}
Symbol: ${symbol}
Interval: 1min
Last closed: ${dateUtc} UTC
Close: ${result.price}
Prev: ${result.price}
EMA20: N/A
EMA50: N/A
RSI14: N/A
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: NEUTRAL`,
      intent: 'price',
      canonical: symbol
    };
  } else {
    // Use FMP for specific timeframes
    try {
      const ohlcData = await getFmpOhlc(symbol, validTimeframe);
      const { candles, last } = ohlcData;
      
      if (candles.length < 50) {
        return {
          block: `Time (UTC): ${new Date(last.timeUtc).toISOString().slice(11, 16)}
Symbol: ${symbol}
Interval: ${validTimeframe}
Last closed: ${last.timeUtc.replace(/[-:]/g, '').replace('T', '_')} UTC
Close: ${last.close}
Prev: ${last.prev}
EMA20: N/A
EMA50: N/A
RSI14: N/A
MACD(12,26,9): N/A / N/A (hist N/A)
ATR14: N/A
SIGNAL: NEUTRAL`,
          intent: 'price',
          canonical: symbol
        };
      }
      
      // Calculate indicators
      const closes = candles.map(c => c.close);
      const ema20Values = ema(closes, 20);
      const ema50Values = ema(closes, 50);
      const rsi = rsi14(closes);
      const macdData = macd(closes);
      const atr = atr14(candles.map(c => ({ high: c.high, low: c.low, close: c.close })));
      
      const ema20 = ema20Values.length > 0 ? ema20Values[ema20Values.length - 1] : undefined;
      const ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : undefined;
      
      const signal = computeSignal({
        ema20,
        ema50,
        rsi,
        macd: macdData.macd,
        signal: macdData.signal
      });
      
      const timeUtc = new Date(last.timeUtc).toISOString().slice(11, 16);
      const dateUtc = last.timeUtc.replace(/[-:]/g, '').replace('T', '_');
      
      let block = `Time (UTC): ${timeUtc}
Symbol: ${symbol}
Interval: ${validTimeframe}
Last closed: ${dateUtc} UTC
Close: ${last.close}
Prev: ${last.prev}
EMA20: ${ema20?.toFixed(2) || 'N/A'}
EMA50: ${ema50?.toFixed(2) || 'N/A'}
RSI14: ${rsi.toFixed(2)}
MACD(12,26,9): ${macdData.macd.toFixed(2)} / ${macdData.signal.toFixed(2)} (hist ${macdData.hist.toFixed(2)})
ATR14: ${atr.toFixed(2)}
SIGNAL: ${signal}`;
      
      if (signal !== 'NEUTRAL') {
        const entrySlTp = calculateEntrySlTp(signal, last.close, atr);
        if (entrySlTp) {
          block += `
Entry: ${entrySlTp.entry.toFixed(2)}
SL: ${entrySlTp.sl.toFixed(2)}
TP1: ${entrySlTp.tp1.toFixed(2)} (R 1.0)
TP2: ${entrySlTp.tp2.toFixed(2)} (R 2.0)`;
        }
      }
      
      return {
        block,
        intent: 'price',
        canonical: symbol
      };
      
    } catch (error) {
      if (error instanceof Error && error.message === 'No data on this timeframe') {
        throw new Error('no data on this timeframe');
      }
      throw error;
    }
  }
}