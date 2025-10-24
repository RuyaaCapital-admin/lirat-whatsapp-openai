// src/tools/ohlc.ts
import axios from "axios";
import { TF } from "./normalize";

export type Candle = { t:number|string; o:number; h:number; l:number; c:number; v?:number };

function fmpInterval(tf: TF) {
  switch (tf) {
    case '1min': return '1min';
    case '5min': return '5min';
    case '15min': return '15min';
    case '30min': return '30min';
    case '1hour': return '1hour';
    case '4hour': return '4hour';
    case 'daily': return '1day';
  }
}

export async function getOhlcFmp(symbol: string, tf: TF, limit=300): Promise<Candle[]> {
  const interval = fmpInterval(tf);
  // FMP FX/crypto unified chart endpoint (unslashed symbols)
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${symbol}?apikey=${process.env.FMP_API_KEY}`;
  console.log('[FMP] OHLC URL:', url);
  const { data } = await axios.get(url, { timeout: 9000 });
  
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`FMP ${interval} ${symbol}: empty response`);
  }
  
  // FMP returns newest first → reverse to oldest→newest
  return data.reverse().slice(-limit).map((x: any) => ({
    t: new Date(x.date).getTime(),
    o: +x.open, 
    h: +x.high, 
    l: +x.low, 
    c: +x.close, 
    v: +x.volume || 0
  }));
}