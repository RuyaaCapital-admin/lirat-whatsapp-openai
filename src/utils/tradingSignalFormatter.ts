import type { TradingSignalOk } from "../tools/compute_trading_signal";

export type TradingSignalLanguage = "ar" | "en";

function formatPriceLike(value: number, symbol: string): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT")) {
    return value.toFixed(2);
  }
  if (abs >= 100) {
    return value.toFixed(2);
  }
  if (abs >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(3);
}

function formatSignalPrice(value: number | null | undefined, symbol: string): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }
  return formatPriceLike(value, symbol);
}

function formatIsoToDisplay(iso: string | null | undefined): string {
  if (typeof iso === "string" && iso.trim()) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      const yyyy = parsed.getUTCFullYear();
      const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getUTCDate()).padStart(2, "0");
      const hh = String(parsed.getUTCHours()).padStart(2, "0");
      const min = String(parsed.getUTCMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }
  }
  const fallback = new Date();
  const yyyy = fallback.getUTCFullYear();
  const mm = String(fallback.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(fallback.getUTCDate()).padStart(2, "0");
  const hh = String(fallback.getUTCHours()).padStart(2, "0");
  const min = String(fallback.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function delayedNeutralMessage(lang: TradingSignalLanguage): string {
  return lang === "ar"
    ? "مافي إشارة واضحة حالياً (البيانات متأخرة)."
    : "No clear signal right now (data is delayed).";
}

function staleWarning(ageMinutes: number, lang: TradingSignalLanguage): string {
  const rounded = Math.max(0, Math.round(ageMinutes));
  if (lang === "ar") {
    return `تنبيه: البيانات متأخرة ~${rounded} دقيقة`;
  }
  return `Warning: data is delayed by ~${rounded} minutes`;
}

export function formatTradingSignalWhatsapp({
  signal,
  lang,
}: {
  signal: TradingSignalOk;
  lang: TradingSignalLanguage;
}): string {
  const ageMinutes = Number.isFinite(signal.ageMinutes)
    ? Math.max(0, Math.round(signal.ageMinutes))
    : Math.max(0, Math.floor(signal.ageSeconds / 60));
  const iso = signal.lastTimeISO ?? signal.lastISO;
  const timeLabel = formatIsoToDisplay(iso);
  const stale = signal.isStale ?? signal.isDelayed;

  if (stale && signal.signal === "NEUTRAL") {
    return delayedNeutralMessage(lang);
  }

  const lines: string[] = [];
  if (stale) {
    lines.push(staleWarning(ageMinutes, lang));
  }
  lines.push(`time (UTC): ${timeLabel}`);
  lines.push(`symbol: ${signal.symbol}`);
  lines.push(`SIGNAL: ${signal.signal}`);
  if (signal.reason?.trim()) {
    lines.push(`Reason: ${signal.reason.trim()}`);
  }

  if (signal.signal !== "NEUTRAL") {
    lines.push(`Entry: ${formatSignalPrice(signal.entry, signal.symbol)}`);
    lines.push(`SL: ${formatSignalPrice(signal.sl, signal.symbol)}`);
    lines.push(`TP1: ${formatSignalPrice(signal.tp1, signal.symbol)}`);
    lines.push(`TP2: ${formatSignalPrice(signal.tp2, signal.symbol)}`);
  }

  return lines.join("\n");
}
