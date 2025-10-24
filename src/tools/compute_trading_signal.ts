// src/tools/compute_trading_signal.ts
import { TF } from './normalize';
import { computeSignal } from './signal';

export async function compute_trading_signal(symbol: string, timeframe: TF) {
  const b = await computeSignal(symbol, timeframe);
  // strict ONE BLOCK
  const lines = [
    `Time (UTC): ${b.timeUTC}`,
    `Symbol: ${b.symbol}`,
    `Interval: ${b.interval}`,
    `Last closed: ${b.lastClosedUTC} UTC`,
    `Close: ${b.close}`,
    `Prev: ${b.prev}`,
    `EMA20: ${b.ema20 ?? 'N/A'}`,
    `EMA50: ${b.ema50 ?? 'N/A'}`,
    `RSI14: ${b.rsi14 ?? 'N/A'}`,
    `MACD(12,26,9): ${b.macd ?? 'N/A'} / ${b.macdSignal ?? 'N/A'} (hist ${b.macdHist ?? 'N/A'})`,
    `ATR14: ${b.atr14 ?? 'N/A'}`,
    `SIGNAL: ${b.signal}`
  ];
  if (b.signal !== 'NEUTRAL') {
    lines.push(
      `Entry: ${b.entry}`,
      `SL: ${b.sl}`,
      `TP1: ${b.tp1} (R 1.0)`,
      `TP2: ${b.tp2} (R 2.0)`
    );
  }
  return lines.join('\n');
}
