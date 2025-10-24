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

  // candidate n-grams
  const toks = t.split(' ');
  let symbol: Canonical|undefined;
  for (let i=0;i<toks.length;i++){
    const uni = toks[i];
    const bi  = i+1<toks.length ? `${toks[i]} ${toks[i+1]}` : '';
    symbol = toCanonical(bi) || toCanonical(uni) || symbol;
    if (symbol) break;
  }

  // Arabic + EN timeframe
  let tf: any;
  if (/\b(1 ?min|1m|دقيقة|الدقيقة|دقيقه|الدقيقى)\b/.test(t)) tf='1min';
  else if (/\b(5 ?min|5m|٥ دقائق|5 دقائق)\b/.test(t)) tf='5min';
  else if (/\b(15 ?min|15m|١٥ دقيقة|15 دقيقة)\b/.test(t)) tf='15min';
  else if (/\b(30 ?min|30m|٣٠ دقيقة|30 دقيقة)\b/.test(t)) tf='30min';
  else if (/\b(1 ?hour|1h|ساعة|ساعه)\b/.test(t)) tf='1hour';
  else if (/\b(4 ?hour|4h|4 ساعات|٤ ساعات)\b/.test(t)) tf='4hour';
  else if (/\b(daily|يومي)\b/.test(t)) tf='daily';

  // price intent - more comprehensive detection
  const hasPriceWord = /\b(سعر|كم|price|quote|شراء|بيع|صفقة|تداول|trade)\b/.test(t);
  const hasSymbolInText = Boolean(symbol);
  const wantsPrice = hasSymbolInText && (hasPriceWord || /xau|xag|eurusd|gbpusd|btc|ذهب|فضة|دهب/u.test(t));

  return { symbol, timeframe: tf, wantsPrice };
}