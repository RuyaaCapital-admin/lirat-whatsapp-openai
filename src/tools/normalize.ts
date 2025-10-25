// src/tools/normalize.ts
export type TF = "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";

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

export const TF_SECONDS: Record<TF, number> = {
  "1min": 60,
  "5min": 5 * 60,
  "15min": 15 * 60,
  "30min": 30 * 60,
  "1hour": 60 * 60,
  "4hour": 4 * 60 * 60,
  "1day": 24 * 60 * 60,
};

export const FMP_TIMEFRAME_MAP: Record<TF, string> = {
  "1min": "1min",
  "5min": "5min",
  "15min": "15min",
  "30min": "30min",
  "1hour": "1hour",
  "4hour": "4hour",
  "1day": "1day",
};

export const FCS_TIMEFRAME_MAP: Record<TF, string> = {
  "1min": "1m",
  "5min": "5m",
  "15min": "15m",
  "30min": "30m",
  "1hour": "1h",
  "4hour": "4h",
  "1day": "1d",
};

export function toProviderInterval(provider: "FMP" | "FCS", tf: TF): string {
  return provider === "FMP" ? FMP_TIMEFRAME_MAP[tf] : FCS_TIMEFRAME_MAP[tf];
}

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

export function mapToFmpSymbol(sym: string): string {
  const upper = sym.toUpperCase();
  if (upper === "BTCUSDT") return "BTCUSD";
  if (upper === "ETHUSDT") return "ETHUSD";
  return upper;
}

export function mapToFcsSymbol(sym: string): string {
  const upper = sym.toUpperCase();
  if (upper.includes("/")) {
    return upper;
  }
  if (upper.length === 6) {
    return `${upper.slice(0, 3)}/${upper.slice(3)}`;
  }
  return upper;
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
    return "1min";
  if (
    /(\b5\s*(m|min)\b|\b5\s*(دقايق|دقائق)\b|\b٥\s*(دقايق|دقائق)\b|\bخمس دقائق\b)/.test(t)
  )
    return "5min";
  if (/(\b15\s*(m|min)?\b|\b١٥\s*(دقيقة|دقايق)\b|\bربع ساعة\b)/.test(t)) return "15min";
  if (
    /(\b30\s*(m|min)?\b|\b٣٠\s*(دقيقة|دقايق)\b|\bنص ساعة\b|\bنصف ساعة\b)/.test(t)
  )
    return "30min";
  if (/(\b1\s*(hour|h)\b|\bساعة\b|\bساعه\b)/.test(t)) return "1hour";
  if (/(\b4\s*(hour|h)\b|\b٤\s*س\b|\b4\s*س\b|\bاربع ساعات\b|\b٤ ساعات\b)/.test(t)) return "4hour";
  if (/(\bdaily\b|\bيومي\b|\bيوم\b)/.test(t)) return "1day";
  return "5min";
}

export const TIMEFRAME_FALLBACKS: Record<TF, TF[]> = {
  "1min": ["5min", "15min"],
  "5min": ["15min"],
  "15min": ["30min", "1hour"],
  "30min": ["1hour", "4hour"],
  "1hour": ["4hour", "1day"],
  "4hour": ["1day"],
  "1day": [],
};

export function timeframeToLabel(tf: TF): string {
  switch (tf) {
    case "1min":
      return "1min";
    case "5min":
      return "5min";
    case "15min":
      return "15min";
    case "30min":
      return "30min";
    case "1hour":
      return "1hour";
    case "4hour":
      return "4hour";
    case "1day":
    default:
      return "1day";
  }
}
