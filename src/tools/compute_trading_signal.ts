import { TF } from "./normalize";
import { get_ohlc, Candle, OhlcResult } from "./ohlc";

export interface SignalPayload extends Record<string, unknown> {
  signal: "BUY" | "SELL" | "NEUTRAL";
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  timeUTC: string;
  symbol: string;
  interval: TF;
}

function ema(values: number[], period: number) {
  const weight = 2 / (period + 1);
  let current = values.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    current = values[i] * weight + current * (1 - weight);
  }
  return current;
}

function rsi(values: number[], period = 14) {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  gains /= period;
  losses = losses || 1e-12;
  let rs = gains / losses;
  let result = 100 - 100 / (1 + rs);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    gains = (gains * (period - 1) + gain) / period;
    losses = (losses * (period - 1) + loss) / period || 1e-12;
    rs = gains / losses;
    result = 100 - 100 / (1 + rs);
  }
  return result;
}

function macd(values: number[]) {
  // Calculate EMA arrays for fast and slow periods
  const calculateEMA = (period: number) => {
    const emaValues: number[] = [];
    const weight = 2 / (period + 1);
    
    // Initialize with SMA for the first period values
    let sum = 0;
    for (let i = 0; i < period && i < values.length; i++) {
      sum += values[i];
    }
    emaValues.push(sum / Math.min(period, values.length));
    
    // Calculate EMA for remaining values
    for (let i = period; i < values.length; i++) {
      const ema = values[i] * weight + emaValues[emaValues.length - 1] * (1 - weight);
      emaValues.push(ema);
    }
    
    return emaValues;
  };
  
  const fastEMA = calculateEMA(12);
  const slowEMA = calculateEMA(26);
  
  // Calculate MACD line (fast - slow)
  const macdValues: number[] = [];
  const minLength = Math.min(fastEMA.length, slowEMA.length);
  for (let i = 0; i < minLength; i++) {
    macdValues.push(fastEMA[i] - slowEMA[i]);
  }
  
  const macdValue = macdValues[macdValues.length - 1];
  const signal = ema(macdValues, 9);
  return { macd: macdValue, signal };
}

function atr14(highs: number[], lows: number[], closes: number[]) {
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (tr.length < 14) {
    return { value: NaN };
  }
  let avg = tr.slice(0, 14).reduce((acc, value) => acc + value, 0) / 14;
  for (let i = 14; i < tr.length; i += 1) {
    avg = (avg * 13 + tr[i]) / 14;
  }
  return { value: avg };
}

function toUtcString(timestamp: number) {
  const iso = new Date(timestamp).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function round(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function normaliseSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function buildSignalFromSeries(symbol: string, timeframe: TF, series: OhlcResult): SignalPayload {
  const candles = series.candles;
  if (!Array.isArray(candles) || candles.length < 3) {
    throw new Error("insufficient_ohlc");
  }
  const closes = candles.map((candle) => candle.c);
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const lastIndex = candles.findIndex((candle) => candle.t === series.lastClosed.t);
  const previous = lastIndex > 0 ? (candles[lastIndex - 1] as Candle | undefined) : undefined;
  if (!previous) {
    throw new Error("missing_previous_bar");
  }

  const ema20 = ema(closes, Math.min(20, closes.length));
  const ema50 = ema(closes, Math.min(50, closes.length));
  const rsiValue = rsi(closes, Math.min(14, closes.length - 1));
  const { macd: macdValue } = macd(closes);
  const { value: atrValue } = atr14(highs, lows, closes);

  let decision: SignalPayload["signal"] = "NEUTRAL";
  if (ema20 > ema50 && rsiValue >= 55 && macdValue > 0) decision = "BUY";
  if (ema20 < ema50 && rsiValue <= 45 && macdValue < 0) decision = "SELL";

  const close = series.lastClosed.c;
  const fallbackRisk = Math.max(close * 0.0015, Math.abs(close - previous.c) || 1);
  const risk = Number.isFinite(atrValue) && atrValue > 0 ? atrValue : fallbackRisk;

  const entry = round(close);
  const stopLoss = round(decision === "BUY" ? close - risk : decision === "SELL" ? close + risk : close);
  const takeProfit1 = round(decision === "BUY" ? close + risk : decision === "SELL" ? close - risk : close);
  const takeProfit2 = round(decision === "BUY" ? close + 2 * risk : decision === "SELL" ? close - 2 * risk : close);

  return {
    signal: decision,
    entry: decision === "NEUTRAL" ? null : entry,
    sl: decision === "NEUTRAL" ? null : stopLoss,
    tp1: decision === "NEUTRAL" ? null : takeProfit1,
    tp2: decision === "NEUTRAL" ? null : takeProfit2,
    timeUTC: toUtcString(series.lastClosed.t),
    symbol: normaliseSymbol(symbol),
    interval: timeframe,
  };
}

export async function compute_trading_signal(symbol: string, timeframe: TF): Promise<SignalPayload> {
  const data = await get_ohlc(symbol, timeframe);
  return buildSignalFromSeries(symbol, timeframe, data);
}
