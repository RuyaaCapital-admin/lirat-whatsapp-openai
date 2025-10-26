import axios, { AxiosError } from "axios";
import {
  TF,
  TF_SECONDS,
  isCrypto,
  mapToFcsSymbol,
  mapToFmpSymbol,
  toProviderInterval,
} from "./normalize";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

export type OhlcSource = "FMP" | "FCS";

type HttpClient = Pick<typeof axios, "get">;

let httpClient: HttpClient = axios;

export function __setOhlcHttpClient(client?: HttpClient | null) {
  httpClient = client ?? axios;
}

function toSeconds(value: number): number {
  return value >= 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function mapFmpRow(row: any): Candle | null {
  const rawDate = row?.date ?? row?.datetime ?? row?.time;
  const timeMs = Date.parse(String(rawDate ?? ""));
  if (Number.isNaN(timeMs)) return null;
  return {
    t: toSeconds(timeMs),
    o: Number(row.open),
    h: Number(row.high),
    l: Number(row.low),
    c: Number(row.close),
    v: Number(row.volume ?? 0),
  };
}

function mapFcsRow(row: any): Candle | null {
  const rawNumeric = Number(row?.t ?? row?.tm ?? row?.timestamp ?? NaN);
  const numericSeconds = Number.isFinite(rawNumeric) ? toSeconds(rawNumeric) : null;
  const rawDate = row?.date ?? row?.time ?? row?.datetime ?? null;
  const parsedMs = rawDate != null ? Date.parse(String(rawDate)) : NaN;
  const parsedSeconds = Number.isFinite(parsedMs) ? toSeconds(parsedMs) : null;
  const timestamp = numericSeconds ?? parsedSeconds ?? NaN;
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
    .map((candle) => ({
      o: Number(candle.o),
      h: Number(candle.h),
      l: Number(candle.l),
      c: Number(candle.c),
      t: toSeconds(Number(candle.t)),
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

async function fetchFromFmp(symbol: string, timeframe: TF, limit: number) {
  const mappedSymbol = mapToFmpSymbol(symbol);
  const interval = toProviderInterval("FMP", timeframe);
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${mappedSymbol}?apikey=${process.env.FMP_API_KEY}`;
  try {
    const { data } = await httpClient.get(url, { timeout: 9000 });
    const rows = Array.isArray(data) ? data : [];
    const mapped = rows.map(mapFmpRow).filter((row): row is Candle => Boolean(row));
    if (!mapped.length) {
      return null;
    }
    const sorted = ensureSorted(mapped).slice(-limit);
    if (!sorted.length) {
      return null;
    }
    return { provider: "FMP" as const, rawSymbol: mappedSymbol, candles: sorted };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      console.warn("[OHLC] FMP HTTP error", {
        symbol,
        timeframe,
        status: error.response?.status,
        message: error.message,
      });
      return { provider: "FMP" as const, rawSymbol: mappedSymbol, candles: [] };
    }
    throw error;
  }
}

async function fetchFromFcs(symbol: string, timeframe: TF, limit: number) {
  const pair = mapToFcsSymbol(symbol);
  const period = toProviderInterval("FCS", timeframe);
  const nowSec = Math.floor(Date.now() / 1000);
  const intervalSec = TF_SECONDS[timeframe] ?? 300;
  const lookback = intervalSec * Math.max(limit + 20, 240);
  const from = nowSec - lookback;
  const baseUrl = symbol.toUpperCase().endsWith("USDT")
    ? "https://fcsapi.com/api-v3/crypto/candle"
    : "https://fcsapi.com/api-v3/forex/candle";
  const url = `${baseUrl}?symbol=${encodeURIComponent(pair)}&period=${period}&from=${from}&to=${nowSec}&access_key=${process.env.FCS_API_KEY}`;
  try {
    const { data } = await httpClient.get(url, { timeout: 9000 });
    const rows: any[] = Array.isArray(data?.response)
      ? data.response
      : Array.isArray(data?.candles)
        ? data.candles
        : [];
    const mapped = rows.map(mapFcsRow).filter((row): row is Candle => Boolean(row));
    if (!mapped.length) {
      return null;
    }
    const sorted = ensureSorted(mapped).slice(-limit);
    if (!sorted.length) {
      return null;
    }
    return { provider: "FCS" as const, rawSymbol: pair, candles: sorted };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      console.warn("[OHLC] FCS HTTP error", {
        symbol,
        timeframe,
        status: error.response?.status,
        message: error.message,
      });
      return { provider: "FCS" as const, rawSymbol: pair, candles: [] };
    }
    throw error;
  }
}

type ProviderFetcher = (
  symbol: string,
  timeframe: TF,
  limit: number,
) => Promise<{ provider: OhlcSource; rawSymbol: string; candles: Candle[] } | null>;

function getProviderOrder(symbol: string): ProviderFetcher[] {
  const order: ProviderFetcher[] = [];
  const add = (fn: ProviderFetcher) => {
    if (!order.includes(fn)) {
      order.push(fn);
    }
  };
  if (isCrypto(symbol)) {
    add(fetchFromFmp);
    add(fetchFromFcs);
  } else {
    add(fetchFromFcs);
    add(fetchFromFmp);
  }
  return order;
}

export interface GetOhlcOptions {
  limit?: number;
  nowMs?: number;
}

// Allow slightly older data for crypto to avoid too many stale neutrals
const STALE_LIMIT_MINUTES: Partial<Record<TF, number>> = {
  "1min": 12,
  "5min": 20,
  "1hour": 120,
  "4hour": 480,
  "1day": 1440,
};

function resolveNowMs(candidate?: number): number {
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  return Date.now();
}

function computeAge(nowMs: number, lastMs: number): { ageMinutes: number; lastISO: string } {
  const diffMs = Math.max(0, nowMs - lastMs);
  const ageMinutes = Math.floor(diffMs / 60000);
  const lastISO = new Date(lastMs).toISOString();
  return { ageMinutes, lastISO };
}

function isStale(timeframe: TF, ageMinutes: number): boolean {
  const limit = STALE_LIMIT_MINUTES[timeframe] ?? 60;
  return ageMinutes > limit;
}

export interface ProviderSnapshot {
  provider: OhlcSource;
  candles: Candle[];
  lastTs: number;
  lastISO: string;
  ageMinutes: number;
  stale: boolean;
  rawSymbol: string;
}

export type GetOhlcSuccess = {
  ok: true;
  symbol: string;
  timeframe: TF;
  candles: Candle[];
  lastISO: string;
  ageMinutes: number;
  stale: boolean;
  provider: OhlcSource;
  rawSymbol: string;
};

export type GetOhlcFailure = { ok: false; reason: "NO_DATA" };

export type GetOhlcResponse = GetOhlcSuccess | GetOhlcFailure;

function buildSnapshot(
  symbol: string,
  timeframe: TF,
  source: { provider: OhlcSource; rawSymbol: string; candles: Candle[] },
  limit: number,
  nowMs: number,
): ProviderSnapshot | null {
  const candles = ensureSorted(source.candles).slice(-limit);
  if (!candles.length) {
    return null;
  }
  const last = candles[candles.length - 1];
  const lastMs = Math.floor(last.t) * 1000;
  const { ageMinutes, lastISO } = computeAge(nowMs, lastMs);
  const stale = isStale(timeframe, ageMinutes);
  console.log(
    `[OHLC] provider=${source.provider} symbol=${symbol} tf=${timeframe} lastIso=${lastISO} ageMin=${ageMinutes} stale=${stale}`,
  );
  return {
    provider: source.provider,
    candles,
    lastTs: Math.floor(last.t),
    lastISO,
    ageMinutes,
    stale,
    rawSymbol: source.rawSymbol,
  };
}

function pickFreshest(snapshots: ProviderSnapshot[]): ProviderSnapshot | null {
  if (!snapshots.length) {
    return null;
  }
  return [...snapshots].sort((a, b) => a.ageMinutes - b.ageMinutes)[0] ?? null;
}

export async function get_ohlc(
  symbol: string,
  timeframe: TF,
  limit = 60,
  opts: GetOhlcOptions = {},
): Promise<GetOhlcResponse> {
  const safeLimit = Math.max(20, Math.min(limit, 120));
  const nowMs = resolveNowMs(opts.nowMs);
  const order = getProviderOrder(symbol);
  const snapshots: ProviderSnapshot[] = [];

  for (const fetcher of order) {
    try {
      const result = await fetcher(symbol, timeframe, safeLimit);
      if (!result) continue;
      const snapshot = buildSnapshot(symbol, timeframe, result, safeLimit, nowMs);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    } catch (error) {
      if (error instanceof AxiosError) {
        continue;
      }
      console.warn("[OHLC] provider fetch error", error);
    }
  }

  const chosen = pickFreshest(snapshots);
  if (!chosen) {
    return { ok: false, reason: "NO_DATA" };
  }

  return {
    ok: true,
    symbol,
    timeframe,
    candles: chosen.candles,
    lastISO: chosen.lastISO,
    ageMinutes: chosen.ageMinutes,
    stale: chosen.stale,
    provider: chosen.provider,
    rawSymbol: chosen.rawSymbol,
  };
}
