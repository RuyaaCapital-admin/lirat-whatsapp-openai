import { formatSignalMsg } from "../utils/formatters";
import { TF } from "./normalize";
import { get_ohlc, Candle, OhlcResult, OhlcSource } from "./ohlc";

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
      const ema = values[i] * weight + emaValues[emaValues.length - 1] * (1 - weight);
      emaValues.push(ema);
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
  const signal = ema(macdValues, 9);
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

const TF_TO_MS: Record<TF, number> = {
  "1min": 60_000,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1hour": 60 * 60_000,
  "4hour": 4 * 60 * 60_000,
  "1day": 24 * 60 * 60_000,
};

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const now = Date.now();
  const sorted = candles.slice().sort((a, b) => a.t - b.t);
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

function normalizeCandles(candles: Candle[]): Candle[] {
  return candles
    .map((candle) => ({
      o: Number(candle.o),
      h: Number(candle.h),
      l: Number(candle.l),
      c: Number(candle.c),
      t: Number(candle.t),
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
    entry,
    sl: stopLoss,
    tp1: takeProfit1,
    tp2: takeProfit2,
    timeUTC: toUtcIso(series.lastClosed.t),
    symbol: normaliseSymbol(symbol),
    interval: timeframe,
    source: series.source,
    stale: Boolean(series.stale),
  };
}

export async function computeSignal(symbol: string, timeframe: TF, candles?: Candle[]): Promise<SignalPayload> {
  if (candles && candles.length > 0) {
    const normalized = normalizeCandles(candles);
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

export function formatSignalPayload(signal: SignalPayload): string {
  return formatSignalMsg({
    decision: signal.signal,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    time: signal.timeUTC,
    symbol: signal.symbol,
  });
}

export async function compute_trading_signal(
  symbol: string,
  timeframe: TF,
  candles?: Candle[],
): Promise<{ text: string }> {
  const payload = await computeSignal(symbol, timeframe, candles);
  return { text: JSON.stringify(payload) };
}
