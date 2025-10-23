// src/tools/symbol.ts
export type Canonical = 'XAUUSD' | 'XAGUSD' | 'EURUSD' | 'GBPUSD' | 'USDJPY' | 'USDCHF' | 'AUDUSD' | 'USDCAD' | 'NZDUSD' | 'BTCUSDT' | 'ETHUSDT' | string;

// Symbol mapping for common variants
const SYMBOL_MAP: Record<string, Canonical> = {
  // Gold variations
  'xau': 'XAUUSD',
  'gold': 'XAUUSD',
  'xauusd': 'XAUUSD',
  'xau/usd': 'XAUUSD',
  'ذهب': 'XAUUSD',
  'الذهب': 'XAUUSD',
  'دهب': 'XAUUSD',
  
  // Silver variations
  'xag': 'XAGUSD',
  'silver': 'XAGUSD',
  'xagusd': 'XAGUSD',
  'xag/usd': 'XAGUSD',
  'فضة': 'XAGUSD',
  'الفضة': 'XAGUSD',
  
  // Forex pairs
  'eurusd': 'EURUSD',
  'eur/usd': 'EURUSD',
  'يورو': 'EURUSD',
  
  'gbpusd': 'GBPUSD',
  'gbp/usd': 'GBPUSD',
  'جنيه': 'GBPUSD',
  'جنيه استرليني': 'GBPUSD',
  
  'usdjpy': 'USDJPY',
  'usd/jpy': 'USDJPY',
  'ين': 'USDJPY',
  'ين ياباني': 'USDJPY',
  
  'usdchf': 'USDCHF',
  'usd/chf': 'USDCHF',
  'فرنك': 'USDCHF',
  'فرنك سويسري': 'USDCHF',
  
  'audusd': 'AUDUSD',
  'aud/usd': 'AUDUSD',
  'دولار أسترالي': 'AUDUSD',
  
  'usdcad': 'USDCAD',
  'usd/cad': 'USDCAD',
  'دولار كندي': 'USDCAD',
  
  'nzdusd': 'NZDUSD',
  'nzd/usd': 'NZDUSD',
  'دولار نيوزلندي': 'NZDUSD',
  
  // Crypto
  'btcusdt': 'BTCUSDT',
  'btc': 'BTCUSDT',
  'بيتكوين': 'BTCUSDT',
  
  'ethusdt': 'ETHUSDT',
  'eth': 'ETHUSDT',
  'إيثيريوم': 'ETHUSDT',
};

// Convert input to canonical symbol
export function toCanonical(input: string): Canonical {
  const normalized = input.toLowerCase().trim();
  return SYMBOL_MAP[normalized] || input.toUpperCase();
}

// FCS requires slash form: "XAUUSD" -> "XAU/USD"
export function toFcsSymbol(c: Canonical): string {
  if (c.includes('BTC') || c.includes('ETH')) {
    return c; // Crypto stays as-is
  }
  
  // Forex/metals get slash
  if (c.length === 6) {
    return `${c.slice(0, 3)}/${c.slice(3)}`;
  }
  
  return c;
}

// FMP requires no slash: already canonical "XAUUSD"
export function toFmpSymbol(c: Canonical): string {
  return c;
}

// Extract symbol from user text
export function extractSymbolFromText(text: string): Canonical | null {
  const words = text.toLowerCase().split(/\s+/);
  
  // Check for exact matches first
  for (const word of words) {
    if (SYMBOL_MAP[word]) {
      return SYMBOL_MAP[word];
    }
  }
  
  // Check for symbol patterns
  for (const word of words) {
    if (word.match(/^[a-z]{3,6}$/)) {
      const canonical = toCanonical(word);
      if (canonical !== word.toUpperCase()) {
        return canonical;
      }
    }
  }
  
  return null;
}

// Extract timeframe from user text
export function extractTimeframeFromText(text: string): string | null {
  const lowerText = text.toLowerCase();
  
  // Arabic timeframes
  if (lowerText.includes('دقيقة') || lowerText.includes('1 دقيقة') || lowerText.includes('عالدفعة')) {
    return '1min';
  }
  if (lowerText.includes('5 دقائق') || lowerText.includes('خمس دقائق')) {
    return '5min';
  }
  if (lowerText.includes('ربع') || lowerText.includes('15 دقيقة') || lowerText.includes('عالربع')) {
    return '15min';
  }
  if (lowerText.includes('30 دقيقة')) {
    return '30min';
  }
  if (lowerText.includes('ساعة') || lowerText.includes('عالساعة')) {
    return '1hour';
  }
  if (lowerText.includes('4 ساعات') || lowerText.includes('عالـ4')) {
    return '4hour';
  }
  if (lowerText.includes('يوم') || lowerText.includes('يومي')) {
    return 'daily';
  }
  
  // English timeframes
  if (lowerText.includes('1min') || lowerText.includes('1 min')) {
    return '1min';
  }
  if (lowerText.includes('5min') || lowerText.includes('5 min')) {
    return '5min';
  }
  if (lowerText.includes('15min') || lowerText.includes('15 min')) {
    return '15min';
  }
  if (lowerText.includes('30min') || lowerText.includes('30 min')) {
    return '30min';
  }
  if (lowerText.includes('1hour') || lowerText.includes('1 hour') || lowerText.includes('1h')) {
    return '1hour';
  }
  if (lowerText.includes('4hour') || lowerText.includes('4 hour') || lowerText.includes('4h')) {
    return '4hour';
  }
  if (lowerText.includes('daily') || lowerText.includes('1d')) {
    return 'daily';
  }
  
  return null;
}
