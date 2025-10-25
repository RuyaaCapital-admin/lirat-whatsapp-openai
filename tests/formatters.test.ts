import assert from "node:assert";

import { formatPriceMsg, formatSignalMsg, formatNewsMsg } from "../src/utils/formatters";

testPrice();
testSignal();
testNews();

async function testPrice() {
  const text = formatPriceMsg({ symbol: "XAGUSD", price: 48.6385, timeUTC: "2025-10-24T17:44:00Z" });
  assert.strictEqual(
    text,
    "- Time (UTC): 2025-10-24 17:44\n- Symbol: XAGUSD\n- Price: 48.6385",
    "price formatter must match spec",
  );
}

async function testSignal() {
  const block = formatSignalMsg({
    decision: "SELL",
    entry: 4062.445,
    sl: 4083.34,
    tp1: 4041.54,
    tp2: 4020.65,
    time: "2025-10-24T13:00:00Z",
    symbol: "XAUUSD",
    interval: "1hour",
  });
  assert.strictEqual(
    block,
    [
      "- Time (UTC): 2025-10-24 13:00",
      "- Symbol: XAUUSD (1hour)",
      "- SIGNAL: SELL",
      "- Entry: 4062.445",
      "- SL: 4083.34",
      "- TP1: 4041.54",
      "- TP2: 4020.65",
    ].join("\n"),
    "signal block must include 7 lines",
  );

  const neutral = formatSignalMsg({
    decision: "NEUTRAL",
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    time: "2025-10-24T13:00:00Z",
    symbol: "XAUUSD",
    interval: "1hour",
  });
  assert.strictEqual(
    neutral,
    "- Time (UTC): 2025-10-24 13:00\n- Symbol: XAUUSD (1hour)\n- SIGNAL: NEUTRAL",
    "neutral block should be 3 lines",
  );
}

async function testNews() {
  const news = formatNewsMsg([
    { date: "2025-10-24T00:00:00Z", source: "Reuters", title: "Headline 1" },
    { date: "2025-10-23T00:00:00Z", source: "CNBC", title: "Headline 2" },
  ]);
  assert.strictEqual(
    news,
    "2025-10-24 — Reuters — Headline 1\n2025-10-23 — CNBC — Headline 2",
    "news formatter trims to three lines",
  );
}
