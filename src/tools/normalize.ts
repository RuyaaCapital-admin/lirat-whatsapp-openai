// src/tools/normalize.ts
export type TF = '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily';

const HARD_MAP: Record<string,string> = {
  // Arabic + English variants
  'ذهب':'XAUUSD','الذهب':'XAUUSD','دهب':'XAUUSD','gold':'XAUUSD',
  'فضة':'XAGUSD','الفضة':'XAGUSD','silver':'XAGUSD',
  'نفط':'XTIUSD','خام':'XTIUSD','wti':'XTIUSD',
  'برنت':'XBRUSD','brent':'XBRUSD',
  'بيتكوين':'BTCUSDT','btc':'BTCUSDT',
  'إيثيريوم':'ETHUSDT','eth':'ETHUSDT',
  'يورو':'EURUSD','eurusd':'EURUSD',
  'ين':'USDJPY','ين ياباني':'USDJPY','usd/jpy':'USDJPY',
  'فرنك سويسري':'USDCHF','جنيه استرليني':'GBPUSD',
  'دولار كندي':'USDCAD','دولار أسترالي':'AUDUSD','دولار نيوزلندي':'NZDUSD',
};

export function hardMapSymbol(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (HARD_MAP[t]) return HARD_MAP[t];
  // ticker-like? keep letters only
  const m = t.replace(/[^a-z]/g,'').toUpperCase();
  if (/^[A-Z]{6,10}$/.test(m)) return m;
  return null;
}

export function isCrypto(sym: string) {
  return sym.endsWith('USDT');
}

// FCS needs slashes for FX/metals; crypto stays unslashed
export function forPriceSource(sym: string): string {
  if (isCrypto(sym)) return sym; // e.g., BTCUSDT
  // metals/FX → XAU/USD, EUR/USD, ...
  return sym.length === 6 ? `${sym.slice(0,3)}/${sym.slice(3)}` : sym;
}

export function toTimeframe(user?: string): TF {
  const t = (user||'').toLowerCase().trim();
  if (/(^|[^0-9])1\s*(m|min|دقيقة)/.test(t)) return '1min';
  if (/5\s*(m|min|دقائق)/.test(t)) return '5min';
  if (/(15|ربع)/.test(t)) return '15min';
  if (/30\s*(m|min)/.test(t)) return '30min';
  if (/(ساعة|1\s*hour)/.test(t)) return '1hour';
  if (/(4\s*سا|4\s*hour)/.test(t)) return '4hour';
  if (/(يوم|daily)/.test(t)) return 'daily';
  return '1hour'; // default for analysis
}
