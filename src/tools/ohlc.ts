// src/tools/ohlc.ts
import axios from "axios";
import { toFcsSymbol, toFcsPeriod } from "./price";

// Candle type definition
type Candle = {
  t: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
};

export async function getFcsCandles(symbolRaw: string, tf: string = "1h", limit = 200): Promise<Candle[]> {
  const symbol = toFcsSymbol(symbolRaw);
  const period = toFcsPeriod(tf);
  const url = `https://fcsapi.com/api-v3/forex/candle?symbol=${encodeURIComponent(symbol)}&period=${period}&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Candles URL:', url);
  const { data } = await axios.get(url, { timeout: 9000 });
  const r = data?.response;
  if (!r || !Array.isArray(r.c) || r.c.length < 60) {
    throw new Error(`FCS candle: not enough data for ${symbol} ${period}`);
  }
  const result: Candle[] = r.c.map((c: string, i: number) => ({
    t: r.t[i],
    o: Number(r.o[i]),
    h: Number(r.h[i]),
    l: Number(r.l[i]),
    c: Number(c),
  }));
  return result.slice(-limit);
}

export function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  let emaPrev = values[0];
  const out = [emaPrev];
  for (let i = 1; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    out.push(emaPrev);
  }
  return out;
}

export function rsi(values: number[], period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let rs = gains / Math.max(1e-9, losses);
  const out = [100 - 100 / (1 + rs)];
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(0, diff);
    const loss = Math.max(0, -diff);
    gains = (gains * (period - 1) + gain) / period;
    losses = (losses * (period - 1) + loss) / period;
    rs = gains / Math.max(1e-9, losses);
    out.push(100 - 100/(1 + rs));
  }
  return out;
}

export function makeSignal(closes: number[]) {
  const ema20 = ema(closes, 20).at(-1)!;
  const ema50 = ema(closes, 50).at(-1)!;
  const r = rsi(closes, 14).at(-1)!;

  if (ema20 > ema50 && r >= 45 && r <= 70) return "BUY";
  if (ema20 < ema50 && r <= 55 && r >= 30) return "SELL";
  return "NEUTRAL";
}

export async function getTradingSignal(symbol: string, tf: string = "1h") {
  const rows: Candle[] = await getFcsCandles(symbol, tf, 200);
  const closes = rows.map((r: Candle) => r.c);
  const sig = makeSignal(closes);
  const last = rows.at(-1)!;
  const prev = rows.at(-2) || last;

  // Calculate indicators
  const ema20 = ema(closes, 20).at(-1)!;
  const ema50 = ema(closes, 50).at(-1)!;
  const rsiValue = rsi(closes, 14).at(-1)!;

  return {
    symbol,
    timeframe: tf,
    lastClosed: last.t,
    close: last.c,
    prev: prev.c,
    ema20,
    ema50,
    rsi14: rsiValue,
    signal: sig,
  };
}