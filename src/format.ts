import { PriceResponse } from "./tools/price";
import type { Candle, TF } from "./signal";
import type { computeSignal } from "./signal";

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

type SignalResult = ReturnType<typeof computeSignal>;

export function formatSignalBlock(args: {
  symbol: string;
  interval: TF;
  candles: Candle[];
  signal: SignalResult;
}) {
  const { symbol, interval, candles, signal } = args;
  const last = candles.at(-1)!;
  const lastIso = new Date(last.t * 1000).toISOString();
  const stamp = `${lastIso.slice(0, 10).replace(/-/g, "")}_${lastIso.slice(11, 16)} UTC`;
  const lines = [
    `Time (UTC): ${formatTimeUTC(last.t)}`,
    `Symbol: ${symbol}`,
    `Interval: ${interval}`,
    `Last closed: ${stamp}`,
    `Close: ${fmt(signal.c)}`,
    `Prev: ${fmt(signal.prev)}`,
    `EMA20: ${fmt(signal.ema20)}  EMA50: ${fmt(signal.ema50)}  RSI14: ${signal.rsi.toFixed(2)}`,
    `MACD(12,26,9): ${fmt(signal.macd)} / ${fmt(signal.macds)} (hist ${fmt(signal.hist)})`,
    `ATR14: ${fmt(signal.atr)}${signal.atrProxy ? " (proxy)" : ""}`,
    `SIGNAL: ${signal.state}`,
  ];
  if (signal.levels) {
    lines.push(`Entry: ${fmt(signal.entry)}  SL: ${fmt(signal.levels.sl)}  TP1: ${fmt(signal.levels.tp1)}  TP2: ${fmt(signal.levels.tp2)}`);
  }
  return lines.join("\n");
}
