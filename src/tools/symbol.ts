// src/tools/symbol.ts
export type Canonical = 'XAUUSD'|'XAGUSD'|'EURUSD'|'GBPUSD'|'BTCUSDT'|string;

const MAP: Record<string, Canonical> = {
  // gold
  'ذهب':'XAUUSD','الذهب':'XAUUSD','دهب':'XAUUSD','الدهب':'XAUUSD',
  // silver
  'فضة':'XAGUSD','الفضة':'XAGUSD',
  // fx
  'يورو دولار':'EURUSD','اليورو دولار':'EURUSD',
  'باوند دولار':'GBPUSD','الجنيه دولار':'GBPUSD','الباوند دولار':'GBPUSD',
  // crypto
  'بتكوين':'BTCUSDT','بيتكوين':'BTCUSDT','btc':'BTCUSDT'
};

const ALIASES: Record<string, Canonical> = {
  'xau':'XAUUSD','xauusd':'XAUUSD','xau/usd':'XAUUSD',
  'xag':'XAGUSD','xagusd':'XAGUSD','xag/usd':'XAGUSD',
  'eurusd':'EURUSD','eur/usd':'EURUSD',
  'gbpusd':'GBPUSD','gbp/usd':'GBPUSD',
  'btcusdt':'BTCUSDT','btc/usdt':'BTCUSDT'
};

export function toCanonical(s: string): Canonical|undefined {
  const t = s.trim().toLowerCase();
  return ALIASES[t] ?? MAP[t];
}
export const toFcsSymbol = (c: Canonical) =>
  c.includes('/') ? c.toUpperCase() : `${c.slice(0,3)}/${c.slice(3)}`.toUpperCase();
export const toFmpSymbol = (c: Canonical) => c.replace('/','').toUpperCase();

export function parseIntent(text: string): {
  symbol?: Canonical,
  timeframe?: '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily',
  wantsPrice: boolean
} {
  const t = text.toLowerCase().replace(/\s+/g,' ').trim();
  console.log('[PARSE] Input text:', text);
  console.log('[PARSE] Normalized text:', t);

  // candidate n-grams
  const toks = t.split(' ');
  console.log('[PARSE] Tokens:', toks);
  let symbol: Canonical|undefined;
  for (let i=0;i<toks.length;i++){
    const uni = toks[i];
    const bi  = i+1<toks.length ? `${toks[i]} ${toks[i+1]}` : '';
    console.log('[PARSE] Checking uni:', uni, 'bi:', bi);
    const uniResult = toCanonical(uni);
    const biResult = toCanonical(bi);
    console.log('[PARSE] uni result:', uniResult, 'bi result:', biResult);
    symbol = biResult || uniResult || symbol;
    if (symbol) break;
  }
  console.log('[PARSE] Final symbol:', symbol);

  // Arabic + EN timeframe
  let tf: any;
  console.log('[PARSE] Checking timeframes...');
  if (/\b(1 ?min|1m|دقيقة|الدقيقة|دقيقه|الدقيقى|الدقيقة)\b/.test(t)) {
    tf='1min';
    console.log('[PARSE] Found 1min timeframe');
  }
  else if (/\b(5 ?min|5m|٥ دقائق|5 دقائق)\b/.test(t)) {
    tf='5min';
    console.log('[PARSE] Found 5min timeframe');
  }
  else if (/\b(15 ?min|15m|١٥ دقيقة|15 دقيقة)\b/.test(t)) {
    tf='15min';
    console.log('[PARSE] Found 15min timeframe');
  }
  else if (/\b(30 ?min|30m|٣٠ دقيقة|30 دقيقة)\b/.test(t)) {
    tf='30min';
    console.log('[PARSE] Found 30min timeframe');
  }
  else if (/\b(1 ?hour|1h|ساعة|ساعه)\b/.test(t)) {
    tf='1hour';
    console.log('[PARSE] Found 1hour timeframe');
  }
  else if (/\b(4 ?hour|4h|4 ساعات|٤ ساعات)\b/.test(t)) {
    tf='4hour';
    console.log('[PARSE] Found 4hour timeframe');
  }
  else if (/\b(daily|يومي)\b/.test(t)) {
    tf='daily';
    console.log('[PARSE] Found daily timeframe');
  }
  console.log('[PARSE] Final timeframe:', tf);

  // price intent - more comprehensive detection
  const hasPriceWord = /\b(سعر|كم|price|quote|شراء|بيع|صفقة|تداول|trade)\b/.test(t);
  const hasSymbolInText = Boolean(symbol);
  const wantsPrice = hasSymbolInText && (hasPriceWord || /xau|xag|eurusd|gbpusd|btc|ذهب|فضة|دهب/u.test(t));
  
  console.log('[PARSE] hasPriceWord:', hasPriceWord);
  console.log('[PARSE] hasSymbolInText:', hasSymbolInText);
  console.log('[PARSE] wantsPrice:', wantsPrice);
  console.log('[PARSE] Final result:', { symbol, timeframe: tf, wantsPrice });

  return { symbol, timeframe: tf, wantsPrice };
}