import { TF } from "./normalize";
import { get_ohlc, Candle, OhlcResult, OhlcSource } from "./ohlc";

export interface SignalPayload extends Record<string, unknown> {
  signal: "BUY" | "SELL" | "NEUTRAL";
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  timeUTC: string;
  symbol: string;
  interval: TF;
}

function ema(values: number[], period: number) {
  const weight = 2 / (period + 1);
  let current = values.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
  for (let i = period; i < values.length; i += 1) {
    current = values[i] * weight + current * (1 - weight);
  }
  return current;
}

function rsi(values: number[], period = 14) {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  gains /= period;
  losses = losses || 1e-12;
  let rs = gains / losses;
  let result = 100 - 100 / (1 + rs);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    gains = (gains * (period - 1) + gain) / period;
    losses = (losses * (period - 1) + loss) / period || 1e-12;
    rs = gains / losses;
    result = 100 - 100 / (1 + rs);
  }
  return result;
}

function macd(values: number[]) {
  const calculateEMA = (period: number) => {
    const emaValues: number[] = [];
    const weight = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period && i < values.length; i += 1) {
      sum += values[i];
    }
    emaValues.push(sum / Math.min(period, values.length));

    for (let i = period; i < values.length; i += 1) {
      const emaValue = values[i] * weight + emaValues[emaValues.length - 1] * (1 - weight);
      emaValues.push(emaValue);
    }

    return emaValues;
  };

  const fastEMA = calculateEMA(12);
  const slowEMA = calculateEMA(26);
  const macdValues: number[] = [];
  const minLength = Math.min(fastEMA.length, slowEMA.length);
  for (let i = 0; i < minLength; i += 1) {
    macdValues.push(fastEMA[i] - slowEMA[i]);
  }

  const macdValue = macdValues[macdValues.length - 1];
  const signal = ema(macdValues, Math.min(9, macdValues.length));
  return { macd: macdValue, signal };
}

function atr14(highs: number[], lows: number[], closes: number[]) {
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (tr.length < 14) {
    return { value: NaN };
  }
  let avg = tr.slice(0, 14).reduce((acc, value) => acc + value, 0) / 14;
  for (let i = 14; i < tr.length; i += 1) {
    avg = (avg * 13 + tr[i]) / 14;
  }
  return { value: avg };
}

function toUtcString(timestamp: number) {
  const iso = new Date(timestamp).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function round(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function normaliseSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

const TF_TO_MS: Record<TF, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function isFiniteCandle(value: Candle | null | undefined): value is Candle {
  if (!value) return false;
  return [value.o, value.h, value.l, value.c].every((x) => Number.isFinite(x));
}

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const sorted = candles.slice().sort((a, b) => a.t - b.t);
  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const now = Date.now();
  const last = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;

  if (!last || !isFiniteCandle(last)) {
    throw new Error("INVALID_CANDLES");
  }

  const candidate = now - last.t < tfMs * 0.5 ? prev : last;
  if (!candidate || !isFiniteCandle(candidate)) {
    throw new Error("NO_CLOSED_BAR");
  }
  if (now - candidate.t > tfMs * 6) {
    throw new Error("STALE_DATA");
  }

  return candidate;
}

function formatSignalOutput(signal: SignalPayload): { text: string } {
  const { signal: decision, entry, sl, tp1, tp2, timeUTC, symbol, interval } = signal;

  if (decision === "NEUTRAL") {
    return {
      text: `- SIGNAL: NEUTRAL — Time: ${timeUTC} (${interval}) — Symbol: ${symbol}`,
    };
  }

  return {
    text: [
      `- Time: ${timeUTC}`,
      `- Symbol: ${symbol}`,
      `- SIGNAL: ${decision}`,
      `- Entry: ${entry}`,
      `- SL: ${sl}`,
      `- TP1: ${tp1} (R 1.0)`,
      `- TP2: ${tp2} (R 2.0)`,
    ].join("\n"),
  };
}

export function buildSignalFromSeries(symbol: string, timeframe: TF, series: OhlcResult): SignalPayload {
  const candles = series.candles;
  if (!Array.isArray(candles) || candles.length < 3) {
    throw new Error("insufficient_ohlc");
  }
  const closes = candles.map((candle) => candle.c);
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const lastIndex = candles.findIndex((candle) => candle.t === series.lastClosed.t);
  const previous = lastIndex > 0 ? (candles[lastIndex - 1] as Candle | undefined) : undefined;
  if (!previous) {
    throw new Error("missing_previous_bar");
  }

  const ema20 = ema(closes, Math.min(20, closes.length));
  const ema50 = ema(closes, Math.min(50, closes.length));
  const rsiValue = rsi(closes, Math.min(14, closes.length - 1));
  const { macd: macdValue } = macd(closes);
  const { value: atrValue } = atr14(highs, lows, closes);

  let decision: SignalPayload["signal"] = "NEUTRAL";
  if (ema20 > ema50 && rsiValue >= 55 && macdValue > 0) decision = "BUY";
  if (ema20 < ema50 && rsiValue <= 45 && macdValue < 0) decision = "SELL";

  const close = series.lastClosed.c;
  const fallbackRisk = Math.max(close * 0.0015, Math.abs(close - previous.c) || 1);
  const risk = Number.isFinite(atrValue) && atrValue > 0 ? atrValue : fallbackRisk;

  const entry = round(close);
  const stopLoss = round(decision === "BUY" ? close - risk : decision === "SELL" ? close + risk : close);
  const takeProfit1 = round(decision === "BUY" ? close + risk : decision === "SELL" ? close - risk : close);
  const takeProfit2 = round(decision === "BUY" ? close + 2 * risk : decision === "SELL" ? close - 2 * risk : close);

  return {
    signal: decision,
    entry: decision === "NEUTRAL" ? null : entry,
    sl: decision === "NEUTRAL" ? null : stopLoss,
    tp1: decision === "NEUTRAL" ? null : takeProfit1,
    tp2: decision === "NEUTRAL" ? null : takeProfit2,
    timeUTC: toUtcString(series.lastClosed.t),
    symbol: normaliseSymbol(symbol),
    interval: timeframe,
  };
}

export async function compute_trading_signal(symbol: string, timeframe: TF, candles?: Candle[]): Promise<{ text: string }> {
  let data: OhlcResult;

  if (Array.isArray(candles) && candles.length > 0) {
    const sorted = candles.slice().sort((a, b) => a.t - b.t);
    const last = sorted.at(-1);
    const intervalMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
    if (last && Date.now() - last.t > 3 * intervalMs) {
      console.warn(
        `[STALE] Candles are stale for ${symbol} ${timeframe}, age: ${Math.round((Date.now() - last.t) / 1000)}s`,
      );
    }
    const lastClosed = deriveLastClosed(sorted, timeframe);
    data = {
      candles: sorted,
      lastClosed,
      timeframe,
      source: "PROVIDED" as OhlcSource,
    };
  } else {
    data = await get_ohlc(symbol, timeframe);
  }

  const signal = buildSignalFromSeries(symbol, timeframe, data);
  return formatSignalOutput(signal);
}
