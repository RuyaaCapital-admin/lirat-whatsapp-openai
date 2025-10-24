import axios, { AxiosError } from "axios";
import { TF } from "./normalize";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

export type OhlcSource = "FMP" | "FCS" | "PROVIDED";

export interface OhlcResult {
  candles: Candle[];
  lastClosed: Candle;
  timeframe: TF;
  source: OhlcSource;
}

export class OhlcError extends Error {
  constructor(
    public readonly code:
      | "NO_DATA_FOR_INTERVAL"
      | "NO_CLOSED_BAR"
      | "STALE_DATA"
      | "HTTP_ERROR"
      | "INVALID_CANDLES",
    public readonly timeframe: TF,
    public readonly source?: OhlcSource,
  ) {
    super(code);
  }
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

const FMP_INTERVAL: Record<TF, string> = {
  "1min": "1min",
  "5min": "5min",
  "15min": "15min",
  "30min": "30min",
  "1hour": "1hour",
  "4hour": "4hour",
  "1day": "1day",
};

function isFiniteCandle(value: Candle | null | undefined): value is Candle {
  if (!value) return false;
  return [value.o, value.h, value.l, value.c].every((x) => Number.isFinite(x));
}

function mapFmpRow(row: any): Candle | null {
  const time = Date.parse(String(row?.date ?? ""));
  if (Number.isNaN(time)) return null;
  return {
    t: time,
    o: Number(row.open),
    h: Number(row.high),
    l: Number(row.low),
    c: Number(row.close),
    v: Number(row.volume ?? 0),
  };
}

function mapFcsRow(row: any): Candle | null {
  const base = Number(row?.t ?? row?.tm ?? row?.timestamp);
  const timestamp = Number.isFinite(base) ? base * 1000 : Number(row?.date ?? row?.time ?? 0);
  if (!Number.isFinite(timestamp)) return null;
  return {
    t: timestamp,
    o: Number(row.o ?? row.open),
    h: Number(row.h ?? row.high),
    l: Number(row.l ?? row.low),
    c: Number(row.c ?? row.close),
    v: Number(row.v ?? row.volume ?? 0),
  };
}

function ensureSorted(candles: Candle[]): Candle[] {
  return candles
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((candle) => ({
      ...candle,
      t: Number(candle.t),
    }));
}

function deriveLastClosed(candles: Candle[], timeframe: TF): Candle {
  const sorted = ensureSorted(candles);
  const tfMs = TF_TO_MS[timeframe] ?? 60 * 60_000;
  const now = Date.now();
  const last = sorted.at(-1) ?? null;
  const prev = sorted.at(-2) ?? null;
  if (!last || !isFiniteCandle(last)) {
    throw new OhlcError("INVALID_CANDLES", timeframe);
  }
  const candidate = now - last.t < tfMs * 0.5 ? prev : last;
  if (!candidate || !isFiniteCandle(candidate)) {
    throw new OhlcError("NO_CLOSED_BAR", timeframe);
  }
  if (now - candidate.t > tfMs * 6) {
    throw new OhlcError("STALE_DATA", timeframe);
  }
  return candidate;
}

async function fetchFromFmp(symbol: string, timeframe: TF, limit: number): Promise<OhlcResult> {
  const interval = FMP_INTERVAL[timeframe];
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${symbol}?apikey=${process.env.FMP_API_KEY}`;
  try {
    const { data } = await axios.get(url, { timeout: 9000 });
    const candles = (Array.isArray(data) ? data : [])
      .map(mapFmpRow)
      .filter(isFiniteCandle)
      .slice(-limit);
    if (!candles.length) {
      throw new OhlcError("NO_DATA_FOR_INTERVAL", timeframe, "FMP");
    }
    const sorted = ensureSorted(candles);
    const lastClosed = deriveLastClosed(sorted, timeframe);
    return { candles: sorted, lastClosed, timeframe, source: "FMP" };
  } catch (error) {
    if (error instanceof OhlcError) {
      throw error;
    }
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        throw new OhlcError("NO_DATA_FOR_INTERVAL", timeframe, "FMP");
      }
      throw new OhlcError("HTTP_ERROR", timeframe, "FMP");
    }
    throw error;
  }
}

async function fetchFromFcs(symbol: string, timeframe: TF, limit: number): Promise<OhlcResult> {
  const isCrypto = /USDT$/i.test(symbol);
  const pair = isCrypto ? symbol.replace(/USDT$/i, "/USDT") : symbol.replace("USD", "/USD");
  const url = isCrypto
    ? `https://fcsapi.com/api-v3/crypto/candle?symbol=${pair}&period=${timeframe}&access_key=${process.env.FCS_API_KEY}`
    : `https://fcsapi.com/api-v3/forex/candle?symbol=${pair}&period=${timeframe}&access_key=${process.env.FCS_API_KEY}`;
  try {
    const { data } = await axios.get(url, { timeout: 9000 });
    const rows = (data?.response ?? data?.candles ?? []) as any[];
    const candles = rows
      .slice(-limit)
      .map(mapFcsRow)
      .filter(isFiniteCandle);
    if (!candles.length) {
      throw new OhlcError("NO_DATA_FOR_INTERVAL", timeframe, "FCS");
    }
    const sorted = ensureSorted(candles);
    const lastClosed = deriveLastClosed(sorted, timeframe);
    return { candles: sorted, lastClosed, timeframe, source: "FCS" };
  } catch (error) {
    if (error instanceof OhlcError) {
      throw error;
    }
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        throw new OhlcError("NO_DATA_FOR_INTERVAL", timeframe, "FCS");
      }
      throw new OhlcError("HTTP_ERROR", timeframe, "FCS");
    }
    throw error;
  }
}

export async function get_ohlc(symbol: string, timeframe: TF, limit = 300): Promise<OhlcResult> {
  const safeLimit = Math.max(50, Math.min(limit, 400));
  try {
    return await fetchFromFmp(symbol, timeframe, safeLimit);
  } catch (error) {
    if (error instanceof OhlcError) {
      if (!["HTTP_ERROR", "NO_DATA_FOR_INTERVAL"].includes(error.code)) {
        throw error;
      }
    } else {
      throw error;
    }
  }
  try {
    return await fetchFromFcs(symbol, timeframe, safeLimit);
  } catch (error) {
    if (error instanceof OhlcError && error.code === "HTTP_ERROR") {
      throw new OhlcError("HTTP_ERROR", timeframe, "FCS");
    }
    throw error;
  }
}
