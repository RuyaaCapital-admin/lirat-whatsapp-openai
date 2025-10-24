import { TF } from "./normalize";
import { get_ohlc } from "./ohlc";

const ema = (arr: number[], p: number) => {
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
};

const rsi = (arr: number[], p = 14) => {
  let g = 0,
    l = 0;
  for (let i = 1; i <= p; i++) {
    const d = arr[i] - arr[i - 1];
    g += Math.max(d, 0);
    l += Math.max(-d, 0);
  }
  g /= p;
  l = l || 1e-12;
  let rs = g / l,
    r = 100 - 100 / (1 + rs);
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const G = Math.max(d, 0),
      L = Math.max(-d, 0);
    g = (g * (p - 1) + G) / p;
    l = (l * (p - 1) + L) / p || 1e-12;
    rs = g / l;
    r = 100 - 100 / (1 + rs);
  }
  return r;
};

const macdVals = (arr: number[]) => {
  const emaN = (n: number) => {
    let e = arr[0];
    const k = 2 / (n + 1);
    for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  };
  const macd = emaN(12) - emaN(26);
  const signal = emaN(9);
  const hist = macd - signal;
  return { macd, signal, hist };
};

const atr14 = (H: number[], L: number[], C: number[]) => {
  const tr: number[] = [];
  for (let i = 1; i < H.length; i++) {
    tr.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  }
  if (tr.length < 14) return { value: NaN, proxy: true };
  let a = tr.slice(0, 14).reduce((x, y) => x + y, 0) / 14;
  for (let i = 14; i < tr.length; i++) a = (a * 13 + tr[i]) / 14;
  return { value: a, proxy: false };
};

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTime(timestamp: number, timeframe: TF) {
  const iso = new Date(timestamp).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC (${timeframe})`;
}

export async function compute_trading_signal(symbol: string, timeframe: TF) {
  const { rows, lastClosed } = await get_ohlc(symbol, timeframe);
  const C = rows.map((r) => r.c);
  const H = rows.map((r) => r.h);
  const L = rows.map((r) => r.l);
  const prev = rows.at(-2)!;

  const ema20 = ema(C, 20);
  const ema50 = ema(C, 50);
  const rsi14 = rsi(C, 14);
  const { macd } = macdVals(C);
  const { value: atrVal } = atr14(H, L, C);

  let decision: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (ema20 > ema50 && rsi14 >= 55) decision = "BUY";
  if (ema20 < ema50 && rsi14 <= 45) decision = "SELL";

  const close = lastClosed.c;
  const fallbackRisk = Math.max(close * 0.0015, Math.abs(close - prev.c) || 1);
  const risk = Number.isFinite(atrVal) ? atrVal : fallbackRisk;
  const entry = close;
  const sl = decision === "BUY" ? entry - risk : decision === "SELL" ? entry + risk : entry;
  const tp1 = decision === "BUY" ? entry + risk : decision === "SELL" ? entry - risk : entry;
  const tp2 = decision === "BUY" ? entry + 2 * risk : decision === "SELL" ? entry - 2 * risk : entry;

  const formattedTime = formatTime(lastClosed.t, timeframe);

  if (decision === "NEUTRAL") {
    const neutralLine = `- SIGNAL: NEUTRAL — Time: ${formattedTime} — Symbol: ${symbol}`;
    return { text: neutralLine };
  }

  const lines = [
    `- Time: ${formattedTime}`,
    `- Symbol: ${symbol}`,
    `- SIGNAL: ${decision}`,
    `- Entry: ${formatNumber(entry)}`,
    `- SL: ${formatNumber(sl)}`,
    `- TP1: ${formatNumber(tp1)}`,
    `- TP2: ${formatNumber(tp2)}`,
  ];

  return { text: lines.join("\n") };
}
