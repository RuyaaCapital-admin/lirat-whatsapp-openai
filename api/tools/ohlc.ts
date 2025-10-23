// pages/api/tools/ohlc.js
import axios from "axios";

const FCS_KEY = process.env.FCS_API_KEY || process.env.OHLC_API_KEY;
const FMP_KEY = process.env.FMP_API_KEY;

const fcsPeriod = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};
const fmpPeriod = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour",
  "4h": "4hour", // FMP supports this
  "1d": "1day",
};

type FcsRow = {
  t?: number | string;
  tm?: string;
  date?: string;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
};

type FmpRow = {
  date: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
};

type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

type IntervalKey = keyof typeof fcsPeriod;

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => ApiResponse;
};

function normalizeSymbol(raw: string | null | undefined): string {
  let s = (raw || "").trim().toUpperCase();
  s = s
    .replace(/ذ?ه?ب|GOLD/gi, "XAUUSD")
    .replace(/فِ?ض[هة]?|SILVER/gi, "XAGUSD")
    .replace(/نَ?فط|خام|WTI/gi, "XTIUSD")
    .replace(/برنت/gi, "XBRUSD")
    .replace(/بيتكوين|BTC/gi, "BTCUSDT")
    .replace(/إ?ي?ثيريوم|ETH/gi, "ETHUSDT");
  // remove slashes for ohlc
  return s.replace("/", "");
}

function asCandles(rows: Array<FcsRow | FmpRow>, isFcs = false): Candle[] {
  // Normalise to {t,o,h,l,c}
  return rows
    .map((x) => {
      if (isFcs) {
        const row = x as FcsRow;
        const timestamp = Number(row.t);
        const fallbackDate = row.tm ?? row.date ?? 0;
        const t = Number.isFinite(timestamp)
          ? Number(timestamp)
          : Math.floor(new Date(fallbackDate).getTime() / 1000);
        return { t, o: +row.o, h: +row.h, l: +row.l, c: +row.c };
      }
      // FMP historical-chart: { date, open, high, low, close }
      const row = x as FmpRow;
      const t = Math.floor(new Date(row.date).getTime() / 1000);
      return { t, o: +row.open, h: +row.high, l: +row.low, c: +row.close };
    })
    .filter((v) => Number.isFinite(v.c));
}

async function fcsHistory(pairSlash: string, period: string): Promise<Candle[] | null> {
  if (!FCS_KEY) return null;
  const url = `https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(
    pairSlash
  )}&period=${period}&access_key=${FCS_KEY}`;
  const r = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const rows = Object.values((r.data?.response || r.data?.data || {}) as Record<string, FcsRow>);
  const candles = asCandles(rows, true);
  return candles;
}

async function fmpHistory(noslash: string, period: string): Promise<Candle[] | null> {
  if (!FMP_KEY) return null;
  // Forex & crypto supported by FMP historical-chart
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${period}/${encodeURIComponent(
    noslash
  )}?apikey=${FMP_KEY}`;
  const r = await axios.get(url);
  const rows = (r.data || []) as FmpRow[];
  // FMP returns newest-first; we’ll reverse to oldest->newest
  const candles = asCandles(rows.reverse(), false);
  return candles;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const body = (req.body || {}) as Partial<{
      symbol: string;
      interval: IntervalKey;
      limit: number;
    }>;
    let { symbol, interval = "15m", limit = 300 } = body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });

    const noslash = normalizeSymbol(symbol);
    const intervalCandidate = typeof interval === "string" && interval in fcsPeriod ? interval : "15m";
    const intervalKey = intervalCandidate as IntervalKey;
    const slashMap: Record<string, string> = {
      XAUUSD: "XAU/USD",
      XAGUSD: "XAG/USD",
      XTIUSD: "XTI/USD",
      XBRUSD: "XBR/USD",
      EURUSD: "EUR/USD",
      GBPUSD: "GBP/USD",
      USDJPY: "USD/JPY",
      USDCHF: "USD/CHF",
      AUDUSD: "AUD/USD",
      USDCAD: "USD/CAD",
    };
    const withSlash = slashMap[noslash] || noslash; // FCS wants slash for FX/metals

    // 1) Try FCS for FX/metals
    let candles: Candle[] | null = null;
    if (slashMap[noslash]) {
      const p = fcsPeriod[intervalKey] || "15min";
      candles = await fcsHistory(withSlash, p);
    }

    // 2) FMP fallback (works for forex & crypto)
    if (!candles || candles.length === 0) {
      const p = fmpPeriod[intervalKey as keyof typeof fmpPeriod] || "15min";
      candles = await fmpHistory(noslash, p);
    }

    // 3) Final shape + limit + last CLOSED
    if (!candles || candles.length === 0) {
      return res.status(200).json({ ok: false, error: "No data found" });
    }
    const numericLimit = Number(limit);
    const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? Math.floor(numericLimit) : 300;
    candles = candles.filter(Boolean).slice(-safeLimit);

    return res.status(200).json({
      ok: true,
      symbol: noslash,
      period: intervalKey,
      candles, // [{t,o,h,l,c}...], oldest → newest, last one is CLOSED
    });
  } catch (e) {
    const maybeAxiosError = e as { response?: { data?: unknown } } | null | undefined;
    const responseData = maybeAxiosError?.response?.data;
    console.error("[ohlc]", responseData ?? e);
    return res.status(200).json({ ok: false, error: "ohlc_error" });
  }
}
