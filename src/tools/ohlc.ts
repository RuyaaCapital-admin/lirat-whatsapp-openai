// src/tools/ohlc.ts
import axios from "axios";
import { TF } from "./normalize";

export type Candle = { t:number; o:number; h:number; l:number; c:number; v?:number };

const TFMS: Record<string, number> = {
  "1min": 6e4, "5min": 3e5, "15min": 9e5, "30min": 18e5, "1hour": 36e5, "4hour": 144e5, "daily": 864e5
};

function fmpInterval(tf: TF) {
  switch (tf) {
    case "1min": return "1min";
    case "5min": return "5min";
    case "15min": return "15min";
    case "30min": return "30min";
    case "1hour": return "1hour";
    case "4hour": return "4hour";
    case "daily": return "1day";
  }
}

async function getOhlcFmp(symbol: string, tf: TF, limit=300): Promise<Candle[]> {
  const interval = fmpInterval(tf)!;
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${symbol}?apikey=${process.env.FMP_API_KEY}`;
  const { data } = await axios.get(url, { timeout: 9000 });
  if (!Array.isArray(data) || !data.length) throw new Error("FMP_EMPTY");
  // newest first → oldest..newest
  return data.reverse().slice(-limit).map((x:any)=>({
    t: new Date(x.date).getTime(),
    o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +x.volume || 0,
  }));
}

async function getOhlcFcs(symbol: string, tf: TF, limit=300): Promise<Candle[]> {
  const isCrypto = /USDT$/i.test(symbol);
  const pair = isCrypto ? symbol.replace(/USDT$/i, "/USDT") : symbol.replace("USD", "/USD");
  const url = isCrypto
    ? `https://fcsapi.com/api-v3/crypto/candle?symbol=${pair}&period=${tf}&access_key=${process.env.FCS_API_KEY}`
    : `https://fcsapi.com/api-v3/forex/candle?symbol=${pair}&period=${tf}&access_key=${process.env.FCS_API_KEY}`;
  const { data } = await axios.get(url, { timeout: 9000 });
  const rows = data?.response || data?.candles || [];
  if (!Array.isArray(rows) || !rows.length) throw new Error("FCS_EMPTY");
  return rows.slice(-limit).map((o:any)=>({
    t: Number(o.t || o.tm || o.timestamp) * 1000,
    o: +(+o.o ?? +o.open),
    h: +(+o.h ?? +o.high),
    l: +(+o.l ?? +o.low),
    c: +(+o.c ?? +o.close),
    v: +(o.v ?? o.volume ?? 0),
  })).sort((a,b)=>a.t-b.t);
}

export async function get_ohlc(symbol: string, timeframe: TF, limit=300): Promise<{rows:Candle[]; lastClosed:Candle}> {
  // 1) fetch (FMP → fallback to FCS)
  let rows: Candle[];
  try { rows = await getOhlcFmp(symbol, timeframe, limit); }
  catch { rows = await getOhlcFcs(symbol, timeframe, limit); }
  if (!rows?.length) throw new Error("NO_OHLC");

  // 2) choose last CLOSED bar + freshness guard
  rows.sort((a,b)=>a.t-b.t);
  const tfms = TFMS[timeframe] ?? 36e5;
  const last = rows[rows.length-1]!;
  const closed = (Date.now() - last.t) < tfms * 0.5 ? rows[rows.length-2] : last;
  if (!closed) throw new Error("NO_CLOSED_BAR");
  if (Date.now() - closed.t > tfms * 6) throw new Error("STALE_DATA");

  return { rows, lastClosed: closed };
}

// 🔥 Delete the legacy indicator fetcher; compute indicators locally in your signal code.
// export async function getFmpTechnicalIndicators(...) { /* remove – legacy returns empty */ }
