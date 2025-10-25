import assert from "node:assert";
import { signalFormatter, priceFormatter, type SignalFormatterInput } from "../src/utils/formatters";

async function runWhatsappFormatTests() {
  function makeSignal(overrides: Partial<SignalFormatterInput> = {}): SignalFormatterInput {
    return {
      symbol: "BTCUSDT",
      timeframe: "5min",
      timeUTC: "2025-10-25 12:55",
      decision: "BUY",
      reason: "bullish_pressure",
      levels: { entry: 111404, sl: 111372.2, tp1: 111435.8, tp2: 111467.61 },
      stale: false,
      ageMinutes: 2,
      ...overrides,
    };
  }

  const english = signalFormatter(makeSignal(), "en");
  assert.ok(english.includes("SIGNAL: BUY"));
  assert.ok(english.includes("timeframe: 5min"));
  assert.ok(english.includes("Reason: Buy pressure above short-term averages"));

  const arabicStale = signalFormatter(makeSignal({ stale: true, ageMinutes: 244 }), "ar");
  assert.ok(arabicStale.startsWith("تنبيه: البيانات متأخرة بحوالي 244 دقيقة"));
  assert.ok(arabicStale.includes("السبب: ضغط شراء فوق المتوسطات (إشارة قديمة، للمراجعة فقط)"));

  const neutral = signalFormatter(
    makeSignal({ decision: "NEUTRAL", reason: "no_clear_bias", levels: { entry: null, sl: null, tp1: null, tp2: null } }),
    "en",
  );
  assert.ok(neutral.includes("SIGNAL: NEUTRAL"));
  assert.ok(neutral.includes("Entry: -"));

  const priceEn = priceFormatter({ symbol: "XAUUSD", price: 2375.2, timeISO: "2025-10-25T12:59:00Z" }, "en");
  assert.ok(priceEn.includes("price: 2375.20"));
  const priceAr = priceFormatter({ symbol: "XAGUSD", price: 48.61, timeISO: "2025-10-25T12:59:00Z" }, "ar");
  assert.ok(priceAr.includes("السعر: 48.61"));
}

runWhatsappFormatTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
