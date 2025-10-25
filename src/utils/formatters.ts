import { strict as assert } from "node:assert";

function ensureDate(input: string | number | Date): Date {
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === "number") {
    const ms = input > 10_000_000_000 ? input : input * 1000;
    return new Date(ms);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    // Accept timestamps like "2024-05-01 10:00" (assumed UTC)
    const normalised = trimmed.replace(/\s+/, "T") + "Z";
    const alt = new Date(normalised);
    if (!Number.isNaN(alt.getTime())) {
      return alt;
    }
  }
  throw new Error("INVALID_DATE_INPUT");
}

export function formatUtcLabel(input: string | number | Date): string {
  const date = ensureDate(input);
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

export interface PriceMessageInput {
  symbol: string;
  price: number;
  timeUTC: string | number | Date;
  source: string;
}

function formatNumber(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
}

export function formatPriceMsg({ symbol, price, timeUTC, source }: PriceMessageInput): string {
  assert(symbol && typeof symbol === "string", "symbol required");
  assert(Number.isFinite(price), "price must be finite");
  const label = formatUtcLabel(timeUTC);
  const rounded = formatNumber(price);
  const sourceLabel = typeof source === "string" && source.trim() ? source.trim() : "FCS latest";
  return [
    `Time (UTC): ${label}`,
    `Symbol: ${symbol}`,
    `Price: ${rounded}`,
    `Source: ${sourceLabel}`,
  ].join("\n");
}

export interface SignalMessageInput {
  decision: "BUY" | "SELL" | "NEUTRAL";
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  time: string | number | Date;
  symbol: string;
}

export function formatSignalMsg(input: SignalMessageInput): string {
  const label = formatUtcLabel(input.time);
  const entry = formatNumber(input.entry);
  const sl = formatNumber(input.sl);
  const tp1 = formatNumber(input.tp1);
  const tp2 = formatNumber(input.tp2);
  return [
    `Time (UTC): ${label}`,
    `Symbol: ${input.symbol}`,
    `SIGNAL: ${input.decision}`,
    `Entry: ${entry}`,
    `SL: ${sl}`,
    `TP1: ${tp1}`,
    `TP2: ${tp2}`,
  ].join("\n");
}

export interface NewsRow {
  date: string | number | Date;
  source: string;
  title: string;
}

export function formatNewsMsg(rows: NewsRow[], bulletPrefix = "* "): string {
  return rows
    .filter((row) => row && row.title && row.source)
    .slice(0, 3)
    .map((row) => {
      const dateLabel = formatUtcLabel(row.date);
      const datePart = dateLabel.slice(0, 10);
      return `${bulletPrefix}${datePart} — ${row.source} — ${row.title}`;
    })
    .join("\n");
}
