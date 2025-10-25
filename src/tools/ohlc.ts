import axios, { AxiosError } from "axios";
import { TF, isCrypto } from "./normalize";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v?: number };

export type OhlcSource = "FMP" | "FCS" | "PROVIDED";

export interface ProviderCandles {
  candles: Candle[];
  source: OhlcSource;
}

export class OhlcError extends Error {
  constructor(
    public readonly code:
      | "NO_DATA_FOR_INTERVAL"
      | "NO_CLOSED_BAR"
      | "HTTP_ERROR"
      | "INVALID_CANDLES",
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

async function fetchFromFmp(symbol: string, timeframe: TF, limit: number): Promise<ProviderCandles | null> {
  const interval = FMP_INTERVAL[timeframe];
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${symbol}?apikey=${process.env.FMP_API_KEY}`;
  try {
    const { data } = await httpClient.get(url, { timeout: 9000 });
    const mapped = (Array.isArray(data) ? data : []).map(mapFmpRow).filter(isFiniteCandle);
    if (!mapped.length) {
      return null;
    }
    const sorted = ensureSorted(mapped);
    const trimmed = sorted.slice(-limit);
    if (!trimmed.length) {
      return null;
    }
    return { candles: trimmed, source: "FMP" };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      console.warn("[OHLC] FMP HTTP error", { symbol, timeframe, status: error.response?.status });
      return null;
    }
    throw error;
  }
}

async function fetchFromFcs(symbol: string, timeframe: TF, limit: number): Promise<ProviderCandles | null> {
  const isCrypto = /USDT$/i.test(symbol);
  const pair = isCrypto ? symbol.replace(/USDT$/i, "/USDT") : symbol.replace("USD", "/USD");
  const url = isCrypto
    ? `https://fcsapi.com/api-v3/crypto/candle?symbol=${pair}&period=${timeframe}&access_key=${process.env.FCS_API_KEY}`
    : `https://fcsapi.com/api-v3/forex/candle?symbol=${pair}&period=${timeframe}&access_key=${process.env.FCS_API_KEY}`;
  try {
    const { data } = await httpClient.get(url, { timeout: 9000 });
    const rows = (data?.response ?? data?.candles ?? []) as any[];
    const mapped = rows.map(mapFcsRow).filter(isFiniteCandle);
    if (!mapped.length) {
      return null;
    }
    const sorted = ensureSorted(mapped);
    const trimmed = sorted.slice(-limit);
    if (!trimmed.length) {
      return null;
    }
    return { candles: trimmed, source: "FCS" };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        return null;
      }
      console.warn("[OHLC] FCS HTTP error", { symbol, timeframe, status: error.response?.status });
      return null;
    }
    throw error;
  }
}

type ProviderResult = {
  fetcher: (symbol: string, timeframe: TF, limit: number) => Promise<ProviderCandles | null>;
  source: OhlcSource;
};

function getProviderOrder(symbol: string): ProviderResult[] {
  const cryptoFirst: ProviderResult[] = [
    { fetcher: fetchFromFmp, source: "FMP" },
    { fetcher: fetchFromFcs, source: "FCS" },
  ];
  const fxFirst: ProviderResult[] = [
    { fetcher: fetchFromFcs, source: "FCS" },
    { fetcher: fetchFromFmp, source: "FMP" },
  ];
  return isCrypto(symbol) ? cryptoFirst : fxFirst;
}

export async function get_ohlc(symbol: string, timeframe: TF, limit = 300): Promise<Candle[]> {
  const safeLimit = Math.max(50, Math.min(limit, 400));
  const order = getProviderOrder(symbol);

  for (const { fetcher } of order) {
    try {
      const result = await fetcher(symbol, timeframe, safeLimit);
      if (result && Array.isArray(result.candles) && result.candles.length > 0) {
        const sorted = ensureSorted(result.candles);
        return sorted;
      }
    } catch (error) {
      if (error instanceof OhlcError) {
        if (error.code === "HTTP_ERROR" || error.code === "NO_DATA_FOR_INTERVAL") {
          continue;
        }
      }
      throw error;
    }
  }

  return [];
}
