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

// NEW: Get technical indicators from FMP
export async function getFmpTechnicalIndicators(symbol: string, tf: TF): Promise<any[]> {
  const interval = fmpInterval(tf);
  const url = `https://financialmodelingprep.com/api/v3/technical_indicator/${interval}/${symbol}?type=rsi&period=14&apikey=${process.env.FMP_API_KEY}`;
  console.log('[FMP] Technical Indicators URL:', url);
  
  const { data } = await axios.get(url, { timeout: 9000 });
  
  if (!data || Object.keys(data).length === 0) {
    throw new Error(`FMP technical indicators ${interval} ${symbol}: empty response`);
  }
  
  // Handle different response formats
  let indicators = [];
  if (Array.isArray(data)) {
    indicators = data;
  } else if (typeof data === 'object') {
    // If response keys are "0","1",... build array
    const keys = Object.keys(data).filter(k => /^\d+$/.test(k));
    if (keys.length > 0) {
      indicators = keys.map(k => data[k]).sort((a, b) => new Date(a.date) - new Date(b.date));
    } else {
      indicators = [data];
    }
  }
  
  if (!indicators.length) {
    throw new Error(`FMP technical indicators ${interval} ${symbol}: no data`);
  }
  
  return indicators;
}