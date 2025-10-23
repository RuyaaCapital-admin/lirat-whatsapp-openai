// src/tools/fcs.ts
import axios from "axios";
import { Canonical, toFcsSymbol } from "./symbol";

const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

export async function getFcsLiveOr1m(canonical: Canonical): Promise<{
  symbol: Canonical;
  price: number;
  timeUtc: string;
  source: 'FCS (live)' | 'FCS (1m)' | 'FCS (5m)' | 'FCS (15m)';
}> {
  const FCS_API_KEY = process.env.FCS_API_KEY;
  if (!FCS_API_KEY) {
    throw new Error('FCS_API_KEY not set');
  }

  const fcsSymbol = toFcsSymbol(canonical);
  const isCrypto = canonical.includes('BTC') || canonical.includes('ETH');
  
  // Try latest endpoint first
  try {
    const latestEndpoint = isCrypto
      ? `https://fcsapi.com/api-v3/crypto/latest?symbol=${encodeURIComponent(fcsSymbol)}&access_key=${FCS_API_KEY}`
      : `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(fcsSymbol)}&access_key=${FCS_API_KEY}`;

    console.log('[FCS] Trying latest endpoint:', latestEndpoint);
    const { data } = await axios.get(latestEndpoint, { headers: UA });
    
    const row = data?.response?.[0] || data?.data?.[0];
    if (row) {
      let price: number | null = null;
      
      // Try different price fields
      if (row.price && Number.isFinite(Number(row.price))) {
        price = Number(row.price);
      } else if (row.bid && Number.isFinite(Number(row.bid))) {
        price = Number(row.bid);
      } else if (row.ask && Number.isFinite(Number(row.ask))) {
        price = Number(row.ask);
      } else if (row.c && Number.isFinite(Number(row.c))) {
        price = Number(row.c);
      }

      if (price !== null) {
        const timestamp = row.t ? Number(row.t) : Math.floor(Date.now() / 1000);
        const timeUtc = new Date(timestamp * 1000).toISOString();
        
        // Check if data is fresh (within 2 minutes)
        const now = Math.floor(Date.now() / 1000);
        if ((now - timestamp) <= 120) {
          return {
            symbol: canonical,
            price,
            timeUtc,
            source: 'FCS (live)'
          };
        }
      }
    }
  } catch (error) {
    console.log('[FCS] Latest endpoint failed, trying candles...');
  }

  // Fallback to candles (1m, 5m, 15m)
  const timeframes = ['1m', '5m', '15m'];
  
  for (const tf of timeframes) {
    try {
      const candlesEndpoint = isCrypto
        ? `https://fcsapi.com/api-v3/crypto/ohlc?symbol=${encodeURIComponent(fcsSymbol)}&period=${tf}&limit=1&access_key=${FCS_API_KEY}`
        : `https://fcsapi.com/api-v3/forex/ohlc?symbol=${encodeURIComponent(fcsSymbol)}&period=${tf}&limit=1&access_key=${FCS_API_KEY}`;

      console.log('[FCS] Trying candles endpoint:', candlesEndpoint);
      const { data } = await axios.get(candlesEndpoint, { headers: UA });
      
      const candles = data?.response || data?.data;
      if (candles && candles.length > 0) {
        const candle = candles[0];
        const price = candle.c ? Number(candle.c) : null;
        
        if (price !== null) {
          const timestamp = candle.t ? Number(candle.t) : Math.floor(Date.now() / 1000);
          const timeUtc = new Date(timestamp * 1000).toISOString();
          
          return {
            symbol: canonical,
            price,
            timeUtc,
            source: `FCS (${tf})` as any
          };
        }
      }
    } catch (error) {
      console.log(`[FCS] ${tf} candles failed, trying next...`);
    }
  }

  throw new Error('All FCS endpoints failed');
}
