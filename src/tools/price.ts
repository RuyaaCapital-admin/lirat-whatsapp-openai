// src/tools/price.ts
import axios from "axios";
import { forPriceSource, isCrypto } from "./normalize";

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
  const path = isCrypto(symbol) ? "crypto/latest" : "forex/latest";
  const url = `${FCS_BASE}/${path}?symbol=${encodeURIComponent(s)}&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Latest URL:', url);
  const { data } = await axios.get(url, { timeout: 7000 });

  const rows = Array.isArray(data?.response) ? data.response : Array.isArray(data?.data) ? data.data : [];
  if (!rows.length) {
    throw new Error(`FCS latest: empty response for ${s}`);
  }
  const r = rows[0];
  const price = Number(r.c ?? r.price ?? r.cp ?? r.close);
  const tm = r.tm || r.t || r.updated_at || r.date || null;
  if (!Number.isFinite(price)) throw new Error(`FCS latest: invalid price for ${s}`);
  return { price, time: tm, symbol: s };
}

async function fcsLastClose(symbol: string) {
  const s = forPriceSource(symbol);
  const path = isCrypto(symbol) ? "crypto/candle" : "forex/candle";
  const url = `${FCS_BASE}/${path}?symbol=${encodeURIComponent(s)}&period=1&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Candle URL:', url);
  const { data } = await axios.get(url, { timeout: 9000 });

  const resp = data?.response || data?.candles;
  const closes: number[] = resp?.c || resp?.close;
  const times: (string|number)[] = resp?.t || resp?.tm || resp?.timestamp;
  if (!Array.isArray(closes) || closes.length === 0) {
    throw new Error(`FCS candle: no data for ${s}`);
  }
  const last = closes[closes.length - 1];
  const lastT = Array.isArray(times) ? times[times.length - 1] ?? null : null;
  return { price: Number(last), time: lastT, symbol: s, period: '1m' };
}

// FCS 1-min only for quick price
export async function getCurrentPrice(symbol: string) {
  try {
    const { price, time, symbol: s } = await fcsLatest(symbol);
    return { price, time, symbol: s, source: 'FCS latest' };
  } catch (e) {
    const err = e as any;
    console.log('[FCS] Latest failed, trying candle fallback:', err?.message);
    const { price, time, symbol: s, period } = await fcsLastClose(symbol);
    return { price, time, symbol: s, source: `FCS ${period} candle` };
  }
}
