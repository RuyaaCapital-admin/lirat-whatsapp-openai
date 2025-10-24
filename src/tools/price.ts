// src/tools/price.ts
import axios from "axios";
import { forPriceSource } from "./normalize";

const FCS_BASE = "https://fcsapi.com/api-v3";

// Price response type for compatibility
export type PriceResponse = {
  symbol: string;
  timestamp: number;
  price: number;
  note: string;
  utcTime: string;
};

async function fcsLatest(symbol: string) {
  const s = forPriceSource(symbol);
  const url = `${FCS_BASE}/forex/latest?symbol=${encodeURIComponent(s)}&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Latest URL:', url);
  const { data } = await axios.get(url, { timeout: 7000 });

  // FCS success shape: { code:200, response:[{ s:"XAU/USD", c:"...", tm:"..." }], ... }
  if (!data || !Array.isArray(data.response) || !data.response[0]) {
    throw new Error(`FCS latest: empty response for ${s}`);
  }
  const r = data.response[0];
  const price = Number(r.c ?? r.price ?? r.cp ?? r.close);
  const tm = r.tm || r.t || r.updated_at || null;
  if (!Number.isFinite(price)) throw new Error(`FCS latest: invalid price for ${s}`);
  return { price, time: tm, symbol: s };
}

async function fcsLastClose(symbol: string) {
  const s = forPriceSource(symbol);
  const url = `${FCS_BASE}/forex/candle?symbol=${encodeURIComponent(s)}&period=1&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Candle URL:', url);
  const { data } = await axios.get(url, { timeout: 9000 });

  // FCS candle shape: { code:200, response:{ o:[], h:[], l:[], c:[], t:[] } }
  const resp = data?.response;
  const closes: number[] = resp?.c;
  const times: (string|number)[] = resp?.t;
  if (!Array.isArray(closes) || closes.length === 0) {
    throw new Error(`FCS candle: no data for ${s}`);
  }
  const last = closes[closes.length - 1];
  const lastT = times?.[times.length - 1] ?? null;
  return { price: Number(last), time: lastT, symbol: s, period: '1m' };
}

// FCS 1-min only for quick price
export async function getCurrentPrice(symbol: string) {
  try {
    // 1) fastest - latest price
    const { price, time, symbol: s } = await fcsLatest(symbol);
    return { price, time, symbol: s, source: 'FCS latest' };
  } catch (e) {
    const err = e as any; // TS fix for "unknown"
    console.log('[FCS] Latest failed, trying candle fallback:', err?.message);
    // fallback: candle last close (works reliably on free plans)
    const { price, time, symbol: s, period } = await fcsLastClose(symbol);
    return { price, time, symbol: s, source: `FCS ${period} candle` };
  }
}