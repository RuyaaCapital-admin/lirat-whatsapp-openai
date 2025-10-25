import assert from "node:assert";

async function runSignalModuleTests() {
  const ohlcModule = await import("../src/tools/ohlc");
  const signalModule = await import("../src/tools/compute_trading_signal");
  const formatters = await import("../src/utils/formatters");

  const { get_ohlc, __setOhlcHttpClient } = ohlcModule;
  const { compute_trading_signal } = signalModule;
  const { formatSignalMsg } = formatters;

  const originalNow = Date.now;
  const fixedNow = Date.UTC(2025, 0, 1, 12, 0, 0);

  function restoreHttp() {
    ohlcModule.__setOhlcHttpClient?.(null);
  }

  try {
    Date.now = () => fixedNow;

    // BTCUSDT via FMP
    {
      const rows = [
        3, 2, 1,
      ].map((offset) => {
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
          assert.ok(
            url.includes("historical-chart/1min/BTCUSD"),
            "FMP endpoint should be used for crypto",
          );
          return { data: rows };
        },
      } as any);

      const candles = await get_ohlc("BTCUSDT", "1min", 200);
      assert.strictEqual(candles.length, rows.length, "should map all candles");
      const last = candles.at(-1)!;
      const expectedLast = Math.floor((fixedNow - 60_000) / 1000);
      assert.strictEqual(last.t, expectedLast, "last timestamp must be seconds");

      const signal = compute_trading_signal("BTCUSDT", "1min", candles);
      const expectedIso = new Date(expectedLast * 1000).toISOString();
      const expectedLabel = `${expectedIso.slice(0, 10)} ${expectedIso.slice(11, 16)} UTC`;
      assert.strictEqual(signal.time, expectedLabel, "signal time should match last closed candle");
      assert.strictEqual(signal.symbol, "BTCUSDT");
    }
    restoreHttp();

    // XAGUSD via FCS neutral formatting
    {
      const nowSec = Math.floor(fixedNow / 1000);
      const interval = 5 * 60;
      const bars = Array.from({ length: 5 }, (_, idx) => {
        const timestamp = nowSec - interval * (5 - idx);
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
          assert.ok(url.includes("forex/candle"), "FCS endpoint should be hit for metals");
          return { data: { response: bars } };
        },
      } as any);

      const candles = await get_ohlc("XAGUSD", "5min", 200);
      const result = compute_trading_signal("XAGUSD", "5min", candles);
      assert.strictEqual(result.decision, "NEUTRAL");
      const formatted = formatSignalMsg({
        decision: result.decision,
        entry: result.entry,
        sl: result.sl,
        tp1: result.tp1,
        tp2: result.tp2,
        time: result.time,
        symbol: result.symbol,
        reason: result.reason,
      });
      assert.ok(!formatted.includes("Entry:"), "neutral message must omit entry line");
      assert.ok(formatted.includes("Reason:"), "neutral message must include reason");
    }
    restoreHttp();

    // Stale data should throw
    {
      const staleRows = [1, 2, 3].map((offset) => {
        const base = fixedNow - offset * 12 * 60 * 60 * 1000;
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
      await assert.rejects(
        get_ohlc("XAUUSD", "1hour", 200),
        (error: any) => error?.code === "STALE_DATA",
        "stale candles should raise STALE_DATA",
      );
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
