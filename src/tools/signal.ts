// src/tools/signal.ts
import { TF } from './normalize';
import { computeSignal as computeSignalPayload, formatSignalPayload } from './compute_trading_signal';

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
};

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const trading_signal = await computeSignalPayload(symbol, tf);
  const timeUTC = trading_signal.timeUTC || new Date().toISOString();
  const decision = trading_signal.signal || 'NEUTRAL';
  const entry = toFiniteNumber(trading_signal.entry);
  const sl = toFiniteNumber(trading_signal.sl, entry);
  const tp1 = toFiniteNumber(trading_signal.tp1, entry);
  const tp2 = toFiniteNumber(trading_signal.tp2, entry);
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC: timeUTC,
    close: entry,
    prev: entry,
    ema20: undefined,
    ema50: undefined,
    rsi14: undefined,
    macd: undefined,
    macdSignal: undefined,
    macdHist: undefined,
    atr14: undefined,
    signal: decision,
    entry,
    sl,
    tp1,
    tp2,
  };
}

export function formatSignalBlock(block: SignalBlock): string {
  return formatSignalPayload({
    signal: block.signal,
    entry: block.entry,
    sl: block.sl,
    tp1: block.tp1,
    tp2: block.tp2,
    timeUTC: block.timeUTC,
    symbol: block.symbol,
    interval: block.interval,
  });
}
