import { TF } from "./normalize";
import { get_ohlc, Candle, OhlcResult, OhlcSource } from "./ohlc";

export interface SignalIndicators {
  ema20: number;
  ema50: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
}

export interface SignalPayload extends Record<string, unknown> {
  signal: "BUY" | "SELL" | "NEUTRAL";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  timeUTC: string;
  symbol: string;
  interval: TF;
  source: OhlcSource;
  stale: boolean;
  lastClosed: Candle;
  indicators: SignalIndicators;
}

const TF_TO_MS: Record<TF, number> = {
  "1min": 60_000,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1hour": 60 * 60_000,
  "4hour": 4 * 60 * 60_000,
  "1day": 24 * 60 * 60_000,
};

function ensureFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function ema(values: number[], period: number) {
  if (!values.length) return NaN;
  const effectivePeriod = Math.max(1, Math.min(period, values.length));
  const weight = 2 / (effectivePeriod + 1);
  let current = values
    .slice(0, effectivePeriod)
    .reduce((acc, value) => acc + value, 0) / effectivePeriod;
  for (let i = effectivePeriod; i < values.length; i += 1) {
    current = values[i] * weight + current * (1 - weight);
  }
  return current;
}

function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const effectivePeriod = Math.max(1, Math.min(period, values.length));
  const weight = 2 / (effectivePeriod + 1);
  const series: number[] = [];
  let current = values
    .slice(0, effectivePeriod)
    .reduce((acc, value) => acc + value, 0) / effectivePeriod;
  for (let i = 0; i < values.length; i += 1) {
    if (i < effectivePeriod) {
      const windowSize = i + 1;
      const avg = values.slice(0, windowSize).reduce((acc, value) => acc + value, 0) / windowSize;
      series.push(avg);
      current = avg;
    } else {
      current = values[i] * weight + current * (1 - weight);
      series.push(current);
    }
  }
  return series;
}

function rsi(values: number[], period = 14) {
  if (values.length < 2) return NaN;
  const effectivePeriod = Math.max(2, Math.min(period, values.length - 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= effectivePeriod; i += 1) {
    const delta = values[i] - values[i - 1];
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  gains /= effectivePeriod;
  losses = losses || 1e-12;
  let rs = gains / losses;
  let result = 100 - 100 / (1 + rs);
  for (let i = effectivePeriod + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    gains = (gains * (effectivePeriod - 1) + gain) / effectivePeriod;
    losses = (losses * (effectivePeriod - 1) + loss) / effectivePeriod || 1e-12;
    rs = gains / losses;
    result = 100 - 100 / (1 + rs);
  }
  return result;
}

function macd(values: number[]) {
  if (!values.length) {
    return { macd: NaN, signal: NaN, hist: NaN };
  }
  const fastSeries = emaSeries(values, 12);
  const slowSeries = emaSeries(values, 26);
  const length = Math.min(fastSeries.length, slowSeries.length);
  const macdSeries: number[] = [];
  for (let i = 0; i < length; i += 1) {
    macdSeries.push(fastSeries[i] - slowSeries[i]);
  }
  if (!macdSeries.length) {
    return { macd: NaN, signal: NaN, hist: NaN };
  }
  const macdValue = macdSeries[macdSeries.length - 1];
  const signalSeries = emaSeries(macdSeries, 9);
  const macdSignal = signalSeries.at(-1) ?? NaN;
  const macdHist = macdValue - macdSignal;
  return { macd: macdValue, signal: macdSignal, hist: macdHist };
}

function atr14(highs: number[], lows: number[], closes: number[]) {
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    tr.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  if (!tr.length) {
    return { value: NaN };
  }
  const period = Math.min(14, tr.length);
  let avg = tr.slice(0, period).reduce((acc, value) => acc + value, 0) / period;
  for (let i = period; i < tr.length; i += 1) {
    avg = (avg * (period - 1) + tr[i]) / period;
  }
  return { value: avg };
}

function toUtcIso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function round(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function normaliseSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function ensureSorted(candles: Candle[]): Candle[] {
  return candles
    .map((candle) => ({
      o: Number(candle.o),
      h: Number(candle.h),
      l: Number(candle.l),
      c: Number(candle.c),
      t: Number(candle.t),
      v: Number.isFinite(candle.v) ? Number(candle.v) : undefined,
    }))
    .filter((candle) =>
      Number.isFinite(candle.o) &&
      Number.isFinite(candle.h) &&
      Number.isFinite(candle.l) &&
      Number.isFinite(candle.c) &&
      Number.isFinite(candle.t),
    )
    .sort((a, b) => a.t - b.t);
}

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const now = Date.now();
  const sorted = ensureSorted(candles);
  const last = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;
  if (!last) {
    throw new Error("INVALID_CANDLES");
  }
  const candidate = last && now - last.t < tfMs * 0.5 ? prev ?? last : last;
  if (!candidate) {
    throw new Error("NO_CLOSED_BAR");
  }
  const values = [candidate.o, candidate.h, candidate.l, candidate.c];
  if (!values.every((value) => Number.isFinite(value))) {
    throw new Error("INVALID_CANDLE_VALUES");
  }
  return candidate;
}

export function buildSignalFromSeries(symbol: string, timeframe: TF, series: OhlcResult): SignalPayload {
  const candles = ensureSorted(series.candles);
  if (!Array.isArray(candles) || candles.length < 3) {
    throw new Error("insufficient_ohlc");
  }
  const lastClosed = series.lastClosed ?? deriveLastClosed(candles, timeframe);
  const closes = candles.map((candle) => candle.c);
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const previous = candles.at(-2);
  if (!previous) {
    throw new Error("missing_previous_bar");
  }

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsiValue = rsi(closes, 14);
  const { macd: macdValue, signal: macdSignal, hist: macdHist } = macd(closes);
  const { value: atrValue } = atr14(highs, lows, closes);

  let decision: SignalPayload["signal"] = "NEUTRAL";
  if (ema20 > ema50 && rsiValue >= 55 && macdValue > macdSignal) decision = "BUY";
  if (ema20 < ema50 && rsiValue <= 45 && macdValue < macdSignal) decision = "SELL";

  const close = lastClosed.c;
  const fallbackRisk = Math.max(close * 0.0015, Math.abs(close - previous.c) || 1);
  const risk = ensureFinite(atrValue, fallbackRisk);

  const entry = round(close);
  const stopLoss = round(
    decision === "BUY" ? close - risk : decision === "SELL" ? close + risk : close,
  );
  const takeProfit1 = round(
    decision === "BUY" ? close + risk : decision === "SELL" ? close - risk : close,
  );
  const takeProfit2 = round(
    decision === "BUY" ? close + 2 * risk : decision === "SELL" ? close - 2 * risk : close,
  );

  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const stale = typeof series.stale === "boolean" ? series.stale : Date.now() - lastClosed.t > tfMs * 3;

  return {
    signal: decision,
    entry,
    sl: stopLoss,
    tp1: takeProfit1,
    tp2: takeProfit2,
    timeUTC: toUtcIso(lastClosed.t),
    symbol: normaliseSymbol(symbol),
    interval: timeframe,
    source: series.source,
    stale,
    lastClosed,
    indicators: {
      ema20,
      ema50,
      rsi: rsiValue,
      macd: macdValue,
      macdSignal,
      macdHist,
    },
  };
}

export async function computeSignal(symbol: string, timeframe: TF, candles?: Candle[]): Promise<SignalPayload> {
  if (candles && candles.length > 0) {
    const normalized = ensureSorted(candles);
    if (!normalized.length) {
      throw new Error("invalid_candles");
    }
    const lastClosed = deriveLastClosed(normalized, timeframe);
    const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
    const stale = Date.now() - lastClosed.t > tfMs * 3;
    const data: OhlcResult = {
      candles: normalized,
      lastClosed,
      timeframe,
      source: "PROVIDED" as OhlcSource,
      stale,
    };
    return buildSignalFromSeries(symbol, timeframe, data);
  }

  const fetched = await get_ohlc(symbol, timeframe);
  if (!fetched.candles.length) {
    throw new Error("missing_ohlc");
  }
  return buildSignalFromSeries(symbol, fetched.timeframe, fetched);
}
