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

function formatPriceValue(value: number): string {
  return formatNumber(value).toFixed(2);
}

export function formatPriceMsg({ symbol, price, timeUTC, source }: PriceMessageInput): string {
  assert(symbol && typeof symbol === "string", "symbol required");
  assert(Number.isFinite(price), "price must be finite");
  const label = formatUtcLabel(timeUTC);
  const rounded = formatPriceValue(price);
  const sourceLabel = typeof source === "string" && source.trim() ? source.trim() : "FCS";
  return [
    `time (UTC): ${label}`,
    `symbol: ${symbol}`,
    `price: ${rounded}`,
    `source: ${sourceLabel}`,
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

function formatRiskRatio(entry: number, target: number, stop: number): string {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(entry - target);
  if (!Number.isFinite(risk) || risk === 0 || !Number.isFinite(reward)) {
    return "";
  }
  const ratio = reward / risk;
  return `(R ${ratio.toFixed(1)})`;
}

export function formatSignalMsg(input: SignalMessageInput): string {
  const label = formatUtcLabel(input.time);
  const entry = formatNumber(input.entry).toFixed(2);
  const sl = formatNumber(input.sl).toFixed(2);
  const tp1 = formatNumber(input.tp1).toFixed(2);
  const tp2 = formatNumber(input.tp2).toFixed(2);
  const tp1Ratio = formatRiskRatio(Number(entry), Number(tp1), Number(sl));
  const tp2Ratio = formatRiskRatio(Number(entry), Number(tp2), Number(sl));
  const tp1Line = tp1Ratio ? `TP1: ${tp1} ${tp1Ratio}` : `TP1: ${tp1}`;
  const tp2Line = tp2Ratio ? `TP2: ${tp2} ${tp2Ratio}` : `TP2: ${tp2}`;
  return [
    `time (UTC): ${label}`,
    `symbol: ${input.symbol}`,
    `SIGNAL: ${input.decision}`,
    `Entry: ${entry}`,
    `SL: ${sl}`,
    tp1Line,
    tp2Line,
  ].join("\n");
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
      const impact = typeof (row as any).impact === "string" && (row as any).impact.trim()
        ? ` — ${(row as any).impact.trim()}`
        : "";
      return `${datePart} — ${row.source} — ${row.title}${impact}`;
    })
    .join("\n");
}
