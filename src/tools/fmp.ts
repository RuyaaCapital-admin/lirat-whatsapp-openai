// src/tools/fmp.ts
import axios from "axios";
import { Canonical, toFmpSymbol } from "./symbol";

const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

export async function getFmpOhlc(
  canonical: Canonical,
  interval: '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily'
): Promise<{
  candles: { timeUtc: string, open:number, high:number, low:number, close:number }[];
  last: { close:number, prev:number, timeUtc:string };
}> {
  const FMP_API_KEY = process.env.FMP_API_KEY;
  if (!FMP_API_KEY) {
    throw new Error('FMP_API_KEY not set');
  }

  const fmpSymbol = toFmpSymbol(canonical);
  
  // FMP endpoint for forex/crypto OHLC
  const endpoint = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${fmpSymbol}?apikey=${FMP_API_KEY}`;
  
  console.log('[FMP] Fetching OHLC:', endpoint);
  const { data } = await axios.get(endpoint, { headers: UA });
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    throw new Error('No data on this timeframe');
  }
  
  // Convert FMP data to our format
  const candles = data.map((candle: any) => ({
    timeUtc: candle.date,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  }));
  
  // Get last candle and previous
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2].close : last.close;
  
  return {
    candles,
    last: {
      close: last.close,
      prev: prev,
      timeUtc: last.timeUtc
    }
  };
}
