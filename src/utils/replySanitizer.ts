// src/utils/replySanitizer.ts
import type { LanguageCode } from "./webhookHelpers";

function normaliseForMatch(text: string): string {
  return text
    .replace(/[!؟?.,،:;\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const AR_GREETING_PATTERNS = [
  /^(?:مرحبا|مرحباً|اهلا|أهلاً|اهلاً وسهلاً|أهلاً وسهلاً|هلا)$/,
  /^السلام عليكم(?: ورحمة الله(?: وبركاته)?)?$/,
  /^صباح الخير$/,
  /^مساء الخير$/,
];

const EN_GREETING_PATTERNS = [
  /^(?:hi|hello|hey|hi there|hello there|greetings)$/,
  /^good (?:morning|evening|afternoon)$/,
  /^(?:morning|evening|afternoon)$/,
  /^peace be upon you$/,
  /^salam (?:alaikum|alaykum)$/,
];

const AR_LEADING_PATTERNS = [
  /^(?:مرحب(?:ا|اً)|اهلاً?|أهلاً?|هلا|السلام عليكم(?: ورحمة الله(?: وبركاته)?)?)[\s،!,.:;-]+/i,
  /^(?:صباح الخير|مساء الخير)[\s،!,.:;-]+/i,
];

const EN_LEADING_PATTERNS = [
  /^(?:hi|hello|hey|greetings|hi there|hello there)[\s,!.:;-]+/i,
  /^(?:good (?:morning|evening|afternoon)|morning|evening|afternoon)[\s,!.:;-]+/i,
  /^(?:peace be upon you|salam (?:alaikum|alaykum))[\s,!.:;-]+/i,
];

export function isGreetingOnly(text: string, lang: LanguageCode): boolean {
  const normalised = normaliseForMatch(text);
  if (!normalised) {
    return false;
  }
  const patterns = lang === "ar" ? AR_GREETING_PATTERNS : EN_GREETING_PATTERNS;
  return patterns.some((pattern) => pattern.test(normalised));
}

export function stripLeadingGreeting(text: string, lang: LanguageCode): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const patterns = lang === "ar" ? AR_LEADING_PATTERNS : EN_LEADING_PATTERNS;
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const remainder = trimmed.slice(match[0].length).trim();
      if (remainder) {
        return remainder;
      }
    }
  }
  return trimmed;
}

export function sanitizeAssistantReply(text: string, lang: LanguageCode): string {
  return stripLeadingGreeting(text, lang).trim();
}

export function greetingResponse(lang: LanguageCode): string {
  return lang === "ar" ? "كيف فيني ساعدك؟" : "How can I help?";
}

export { normaliseForMatch as _testNormalizeGreeting };
