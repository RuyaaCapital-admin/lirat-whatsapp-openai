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
}

export function formatPriceMsg({ symbol, price, timeUTC }: PriceMessageInput): string {
  assert(symbol && typeof symbol === "string", "symbol required");
  assert(Number.isFinite(price), "price must be finite");
  const label = formatUtcLabel(timeUTC);
  const rounded = Number(price);
  return [`- Time (UTC): ${label}`, `- Symbol: ${symbol}`, `- Price: ${rounded}`].join("\n");
}

export interface SignalMessageInput {
  decision: "BUY" | "SELL" | "NEUTRAL";
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  time: string | number | Date;
  symbol: string;
  interval: string;
}

export function formatSignalMsg(input: SignalMessageInput): string {
  const label = formatUtcLabel(input.time);
  const header = [`- Time (UTC): ${label}`, `- Symbol: ${input.symbol} (${input.interval})`, `- SIGNAL: ${input.decision}`];
  if (input.decision === "NEUTRAL") {
    return header.join("\n");
  }
  assert(Number.isFinite(input.entry), "entry required for non-neutral");
  assert(Number.isFinite(input.sl), "sl required for non-neutral");
  assert(Number.isFinite(input.tp1), "tp1 required for non-neutral");
  assert(Number.isFinite(input.tp2), "tp2 required for non-neutral");
  return header
    .concat([
      `- Entry: ${Number(input.entry)}`,
      `- SL: ${Number(input.sl)}`,
      `- TP1: ${Number(input.tp1)}`,
      `- TP2: ${Number(input.tp2)}`,
    ])
    .join("\n");
}

export interface NewsRow {
  date: string | number | Date;
  source: string;
  title: string;
}

export function formatNewsMsg(rows: NewsRow[]): string {
  return rows
    .filter((row) => row && row.title && row.source)
    .slice(0, 3)
    .map((row) => {
      const dateLabel = formatUtcLabel(row.date);
      const datePart = dateLabel.slice(0, 10);
      return `${datePart} — ${row.source} — ${row.title}`;
    })
    .join("\n");
}
