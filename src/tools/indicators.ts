// src/tools/indicators.ts

// EMA calculation
export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  
  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];
  
  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  emaValues[period - 1] = sum / period;
  
  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    emaValues[i] = (values[i] * multiplier) + (emaValues[i - 1] * (1 - multiplier));
  }
  
  return emaValues;
}

// RSI calculation
export function rsi14(closes: number[]): number {
  if (closes.length < 15) return 0;
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  // Calculate average gains and losses
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 0; i < 14; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  
  avgGain /= 14;
  avgLoss /= 14;
  
  // Calculate RSI
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// MACD calculation (12,26,9)
export function macd(closes: number[]): { macd: number, signal: number, hist: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
  
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  
  if (ema12.length === 0 || ema26.length === 0) return { macd: 0, signal: 0, hist: 0 };
  
  // Calculate MACD line
  const macdLine: number[] = [];
  const startIdx = Math.max(ema12.length - 1, ema26.length - 1);
  
  for (let i = startIdx; i < closes.length; i++) {
    const macdValue = ema12[i] - ema26[i];
    macdLine.push(macdValue);
  }
  
  if (macdLine.length < 9) return { macd: 0, signal: 0, hist: 0 };
  
  // Calculate signal line (9-period EMA of MACD)
  const signalLine = ema(macdLine, 9);
  
  if (signalLine.length === 0) return { macd: 0, signal: 0, hist: 0 };
  
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const histogram = lastMacd - lastSignal;
  
  return {
    macd: lastMacd,
    signal: lastSignal,
    hist: histogram
  };
}

// ATR calculation
export function atr14(ohlc: {high: number, low: number, close: number}[]): number {
  if (ohlc.length < 15) return 0;
  
  const trueRanges: number[] = [];
  
  for (let i = 1; i < ohlc.length; i++) {
    const high = ohlc[i].high;
    const low = ohlc[i].low;
    const prevClose = ohlc[i - 1].close;
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }
  
  // Calculate 14-period ATR
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    sum += trueRanges[i];
  }
  
  return sum / 14;
}
