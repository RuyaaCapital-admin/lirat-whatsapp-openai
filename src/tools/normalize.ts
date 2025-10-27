// src/tools/normalize.ts
export type TF = "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";

const DIGIT_MAP: Record<string, string> = {
  '٠': '0','١': '1','٢': '2','٣': '3','٤': '4','٥': '5','٦': '6','٧': '7','٨': '8','٩': '9'
};

const SYMBOL_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'BTCUSDT', aliases: ['btc', 'btcusdt', 'bitcoin', 'بيتكوين', 'بتكوين', 'btcusd', 'btc/usd'] },
  { canonical: 'ADAUSDT', aliases: ['ada', 'cardano', 'كاردانو', 'أدا', 'adausd', 'ada/usd', 'adausdt'] },
  { canonical: 'ETHUSDT', aliases: ['eth', 'ethusdt', 'ethereum', 'إيثيريوم', 'اثيريوم', 'ethusd', 'eth/usd'] },
  { canonical: 'XRPUSDT', aliases: ['xrp', 'ripple', 'ريبل', 'اكس ار بي', 'إكس آر بي', 'xrpusd', 'xrp/usd'] },
  { canonical: 'XAUUSD', aliases: ['xauusd', 'xau', 'gold', 'ذهب', 'الذهب', 'دهب'] },
  { canonical: 'XAGUSD', aliases: ['xagusd', 'xag', 'silver', 'فضة', 'فضه', 'الفضة', 'سيلفر'] },
  { canonical: 'XTIUSD', aliases: ['xtiusd', 'wti', 'نفط', 'خام'] },
  { canonical: 'XBRUSD', aliases: ['xbrusd', 'برنت', 'brent'] },
  { canonical: 'EURUSD', aliases: ['eurusd', 'eur/usd', 'eur', 'يورو', 'يورو دولار', 'يورو/دولار'] },
  { canonical: 'GBPUSD', aliases: ['gbpusd', 'gbp/usd', 'gbp', 'استرليني', 'باوند', 'جنيه'] },
  { canonical: 'USDJPY', aliases: ['usdjpy', 'usd/jpy', 'jpy', 'ين', 'ين ياباني'] },
  { canonical: 'USDCHF', aliases: ['usdchf', 'usd/chf', 'chf', 'فرنك', 'فرنك سويسري'] },
  { canonical: 'USDCAD', aliases: ['usdcad', 'usd/cad', 'cad', 'كندي', 'دولار كندي'] },
  { canonical: 'AUDUSD', aliases: ['audusd', 'aud/usd', 'aud', 'استرالي', 'أسترالي', 'دولار استرالي', 'دولار أسترالي'] },
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
  // 1) Exact match of the whole string
  if (HARD_MAP[t]) return HARD_MAP[t];

  // 2) N-gram scan (prefer longer phrases) within the sentence
  // Split on whitespace only to keep tokens like eur/usd intact
  const words = t.split(/\s+/).filter(Boolean);
  // Create base form of words by stripping common Arabic clitics/prefixes
  const baseWords = words.map((w) => w
    .replace(/^(لل)/, "") // for-the -> remove
    .replace(/^(ال)/, "") // the-
    .replace(/^[لبوف]/, "") // leading single-letter prepositions/conjunctions: l, b, w, f
  );
  for (let n = Math.min(3, words.length); n >= 1; n -= 1) {
    for (let i = 0; i <= words.length - n; i += 1) {
      // Try original slice
      const sliceOrig = words.slice(i, i + n).join(" ");
      let mapped = HARD_MAP[sliceOrig];
      if (!mapped) {
        // Try base-words slice (without clitics)
        const sliceBase = baseWords.slice(i, i + n).join(" ");
        mapped = HARD_MAP[sliceBase];
      }
      if (mapped) return mapped;
    }
  }

  // 3) English pair patterns inside the text (eur/usd, eur usd, xauusd, btcusdt)
  const slashPair = t.match(/\b([a-z]{3})\s*\/\s*([a-z]{3,4})\b/);
  if (slashPair) {
    const lhs = slashPair[1].toUpperCase();
    const rhs = slashPair[2].toUpperCase();
    const combined = `${lhs}${rhs}`;
    if (/^[A-Z]{6,10}$/.test(combined)) return combined;
  }
  const compactPair = t.match(/\b([a-z]{6,10})\b/);
  if (compactPair) {
    const comp = compactPair[1].toUpperCase();
    if (/^[A-Z]{6,10}$/.test(comp)) return comp;
  }
  // 4) Last resort: strip non-letters and look for a 6-10 uppercase run inside
  const lettersOnly = t.replace(/[^a-z]/g, '').toUpperCase();
  const run = lettersOnly.match(/[A-Z]{6,10}/);
  if (run) return run[0];
  return null;
}

export function isCrypto(sym: string) {
  const upper = sym.toUpperCase();
  const CRYPTO_USD = new Set(['BTCUSD','ETHUSD','XRPUSD','LTCUSD','ADAUSD','SOLUSD','DOGEUSD','BNBUSD']);
  return upper.endsWith('USDT') || CRYPTO_USD.has(upper);
}

export function mapToFmpSymbol(sym: string): string {
  const upper = sym.toUpperCase();
  if (upper === "BTCUSDT") return "BTCUSD";
  if (upper === "ETHUSDT") return "ETHUSD";
  if (upper === "XRPUSDT") return "XRPUSD";
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
  
  // 1 minute patterns
  if (
    /(\b1\s*(m|min|minute)\b|\b1m\b|\b1\s*min\b|\bدقيقة\b|\bعلى دقيقة\b|\bعالدقيقة\b|\b1\s*دقيقة\b)/.test(t)
  )
    return "1min";
    
  // 5 minutes patterns  
  if (
    /(\b5\s*(m|min)\b|\b5m\b|\b٥\s*m\b|\b5\s*(دقايق|دقائق)\b|\b٥\s*(دقايق|دقائق)\b|\bخمس دقائق\b|\b5\s*دقايق\b)/.test(t)
  )
    return "5min";
    
  // 15 minutes patterns
  if (/(\b15\s*(m|min)?\b|\b15m\b|\b١٥\s*(دقيقة|دقايق)\b|\b15\s*(دقيقة|دقايق)\b|\bربع ساعة\b)/.test(t)) 
    return "15min";
    
  // 30 minutes patterns
  if (
    /(\b30\s*(m|min)?\b|\b30m\b|\b٣٠\s*(دقيقة|دقايق)\b|\b30\s*(دقيقة|دقايق)\b|\bنص ساعة\b|\bنصف ساعة\b)/.test(t)
  )
    return "30min";
    
  // 1 hour patterns
  if (/(\b1\s*(hour|h)\b|\b1h\b|\bساعة\b|\bساعه\b|\b1\s*ساعة\b|\bعالساعة\b)/.test(t)) 
    return "1hour";
    
  // 4 hours patterns
  if (/(\b4\s*(hour|h)\b|\b4h\b|\b٤\s*س\b|\b4\s*س\b|\bاربع ساعات\b|\b٤ ساعات\b|\b4\s*ساعات\b)/.test(t)) 
    return "4hour";
    
  // Daily patterns
  if (/(\b1d\b|\b1\s*day\b|\bdaily\b|\bday\b|\bيومي\b|\bيوم\b|\bعلى اليومي\b|\bعلى اليوم\b)/.test(t)) 
    return "1day";
    
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
