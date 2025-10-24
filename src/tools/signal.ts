// src/tools/signal.ts
import { TF } from './normalize';
import { compute_trading_signal } from './compute_trading_signal';

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
  const result = await compute_trading_signal(symbol, tf);
  let trading_signal: any = result;
  if (trading_signal && typeof (trading_signal as any).text === 'string') {
    try {
      const parsed = JSON.parse((trading_signal as any).text);
      trading_signal = parsed?.trading_signal || parsed;
    } catch (error) {
      throw new Error('Failed to parse trading signal payload');
    }
  }
  if (trading_signal && typeof trading_signal === 'object' && 'text' in trading_signal) {
    trading_signal = (trading_signal as any).text;
  }
  if (trading_signal && typeof trading_signal === 'string') {
    try {
      const parsed = JSON.parse(trading_signal);
      trading_signal = parsed?.trading_signal || parsed;
    } catch (error) {
      throw new Error('Failed to parse trading signal payload string');
    }
  }
  if (!trading_signal) {
    throw new Error('Missing trading signal data');
  }
  const timeUTC =
    trading_signal.timeUTC ||
    trading_signal.time_utc ||
    trading_signal.last_closed_iso ||
    trading_signal.last_closed_utc ||
    new Date().toISOString();
  const lastClosedUTC = trading_signal.last_closed_iso || trading_signal.last_closed_utc || timeUTC;
  const decision = trading_signal.decision || trading_signal.signal || 'NEUTRAL';
  const entry = Number(trading_signal.entry ?? trading_signal.close ?? trading_signal.price ?? NaN);
  const sl = Number(trading_signal.sl ?? NaN);
  const tp1 = Number(trading_signal.tp1 ?? NaN);
  const tp2 = Number(trading_signal.tp2 ?? NaN);
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC,
    close: Number.isFinite(entry) ? entry : Number(trading_signal.close ?? NaN),
    prev: Number(trading_signal.prev ?? trading_signal.close ?? NaN),
    ema20: trading_signal.ema20,
    ema50: trading_signal.ema50,
    rsi14: trading_signal.rsi,
    macd: trading_signal.macd,
    macdSignal: trading_signal.macd_signal ?? trading_signal.signal,
    macdHist: trading_signal.macd_hist ?? trading_signal.hist,
    atr14: trading_signal.atr,
    signal: decision,
    entry: Number.isFinite(entry) ? entry : undefined,
    sl: Number.isFinite(sl) ? sl : undefined,
    tp1: Number.isFinite(tp1) ? tp1 : undefined,
    tp2: Number.isFinite(tp2) ? tp2 : undefined,
  };
}
