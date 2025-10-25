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

export type OhlcSource = "FMP" | "FCS" | "PROVIDED";

export interface ProviderCandles {
  candles: Candle[];
  source: OhlcSource;
  rawSymbol: string;
}

export interface OhlcResult {
  symbol: string;
  timeframe: TF;
  candles: Candle[];
  lastCandleUnix: number;
  lastCandleISO: string;
  ageSeconds: number;
  isStale: boolean;
  tooOld: boolean;
  provider: OhlcSource;
  rawSymbol: string;
}

export class OhlcError extends Error {
  constructor(
    public readonly code:
      | "NO_DATA_FOR_INTERVAL"
      | "NO_CLOSED_BAR"
      | "HTTP_ERROR"
      | "INVALID_CANDLES"
      | "STALE_DATA",
    public readonly timeframe: TF,
    public readonly source?: OhlcSource,
  ) {
    super(code);
  }
}

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

async function fetchFromFmp(symbol: string, timeframe: TF, limit: number): Promise<ProviderCandles | null> {
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
    const sorted = ensureSorted(mapped);
    const trimmed = sorted.slice(-limit);
    if (!trimmed.length) {
      return null;
    }
    return { candles: trimmed, source: "FMP", rawSymbol: mappedSymbol };
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
      throw new OhlcError("HTTP_ERROR", timeframe, "FMP");
    }
    throw error;
  }
}

async function fetchFromFcs(symbol: string, timeframe: TF, limit: number): Promise<ProviderCandles | null> {
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
    const sorted = ensureSorted(mapped);
    const trimmed = sorted.slice(-limit);
    if (!trimmed.length) {
      return null;
    }
    return { candles: trimmed, source: "FCS", rawSymbol: pair };
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
      throw new OhlcError("HTTP_ERROR", timeframe, "FCS");
    }
    throw error;
  }
}

type ProviderResult = {
  fetcher: (symbol: string, timeframe: TF, limit: number) => Promise<ProviderCandles | null>;
};

function getProviderOrder(symbol: string): ProviderResult[] {
  if (isCrypto(symbol)) {
    return [{ fetcher: fetchFromFmp }];
  }
  return [{ fetcher: fetchFromFcs }, { fetcher: fetchFromFmp }];
}

export interface GetOhlcOptions {
  limit?: number;
}

function selectCandidate(candidates: OhlcResult[]): OhlcResult | null {
  if (!candidates.length) {
    return null;
  }
  const hasUsable = candidates.filter((candidate) => !candidate.tooOld);
  const pool = hasUsable.length ? hasUsable : candidates;
  const byProvider = (source: OhlcSource, min = 0) =>
    pool.find((candidate) => candidate.provider === source && candidate.candles.length >= min) ?? null;

  return (
    byProvider("FMP", 30) ||
    byProvider("FCS", 30) ||
    pool.find((candidate) => candidate.candles.length >= 30) ||
    pool[0]
  );
}

function buildResult(
  symbol: string,
  timeframe: TF,
  sourceResult: ProviderCandles,
  limit: number,
): OhlcResult | null {
  const sorted = ensureSorted(sourceResult.candles).slice(-limit);
  if (!sorted.length) {
    return null;
  }
  const last = sorted.at(-1)!;
  const lastSec = Math.floor(last.t);
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, nowSec - lastSec);
  const intervalSec = TF_SECONDS[timeframe] ?? 300;
  const staleThreshold = Math.max(5 * 60, intervalSec * 2);
  const isStale = ageSeconds > staleThreshold;
  const tooOld = ageSeconds > 24 * 60 * 60;
  const lastIso = new Date(lastSec * 1000).toISOString();

  console.log(
    `[OHLC] provider=${sourceResult.source} symbol=${symbol} rawSymbol=${sourceResult.rawSymbol} tf=${timeframe} bars=${sorted.length} lastTs=${lastSec} lastIso=${lastIso} age=${ageSeconds}s stale=${isStale} tooOld=${tooOld}`,
  );

  return {
    symbol,
    timeframe,
    candles: sorted,
    lastCandleUnix: lastSec,
    lastCandleISO: lastIso,
    ageSeconds,
    isStale,
    tooOld,
    provider: sourceResult.source,
    rawSymbol: sourceResult.rawSymbol,
  };
}

export async function get_ohlc(symbol: string, timeframe: TF, limit = 60): Promise<OhlcResult> {
  const safeLimit = Math.max(10, Math.min(limit, 60));
  const providers = getProviderOrder(symbol);
  const candidates: OhlcResult[] = [];

  for (const { fetcher } of providers) {
    try {
      const raw = await fetcher(symbol, timeframe, safeLimit);
      if (!raw) {
        continue;
      }
      const candidate = buildResult(symbol, timeframe, raw, safeLimit);
      if (candidate) {
        candidates.push(candidate);
        if (candidate.provider === "FMP" && candidate.candles.length >= 30 && !candidate.tooOld) {
          break;
        }
      }
    } catch (error) {
      if (error instanceof OhlcError) {
        if (error.code === "HTTP_ERROR") {
          continue;
        }
      }
      throw error;
    }
  }

  const chosen = selectCandidate(candidates);
  if (!chosen || chosen.tooOld) {
    const err: any = new Error("NO_DATA");
    err.code = "NO_DATA";
    throw err;
  }
  return {
    ...chosen,
    candles: chosen.candles.slice(-safeLimit),
  };
}
