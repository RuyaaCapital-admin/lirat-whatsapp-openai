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

  const handlers: Array<{ pattern: RegExp; handler: (url: string) => Promise<any> | any }> = [];

  function registerHandler(pattern: RegExp, handler: (url: string) => Promise<any> | any) {
    handlers.push({ pattern, handler });
  }

  function clearHandlers() {
    handlers.length = 0;
  }

  axiosInstance.get = async (url: string) => {
    const match = handlers.find((entry) => entry.pattern.test(url));
    if (!match) {
      throw new Error(`Unhandled URL in test: ${url}`);
    }
    return await match.handler(url);
  };

  try {
    Date.now = () => fixedNow;

    clearHandlers();
    registerHandler(/financialmodelingprep/, () => ({
      data: [makeCandle(2, 1), makeCandle(1, 1.5), makeCandle(0.5, 2)],
    }));
    registerHandler(/fcsapi/, () => ({ data: { response: [] } }));
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
    clearHandlers();
    registerHandler(/financialmodelingprep/, () => ({ data: [recent] }));
    registerHandler(/fcsapi/, () => ({ data: { response: [] } }));
    const single = await ohlcModule.get_ohlc("XAUUSD", "1hour", 50);
    assert.strictEqual(single.candles.length, 1, "single candle response should be allowed");
    assert.strictEqual(
      single.candles[0].t,
      Math.floor(new Date(recent.date).getTime() / 1000),
    );

    clearHandlers();
    registerHandler(/financialmodelingprep/, () => ({
      data: [makeCandle(10, 1), makeCandle(9, 1.5), makeCandle(8, 2)],
    }));
    registerHandler(/fcsapi/, () => ({ data: { response: [] } }));
    const staleResult = await ohlcModule.get_ohlc("XAUUSD", "1hour", 100);
    assert.ok(staleResult.isStale, "older candles should be flagged as stale");

    clearHandlers();
    registerHandler(/financialmodelingprep/, () => ({
      data: [makeCandle(30 * 24, 1)],
    }));
    registerHandler(/fcsapi/, () => ({ data: { response: [] } }));
    const veryOld = await ohlcModule.get_ohlc("XAUUSD", "1hour", 100);
    assert.ok(veryOld.isStale, "very old data should still be marked stale");
    assert.ok(veryOld.ageMinutes >= 30 * 24 * 60, "ageMinutes should reflect actual age in minutes");

    clearHandlers();
    registerHandler(/fcsapi/, () => ({
      data: {
        response: [
          {
            time: new Date(fixedNow - 4 * 60 * 60 * 1000).toISOString(),
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
          },
        ],
      },
    }));
    registerHandler(/financialmodelingprep/, () => ({
      data: [
        {
          date: new Date(fixedNow - 2 * 60 * 1000).toISOString(),
          open: 100,
          high: 110,
          low: 95,
          close: 108,
        },
      ],
    }));
    const freshest = await ohlcModule.get_ohlc("BTCUSDT", "1min", 200);
    assert.strictEqual(freshest.provider, "FMP", "should pick freshest provider");
    assert.strictEqual(freshest.isStale, false, "fresh 1min candles should not be stale");
    assert.ok(freshest.ageMinutes <= 2, "ageMinutes should reflect the freshest provider age");
  } finally {
    clearHandlers();
    ohlcModule.__setOhlcHttpClient?.(null);
    axiosInstance.get = originalGet;
    Date.now = originalNow;
  }
}

runOhlcTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
