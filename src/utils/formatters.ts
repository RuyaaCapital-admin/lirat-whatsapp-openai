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
  entry?: number | null;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  time: string | number | Date;
  symbol: string;
  reason?: string;
}

function normalizeNumeric(value: number | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatSignalPrice(value: number | null, symbol: string): string {
  if (value == null) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const upper = symbol.toUpperCase();
  const abs = Math.abs(numeric);
  const decimals = upper.endsWith("USDT")
    ? 2
    : abs >= 100
      ? 2
      : abs >= 10
        ? 3
        : 4;
  return numeric.toFixed(decimals);
}

function formatRiskRatio(entry: number | null, target: number | null, stop: number | null): string {
  if (!Number.isFinite(entry) || !Number.isFinite(target) || !Number.isFinite(stop)) {
    return "";
  }
  const risk = Math.abs((entry as number) - (stop as number));
  if (!Number.isFinite(risk) || risk === 0) {
    return "";
  }
  const reward = Math.abs((target as number) - (entry as number));
  if (!Number.isFinite(reward) || reward === 0) {
    return "";
  }
  const ratio = reward / risk;
  return `(R ${ratio.toFixed(1)})`;
}

export function formatSignalMsg(input: SignalMessageInput): string {
  const label = formatUtcLabel(input.time);
  const symbol = input.symbol;
  const decision = input.decision;
  const reason =
    (typeof input.reason === "string" && input.reason.trim()) ||
    (decision === "NEUTRAL" ? "No clear momentum / structure." : "Momentum bias");
  const lines: string[] = [decision, "", `Time (UTC): ${label}`, `Symbol: ${symbol}`, `SIGNAL: ${decision}`];

  if (decision === "NEUTRAL") {
    lines.push(`Reason: ${reason}`);
    return lines.join("\n");
  }

  const entryValue = normalizeNumeric(input.entry);
  const slValue = normalizeNumeric(input.sl);
  const tp1Value = normalizeNumeric(input.tp1);
  const tp2Value = normalizeNumeric(input.tp2);

  lines.push(`Entry: ${formatSignalPrice(entryValue, symbol)}`);
  lines.push(`SL: ${formatSignalPrice(slValue, symbol)}`);

  const tp1Ratio = formatRiskRatio(entryValue, tp1Value, slValue);
  const tp2Ratio = formatRiskRatio(entryValue, tp2Value, slValue);

  const tp1Label = formatSignalPrice(tp1Value, symbol);
  const tp2Label = formatSignalPrice(tp2Value, symbol);

  lines.push(tp1Ratio ? `TP1: ${tp1Label} ${tp1Ratio}` : `TP1: ${tp1Label}`);
  lines.push(tp2Ratio ? `TP2: ${tp2Label} ${tp2Ratio}` : `TP2: ${tp2Label}`);
  lines.push(`Reason: ${reason}`);

  return lines.join("\n");
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
