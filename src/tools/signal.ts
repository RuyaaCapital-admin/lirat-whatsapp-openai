// src/tools/signal.ts
import { TF } from './normalize';
import type { OhlcSource } from './ohlc';
import { formatSignalMsg } from '../utils/formatters';
import { computeSignal as computeSignalPayload, type TradingSignalResult } from './compute_trading_signal';

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
  source: OhlcSource;
  stale: boolean;
};

function resolveTimeISO(payload: TradingSignalResult): string {
  if (payload.lastClosed?.t) {
    const timestamp = Number(payload.lastClosed.t);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  if (payload.last_closed_utc) {
    const normalized = `${payload.last_closed_utc.replace(/\s+/, 'T')}Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function resolveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const trading_signal = await computeSignalPayload(symbol, tf);
  const timeUTC = resolveTimeISO(trading_signal);
  const decision = trading_signal.decision ?? 'NEUTRAL';
  const entry = toFiniteNumber(trading_signal.entry);
  const sl = toFiniteNumber(trading_signal.sl, entry);
  const tp1 = toFiniteNumber(trading_signal.tp1, entry);
  const tp2 = toFiniteNumber(trading_signal.tp2, entry);
  const indicators = trading_signal.indicators ?? ({} as Partial<TradingSignalResult['indicators']>);
  const lastClose = resolveNumber(trading_signal.lastClosed?.c, entry) ?? entry;
  const prevClose = resolveNumber(trading_signal.lastClosed?.o, lastClose) ?? entry;
  return {
    timeUTC,
    symbol: trading_signal.symbol || symbol,
    interval: tf,
    lastClosedUTC: timeUTC,
    close: lastClose,
    prev: prevClose,
    ema20: resolveOptionalNumber(indicators.ema20),
    ema50: resolveOptionalNumber(indicators.ema50),
    rsi14: resolveOptionalNumber(indicators.rsi),
    macd: resolveOptionalNumber(indicators.macd),
    macdSignal: resolveOptionalNumber(indicators.macdSignal),
    macdHist: resolveOptionalNumber(indicators.macdHist),
    atr14: undefined,
    signal: decision,
    entry,
    sl,
    tp1,
    tp2,
    source: 'PROVIDED',
    stale: Boolean(trading_signal.stale),
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
  });
}
