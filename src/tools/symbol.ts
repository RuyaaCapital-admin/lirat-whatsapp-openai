// src/tools/symbol.ts
export type Canonical = 'XAUUSD'|'XAGUSD'|'EURUSD'|'GBPUSD'|'BTCUSDT'|string;

// Arabic preprocessing function
function arNorm(t: string): string {
  return t
    .normalize('NFKC')
    .replace(/[\u064B-\u0652\u0670\u0640]/gu, '') // remove diacritics + tatweel
    .replace(/(^|\s)عال/gu, '$1على ')                // "عالبيتكوين" → "على بيتكوين"
    .replace(/(^|\s)عل(?=\s)/gu, '$1على ')          // "عل الذهب" → "على الذهب"
    .replace(/(^|\s)بال/gu, '$1ب ')
    .replace(/(^|\s)ال(?=\S)/gu, '$1')              // drop leading "ال"
    .replace(/\s+/g, ' ')
    .trim();
}

// Signal and price detection regexes (order matters - signal first)
const SIGNAL_RE = /(صفقة|إشارة|تحليل|signal|long|short|buy|sell)/i;
const PRICE_RE = /(سعر|price|quote|كم|قديش)/i;

// Symbol mapping with regex patterns (no keywords like "صفقة")
const MAP: [string[], string][] = [
  [["بيتكوين", "بتكوين", "btc"], "BTCUSDT"],
  [["اثيريوم", "إيثيريوم", "eth"], "ETHUSDT"],
  [["ذهب", "دهب", "gold", "xau"], "XAUUSD"],
  [["فضة", "سيلفر", "silver", "xag"], "XAGUSD"],
  [["يورو", "eurusd", "eur/usd", "eur"], "EURUSD"],
  [["ين"], "USDJPY"],
  [["فرنك"], "USDCHF"],
  [["استرليني", "جنيه"], "GBPUSD"],
  [["كندي"], "USDCAD"],
  [["استرالي"], "AUDUSD"],
  [["نيوزلندي"], "NZDUSD"],
];

function pickSymbol(s: string): string | undefined {
  for (const [keywords, val] of MAP) {
    if (keywords.some((keyword) => s.includes(keyword))) {
      return val;
    }
  }
  return undefined;
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
  route?: 'forex' | 'crypto'
} {
  const normalizedText = arNorm(text.toLowerCase());
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
  if (/(^|\s)(1 ?min|1m|دقيقة|دقيقه|عالدقيقة|على دقيقة|على الدقيقه)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '1min';
  } else if (/(^|\s)(5 ?min|5m|٥ دقائق|5 دقائق|5 دقايق|٥ دقايق)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '5min';
  } else if (/(^|\s)(15 ?min|15m|15 دقيقة|15 دقائق)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '15min';
  } else if (/(^|\s)(30 ?min|30m|30 دقيقة|30 دقائق)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '30min';
  } else if (/(^|\s)(1 ?hour|1h|ساعة|ساعه)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '1hour';
  } else if (/(^|\s)(4 ?hour|4h|4 ساعات|4 ساعة)(?=$|\s)/u.test(normalizedText)) {
    timeframe = '4hour';
  } else if (/(^|\s)(1 ?day|1d|يوم)(?=$|\s)/u.test(normalizedText)) {
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
  const route = symbol ? (isCrypto(symbol) ? 'crypto' : 'forex') : undefined;
  
  console.log('[PARSE] Final result:', { symbol, timeframe, wantsPrice, wantsSignal, route });
  
  return { symbol, timeframe, wantsPrice, wantsSignal, route };
}