import assert from "node:assert";
import type { OhlcResult } from "../src/tools/ohlc";

async function runTradingSignalTests() {
  const agentTools = await import("../src/tools/agentTools");
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);
  const originalNow = Date.now;

  try {
    Date.now = () => fixedNow;
    const hour = 60 * 60 * 1000;
    const freshCandles = Array.from({ length: 60 }, (_, index) => ({
      o: 1990 + index,
      h: 2005 + index,
      l: 1985 + index,
      c: 1998 + index,
      t: Math.floor((fixedNow - (60 - index) * 5 * 60 * 1000) / 1000),
    }));
    const freshOhlc = {
      symbol: "XAUUSD",
      timeframe: "1hour" as const,
      candles: freshCandles,
      lastCandleUnix: freshCandles.at(-1)!.t,
      lastCandleISO: new Date(freshCandles.at(-1)!.t * 1000).toISOString(),
      ageSeconds: Math.floor((fixedNow / 1000) - freshCandles.at(-1)!.t),
      isStale: false,
      tooOld: false,
      provider: "TEST",
    } satisfies OhlcResult;
    const result = await agentTools.compute_trading_signal({ ...freshOhlc, lang: "en" });
    assert.strictEqual(result.status, "OK");
    assert.strictEqual(result.symbol, "XAUUSD");
    assert.strictEqual(result.timeframe, "1hour");
    assert.strictEqual(result.lastISO, freshOhlc.lastCandleISO);
    assert.strictEqual(result.isDelayed, false, "recent candles should not be delayed");
    if (result.signal !== "NEUTRAL") {
      assert.ok(Number.isFinite(result.entry ?? NaN));
      assert.ok(Number.isFinite(result.tp1 ?? NaN));
      assert.ok(Number.isFinite(result.sl ?? NaN));
      assert.ok(Number.isFinite(result.tp2 ?? NaN));
    } else {
      assert.strictEqual(result.entry, null);
      assert.strictEqual(result.tp1, null);
      assert.strictEqual(result.sl, null);
      assert.strictEqual(result.tp2, null);
    }

    const oldOhlc: OhlcResult = {
      ...freshOhlc,
      candles: freshCandles.map((candle) => ({ ...candle, t: candle.t - 10 * 60 * 60 })) ,
      lastCandleUnix: freshOhlc.lastCandleUnix - 10 * 60 * 60,
      lastCandleISO: new Date((freshOhlc.lastCandleUnix - 10 * 60 * 60) * 1000).toISOString(),
      ageSeconds: 10 * 60 * 60,
      isStale: true,
      tooOld: false,
    };
    const usable = await agentTools.compute_trading_signal({ ...oldOhlc, lang: "en" });
    assert.strictEqual(usable.status, "OK");
    assert.strictEqual(usable.isDelayed, true, "older candles should mark the signal as delayed");

    const tooOld: OhlcResult = { ...oldOhlc, tooOld: true, ageSeconds: 10 * 24 * 60 * 60 };
    const unusable = await agentTools.compute_trading_signal({ ...tooOld, lang: "en" });
    assert.strictEqual(unusable.status, "UNUSABLE");
  } finally {
    Date.now = originalNow;
  }
}

runTradingSignalTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
