import assert from "node:assert";

async function runTradingSignalTests() {
  const agentTools = await import("../src/tools/agentTools");
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);
  const originalNow = Date.now;

  const hour = 60 * 60 * 1000;
  const candles = [
    { o: 1990, h: 2005, l: 1985, c: 1998, t: fixedNow - 3 * hour },
    { o: 1998, h: 2010, l: 1990, c: 2004, t: fixedNow - 2 * hour },
    { o: 2004, h: 2018, l: 2000, c: 2012, t: fixedNow - hour },
    { o: 2012, h: 2020, l: 2005, c: 2010, t: fixedNow - 20 * 60 * 1000 },
  ];

  try {
    Date.now = () => fixedNow;
    const result = await agentTools.compute_trading_signal("XAUUSD", "1hour", candles);
    const latest = candles[candles.length - 1];
    const candidate =
      latest && fixedNow - latest.t < hour / 2 ? candles[candles.length - 2] ?? latest : latest;
    const expectedTime = new Date(candidate?.t ?? fixedNow).toISOString();

    assert.strictEqual(result.symbol, "XAUUSD");
    assert.strictEqual(result.timeframe, "1hour");
    assert.strictEqual(result.last_closed_utc, expectedTime);
    assert.strictEqual(result.time, expectedTime);
    assert.strictEqual(result.entry, Number(candidate?.c ?? 0));
    assert.strictEqual(result.stale, false, "recent candles should not be stale");
  } finally {
    Date.now = originalNow;
  }
}

runTradingSignalTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
