// src/tools/symbol.ts
import { normalizeArabic, hardMapSymbol, isCrypto } from './normalize';

export type Canonical = 'XAUUSD'|'XAGUSD'|'EURUSD'|'GBPUSD'|'BTCUSDT'|string;

type IntentMatch = {
  symbol?: Canonical;
  timeframe?: '1min'|'5min'|'15min'|'30min'|'1hour'|'4hour'|'daily';
  wantsPrice: boolean;
  wantsSignal: boolean;
  wantsNews: boolean;
  route?: 'forex' | 'crypto';
};

const SIGNAL_RE = /(صفقة|اشارة|إشارة|تحليل|signal|analysis|buy|sell|long|short)/i;
const PRICE_RE = /(سعر|price|quote|كم|قديش|قيمة)/i;
const NEWS_RE = /(خبر|أخبار|اخبار|news)/i;

const SYMBOL_PATTERNS: Array<{ regex: RegExp; symbol: Canonical }> = [
  { regex: /\b(بيتكوين|بتكوين|btc)\b/i, symbol: 'BTCUSDT' },
  { regex: /\b(إيثيريوم|اثيريوم|eth)\b/i, symbol: 'ETHUSDT' },
  { regex: /\b(ذهب|دهب|gold|xau)\b/i, symbol: 'XAUUSD' },
  { regex: /\b(فضة|سيلفر|silver|xag)\b/i, symbol: 'XAGUSD' },
  { regex: /\b(برنت|brent)\b/i, symbol: 'XBRUSD' },
  { regex: /\b(نفط|خام|wti)\b/i, symbol: 'XTIUSD' },
  { regex: /\b(يورو|eur)\b/i, symbol: 'EURUSD' },
  { regex: /\b(استرليني|جنيه|gbp)\b/i, symbol: 'GBPUSD' },
  { regex: /\b(ين|ين ياباني|jpy)\b/i, symbol: 'USDJPY' },
  { regex: /\b(فرنك|chf)\b/i, symbol: 'USDCHF' },
  { regex: /\b(كندي|cad)\b/i, symbol: 'USDCAD' },
  { regex: /\b(استرالي|أسترالي|aud)\b/i, symbol: 'AUDUSD' },
  { regex: /\b(نيوزلندي|nzd)\b/i, symbol: 'NZDUSD' },
];

function extractTimeframe(text: string): IntentMatch['timeframe'] {
  if (/(^|\s)(1 ?min|1m|دقيقة|عالدقيقة)(?=$|\s)/i.test(text)) return '1min';
  if (/(^|\s)(5 ?min|5m|٥ ?دقائق|٥ ?دقايق|5 ?دقائق)(?=$|\s)/i.test(text)) return '5min';
  if (/(^|\s)(15 ?min|15m|ربع|١٥ ?دقيقة)(?=$|\s)/i.test(text)) return '15min';
  if (/(^|\s)(30 ?min|30m|نص ساعة|نصف ساعة)(?=$|\s)/i.test(text)) return '30min';
  if (/(^|\s)(1 ?hour|1h|ساعة|ساعه)(?=$|\s)/i.test(text)) return '1hour';
  if (/(^|\s)(4 ?hour|4h|٤ ?ساعات|اربع ساعات)(?=$|\s)/i.test(text)) return '4hour';
  if (/(^|\s)(daily|يومي|يوم)(?=$|\s)/i.test(text)) return 'daily';
  return undefined;
}

function findSymbol(text: string): Canonical | undefined {
  const mapped = hardMapSymbol(text);
  if (mapped) return mapped;
  for (const { regex, symbol } of SYMBOL_PATTERNS) {
    if (regex.test(text)) return symbol;
  }
  return undefined;
}

export function parseIntent(input: string): IntentMatch {
  const normalized = normalizeArabic(input.toLowerCase());
  console.log('[PARSE] Input text:', input);
  console.log('[PARSE] Normalized text:', normalized);

  const wantsSignal = SIGNAL_RE.test(normalized);
  const wantsPrice = PRICE_RE.test(normalized);
  const wantsNews = NEWS_RE.test(normalized);

  const symbol = findSymbol(normalized);
  const timeframe = extractTimeframe(normalized);

  const finalTimeframe = timeframe ?? (wantsSignal ? '1hour' : wantsPrice ? '1min' : undefined);
  const route = symbol ? (isCrypto(symbol) ? 'crypto' : 'forex') : undefined;

  console.log('[PARSE] wantsSignal:', wantsSignal, 'wantsPrice:', wantsPrice, 'wantsNews:', wantsNews);
  console.log('[PARSE] Detected symbol:', symbol, 'timeframe:', finalTimeframe, 'route:', route);

  return { symbol, timeframe: finalTimeframe, wantsPrice, wantsSignal, wantsNews, route };
}
