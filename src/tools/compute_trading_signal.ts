import { TF } from "./normalize";
import type { Candle } from "./ohlc";

export type SignalDecision = "BUY" | "SELL" | "NEUTRAL";

export type ReasonToken = "bullish_pressure" | "bearish_pressure" | "no_clear_bias";

export interface TradingSignalInput {
  symbol: string;
  timeframe: TF;
  candles: Candle[];
  lastISO: string;
  ageMinutes: number;
  stale: boolean;
}

export interface TradingSignalLevels {
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
}

export interface TradingSignal {
  symbol: string;
  timeframe: TF;
  timeUTC: string;
  decision: SignalDecision;
  reason: ReasonToken;
  levels: TradingSignalLevels;
  stale: boolean;
  ageMinutes: number;
}

// Require a reasonable history but not too strict; 25 gives ~2h on 5min
const MIN_CANDLES = 25;

const PERIOD_BY_TF: Record<TF, "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d"> = {
  "1min": "1m",
  "5min": "5m",
  "15min": "15m",
  "30min": "30m",
  "1hour": "1h",
  "4hour": "4h",
  "1day": "1d",
};

const THRESH_BY_PERIOD: Record<"1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d", number> = {
  "1m": 2,
  "5m": 2,
  "15m": 2,
  "30m": 2,
  "1h": 1,
  "4h": 1,
  "1d": 1,
};

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
    .filter(
      (candle) =>
        Number.isFinite(candle.o) &&
        Number.isFinite(candle.h) &&
        Number.isFinite(candle.l) &&
        Number.isFinite(candle.c) &&
        Number.isFinite(candle.t),
    )
    .sort((a, b) => a.t - b.t);
}

function ema(values: number[], period: number) {
  if (!values.length) return NaN;
  const effectivePeriod = Math.max(1, Math.min(period, values.length));
  const alpha = 2 / (effectivePeriod + 1);
  let current = values
    .slice(0, effectivePeriod)
    .reduce((acc, value) => acc + value, 0) / effectivePeriod;
  for (let i = effectivePeriod; i < values.length; i += 1) {
    current = values[i] * alpha + current * (1 - alpha);
  }
  return current;
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

function atr(highs: number[], lows: number[], closes: number[], period = 14) {
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
  if (!tr.length) return NaN;
  const window = Math.min(period, tr.length);
  let avg = tr.slice(0, window).reduce((acc, value) => acc + value, 0) / window;
  for (let i = window; i < tr.length; i += 1) {
    avg = (avg * (window - 1) + tr[i]) / window;
  }
  return avg;
}

function roundPrice(value: number) {
  if (!Number.isFinite(value)) return NaN;
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : 6;
  return Number(value.toFixed(decimals));
}

function mapReason(decision: SignalDecision): ReasonToken {
  if (decision === "BUY") {
    return "bullish_pressure";
  }
  if (decision === "SELL") {
    return "bearish_pressure";
  }
  return "no_clear_bias";
}

function computeTargets(
  decision: SignalDecision,
  lastClose: number,
  previousClose: number,
  atrValue: number,
): { entry: number | null; sl: number | null; tp1: number | null; tp2: number | null } {
  if (decision === "NEUTRAL") {
    return { entry: null, sl: null, tp1: null, tp2: null };
  }
  // Use ATR for risk; fallback to price change or 0.15%
  const fallbackRisk = Math.max(lastClose * 0.0015, Math.abs(lastClose - previousClose) || lastClose * 0.001);
  const risk = Number.isFinite(atrValue) && atrValue > 0 ? atrValue : fallbackRisk;
  const entry = roundPrice(lastClose);
  const riskRounded = roundPrice(risk);
  if (!Number.isFinite(entry) || !Number.isFinite(riskRounded)) {
    return { entry: null, sl: null, tp1: null, tp2: null };
  }
  if (decision === "BUY") {
    const sl = roundPrice(entry - 0.9 * riskRounded);
    return {
      entry,
      sl,
      tp1: roundPrice(entry + 1.2 * riskRounded),
      tp2: roundPrice(entry + 2.4 * riskRounded),
    };
  }
  const sl = roundPrice(entry + 0.9 * riskRounded);
  return {
    entry,
    sl,
    tp1: roundPrice(entry - 1.2 * riskRounded),
    tp2: roundPrice(entry - 2.4 * riskRounded),
  };
}

function computeDirectionalScore(
  lastClose: number,
  fastEma: number,
  slowEma: number,
  momentum: number,
  rsiValue: number,
): number {
  if (
    !Number.isFinite(lastClose) ||
    !Number.isFinite(fastEma) ||
    !Number.isFinite(slowEma) ||
    !Number.isFinite(rsiValue)
  ) {
    return 0;
  }

  let buyScore = 0;
  let sellScore = 0;

  // Trend bias via EMAs
  if (fastEma > slowEma) buyScore += 2; else if (fastEma < slowEma) sellScore += 2;

  // Price location vs fast EMA
  if (lastClose > fastEma) buyScore += 1; else sellScore += 1;

  // RSI zones (more permissive)
  if (rsiValue >= 60) buyScore += 2; else if (rsiValue >= 55) buyScore += 1;
  if (rsiValue <= 40) sellScore += 2; else if (rsiValue <= 45) sellScore += 1;

  // Momentum direction
  if (momentum > 0) buyScore += 1; else if (momentum < 0) sellScore += 1;

  return buyScore - sellScore;
}

function formatUtcLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return formatUtcLabel(new Date().toISOString());
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function deriveMomentum(closes: number[]): number {
  if (closes.length < 2) return 0;
  const window = Math.min(6, closes.length - 1);
  return closes[closes.length - 1] - closes[closes.length - 1 - window];
}

function computeDonchianMid(candles: Candle[], period = 20): number {
  if (!candles.length) {
    return Number.NaN;
  }
  const length = Math.min(period, candles.length);
  let highest = -Infinity;
  let lowest = Infinity;
  for (let i = candles.length - length; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!candle) continue;
    if (Number.isFinite(candle.h) && candle.h > highest) {
      highest = candle.h;
    }
    if (Number.isFinite(candle.l) && candle.l < lowest) {
      lowest = candle.l;
    }
  }
  if (!Number.isFinite(highest) || !Number.isFinite(lowest)) {
    return Number.NaN;
  }
  return (highest + lowest) / 2;
}

function forceDirectionFallback(params: {
  ema20: number;
  ema50: number;
  ema200: number;
  lastClose: number;
  donchianMid: number;
  macd: number;
}): SignalDecision {
  const { ema20, ema50, ema200, lastClose, donchianMid, macd } = params;

  if (Number.isFinite(ema20) && Number.isFinite(ema50) && ema20 !== ema50) {
    return ema20 > ema50 ? "BUY" : "SELL";
  }

  if (Number.isFinite(lastClose) && Number.isFinite(ema200) && lastClose !== ema200) {
    return lastClose > ema200 ? "BUY" : "SELL";
  }

  if (Number.isFinite(lastClose) && Number.isFinite(donchianMid) && lastClose !== donchianMid) {
    return lastClose > donchianMid ? "BUY" : "SELL";
  }

  if (Number.isFinite(macd) && macd !== 0) {
    return macd >= 0 ? "BUY" : "SELL";
  }

  return "BUY";
}

export function compute_trading_signal(input: TradingSignalInput): TradingSignal {
  const sorted = ensureSorted(input.candles);
  if (!sorted.length) {
    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      timeUTC: formatUtcLabel(input.lastISO),
      decision: "NEUTRAL",
      reason: "no_clear_bias",
      levels: { entry: null, sl: null, tp1: null, tp2: null },
      stale: Boolean(input.stale),
      ageMinutes: Math.max(0, Math.floor(input.ageMinutes)),
    };
  }

  const candles = sorted.slice(-Math.max(MIN_CANDLES, sorted.length));
  const closes = candles.map((candle) => candle.c);
  const highs = candles.map((candle) => candle.h);
  const lows = candles.map((candle) => candle.l);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? last;
  const lastClose = last.c;
  const previousClose = previous.c;

  const momentum = deriveMomentum(closes);
  const fastEma = ema(closes, 20);
  const slowEma = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiValue = rsi(closes, 14);
  const atrValue = atr(highs, lows, closes, 14);
  const donchianMid = computeDonchianMid(candles, 20);
  const macdFast = ema(closes, 12);
  const macdSlow = ema(closes, 26);
  const macdValue = Number.isFinite(macdFast) && Number.isFinite(macdSlow)
    ? macdFast - macdSlow
    : Number.NaN;

  const periodKey = PERIOD_BY_TF[input.timeframe] ?? "1m";
  const threshold = THRESH_BY_PERIOD[periodKey] ?? 2;
  const score = computeDirectionalScore(lastClose, fastEma, slowEma, momentum, rsiValue);

  let decision: SignalDecision;
  if (candles.length < MIN_CANDLES) {
    decision = "NEUTRAL";
  } else if (score >= threshold) {
    decision = "BUY";
  } else if (score <= -threshold) {
    decision = "SELL";
  } else {
    decision = forceDirectionFallback({
      ema20: fastEma,
      ema50: slowEma,
      ema200,
      lastClose,
      donchianMid,
      macd: macdValue,
    });
  }
  const targets = computeTargets(decision, lastClose, previousClose, atrValue);

  const timeUTC = formatUtcLabel(input.lastISO);
  const reason = mapReason(decision);
  const ageMinutes = Math.max(0, Math.floor(Number(input.ageMinutes) || 0));

  const levels: TradingSignalLevels = decision === "NEUTRAL"
    ? { entry: null, sl: null, tp1: null, tp2: null }
    : targets;

  const result: TradingSignal = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    timeUTC,
    decision,
    reason,
    levels,
    stale: Boolean(input.stale),
    ageMinutes,
  };

  console.log(
    `[SIGNAL] symbol=${result.symbol} tf=${result.timeframe} decision=${result.decision} reason=${result.reason} stale=${result.stale} age=${result.ageMinutes}`,
  );

  return result;
}
