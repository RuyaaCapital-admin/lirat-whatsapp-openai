import assert from "node:assert";
import { alreadyHandled } from "../src/idempotency";
import { normalise } from "../src/symbols";
import { formatPriceBlock, formatSignalBlock } from "../src/format";
import { computeSignal, type Candle } from "../src/signal";

// idempotency guard
const id = "msg-1";
assert.strictEqual(alreadyHandled(id), false, "first occurrence should not be flagged");
assert.strictEqual(alreadyHandled(id), true, "second occurrence must be flagged");

// normalisation
const norm = normalise("xauusd");
assert.strictEqual(norm.pricePair, "XAU/USD");
assert.strictEqual(norm.ohlcSymbol, "XAUUSD");

// price formatter
const priceBlock = formatPriceBlock({ symbol: "XAU/USD", timestamp: 1_700_000_000, price: 1950.12345, note: "latest CLOSED price" });
const priceLines = priceBlock.split("\n");
assert.strictEqual(priceLines.length, 4);
assert.ok(priceLines[0].startsWith("Time (UTC): "));
assert.strictEqual(priceLines[1], "Symbol: XAU/USD");
assert.strictEqual(priceLines[2], "Price: 1950.12");
assert.strictEqual(priceLines[3], "Note: latest CLOSED price");

// signal formatting
const candles: Candle[] = [];
let base = 100;
for (let i = 0; i < 120; i++) {
  base += 0.3;
  const o = base - 0.1;
  const c = base + 0.1;
  candles.push({
    t: 1_700_000_000 + i * 900,
    o,
    h: c + 0.2,
    l: o - 0.2,
    c,
  });
}
const signal = computeSignal("XAUUSD", "15m", candles);
const signalBlock = formatSignalBlock({ symbol: "XAUUSD", interval: "15m", candles, signal });
const signalLines = signalBlock.split("\n");
assert.strictEqual(signalLines[0].startsWith("Time (UTC):"), true);
assert.strictEqual(signalLines[1], "Symbol: XAUUSD");
assert.strictEqual(signalLines[2], "Interval: 15m");
assert.strictEqual(signalLines[4].startsWith("Close:"), true);
assert.strictEqual(signalLines[6].includes("EMA20"), true);
assert.ok(signalLines.some((line) => line.startsWith("SIGNAL:")), "Signal line missing");

console.log("All integration tests passed");
