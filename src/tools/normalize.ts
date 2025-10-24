// src/tools/normalize.ts
export type TF = '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily';

const DIGIT_MAP: Record<string, string> = {
  '٠': '0','١': '1','٢': '2','٣': '3','٤': '4','٥': '5','٦': '6','٧': '7','٨': '8','٩': '9'
};

const SYMBOL_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'BTCUSDT', aliases: ['btc', 'btcusdt', 'bitcoin', 'بيتكوين', 'بتكوين'] },
  { canonical: 'ETHUSDT', aliases: ['eth', 'ethusdt', 'ethereum', 'إيثيريوم', 'اثيريوم'] },
  { canonical: 'XAUUSD', aliases: ['xauusd', 'xau', 'gold', 'ذهب', 'الذهب', 'دهب'] },
  { canonical: 'XAGUSD', aliases: ['xagusd', 'xag', 'silver', 'فضة', 'الفضة', 'سيلفر'] },
  { canonical: 'XTIUSD', aliases: ['xtiusd', 'wti', 'نفط', 'خام'] },
  { canonical: 'XBRUSD', aliases: ['xbrusd', 'برنت', 'brent'] },
  { canonical: 'EURUSD', aliases: ['eurusd', 'eur/usd', 'eur', 'يورو'] },
  { canonical: 'GBPUSD', aliases: ['gbpusd', 'gbp/usd', 'gbp', 'استرليني', 'جنيه'] },
  { canonical: 'USDJPY', aliases: ['usdjpy', 'usd/jpy', 'jpy', 'ين', 'ين ياباني'] },
  { canonical: 'USDCHF', aliases: ['usdchf', 'usd/chf', 'chf', 'فرنك', 'فرنك سويسري'] },
  { canonical: 'USDCAD', aliases: ['usdcad', 'usd/cad', 'cad', 'كندي', 'دولار كندي'] },
  { canonical: 'AUDUSD', aliases: ['audusd', 'aud/usd', 'aud', 'استرالي', 'دولار استرالي', 'دولار أسترالي'] },
  { canonical: 'NZDUSD', aliases: ['nzdusd', 'nzd/usd', 'nzd', 'نيوزلندي', 'دولار نيوزلندي'] },
];

const HARD_MAP: Record<string,string> = SYMBOL_ALIASES.reduce((map, entry) => {
  for (const alias of entry.aliases) {
    map[alias.toLowerCase()] = entry.canonical;
  }
  map[entry.canonical.toLowerCase()] = entry.canonical;
  return map;
}, {} as Record<string,string>);

function normalizeDigits(input: string) {
  return input.replace(/[٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
}

export function normalizeArabic(text: string) {
  return normalizeDigits(text)
    .normalize('NFKC')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/\bعال/g, 'على ')
    .replace(/\bال(?=\S)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hardMapSymbol(input: string): string | null {
  const t = normalizeArabic(input).toLowerCase();
  if (HARD_MAP[t]) return HARD_MAP[t];
  const ticker = t.replace(/[^a-z]/g, '').toUpperCase();
  if (/^[A-Z]{6,10}$/.test(ticker)) return ticker;
  return null;
}

export function isCrypto(sym: string) {
  return sym.toUpperCase().endsWith('USDT');
}

export function forPriceSource(sym: string): string {
  if (isCrypto(sym)) return sym.toUpperCase();
  const s = sym.toUpperCase();
  return s.length === 6 ? `${s.slice(0,3)}/${s.slice(3)}` : s.replace(/USD$/,'/USD');
}

export function toTimeframe(user?: string): TF {
  const t = normalizeArabic((user || '').toLowerCase());
  if (/(^|[^0-9])1\s*(m|min|minute|دقيقة)/.test(t)) return '1min';
  if (/(^|\s)(5\s*(m|min|دقائق|دقايق)|٥\s*(دقائق|دقايق|m|min))/.test(t)) return '5min';
  if (/(15|ربع)/.test(t)) return '15min';
  if (/(30\s*(m|min)|نص ساعة|نصف ساعة)/.test(t)) return '30min';
  if (/(1\s*hour|ساعة|ساعه)/.test(t)) return '1hour';
  if (/(4\s*hour|4h|٤\s*س|اربع ساعات|٤ ساعات)/.test(t)) return '4hour';
  if (/(daily|يومي|يوم)/.test(t)) return 'daily';
  return '1hour';
}
