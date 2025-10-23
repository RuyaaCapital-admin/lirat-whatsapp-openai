export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type TF = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

function ema(values: number[], p: number) {
  const k = 2 / (p + 1);
  let ema = values[0];
  const out = [ema];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function rsi14(values: number[]) {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < 15; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);
  return rsi;
}

function macd(values: number[]) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => ema12[i] - ema26[i]);
  const signal = ema(macdLine, 9);
  const hist = macdLine.at(-1)! - signal.at(-1)!;
  return { macd: macdLine.at(-1)!, signal: signal.at(-1)!, hist };
}

function atr14(candles: Candle[]) {
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  if (tr.length < 14) return { atr: stddev(candles.map((x) => x.c).slice(-14)) * 1.5, proxy: true } as const;
  const out = ema(tr, 14);
  return { atr: out.at(-1)!, proxy: false } as const;
}

function stddev(arr: number[]) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
  return Math.sqrt(v);
}

export function computeSignal(ticker: string, tf: TF, candles: Candle[]) {
  if (candles.length < 60) return { state: "NEUTRAL", reason: "insufficient" } as const;
  const closes = candles.map((x) => x.c);
  const c = closes.at(-1)!;
  const prev = closes.at(-2)!;

  const ema20 = ema(closes, 20).at(-1)!;
  const ema50 = ema(closes, 50).at(-1)!;
  const rsi = rsi14(closes.slice(-15));
  const { macd: macdV, signal: macdS, hist } = macd(closes.slice(-60));
  const { atr, proxy } = atr14(candles.slice(-60));

  let state: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (c > ema50 && ema20 > ema50 && rsi >= 55 && macdV > macdS) state = "BUY";
  else if (c < ema50 && ema20 < ema50 && rsi <= 45 && macdV < macdS) state = "SELL";

  const k = tf === "1m" ? 0.35 : tf === "5m" ? 0.5 : tf === "15m" ? 0.75 : tf === "30m" ? 0.9 : tf === "1h" ? 1 : tf === "4h" ? 1.5 : 2;
  const risk = k * atr;
  const entry = c;
  const levels =
    state === "BUY"
      ? { sl: entry - risk, tp1: entry + risk, tp2: entry + 2 * risk }
      : state === "SELL"
      ? { sl: entry + risk, tp1: entry - risk, tp2: entry - 2 * risk }
      : null;

  return { state, c, prev, ema20, ema50, rsi, macd: macdV, macds: macdS, hist, atr, atrProxy: proxy, entry, levels };
}
