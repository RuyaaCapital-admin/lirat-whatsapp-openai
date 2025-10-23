// pages/api/tools/price.js
import axios from "axios";

const FCS_KEY = process.env.FCS_API_KEY || process.env.PRICE_API_KEY;
const FMP_KEY = process.env.FMP_API_KEY;

type QuoteResult = {
  price: number;
  hhmm: string;
};

type NormalizedSymbol = {
  pretty: string;
  forFcs: string;
  noslash: string;
};

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => ApiResponse;
};

const nowHHMM = (d: Date | string | number = new Date()): string =>
  new Date(d).toISOString().slice(11, 16);
const fmt = (n: number): string => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6));

function normalizeSymbol(raw: string | null | undefined): NormalizedSymbol {
  let s = (raw || "").trim().toUpperCase();
  // Arabic → canonical
  s = s
    .replace(/ذ?ه?ب|GOLD/gi, "XAUUSD")
    .replace(/فِ?ض[هة]?|SILVER/gi, "XAGUSD")
    .replace(/نَ?فط|خام|WTI/gi, "XTIUSD")
    .replace(/برنت/gi, "XBRUSD")
    .replace(/بيتكوين|BTC/gi, "BTCUSDT")
    .replace(/إ?ي?ثيريوم|ETH/gi, "ETHUSDT");

  // slash price pair (always show slashes in output)
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
    BTCUSDT: "BTC/USDT",
    ETHUSDT: "ETH/USDT",
  };

  // if already contains slash, keep it
  const pricePair = /[A-Z]{3,4}\/[A-Z]{3,4}/.test(s) ? s : slashMap[s] || s;

  return {
    // output
    pretty: pricePair,
    // provider needs slash for FCS (FX/metals)
    forFcs: pricePair,
    // provider needs noslash for FMP/Binance
    noslash: pricePair.replace("/", ""),
  };
}

async function fcsLatest(pairSlash: string): Promise<QuoteResult | null> {
  if (!FCS_KEY) return null;
  // FCS expects slash pairs for FX/metals e.g. XAU/USD
  const url = `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(
    pairSlash
  )}&access_key=${FCS_KEY}`;
  const r = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const row = (r.data?.response?.[0] || r.data?.data?.[0]) as
    | {
        c?: number | string;
        tm?: string;
        t?: number | string;
      }
    | undefined;
  if (!row) return null;
  const price = Number(row.c);
  if (!Number.isFinite(price)) return null;
  const timestamp =
    row.tm || (row.t != null ? new Date(Number(row.t) * 1000).toISOString() : new Date().toISOString());
  const hhmm = nowHHMM(timestamp);
  return { price, hhmm };
}

async function fmpQuote(noslash: string): Promise<QuoteResult | null> {
  if (!FMP_KEY) return null;
  // FMP supports /v3/quote/{symbol} for many assets, including crypto & some forex
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(
    noslash
  )}?apikey=${FMP_KEY}`;
  const r = await axios.get(url);
  const row = r.data?.[0] as
    | {
        price?: number | string;
        c?: number | string;
        previousClose?: number | string;
      }
    | undefined;
  if (!row) return null;
  const price = Number(row.price ?? row.c ?? row.previousClose);
  if (!Number.isFinite(price)) return null;
  const hhmm = nowHHMM();
  return { price, hhmm };
}

async function binanceLastClosed(noslash: string): Promise<QuoteResult | null> {
  // crypto fallback: Binance klines 1m, take previous candle close as "latest CLOSED"
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
    noslash
  )}&interval=1m&limit=2`;
  const r = await axios.get(url);
  const candles = r.data as Array<[number, number, number, number, number, ...number[]]> | undefined;
  const k = candles?.length ? candles[candles.length - 1] : undefined; // last candle (closed)
  if (!k) return null;
  const price = Number(k[4]);
  if (!Number.isFinite(price)) return null;
  const hhmm = nowHHMM(k[0] + 60000);
  return { price, hhmm };
}

async function yahooFallback(prettySlash: string): Promise<QuoteResult | null> {
  // metals sanity fallback when FCS looks off
  const map: Record<string, string[]> = {
    "XAU/USD": ["XAUUSD=X", "XAU=X", "GC=F"],
    "XAG/USD": ["XAGUSD=X", "SI=F"],
  };
  const list = map[prettySlash];
  if (!list) return null;
  for (const tkr of list) {
    try {
      const y = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${tkr}?range=1d&interval=1m`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const r0 = y.data?.chart?.result?.[0] as
        | {
            indicators?: { quote?: Array<{ close?: Array<number | null | undefined> }> };
            timestamp?: number[];
          }
        | undefined;
      const closes = r0?.indicators?.quote?.[0]?.close ?? [];
      const ts = r0?.timestamp ?? [];
      let i = closes.length - 1;
      while (i >= 0) {
        const close = closes[i];
        if (close != null && !Number.isNaN(Number(close))) {
          const tsValue = ts[i] ?? Date.now() / 1000;
          return { price: Number(close), hhmm: nowHHMM(tsValue * 1000) };
        }
        i--;
      }
    } catch {
      // ignore and try next ticker
    }
  }
  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const { symbol } = (req.body || {}) as { symbol?: string };
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });

    const norm = normalizeSymbol(symbol);
    let out: QuoteResult | null = null;

    // try FCS for FX/metals first (slash pair)
    if (/(XAU|XAG|XTI|XBR|EUR|GBP|USD|CHF|AUD|CAD)/.test(norm.noslash)) {
      out = await fcsLatest(norm.forFcs);
      // sanity guard for metals
      if (out && norm.pretty === "XAU/USD" && (out.price < 1000 || out.price > 3500)) out = null;
      if (out && norm.pretty === "XAG/USD" && (out.price < 10 || out.price > 60)) out = null;
      if (!out && (norm.pretty === "XAU/USD" || norm.pretty === "XAG/USD")) {
        out = await yahooFallback(norm.pretty);
      }
    }

    // FMP quote fallback (covers crypto and some fx)
    if (!out) out = await fmpQuote(norm.noslash);

    // Binance last-closed fallback (crypto)
    if (!out && /USDT$/.test(norm.noslash)) out = await binanceLastClosed(norm.noslash);

    if (!out || !Number.isFinite(out.price)) {
      return res.status(200).json({ ok: false, error: "Data unavailable" });
    }

    const text =
`Time (UTC): ${out.hhmm}
Symbol: ${norm.pretty}
Price: ${fmt(out.price)}
Note: latest CLOSED price`;

    return res.status(200).json({ ok: true, text });
  } catch (e) {
    const maybeAxiosError = e as { response?: { data?: unknown } } | null | undefined;
    const responseData = maybeAxiosError?.response?.data;
    console.error("[price]", responseData ?? e);
    return res.status(200).json({ ok: false, error: "price_error" });
  }
}
