import { PriceResponse } from "./tools/price";
import type { Candle } from "./tools/ohlc";
import type { TF } from "./tools/normalize";
import type { SignalBlock } from "./tools/signal";

export function formatTimeUTC(ts: number) {
  return new Date(ts * 1000).toISOString().slice(11, 16);
}

function fmt(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 100) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export function formatPriceBlock(data: PriceResponse) {
  const time = formatTimeUTC(data.timestamp);
  return [
    `Time (UTC): ${time}`,
    `Symbol: ${data.symbol}`,
    `Price: ${fmt(data.price)}`,
    `Note: ${data.note}`,
  ].join("\n");
}

export function formatSignalBlock(args: {
  symbol: string;
  interval: TF;
  candles: Candle[];
  signal: SignalBlock;
}) {
  const { symbol, interval, candles, signal } = args;
  const last = candles.at(-1)!;
  const lastIso = new Date(typeof last.t === 'string' ? parseInt(last.t) * 1000 : last.t * 1000).toISOString();
  const stamp = `${lastIso.slice(0, 10).replace(/-/g, "")}_${lastIso.slice(11, 16)} UTC`;
  const headerLines = [
    `Time (UTC): ${formatTimeUTC(typeof last.t === 'string' ? parseInt(last.t) : last.t)}`,
    `Symbol: ${symbol}`,
    `Interval: ${interval}`,
    `Last closed: ${stamp}`,
  ];

  const lines = [
    ...headerLines,
    `Close: ${fmt(signal.close)}`,
    `Prev: ${fmt(signal.prev)}`,
    `EMA20: ${fmt(signal.ema20 || 0)}  EMA50: ${fmt(signal.ema50 || 0)}  RSI14: ${(signal.rsi14 || 0).toFixed(2)}`,
    `MACD(12,26,9): ${fmt(signal.macd || 0)} / ${fmt(signal.macdSignal || 0)} (hist ${fmt(signal.macdHist || 0)})`,
    `ATR14: ${fmt(signal.atr14 || 0)}`,
    `SIGNAL: ${signal.signal}`,
  ];
  
  if (signal.entry && signal.sl && signal.tp1 && signal.tp2) {
    lines.push(
      `Entry: ${fmt(signal.entry)}  SL: ${fmt(signal.sl)}  TP1: ${fmt(signal.tp1)}  TP2: ${fmt(signal.tp2)}`
    );
  }
  
  return lines.join("\n");
}
