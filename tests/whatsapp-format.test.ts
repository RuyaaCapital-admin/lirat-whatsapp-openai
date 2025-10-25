import assert from "node:assert";

import { formatTradingSignalWhatsapp } from "../src/utils/tradingSignalFormatter";
import type { TradingSignalOk } from "../src/tools/compute_trading_signal";

function makeSignal(overrides: Partial<TradingSignalOk> = {}): TradingSignalOk {
  return {
    status: "OK",
    lang: "ar",
    symbol: "BTCUSDT",
    timeframe: "1min",
    signal: "BUY",
    entry: 111404,
    sl: 111372.2,
    tp1: 111435.8,
    tp2: 111467.61,
    reason: "ضغط شراء فوق المتوسطات",
    lastISO: "2025-10-25T12:59:00Z",
    lastTimeISO: "2025-10-25T12:59:00Z",
    ageSeconds: 60,
    ageMinutes: 1,
    isDelayed: false,
    isStale: false,
    provider: "FMP",
    ...overrides,
  };
}

async function runWhatsappFormatTests() {
  {
    const signal = makeSignal();
    const text = formatTradingSignalWhatsapp({ signal, lang: "ar" });
    assert.ok(!text.includes("Data age"), "fresh signal must not include data age");
    assert.ok(!text.startsWith("تنبيه"), "fresh signal must not start with warning");
    assert.ok(text.includes("time (UTC): 2025-10-25 12:59"), "should format timestamp");
  }

  {
    const signal = makeSignal({ signal: "NEUTRAL", entry: null, sl: null, tp1: null, tp2: null, isStale: true, ageMinutes: 241, isDelayed: true });
    const text = formatTradingSignalWhatsapp({ signal, lang: "ar" });
    assert.strictEqual(text, "مافي إشارة واضحة حالياً (البيانات متأخرة).", "stale neutral should collapse to one line");
  }

  {
    const signal = makeSignal({ signal: "SELL", isStale: true, isDelayed: true, ageMinutes: 241 });
    const text = formatTradingSignalWhatsapp({ signal, lang: "ar" });
    const [firstLine] = text.split("\n");
    assert.strictEqual(firstLine, "تنبيه: البيانات متأخرة ~241 دقيقة", "stale warning must be first line");
    assert.ok(text.includes("SIGNAL: SELL"), "should include signal block");
  }

  console.log("whatsapp format tests passed");
}

runWhatsappFormatTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
