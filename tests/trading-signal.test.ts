import assert from "node:assert";

async function runTradingSignalTests() {
  const agentTools = await import("../src/tools/agentTools");
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);
  const originalNow = Date.now;

  try {
    Date.now = () => fixedNow;
    const hour = 60 * 60 * 1000;
    const freshCandles = [
      { o: 1990, h: 2005, l: 1985, c: 1998, t: fixedNow - 3 * hour },
      { o: 1998, h: 2010, l: 1990, c: 2004, t: fixedNow - 2 * hour },
      { o: 2004, h: 2018, l: 2000, c: 2012, t: fixedNow - hour },
      { o: 2012, h: 2020, l: 2005, c: 2010, t: fixedNow - 20 * 60 * 1000 },
    ];
    const result = await agentTools.compute_trading_signal("XAUUSD", "1hour", freshCandles);
    const latest = freshCandles[freshCandles.length - 1];
    const candidate =
      latest && fixedNow - latest.t < hour / 2 ? freshCandles[freshCandles.length - 2] ?? latest : latest;
    const candidateIso = new Date(candidate?.t ?? fixedNow).toISOString();
    const expectedLabel = `${candidateIso.slice(0, 10)} ${candidateIso.slice(11, 16)}`;

    assert.strictEqual(result.symbol, "XAUUSD");
    assert.strictEqual(result.timeframe, "1hour");
    assert.strictEqual(result.time, `${expectedLabel} UTC`);
    assert.strictEqual(result.stale, false, "recent candles should not be stale");
    if (result.decision !== "NEUTRAL") {
      assert.ok(Number.isFinite(result.entry));
      assert.ok(Number.isFinite(result.tp1));
      assert.ok(Number.isFinite(result.sl));
      assert.ok(Number.isFinite(result.tp2));
    } else {
      assert.strictEqual(result.entry, undefined);
      assert.strictEqual(result.tp1, undefined);
      assert.strictEqual(result.sl, undefined);
      assert.strictEqual(result.tp2, undefined);
    }
    assert.ok(result.candles_count >= freshCandles.length);
    assert.ok(Number.isFinite(result.indicators.rsi));

    const oldCandles = freshCandles.map((candle) => ({
      ...candle,
      t: candle.t - 10 * hour,
    }));
    const staleResult = await agentTools.compute_trading_signal("XAUUSD", "1hour", oldCandles);
    assert.strictEqual(staleResult.stale, true, "older candles should mark the signal as stale");
  } finally {
    Date.now = originalNow;
  }
}

runTradingSignalTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
