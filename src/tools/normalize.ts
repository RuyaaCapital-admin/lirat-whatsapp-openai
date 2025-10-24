// src/tools/normalize.ts
export type TF = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

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

const HARD_MAP: Record<string, string> = SYMBOL_ALIASES.reduce((map, entry) => {
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
    .normalize("NFKC")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\bعال/g, "على ")
    .replace(/\bال(?=\S)/g, "")
    .replace(/\s+/g, " ")
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
  return s.length === 6 ? `${s.slice(0, 3)}/${s.slice(3)}` : s.replace(/USD$/, "/USD");
}

export function toTimeframe(user?: string): TF {
  const t = normalizeArabic((user || "").toLowerCase());
  if (
    /(\b1\s*(m|min|minute)\b|\bدقيقة\b|\bعلى دقيقة\b|\bعالدقيقة\b)/.test(t)
  )
    return "1m";
  if (
    /(\b5\s*(m|min)\b|\b5\s*(دقايق|دقائق)\b|\b٥\s*(دقايق|دقائق)\b|\bخمس دقائق\b)/.test(t)
  )
    return "5m";
  if (/(\b15\s*(m|min)?\b|\b١٥\s*(دقيقة|دقايق)\b|\bربع ساعة\b)/.test(t)) return "15m";
  if (
    /(\b30\s*(m|min)?\b|\b٣٠\s*(دقيقة|دقايق)\b|\bنص ساعة\b|\bنصف ساعة\b)/.test(t)
  )
    return "30m";
  if (/(\b1\s*(hour|h)\b|\bساعة\b|\bساعه\b)/.test(t)) return "1h";
  if (/(\b4\s*(hour|h)\b|\b٤\s*س\b|\b4\s*س\b|\bاربع ساعات\b|\b٤ ساعات\b)/.test(t)) return "4h";
  if (/(\bdaily\b|\bيومي\b|\bيوم\b)/.test(t)) return "1d";
  return "1h";
}

export const TIMEFRAME_FALLBACKS: Record<TF, TF[]> = {
  "1m": ["5m", "15m"],
  "5m": ["15m"],
  "15m": ["30m", "1h"],
  "30m": ["1h", "4h"],
  "1h": ["4h", "1d"],
  "4h": ["1d"],
  "1d": [],
};

export function timeframeToLabel(tf: TF): string {
  switch (tf) {
    case "1m":
      return "1m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "30m":
      return "30m";
    case "1h":
      return "1h";
    case "4h":
      return "4h";
    case "1d":
    default:
      return "1d";
  }
}
