import { TF } from "./normalize";
import { Candle, OhlcResult } from "./ohlc";

type SignalDirection = "BUY" | "SELL" | "NEUTRAL";

type Lang = "ar" | "en";

export interface TradingSignalOk {
  status: "OK";
  lang: Lang;
  symbol: string;
  timeframe: TF;
  signal: SignalDirection;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  reason: string;
  lastISO: string;
  ageSeconds: number;
  isDelayed: boolean;
  provider: string;
}

export interface TradingSignalUnusable {
  status: "UNUSABLE";
  lang: Lang;
  error: "NO_DATA";
}

export type TradingSignalResult = TradingSignalOk | TradingSignalUnusable;

const MIN_CANDLES = 30;

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

function buildReason(signal: SignalDirection, lang: Lang): string {
  if (lang === "ar") {
    if (signal === "BUY") return "الاتجاه العام صاعد والمؤشرات تدعم الشراء.";
    if (signal === "SELL") return "الاتجاه العام هابط والمؤشرات تدعم البيع.";
    return "السوق بدون اتجاه واضح حالياً.";
  }
  if (signal === "BUY") return "Trend is up and indicators support buying.";
  if (signal === "SELL") return "Trend is down and indicators support selling.";
  return "Momentum is mixed; no clear setup right now.";
}

function computeTargets(
  signal: SignalDirection,
  lastClose: number,
  previousClose: number,
  atrValue: number,
): { entry: number | null; sl: number | null; tp1: number | null; tp2: number | null } {
  if (signal === "NEUTRAL") {
    return { entry: null, sl: null, tp1: null, tp2: null };
  }
  const fallbackRisk = Math.max(lastClose * 0.0015, Math.abs(lastClose - previousClose) || lastClose * 0.0008);
  const risk = Number.isFinite(atrValue) && atrValue > 0 ? atrValue : fallbackRisk;
  const entry = roundPrice(lastClose);
  const riskRounded = roundPrice(risk);
  if (!Number.isFinite(entry) || !Number.isFinite(riskRounded)) {
    return { entry: null, sl: null, tp1: null, tp2: null };
  }
  if (signal === "BUY") {
    const sl = roundPrice(entry - riskRounded);
    return {
      entry,
      sl,
      tp1: roundPrice(entry + riskRounded),
      tp2: roundPrice(entry + 2 * riskRounded),
    };
  }
  const sl = roundPrice(entry + riskRounded);
  return {
    entry,
    sl,
    tp1: roundPrice(entry - riskRounded),
    tp2: roundPrice(entry - 2 * riskRounded),
  };
}

function deriveSignal(
  fastEma: number,
  slowEma: number,
  momentum: number,
  rsiValue: number,
): SignalDirection {
  if (!Number.isFinite(fastEma) || !Number.isFinite(slowEma) || !Number.isFinite(rsiValue)) {
    return "NEUTRAL";
  }
  const trendUp = fastEma > slowEma;
  const trendDown = fastEma < slowEma;
  const momentumUp = momentum >= 0;
  const momentumDown = momentum <= 0;
  if (trendUp && momentumUp && rsiValue < 70) {
    return "BUY";
  }
  if (trendDown && momentumDown && rsiValue > 30) {
    return "SELL";
  }
  return "NEUTRAL";
}

interface TradingSignalInput extends OhlcResult {
  lang?: Lang;
}

export function compute_trading_signal(input: TradingSignalInput): TradingSignalResult {
  const lang: Lang = input.lang === "ar" ? "ar" : "en";
  const sorted = ensureSorted(input.candles);
  if (sorted.length < MIN_CANDLES || input.tooOld) {
    return { status: "UNUSABLE", lang, error: "NO_DATA" };
  }

  const closes = sorted.map((candle) => candle.c);
  const highs = sorted.map((candle) => candle.h);
  const lows = sorted.map((candle) => candle.l);
  const last = sorted.at(-1)!;
  const previous = sorted.at(-2) ?? last;
  const lastClose = last.c;
  const previousClose = previous.c;
  const lookback = Math.max(0, sorted.length - 6);
  const momentum = lastClose - sorted[lookback].c;

  const fastEma = ema(closes, 20);
  const slowEma = ema(closes, 50);
  const rsiValue = rsi(closes, 14);
  const atrValue = atr(highs, lows, closes, 14);
  const signal = deriveSignal(fastEma, slowEma, momentum, rsiValue);
  const targets = computeTargets(signal, lastClose, previousClose, atrValue);
  const reason = buildReason(signal, lang);

  const result: TradingSignalOk = {
    status: "OK",
    lang,
    symbol: input.symbol,
    timeframe: input.timeframe,
    signal,
    entry: targets.entry,
    sl: targets.sl,
    tp1: targets.tp1,
    tp2: targets.tp2,
    reason,
    lastISO: input.lastCandleISO,
    ageSeconds: input.ageSeconds,
    isDelayed: input.isStale,
    provider: input.provider,
  };

  if (signal === "NEUTRAL") {
    result.entry = null;
    result.sl = null;
    result.tp1 = null;
    result.tp2 = null;
  }

  const logEntry = Number.isFinite(result.entry ?? NaN) ? result.entry : "";
  const logSl = Number.isFinite(result.sl ?? NaN) ? result.sl : "";
  const logTp1 = Number.isFinite(result.tp1 ?? NaN) ? result.tp1 : "";
  const logTp2 = Number.isFinite(result.tp2 ?? NaN) ? result.tp2 : "";
  console.log(
    `[SIGNAL] symbol=${result.symbol} tf=${result.timeframe} signal=${result.signal} reason="${result.reason}" entry=${logEntry} sl=${logSl} tp1=${logTp1} tp2=${logTp2} delayed=${result.isDelayed}`,
  );

  return result;
}
