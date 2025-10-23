import axios from "axios";
import { normalise } from "../symbols.js";
import type { Candle, TF } from "../signal.js";

const ALLOWED: TF[] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

function buildSymbol(symbol: string) {
  if (symbol.includes("/")) return symbol;
  if (symbol.length === 6) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  return symbol;
}

function isCrypto(symbol: string) {
  return symbol.startsWith("BTC") || symbol.startsWith("ETH");
}

export async function fetchOhlc(symbol: string, interval: TF): Promise<{ ok: true; data: { symbol: string; interval: TF; candles: Candle[] } } | { ok: false; error: string }> {
  try {
    const norm = normalise(symbol);
    if (!ALLOWED.includes(interval)) {
      return { ok: false, error: "interval_invalid" };
    }
    const ohlcKey = process.env.OHLC_API_KEY;
    if (!ohlcKey) return { ok: false, error: "ohlc_key_missing" };
    const providerSymbol = buildSymbol(norm.ohlcSymbol);
    const endpoint = isCrypto(norm.ohlcSymbol)
      ? `https://fcsapi.com/api-v3/crypto/history?symbol=${encodeURIComponent(providerSymbol)}&period=${interval}&access_key=${ohlcKey}`
      : `https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(providerSymbol)}&period=${interval}&access_key=${ohlcKey}`;

    const { data } = await axios.get(endpoint, { headers: UA });
    const rows: any[] = Array.isArray(data?.response)
      ? data.response
      : data?.response
      ? Object.values(data.response)
      : Array.isArray(data?.data)
      ? data.data
      : [];

    const candles: Candle[] = rows
      .map((row) => {
        const ts = row.t ? Number(row.t) * 1000 : row.tm ? Date.parse(row.tm) : row.date ? Date.parse(row.date) : undefined;
        if (!ts) return null;
        const o = Number(row.o ?? row.open);
        const h = Number(row.h ?? row.high);
        const l = Number(row.l ?? row.low);
        const c = Number(row.c ?? row.close);
        if (![o, h, l, c].every(Number.isFinite)) return null;
        const candle: Candle = { t: Math.floor(ts / 1000), o, h, l, c };
        return candle;
      })
      .filter((v): v is Candle => Boolean(v));

    if (!candles.length) {
      return { ok: false, error: "ohlc_empty" };
    }

    const ordered = candles.sort((a, b) => a.t - b.t).slice(-500);
    return { ok: true, data: { symbol: norm.ohlcSymbol, interval, candles: ordered } };
  } catch (err: any) {
    const code = err?.response?.status;
    return { ok: false, error: `ohlc_fetch_failed${code ? `_${code}` : ""}` };
  }
}
