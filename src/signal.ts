import type { SignalBlock } from "./tools/signal";
import type { TF } from "./tools/normalize";
import { toTimeframe } from "./tools/normalize";

export type Candle = {
  t: number | string;
  o: number;
  h: number;
  l: number;
  c: number;
};

function ensureAscending(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => Number(a.t) - Number(b.t));
}

function ema(values: number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const k = 2 / (period + 1);
  let emaValue = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    emaValue = values[i] * k + emaValue * (1 - k);
  }
  return emaValue;
}

function rsi(values: number[], period = 14): number | undefined {
  if (values.length <= period) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) {
      gain += diff;
    } else {
      loss -= diff;
    }
  }
  gain /= period;
  loss = loss === 0 ? 1e-12 : loss / period;
  let rs = gain / loss;
  let rsiValue = 100 - 100 / (1 + rs);
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;
    gain = (gain * (period - 1) + currentGain) / period;
    loss = ((loss * (period - 1)) + currentLoss) / period || 1e-12;
    rs = gain / loss;
    rsiValue = 100 - 100 / (1 + rs);
  }
  return rsiValue;
}

function trueRange(high: number, low: number, prevClose: number) {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number | undefined {
  if (highs.length !== lows.length || highs.length !== closes.length) return undefined;
  if (highs.length <= period) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }
  if (trs.length < period) return undefined;
  let atrValue = trs.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    atrValue = (atrValue * (period - 1) + trs[i]) / period;
  }
  return atrValue;
}

function macd(values: number[]) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  if (ema12 === undefined || ema26 === undefined) {
    return { macd: undefined, signal: undefined, hist: undefined };
  }
  const macdLine = ema12 - ema26;
  const macdSeries: number[] = [];
  const k12 = 2 / (12 + 1);
  const k26 = 2 / (26 + 1);
  let ema12Iter = values.slice(0, 12).reduce((sum, value) => sum + value, 0) / 12;
  let ema26Iter = values.slice(0, 26).reduce((sum, value) => sum + value, 0) / 26;
  macdSeries.push(ema12Iter - ema26Iter);
  for (let i = 26; i < values.length; i += 1) {
    const price = values[i];
    ema12Iter = price * k12 + ema12Iter * (1 - k12);
    ema26Iter = price * k26 + ema26Iter * (1 - k26);
    macdSeries.push(ema12Iter - ema26Iter);
  }
  const signalLine = ema(macdSeries, 9);
  const hist = signalLine !== undefined ? macdLine - signalLine : undefined;
  return { macd: macdLine, signal: signalLine, hist };
}

function toTimestamp(value: number | string): number {
  return typeof value === "string" ? Number(value) : value;
}

export function computeSignal(symbol: string, interval: string, candles: Candle[]): SignalBlock {
  if (!candles?.length) {
    throw new Error("No candles provided");
  }
  const sorted = ensureAscending(candles);
  const closes = sorted.map((candle) => candle.c);
  const highs = sorted.map((candle) => candle.h);
  const lows = sorted.map((candle) => candle.l);

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const { macd: macdLine, signal: macdSignal, hist: macdHist } = macd(closes);
  const atr14 = atr(highs, lows, closes, 14);

  const last = sorted.at(-1)!;
  const prev = sorted.at(-2) ?? last;
  const close = closes.at(-1)!;
  const prevClose = closes.at(-2) ?? close;

  let decision: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (ema20 !== undefined && ema50 !== undefined && rsi14 !== undefined) {
    if (ema20 > ema50 && rsi14 >= 55) {
      decision = "BUY";
    } else if (ema20 < ema50 && rsi14 <= 45) {
      decision = "SELL";
    }
  }

  const risk = Number.isFinite(atr14)
    ? (atr14 as number)
    : Math.max(Math.abs(close - prevClose), close * 0.0015);
  const entry = close;
  const sl = decision === "BUY" ? entry - risk : decision === "SELL" ? entry + risk : entry;
  const tp1 = decision === "BUY" ? entry + risk : decision === "SELL" ? entry - risk : entry;
  const tp2 = decision === "BUY" ? entry + risk * 2 : decision === "SELL" ? entry - risk * 2 : entry;

  const tf: TF = toTimeframe(interval);

  return {
    timeUTC: new Date(toTimestamp(last.t)).toISOString(),
    symbol,
    interval: tf,
    lastClosedUTC: new Date(toTimestamp(last.t)).toISOString(),
    close,
    prev: prev.c,
    ema20: ema20 ?? close,
    ema50: ema50 ?? close,
    rsi14: rsi14 ?? 50,
    macd: macdLine ?? 0,
    macdSignal: macdSignal ?? 0,
    macdHist: macdHist ?? 0,
    atr14: risk,
    signal: decision,
    entry,
    sl,
    tp1,
    tp2,
  } satisfies SignalBlock;
}

export type { SignalBlock } from "./tools/signal";
