import assert from "node:assert";

async function runOhlcTests() {
  const axiosModule = await import("axios");
  const ohlcModule = await import("../src/tools/ohlc");
  const axiosInstance: any = axiosModule.default ?? axiosModule;
  const originalGet = axiosInstance.get;
  const originalNow = Date.now;
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);

  function makeCandle(dateOffsetHours: number, base = 1) {
    const time = new Date(fixedNow - dateOffsetHours * 60 * 60 * 1000).toISOString();
    return {
      date: time,
      open: base,
      high: base + 1,
      low: base - 0.5,
      close: base + 0.5,
    };
  }

  try {
    Date.now = () => fixedNow;

    axiosInstance.get = async () => ({
      data: [makeCandle(2, 1), makeCandle(1, 1.5), makeCandle(0.5, 2)],
    });
    ohlcModule.__setOhlcHttpClient?.(axiosInstance);
    const fresh = await ohlcModule.get_ohlc("XAUUSD", "1hour", 100);
    assert.ok(Array.isArray(fresh.candles) && fresh.candles.length === 3, "should normalise candles");
    assert.strictEqual(fresh.symbol, "XAUUSD");
    assert.strictEqual(fresh.timeframe, "1hour");
    const timestamps = fresh.candles.map((candle: any) => candle.t);
    assert.deepStrictEqual(timestamps, [...timestamps].sort((a, b) => a - b), "candles should be sorted");
    const expectedTimes = [makeCandle(2, 1), makeCandle(1, 1.5), makeCandle(0.5, 2)].map((c) => Math.floor(new Date(c.date).getTime() / 1000));
    assert.deepStrictEqual(timestamps, expectedTimes.sort((a, b) => a - b), "timestamps must be seconds");
    assert.strictEqual(fresh.lastCandleUnix, timestamps.at(-1));
    assert.ok(typeof fresh.lastCandleISO === "string" && fresh.lastCandleISO.endsWith("Z"));

    const recent = makeCandle(0.1, 3);
    axiosInstance.get = async () => ({ data: [recent] });
    const single = await ohlcModule.get_ohlc("XAUUSD", "1hour", 50);
    assert.strictEqual(single.candles.length, 1, "single candle response should be allowed");
    assert.strictEqual(
      single.candles[0].t,
      Math.floor(new Date(recent.date).getTime() / 1000),
    );

    axiosInstance.get = async () => ({
      data: [makeCandle(10, 1), makeCandle(9, 1.5), makeCandle(8, 2)],
    });
    const staleResult = await ohlcModule.get_ohlc("XAUUSD", "1hour", 100);
    assert.ok(staleResult.isStale, "older candles should be flagged as stale");

    axiosInstance.get = async () => ({
      data: [makeCandle(30 * 24, 1)],
    });
    await assert.rejects(
      ohlcModule.get_ohlc("XAUUSD", "1hour", 100),
      (error: any) => error?.code === "NO_DATA",
      "too old data should reject with NO_DATA",
    );
  } finally {
    ohlcModule.__setOhlcHttpClient?.(null);
    axiosInstance.get = originalGet;
    Date.now = originalNow;
  }
}

runOhlcTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
