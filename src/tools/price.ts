// src/tools/price.ts
import axios from "axios";
import { forPriceSource, isCrypto, mapToFcsSymbol } from "./normalize";

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
  // Use FCS pair mapping (ABC/DEF) for both forex and crypto for consistency
  const s = mapToFcsSymbol(symbol);
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
  const s = mapToFcsSymbol(symbol);
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

// Yahoo Finance symbol mapping
function mapToYahooSymbol(sym: string): string {
  const upper = sym.toUpperCase();
  // Crypto pairs
  if (upper.endsWith("USDT")) {
    const base = upper.replace(/USDT$/, "");
    return `${base}-USD`;
  }
  if (upper.endsWith("USD")) {
    const base = upper.replace(/USD$/, "");
    // Metals and crypto as {BASE}-USD, FX as {PAIR}=X
    const metals = new Set(["XAU", "XAG", "XPT", "XPD"]);
    if (metals.has(base)) return `${upper}=X`;
    // If it's a known crypto like BTCUSD/ETHUSD
    const cryptos = new Set(["BTC", "ETH", "XRP", "LTC", "ADA", "SOL", "DOGE", "BNB"]);
    if (cryptos.has(base)) return `${base}-USD`;
    return `${upper}=X`;
  }
  // Default to {SYMBOL}=X for other FX-style pairs
  if (/^[A-Z]{6}$/.test(upper)) return `${upper}=X`;
  return upper;
}

async function yahooLatest(symbol: string) {
  const ySymbol = mapToYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1m&range=1d`;
  console.log('[YF] Chart URL:', url);
  const { data } = await axios.get(url, { timeout: 7000 });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo: empty result');
  const meta = result.meta || {};
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes: number[] = Array.isArray(result.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close
    : [];
  let price = Number(meta.regularMarketPrice);
  let time = meta.regularMarketTime;
  if (!Number.isFinite(price) && closes.length) {
    // fallback to last non-null close
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(closes[i])) {
        price = Number(closes[i]);
        time = Array.isArray(timestamps) ? timestamps[i] : undefined;
        break;
      }
    }
  }
  if (!Number.isFinite(price)) throw new Error('Yahoo: invalid price');
  return { price, time, symbol: ySymbol };
}

async function binanceLatest(symbol: string) {
  const upper = symbol.toUpperCase();
  const s = upper.endsWith('USDT') ? upper : `${upper.replace(/USD$/, '')}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(s)}`;
  console.log('[BINANCE] URL:', url);
  const { data } = await axios.get(url, { timeout: 6000 });
  const price = Number(data?.price);
  if (!Number.isFinite(price)) throw new Error('Binance: invalid price');
  // Binance doesn't return a timestamp here; use now
  const time = Math.floor(Date.now() / 1000);
  return { price, time, symbol: s };
}

// FCS first with robust fallbacks for realtime price
export async function getCurrentPrice(symbol: string) {
  // 1) Primary: FCS latest
  try {
    const { price, time, symbol: s } = await fcsLatest(symbol);
    return { price, time, symbol: s, source: 'FCS latest' };
  } catch (e) {
    console.log('[FCS] Latest failed:', (e as any)?.message);
  }
  // 2) Fallback: FCS last candle close
  try {
    const { price, time, symbol: s, period } = await fcsLastClose(symbol);
    return { price, time, symbol: s, source: `FCS ${period} candle` };
  } catch (e) {
    console.log('[FCS] Candle fallback failed:', (e as any)?.message);
  }
  // 3) Fallback: Yahoo Finance
  try {
    const { price, time, symbol: s } = await yahooLatest(symbol);
    return { price, time, symbol: s, source: 'Yahoo' };
  } catch (e) {
    console.log('[Yahoo] Fallback failed:', (e as any)?.message);
  }
  // 4) Fallback for crypto only: Binance
  if (isCrypto(symbol)) {
    const { price, time, symbol: s } = await binanceLatest(symbol);
    return { price, time, symbol: s, source: 'Binance' };
  }
  throw new Error(`price_unavailable:${symbol}`);
}
