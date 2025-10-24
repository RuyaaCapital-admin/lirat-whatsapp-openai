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
  let payload: any;
  try {
    payload = JSON.parse(result.text);
  } catch (error) {
    throw new Error('Failed to parse trading signal payload');
  }
  const trading_signal = payload?.trading_signal || payload;
  if (!trading_signal) {
    throw new Error('Missing trading signal data');
  }
  const timeUTC = trading_signal.time_utc || trading_signal.last_closed_iso || trading_signal.last_closed_utc;
  const lastClosedUTC = trading_signal.last_closed_iso || trading_signal.last_closed_utc || timeUTC;
  const decision = trading_signal.decision || trading_signal.signal || 'NEUTRAL';
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC,
    close: trading_signal.close,
    prev: trading_signal.prev,
    ema20: trading_signal.ema20,
    ema50: trading_signal.ema50,
    rsi14: trading_signal.rsi,
    macd: trading_signal.macd,
    macdSignal: trading_signal.macd_signal ?? trading_signal.signal,
    macdHist: trading_signal.macd_hist ?? trading_signal.hist,
    atr14: trading_signal.atr,
    signal: decision,
    entry: trading_signal.entry,
    sl: trading_signal.sl,
    tp1: trading_signal.tp1,
    tp2: trading_signal.tp2,
  };
}
