import { TF, TF_SECONDS } from "./normalize";
import { Candle, get_ohlc } from "./ohlc";

export interface SignalIndicators {
  ema20: number;
  ema50: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
}

export interface TradingSignalResult {
  decision: "BUY" | "SELL" | "NEUTRAL";
  entry?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  time: string;
  symbol: string;
  timeframe: TF;
  reason: string;
  stale: boolean;
  indicators: SignalIndicators;
  candles_count: number;
  lastClosedTs: number;
  lastClosed: Candle;
}

const MAX_CANDLES = 200;

function toMillis(timestamp: number): number {
  return timestamp >= 10_000_000_000 ? timestamp : timestamp * 1000;
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
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_CANDLES);
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

function roundPrice(value: number) {
  if (!Number.isFinite(value)) return NaN;
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const intervalMs = (TF_SECONDS[timeframe] ?? 300) * 1000;
  const sorted = ensureSorted(candles);
  const last = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;
  if (!last) {
    throw new Error("INVALID_CANDLES");
  }
  const now = Date.now();
  const lastMs = toMillis(last.t);
  if (now - lastMs < intervalMs * 0.5 && prev) {
    return prev;
  }
  return last;
}

function computeDecision(indicators: SignalIndicators): "BUY" | "SELL" | "NEUTRAL" {
  const { ema20, ema50, rsi, macd, macdSignal } = indicators;
  if (ema20 > ema50 && rsi >= 55 && macd > macdSignal) return "BUY";
  if (ema20 < ema50 && rsi <= 45 && macd < macdSignal) return "SELL";
  return "NEUTRAL";
}

function computeTargets(
  decision: "BUY" | "SELL" | "NEUTRAL",
  lastClose: number,
  previousClose: number,
  atrValue: number,
) {
  const fallbackRisk = Math.max(lastClose * 0.0015, Math.abs(lastClose - previousClose) || 1);
  const risk = Number.isFinite(atrValue) ? atrValue : fallbackRisk;
  const entry = roundPrice(lastClose);
  if (decision === "BUY") {
    return {
      entry,
      sl: roundPrice(lastClose - risk),
      tp1: roundPrice(lastClose + risk),
      tp2: roundPrice(lastClose + 2 * risk),
    };
  }
  if (decision === "SELL") {
    return {
      entry,
      sl: roundPrice(lastClose + risk),
      tp1: roundPrice(lastClose - risk),
      tp2: roundPrice(lastClose - 2 * risk),
    };
  }
  return { entry: NaN, sl: NaN, tp1: NaN, tp2: NaN };
}

function toUtcLabel(timestamp: number) {
  const date = new Date(toMillis(timestamp));
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function buildReason(decision: "BUY" | "SELL" | "NEUTRAL", indicators: SignalIndicators): string {
  if (decision === "NEUTRAL") {
    return "No clear momentum / structure.";
  }
  const parts: string[] = [];
  if (decision === "BUY") {
    if (indicators.ema20 > indicators.ema50) parts.push("EMA cross up");
    if (indicators.rsi <= 35) parts.push("RSI oversold");
    else if (indicators.rsi >= 55) parts.push("RSI momentum");
    if (indicators.macd > indicators.macdSignal) parts.push("MACD bullish");
  } else {
    if (indicators.ema20 < indicators.ema50) parts.push("EMA cross down");
    if (indicators.rsi >= 65) parts.push("RSI overbought");
    else if (indicators.rsi <= 45) parts.push("RSI momentum");
    if (indicators.macd < indicators.macdSignal) parts.push("MACD bearish");
  }
  const unique = Array.from(new Set(parts));
  return unique.length ? unique.join(" + ") : "Momentum bias";
}

function normaliseSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function computeFromCandles(symbol: string, timeframe: TF, candles: Candle[]): TradingSignalResult {
  const sorted = ensureSorted(candles);
  if (!sorted.length) {
    throw new Error("missing_candles");
  }
  const lastClosed = deriveLastClosed(sorted, timeframe);
  const closes = sorted.map((candle) => candle.c);
  const highs = sorted.map((candle) => candle.h);
  const lows = sorted.map((candle) => candle.l);
  const previous = sorted.at(-2) ?? sorted.at(-1);
  if (!previous) {
    throw new Error("missing_previous_bar");
  }

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsiValue = rsi(closes, 14);
  const { macd: macdValue, signal: macdSignal, hist: macdHist } = macd(closes);
  const { value: atrValue } = atr14(highs, lows, closes);

  const indicators: SignalIndicators = {
    ema20,
    ema50,
    rsi: rsiValue,
    macd: macdValue,
    macdSignal,
    macdHist,
  };

  const decision = computeDecision(indicators);
  const targets = computeTargets(decision, lastClosed.c, previous.c, atrValue);

  const intervalMs = (TF_SECONDS[timeframe] ?? 300) * 1000;
  const lastClosedTs = Number(lastClosed.t);
  const stale = Date.now() - toMillis(lastClosedTs) > intervalMs * 3;
  const time = toUtcLabel(lastClosedTs);
  const reason = buildReason(decision, indicators);

  const payload: TradingSignalResult = {
    decision,
    time,
    symbol: normaliseSymbol(symbol),
    timeframe,
    reason,
    stale,
    indicators,
    candles_count: sorted.length,
    lastClosedTs,
    lastClosed,
  };

  if (decision !== "NEUTRAL") {
    payload.entry = targets.entry;
    payload.sl = targets.sl;
    payload.tp1 = targets.tp1;
    payload.tp2 = targets.tp2;
  }

  const logEntry = payload.entry ?? "";
  const logSl = payload.sl ?? "";
  const logTp1 = payload.tp1 ?? "";
  const logTp2 = payload.tp2 ?? "";
  console.log(
    `[SIGNAL] symbol=${payload.symbol} tf=${timeframe} decision=${decision} reason="${reason}" entry=${logEntry} sl=${logSl} tp1=${logTp1} tp2=${logTp2}`,
  );

  return payload;
}

export function compute_trading_signal(symbol: string, timeframe: TF, candles: Candle[]): TradingSignalResult {
  if (!Array.isArray(candles) || !candles.length) {
    throw new Error("missing_candles");
  }
  return computeFromCandles(symbol, timeframe, candles);
}

export async function computeSignal(
  symbol: string,
  timeframe: TF,
  candles?: Candle[],
): Promise<TradingSignalResult> {
  let working = Array.isArray(candles) ? candles : [];
  if (!working.length) {
    working = await get_ohlc(symbol, timeframe, MAX_CANDLES);
  }
  return computeFromCandles(symbol, timeframe, working);
}
