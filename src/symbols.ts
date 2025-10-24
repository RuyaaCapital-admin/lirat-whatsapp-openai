import { hardMapSymbol, forPriceSource, toTimeframe, normalizeArabic, isCrypto, type TF } from "./tools/normalize";

export type NormalisedSymbol = {
  /** Original user input */
  original: string;
  /** Normalised text (Arabic stripped) */
  normalized: string;
  /** Canonical symbol used internally (e.g. XAUUSD) */
  ohlcSymbol: string;
  /** Symbol formatted for price sources (e.g. XAU/USD) */
  pricePair: string;
  /** Whether the symbol should be routed to crypto providers */
  route: "crypto" | "forex";
  /** Timeframe derived from the query */
  timeframe: TF;
};

function fallbackSymbol(input: string): string {
  const upper = input.toUpperCase();
  if (/^[A-Z]{3}\/?[A-Z]{3,4}$/.test(upper)) {
    return upper.replace("/", "");
  }
  return upper;
}

export function normalise(raw: string, timeframeHint?: string): NormalisedSymbol {
  const original = raw ?? "";
  const normalized = normalizeArabic(original.toLowerCase());
  const canonical = hardMapSymbol(normalized) || hardMapSymbol(original) || fallbackSymbol(normalized || original || "");
  const ohlcSymbol = canonical.toUpperCase();
  const pricePair = forPriceSource(ohlcSymbol);
  const timeframe = timeframeHint ? toTimeframe(timeframeHint) : toTimeframe(original);
  const route = isCrypto(ohlcSymbol) ? "crypto" : "forex";

  return {
    original,
    normalized,
    ohlcSymbol,
    pricePair,
    route,
    timeframe,
  };
}

export type { TF } from "./tools/normalize";
