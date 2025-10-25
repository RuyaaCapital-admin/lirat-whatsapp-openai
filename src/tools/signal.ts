// src/tools/signal.ts
import type { LanguageCode, ReasonToken } from "../utils/formatters";
import { signalFormatter } from "../utils/formatters";
import { get_ohlc, type Candle, type GetOhlcSuccess } from "./ohlc";
import { compute_trading_signal, type TradingSignal } from "./compute_trading_signal";
import { TF } from "./normalize";

export interface SignalBlock {
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
  signal: TradingSignal["decision"];
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  source: GetOhlcSuccess["provider"] | "PROVIDED";
  stale: boolean;
  ageMinutes: number;
  reason: ReasonToken;
}

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

function resolveOptionalNumber(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function mapLevels(levels: TradingSignal["levels"], key: keyof TradingSignal["levels"]): number | null {
  const value = levels[key];
  return Number.isFinite(value) ? (value as number) : null;
}

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const ohlc = await get_ohlc(symbol, tf, 120);
  if (!ohlc.ok) {
    throw new Error("NO_DATA");
  }

  const candles = ensureAscending(ohlc.candles);
  if (!candles.length) {
    throw new Error("NO_CANDLES");
  }

  const closes = candles.map((candle) => candle.c);
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const ema20Value = ema(closes, 20);
  const ema50Value = ema(closes, 50);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 !== undefined && ema26 !== undefined ? ema12 - ema26 : undefined;
  const signal = compute_trading_signal({
    symbol: ohlc.symbol,
    timeframe: ohlc.timeframe,
    candles,
    lastISO: ohlc.lastISO,
    ageMinutes: ohlc.ageMinutes,
    stale: ohlc.stale,
  });

  return {
    timeUTC: signal.timeUTC,
    symbol: signal.symbol,
    interval: tf,
    lastClosedUTC: signal.timeUTC,
    close: closes.at(-1) ?? Number.NaN,
    prev: closes.at(-2) ?? closes.at(-1) ?? Number.NaN,
    ema20: resolveOptionalNumber(ema20Value),
    ema50: resolveOptionalNumber(ema50Value),
    rsi14: resolveOptionalNumber(rsi(closes, 14)),
    macd: resolveOptionalNumber(macdLine),
    macdSignal: undefined,
    macdHist: undefined,
    atr14: resolveOptionalNumber(atr(highs, lows, closes, 14)),
    signal: signal.decision,
    entry: mapLevels(signal.levels, "entry"),
    sl: mapLevels(signal.levels, "sl"),
    tp1: mapLevels(signal.levels, "tp1"),
    tp2: mapLevels(signal.levels, "tp2"),
    source: ohlc.provider,
    stale: signal.stale,
    ageMinutes: signal.ageMinutes,
    reason: signal.reason,
  } satisfies SignalBlock;
}

export function formatSignalBlock(block: SignalBlock, lang: LanguageCode = "en"): string {
  return signalFormatter(
    {
      symbol: block.symbol,
      timeframe: block.interval,
      timeUTC: block.timeUTC,
      decision: block.signal,
      reason: block.reason,
      levels: { entry: block.entry, sl: block.sl, tp1: block.tp1, tp2: block.tp2 },
      stale: block.stale,
      ageMinutes: block.ageMinutes,
    },
    lang,
  );
}

export type { Candle } from "./ohlc";
