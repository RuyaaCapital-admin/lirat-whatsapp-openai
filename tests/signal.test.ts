import assert from "node:assert";

async function runSignalModuleTests() {
  const ohlcModule = await import("../src/tools/ohlc");
  const signalModule = await import("../src/tools/compute_trading_signal");

  const { get_ohlc, __setOhlcHttpClient } = ohlcModule;
  const { compute_trading_signal } = signalModule;

  const originalNow = Date.now;
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);

  function restoreHttp() {
    ohlcModule.__setOhlcHttpClient?.(null);
  }

  try {
    Date.now = () => fixedNow;

    // BTCUSDT via FMP
    {
      const rows = Array.from({ length: 60 }, (_, idx) => {
        const offset = 60 - idx;
        const base = fixedNow - offset * 60_000;
        return {
          date: new Date(base).toISOString(),
          open: 43000 + offset * 10,
          high: 43050 + offset * 10,
          low: 42950 + offset * 10,
          close: 43020 + offset * 10,
        };
      });
      __setOhlcHttpClient({
        get: async (url: string) => {
          if (url.includes("historical-chart/1min/BTCUSD")) {
            return { data: rows };
          }
          return { data: { response: [] } };
        },
      } as any);

      const ohlc = await get_ohlc("BTCUSDT", "1min", 200);
      assert.strictEqual(ohlc.candles.length, rows.length, "should map all candles");
      const last = ohlc.candles.at(-1)!;
      const expectedLast = Math.floor((fixedNow - 60_000) / 1000);
      assert.strictEqual(last.t, expectedLast, "last timestamp must be seconds");

      const signal = compute_trading_signal({ ...ohlc, lang: "en" });
      assert.strictEqual(signal.status, "OK");
      const expectedIso = new Date(expectedLast * 1000).toISOString();
      assert.strictEqual(signal.lastISO, expectedIso, "signal timestamp should match last candle");
      assert.strictEqual(signal.symbol, "BTCUSDT");
    }
    restoreHttp();

    // XAGUSD via FCS neutral formatting
    {
      const nowSec = Math.floor(fixedNow / 1000);
      const interval = 5 * 60;
      const bars = Array.from({ length: 60 }, (_, idx) => {
        const timestamp = nowSec - interval * (60 - idx);
        return {
          t: timestamp,
          o: 24.1,
          h: 24.2,
          l: 24.0,
          c: 24.15,
        };
      });
      __setOhlcHttpClient({
        get: async (url: string) => {
          if (url.includes("forex/candle")) {
            return { data: { response: bars } };
          }
          return { data: [] };
        },
      } as any);

      const ohlc = await get_ohlc("XAGUSD", "5min", 200);
      const result = compute_trading_signal({ ...ohlc, lang: "en" });
      assert.strictEqual(result.status, "OK");
      assert.strictEqual(result.signal, "NEUTRAL");
      assert.strictEqual(result.entry, null, "neutral signal must omit entry");
      assert.strictEqual(result.sl, null, "neutral signal must omit stop");
      assert.strictEqual(result.tp1, null);
      assert.strictEqual(result.tp2, null);
      assert.ok(result.reason.length > 0, "neutral signal must include reason");
    }
    restoreHttp();

    // Too old data should still return marked stale
    {
      const staleRows = [1, 2, 3].map((offset) => {
        const base = fixedNow - offset * 36 * 60 * 60 * 1000;
        return {
          date: new Date(base).toISOString(),
          open: 1900 + offset,
          high: 1910 + offset,
          low: 1890 + offset,
          close: 1905 + offset,
        };
      });
      __setOhlcHttpClient({
        get: async () => ({ data: staleRows }),
      } as any);
      const ohlc = await get_ohlc("XAUUSD", "1hour", 200);
      assert.ok(ohlc.isStale, "stale dataset should be flagged");
      assert.ok(ohlc.ageMinutes >= 36 * 60, "ageMinutes should reflect stale age");
      const signal = compute_trading_signal({ ...ohlc, lang: "en" });
      assert.strictEqual(signal.status, "UNUSABLE");
    }
  } finally {
    restoreHttp();
    Date.now = originalNow;
  }
}

runSignalModuleTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
