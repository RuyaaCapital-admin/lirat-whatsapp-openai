// src/tools/symbol.ts
export type Canonical = 'XAUUSD'|'XAGUSD'|'EURUSD'|'GBPUSD'|'BTCUSDT'|string;

// Arabic preprocessing function
function arNorm(t: string): string {
  return t
    .replace(/[ًٌٍَُِّْـ]/g, "")              // remove diacritics
    .replace(/\bعال/g, "على ")                // "عالبيتكوين" → "على بيتكوين"
    .replace(/\bبال/g, "ب ")
    .replace(/\bال(?=\S)/g, "");              // drop leading "ال"
}

// Signal and price detection regexes (order matters - signal first)
const SIGNAL_RE = /(صفقة|إشارة|تحليل|signal|long|short|buy|sell)/i;
const PRICE_RE = /(سعر|price|quote|كم|قديش)/i;

// Symbol mapping with regex patterns (no keywords like "صفقة")
const MAP: [RegExp, string][] = [
  [/\b(بيتكوين|بتكوين|BTC)\b/i, "BTCUSDT"],
  [/\b(اثيريوم|إيثيريوم|ETH)\b/i, "ETHUSDT"],
  [/\b(ذهب|دهب|GOLD|XAU)\b/i, "XAUUSD"],
  [/\b(فضة|سيلفر|SILVER|XAG)\b/i, "XAGUSD"],
  [/\b(يورو)\b/i, "EURUSD"], 
  [/\b(ين)\b/i, "USDJPY"],
  [/\b(فرنك)\b/i, "USDCHF"], 
  [/\b(استرليني)\b/i, "GBPUSD"],
  [/\b(كندي)\b/i, "USDCAD"], 
  [/\b(استرالي)\b/i, "AUDUSD"],
  [/\b(نيوزلندي)\b/i, "NZDUSD"],
];

function pickSymbol(s: string): string | null {
  for (const [re, val] of MAP) {
    if (re.test(s)) return val;
  }
  return null;
}

// Check if symbol is crypto
function isCrypto(sym: string): boolean {
  return /USDT$/.test(sym);
}

const ALIASES: Record<string, Canonical> = {
  'xau':'XAUUSD','xauusd':'XAUUSD','xau/usd':'XAUUSD',
  'xag':'XAGUSD','xagusd':'XAGUSD','xag/usd':'XAGUSD',
  'eurusd':'EURUSD','eur/usd':'EURUSD',
  'gbpusd':'GBPUSD','gbp/usd':'GBPUSD',
  'btcusdt':'BTCUSDT','btc/usdt':'BTCUSDT','btcusd':'BTCUSDT'
};

export function toCanonical(s: string): Canonical|undefined {
  const t = s.trim().toLowerCase();
  return ALIASES[t];
}

export const toFcsSymbol = (c: Canonical) =>
  c.includes('/') ? c.toUpperCase() : `${c.slice(0,3)}/${c.slice(3)}`.toUpperCase();
export const toFmpSymbol = (c: Canonical) => c.replace('/','').toUpperCase();

export function parseIntent(text: string): {
  symbol?: Canonical,
  timeframe?: '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily',
  wantsPrice: boolean,
  wantsSignal: boolean,
  route: 'forex' | 'crypto' | null
} {
  const normalizedText = arNorm(text.toLowerCase().replace(/\s+/g, ' ').trim());
  console.log('[PARSE] Input text:', text);
  console.log('[PARSE] Normalized text:', normalizedText);
  
  // Check routing priority: signal first, then price
  const wantsSignal = SIGNAL_RE.test(normalizedText);
  const wantsPrice = PRICE_RE.test(normalizedText);
  
  console.log('[PARSE] wantsSignal:', wantsSignal);
  console.log('[PARSE] wantsPrice:', wantsPrice);
  
  // Extract symbol using new mapping
  const symbol = pickSymbol(normalizedText);
  console.log('[PARSE] Detected symbol:', symbol);
  
  // Extract timeframe
  let timeframe: any;
  if (/\b(1 ?min|1m|دقيقة|الدقيقة|دقيقه|الدقيقى|الدقيقة|عالدقيقة|على الدقيقة)\b/.test(normalizedText)) {
    timeframe = '1min';
  } else if (/\b(5 ?min|5m|٥ دقائق|5 دقائق|5 دقايق|٥ دقايق)\b/.test(normalizedText)) {
    timeframe = '5min';
  } else if (/\b(15 ?min|15m|15 دقيقة|15 دقائق)\b/.test(normalizedText)) {
    timeframe = '15min';
  } else if (/\b(30 ?min|30m|30 دقيقة|30 دقائق)\b/.test(normalizedText)) {
    timeframe = '30min';
  } else if (/\b(1 ?hour|1h|ساعة|الساعة|ساعه|الساعه)\b/.test(normalizedText)) {
    timeframe = '1hour';
  } else if (/\b(4 ?hour|4h|4 ساعات|4 ساعة)\b/.test(normalizedText)) {
    timeframe = '4hour';
  } else if (/\b(1 ?day|1d|يوم|اليوم)\b/.test(normalizedText)) {
    timeframe = 'daily';
  }
  
  // Default timeframes based on intent
  if (!timeframe) {
    if (wantsSignal) {
      timeframe = '1hour';  // Default for signals
    } else if (wantsPrice) {
      timeframe = '1min';    // Default for prices
    }
  }
  
  console.log('[PARSE] Final timeframe:', timeframe);
  
  // Determine route
  const route = symbol ? (isCrypto(symbol) ? 'crypto' : 'forex') : null;
  
  console.log('[PARSE] Final result:', { symbol, timeframe, wantsPrice, wantsSignal, route });
  
  return { symbol, timeframe, wantsPrice, wantsSignal, route };
}