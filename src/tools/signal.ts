// src/tools/signal.ts
import { TF } from './normalize';
import { formatSignalMsg } from '../utils/formatters';
import { get_ohlc, type OhlcSource } from './ohlc';
import {
  compute_trading_signal,
  type TradingSignalOk,
  type TradingSignalResult,
} from './compute_trading_signal';

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

export type SignalBlock = {
  timeUTC: string;
  symbol: string;
  interval: TF;
  lastClosedUTC: string;
  close: number;
  prev: number;
  ema20?: number;
  ema50?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  atr14?: number;
  signal: 'BUY'|'SELL'|'NEUTRAL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  source: OhlcSource;
  stale: boolean;
  reason?: string;
};

function resolveTimeISO(payload: TradingSignalOk): string {
  if (typeof payload.lastISO === 'string' && payload.lastISO.trim()) {
    return payload.lastISO;
  }
  return new Date().toISOString();
}

function resolveOptionalNumber(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function mapCandles(candles: { t: number; o: number; h: number; l: number; c: number }[]): Candle[] {
  return candles.map((candle) => ({
    t: candle.t,
    o: candle.o,
    h: candle.h,
    l: candle.l,
    c: candle.c,
  }));
}

function assertOk(result: TradingSignalResult): TradingSignalOk {
  if (result.status === 'OK') {
    return result;
  }
  throw new Error('No usable signal data');
}

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const ohlc = await get_ohlc(symbol, tf, 60);
  const trading_signal = assertOk(compute_trading_signal({ ...ohlc, lang: 'en' }));
  const mapped = ensureAscending(mapCandles(ohlc.candles));
  const closes = mapped.map((candle) => candle.c);
  const highs = mapped.map((candle) => candle.h);
  const lows = mapped.map((candle) => candle.l);
  const timeUTC = resolveTimeISO(trading_signal);
  const decision = trading_signal.signal;
  const entry = trading_signal.entry ?? Number.NaN;
  const sl = trading_signal.sl ?? entry;
  const tp1 = trading_signal.tp1 ?? entry;
  const tp2 = trading_signal.tp2 ?? entry;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const { macd: macdLine, signal: macdSignal, hist: macdHist } = macd(closes);
  const atr14 = atr(highs, lows, closes, 14);
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC: timeUTC,
    close: closes.at(-1) ?? Number.NaN,
    prev: closes.at(-2) ?? closes.at(-1) ?? Number.NaN,
    ema20: resolveOptionalNumber(ema20),
    ema50: resolveOptionalNumber(ema50),
    rsi14: resolveOptionalNumber(rsi14),
    macd: resolveOptionalNumber(macdLine),
    macdSignal: resolveOptionalNumber(macdSignal),
    macdHist: resolveOptionalNumber(macdHist),
    atr14: resolveOptionalNumber(atr14),
    signal: decision,
    entry,
    sl,
    tp1,
    tp2,
    source: (trading_signal.provider as OhlcSource) ?? 'PROVIDED',
    stale: Boolean(trading_signal.isDelayed),
    reason: trading_signal.reason,
  };
}

export function formatSignalBlock(block: SignalBlock): string {
  return formatSignalMsg({
    decision: block.signal,
    entry: block.entry,
    sl: block.sl,
    tp1: block.tp1,
    tp2: block.tp2,
    time: block.timeUTC,
    symbol: block.symbol,
    reason: block.reason,
  });
}
