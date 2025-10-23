// src/tools/price.ts
import axios from "axios";

const FCS_BASE = "https://fcsapi.com/api-v3";

export function toFcsSymbol(input: string) {
  // XAUUSD -> XAU/USD, EURUSD -> EUR/USD, crypto stays as-is (BTCUSDT)
  const s = input.toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]{3}USD$/.test(s) || /^[A-Z]{6}$/.test(s)) {
    // handle majors/metals like XAUUSD, EURUSD -> XAU/USD, EUR/USD
    return s.length === 6 ? `${s.slice(0,3)}/${s.slice(3)}` : s;
  }
  return s.includes("/") ? s.toUpperCase() : s; // already slashed or crypto
}

export function toFcsPeriod(tf: string | undefined) {
  const t = (tf || "").toLowerCase().trim();
  if (["1min","1m"].includes(t)) return "1m";
  if (["5min","5m"].includes(t)) return "5m";
  if (["15min","15m","ربع","عالربع"].includes(t)) return "15m";
  if (["30min","30m"].includes(t)) return "30m";
  if (["1hour","1h","ساعة","عالساعة"].includes(t)) return "1h";
  if (["4hour","4h","4 ساعات","عالـ4"].includes(t)) return "4h";
  if (["daily","1day","day","يوم","يومي"].includes(t)) return "1d";
  return "1m";
}

export async function fcsLatest(symbolRaw: string) {
  const symbol = toFcsSymbol(symbolRaw);
  const url = `${FCS_BASE}/forex/latest?symbol=${encodeURIComponent(symbol)}&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Latest URL:', url);
  const { data } = await axios.get(url, { timeout: 7000 });

  // FCS success shape: { code:200, response:[{ s:"XAU/USD", c:"...", tm:"..." }], ... }
  if (!data || !Array.isArray(data.response) || !data.response[0]) {
    throw new Error(`FCS latest: empty response for ${symbol}`);
  }
  const r = data.response[0];
  const price = Number(r.c ?? r.price ?? r.cp ?? r.close);
  const tm = r.tm || r.t || r.updated_at || null;
  if (!Number.isFinite(price)) throw new Error(`FCS latest: invalid price for ${symbol}`);
  return { price, time: tm, symbol };
}

export async function fcsLastClose(symbolRaw: string, tf?: string) {
  const symbol = toFcsSymbol(symbolRaw);
  const period = toFcsPeriod(tf);
  const url = `${FCS_BASE}/forex/candle?symbol=${encodeURIComponent(symbol)}&period=${period}&access_key=${process.env.FCS_API_KEY}`;
  console.log('[FCS] Candle URL:', url);
  const { data } = await axios.get(url, { timeout: 9000 });

  // FCS candle shape: { code:200, response:{ o:[], h:[], l:[], c:[], t:[] } }
  const resp = data?.response;
  const closes: number[] = resp?.c;
  const times: (string|number)[] = resp?.t;
  if (!Array.isArray(closes) || closes.length === 0) {
    throw new Error(`FCS candle: no data for ${symbol} ${period}`);
  }
  const last = closes[closes.length - 1];
  const lastT = times?.[times.length - 1] ?? null;
  return { price: Number(last), time: lastT, symbol, period };
}

// A unified "get current price" that tries latest -> candle
export async function getCurrentPrice(symbol: string, tf?: string) {
  try {
    const { price, time, symbol: s } = await fcsLatest(symbol);
    return { price, time, symbol: s, source: "FCS latest" };
  } catch (e) {
    console.log('[FCS] Latest failed, trying candle fallback:', e.message);
    // fallback: candle last close (works reliably on free plans)
    const { price, time, symbol: s, period } = await fcsLastClose(symbol, tf || "1m");
    return { price, time, symbol: s, source: `FCS ${period} candle` };
  }
}

// Format price block for WhatsApp
export function formatPriceBlock(data: {
  symbol: string;
  interval: string;
  lastClosed: string | number | null;
  close: number;
  prev: string | number;
  ema20: string | number;
  ema50: string | number;
  rsi14: string | number;
  macd: { macd: string | number, signal: string | number, hist: string | number };
  atr14: string | number;
  signal: string;
}) {
  const now = new Date();
  const timeUtc = now.toISOString().slice(11, 16);
  const dateUtc = now.toISOString().slice(0, 10).replace(/-/g, '');
  
  const lastClosed = data.lastClosed ? 
    (typeof data.lastClosed === 'string' ? data.lastClosed : new Date(data.lastClosed).toISOString().slice(11, 16)) : 
    timeUtc;
  
  const lastClosedDate = data.lastClosed ? 
    (typeof data.lastClosed === 'string' ? data.lastClosed.slice(0, 10).replace(/-/g, '') : new Date(data.lastClosed).toISOString().slice(0, 10).replace(/-/g, '')) : 
    dateUtc;

  return `Time (UTC): ${timeUtc}
Symbol: ${data.symbol}
Interval: ${data.interval}
Last closed: ${lastClosedDate}_${lastClosed} UTC
Close: ${data.close}
Prev: ${data.prev}
EMA20: ${data.ema20}
EMA50: ${data.ema50}
RSI14: ${data.rsi14}
MACD(12,26,9): ${data.macd.macd} / ${data.macd.signal} (hist ${data.macd.hist})
ATR14: ${data.atr14}
SIGNAL: ${data.signal}`;
}