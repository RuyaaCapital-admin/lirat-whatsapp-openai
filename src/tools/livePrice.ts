// src/tools/livePrice.ts
import axios from "axios";

export type LivePriceResponse = {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  timeUtc: string;
  source: 'FCS (live)' | 'FCS (1m)' | 'FALLBACK';
};

const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

// Symbol normalization mapping
const SYMBOL_MAP: Record<string, string> = {
  // Gold variations
  'xau': 'XAU/USD',
  'gold': 'XAU/USD',
  'xauusd': 'XAU/USD',
  'xau/usd': 'XAU/USD',
  
  // Silver variations
  'xag': 'XAG/USD',
  'silver': 'XAG/USD',
  'xagusd': 'XAG/USD',
  'xag/usd': 'XAG/USD',
  
  // Forex pairs
  'eurusd': 'EUR/USD',
  'eur/usd': 'EUR/USD',
  'gbpusd': 'GBP/USD',
  'gbp/usd': 'GBP/USD',
  'usdjpy': 'USD/JPY',
  'usd/jpy': 'USD/JPY',
  'usdchf': 'USD/CHF',
  'usd/chf': 'USD/CHF',
  'audusd': 'AUD/USD',
  'aud/usd': 'AUD/USD',
  'usdcad': 'USD/CAD',
  'usd/cad': 'USD/CAD',
  'nzdusd': 'NZD/USD',
  'nzd/usd': 'NZD/USD',
  
  // Crypto (no slash)
  'btcusdt': 'BTCUSDT',
  'btc': 'BTCUSDT',
  'ethusdt': 'ETHUSDT',
  'eth': 'ETHUSDT',
};

function normalizeSymbol(symbolInput: string): string {
  const normalized = symbolInput.toLowerCase().trim();
  return SYMBOL_MAP[normalized] || symbolInput.toUpperCase();
}

function isCrypto(symbol: string): boolean {
  return symbol.includes('BTC') || symbol.includes('ETH') || symbol.length > 6;
}

function isStale(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (now - timestamp) > 120; // 2 minutes
}

export async function getLivePrice(symbolInput: string): Promise<LivePriceResponse | null> {
  try {
    const FCS_API_KEY = process.env.FCS_API_KEY;
    if (!FCS_API_KEY) {
      console.error('[PRICE] FCS_API_KEY is not set');
      return null;
    }

    const symbol = normalizeSymbol(symbolInput);
    console.log('[PRICE] Normalized symbol:', symbolInput, '→', symbol);

    // Try latest endpoint first
    const latestEndpoint = isCrypto(symbol)
      ? `https://fcsapi.com/api-v3/crypto/latest?symbol=${encodeURIComponent(symbol)}&access_key=${FCS_API_KEY}`
      : `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(symbol)}&access_key=${FCS_API_KEY}`;

    try {
      const { data } = await axios.get(latestEndpoint, { headers: UA });
      const row = data?.response?.[0] || data?.data?.[0];
      
      if (row) {
        let price: number | null = null;
        let bid: number | undefined;
        let ask: number | undefined;
        
        // Try different price fields
        if (row.price && Number.isFinite(Number(row.price))) {
          price = Number(row.price);
        } else if (row.bid && Number.isFinite(Number(row.bid))) {
          price = Number(row.bid);
          bid = price;
        } else if (row.ask && Number.isFinite(Number(row.ask))) {
          price = Number(row.ask);
          ask = price;
        } else if (row.c && Number.isFinite(Number(row.c))) {
          price = Number(row.c);
        }

        if (price !== null) {
          const timestamp = row.t ? Number(row.t) : Math.floor(Date.now() / 1000);
          const timeUtc = new Date(timestamp * 1000).toISOString().slice(11, 16);
          
          // Check if data is stale
          if (isStale(timestamp)) {
            console.log('[PRICE] Latest data is stale, trying 1m candles...');
            return await tryOneMinuteCandles(symbol, FCS_API_KEY);
          }

          // Extract bid/ask if available
          if (row.bid && Number.isFinite(Number(row.bid))) {
            bid = Number(row.bid);
          }
          if (row.ask && Number.isFinite(Number(row.ask))) {
            ask = Number(row.ask);
          }

          return {
            symbol,
            price,
            bid,
            ask,
            timeUtc,
            source: 'FCS (live)'
          };
        }
      }
    } catch (error) {
      console.log('[PRICE] Latest endpoint failed, trying 1m candles...');
    }

    // Fallback to 1-minute candles
    return await tryOneMinuteCandles(symbol, FCS_API_KEY);

  } catch (err: any) {
    console.error('[PRICE] Error fetching price:', err.message);
    return null;
  }
}

async function tryOneMinuteCandles(symbol: string, apiKey: string): Promise<LivePriceResponse | null> {
  try {
    // Use the correct FCS API endpoint for OHLC data
    const candlesEndpoint = isCrypto(symbol)
      ? `https://fcsapi.com/api-v3/crypto/ohlc?symbol=${encodeURIComponent(symbol)}&period=1m&limit=1&access_key=${apiKey}`
      : `https://fcsapi.com/api-v3/forex/ohlc?symbol=${encodeURIComponent(symbol)}&period=1m&limit=1&access_key=${apiKey}`;

    console.log('[PRICE] Trying candles endpoint:', candlesEndpoint);
    const { data } = await axios.get(candlesEndpoint, { headers: UA });
    console.log('[PRICE] Candles response:', data);
    
    const candles = data?.response || data?.data;
    
    if (candles && candles.length > 0) {
      const candle = candles[0];
      const price = candle.c ? Number(candle.c) : null;
      
      if (price !== null) {
        const timestamp = candle.t ? Number(candle.t) : Math.floor(Date.now() / 1000);
        const timeUtc = new Date(timestamp * 1000).toISOString().slice(11, 16);
        
        return {
          symbol,
          price,
          timeUtc,
          source: 'FCS (1m)'
        };
      }
    }
  } catch (error) {
    console.error('[PRICE] 1m candles failed:', error);
    // Return a fallback response instead of null
    return {
      symbol,
      price: 0,
      timeUtc: new Date().toISOString().slice(11, 16),
      source: 'FALLBACK'
    };
  }

  return null;
}