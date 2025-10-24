// src/tools/signal.ts
import { TF } from './normalize';
import { computeSignal as computeSignalPayload, formatSignalPayload } from './compute_trading_signal';

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
  entry?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
};

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const trading_signal = await computeSignalPayload(symbol, tf);
  const timeUTC = trading_signal.timeUTC || new Date().toISOString();
  const decision = trading_signal.signal || 'NEUTRAL';
  const entry = Number(trading_signal.entry ?? NaN);
  const sl = Number(trading_signal.sl ?? NaN);
  const tp1 = Number(trading_signal.tp1 ?? NaN);
  const tp2 = Number(trading_signal.tp2 ?? NaN);
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC: timeUTC,
    close: Number.isFinite(entry) ? entry : NaN,
    prev: Number(trading_signal.entry ?? NaN),
    ema20: undefined,
    ema50: undefined,
    rsi14: undefined,
    macd: undefined,
    macdSignal: undefined,
    macdHist: undefined,
    atr14: undefined,
    signal: decision,
    entry: Number.isFinite(entry) ? entry : undefined,
    sl: Number.isFinite(sl) ? sl : undefined,
    tp1: Number.isFinite(tp1) ? tp1 : undefined,
    tp2: Number.isFinite(tp2) ? tp2 : undefined,
  };
}

export function formatSignalBlock(block: SignalBlock): string {
  return formatSignalPayload({
    signal: block.signal,
    entry: block.entry ?? null,
    sl: block.sl ?? null,
    tp1: block.tp1 ?? null,
    tp2: block.tp2 ?? null,
    timeUTC: block.timeUTC,
    symbol: block.symbol,
    interval: block.interval,
  });
}
