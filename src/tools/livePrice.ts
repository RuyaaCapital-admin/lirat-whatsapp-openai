// src/tools/livePrice.ts
import { fetchLatestPrice } from './price';
import { normalise } from '../symbols';

export type LivePriceResponse = {
  symbol: string;
  bid?: number;
  ask?: number;
  price: number;
  source: string;
  timeUtc: string;
};

// Symbol normalization with fallbacks
function normalizeSymbol(input: string): string {
  const lower = input.toLowerCase().trim();
  
  // Direct mappings
  const mappings: Record<string, string> = {
    'gold': 'XAUUSD',
    'xau': 'XAUUSD',
    'silver': 'XAGUSD',
    'xag': 'XAGUSD',
    'oil': 'XTIUSD',
    'wti': 'XTIUSD',
    'brent': 'XBRUSD',
    'btc': 'BTCUSDT',
    'bitcoin': 'BTCUSDT',
    'eth': 'ETHUSDT',
    'ethereum': 'ETHUSDT',
    'eur': 'EURUSD',
    'euro': 'EURUSD',
    'gbp': 'GBPUSD',
    'pound': 'GBPUSD',
    'jpy': 'USDJPY',
    'yen': 'USDJPY',
    'chf': 'USDCHF',
    'franc': 'USDCHF',
    'cad': 'USDCAD',
    'aud': 'AUDUSD',
    'nzd': 'NZDUSD'
  };

  // Check direct mappings first
  if (mappings[lower]) {
    return mappings[lower];
  }

  // Check if it's already a valid symbol format
  if (lower.match(/^[a-z]{3,6}[a-z]{3,6}$/i)) {
    return lower.toUpperCase();
  }

  // Use existing normalise function as fallback
  try {
    const { pricePair } = normalise(input);
    return pricePair;
  } catch {
    return input.toUpperCase();
  }
}

export async function getLivePrice(symbolInput: string): Promise<LivePriceResponse | null> {
  try {
    const normalizedSymbol = normalizeSymbol(symbolInput);
    
    // Try with slash format first (for FCS API)
    const slashSymbol = normalizedSymbol.includes('/') ? normalizedSymbol : 
      normalizedSymbol.replace(/(.{3})(.{3})/, '$1/$2');
    
    const result = await fetchLatestPrice(slashSymbol);
    
    if (!result.ok) {
      console.error('[LIVE_PRICE] Failed to fetch price:', result.error);
      return null;
    }

    const { data } = result;
    const now = new Date();
    const timeUtc = now.toISOString().slice(11, 16); // HH:MM format

    return {
      symbol: normalizedSymbol,
      price: data.price,
      source: data.note || 'FCS',
      timeUtc: data.utcTime || timeUtc
    };
  } catch (error) {
    console.error('[LIVE_PRICE] Error:', error);
    return null;
  }
}

// Check if text contains price intent
export function hasPriceIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const priceKeywords = [
    'price', 'سعر', 'سعره', 'كم', 'قيمة',
    'gold', 'ذهب', 'xau', 'silver', 'فضة', 'xag',
    'oil', 'نفط', 'wti', 'brent', 'برنت',
    'btc', 'bitcoin', 'بيتكوين', 'eth', 'ethereum', 'إيثيريوم',
    'eur', 'euro', 'يورو', 'gbp', 'pound', 'جنيه',
    'jpy', 'yen', 'ين', 'chf', 'franc', 'فرنك',
    'cad', 'aud', 'nzd'
  ];

  return priceKeywords.some(keyword => lower.includes(keyword));
}
