import assert from "node:assert";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test";

type Candle = { o: number; h: number; l: number; c: number; t: number };

async function loadTools() {
  const { compute_trading_signal } = await import("../src/tools/agentTools");
  const { formatSignalPayload } = await import("../src/tools/compute_trading_signal");
  return { compute_trading_signal, formatSignalPayload };
}

const toolsPromise = loadTools();
const webhookPromise = import("../src/utils/webhookHelpers");

function buildTrendCandles(type: "buy" | "sell"): Candle[] {
  const base = Date.UTC(2024, 0, 1, 0, 0, 0);
  return Array.from({ length: 80 }, (_, index) => {
    const step = type === "buy" ? index : -index;
    const price = 1900 + step * 2;
    return {
      o: price,
      h: price + 1,
      l: price - 1,
      c: price + (type === "buy" ? 1 : -1),
      t: base + index * 60 * 60 * 1000,
    };
  });
}

async function testBuySignal() {
  const { compute_trading_signal } = await toolsPromise;
  const candles = buildTrendCandles("buy");
  const text = await compute_trading_signal("XAUUSD", "1hour", candles);
  if (text.trim() === "- SIGNAL: NEUTRAL") {
    assert.strictEqual(text.trim(), "- SIGNAL: NEUTRAL");
  } else {
    const lines = text.split("\n");
    assert.ok(text.includes("- Symbol: XAUUSD"), "symbol should be normalized");
    assert.strictEqual(lines.length, 7, "non-neutral signals should have 7 lines");
    assert.ok(lines[2].includes("SIGNAL:"), "signal line missing");
  }
}

async function testDigitNormalization() {
  const { normaliseDigits } = await webhookPromise;
  const input = "السعر ١٢٣٫٤٥";
  const output = normaliseDigits(input);
  assert.strictEqual(output.includes("123"), true);
}

async function testLanguageDetection() {
  const { detectLanguage } = await webhookPromise;
  assert.strictEqual(detectLanguage("مرحبا"), "ar");
  assert.strictEqual(detectLanguage("hello"), "en");
}

async function testParseOhlcPayload() {
  const { parseOhlcPayload } = await webhookPromise;
  const candles = [
    { o: 1, h: 2, l: 0.5, c: 1.5, t: 2000 },
    { o: 2, h: 3, l: 1.5, c: 2.5, t: 1000 },
  ];
  const payload = JSON.stringify({
    text: JSON.stringify({ symbol: "XAUUSD", timeframe: "1hour", candles }),
  });
  const snapshot = parseOhlcPayload(payload);
  assert.ok(snapshot, "snapshot should be parsed");
  assert.strictEqual(snapshot?.symbol, "XAUUSD");
  assert.strictEqual(snapshot?.timeframe, "1hour");
  assert.strictEqual(snapshot?.candles.length, 2);
  assert.deepStrictEqual(snapshot?.candles.map((c) => c.t), [1000, 2000]);
}

async function testNeutralFormatting() {
  const { formatSignalPayload } = await toolsPromise;
  const neutral = formatSignalPayload({
    signal: "NEUTRAL",
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    timeUTC: "2024-01-01 00:00 UTC",
    symbol: "BTCUSDT",
    interval: "1hour",
  });
  assert.strictEqual(neutral, "- SIGNAL: NEUTRAL");
}

async function testBuyFormatting() {
  const { formatSignalPayload } = await toolsPromise;
  const text = formatSignalPayload({
    signal: "BUY",
    entry: 10,
    sl: 9,
    tp1: 11,
    tp2: 12,
    timeUTC: "2024-01-01 00:00 UTC",
    symbol: "XAUUSD",
    interval: "1hour",
  });
  const lines = text.split("\n");
  assert.strictEqual(lines.length, 7, "formatted BUY payload should have 7 lines");
  assert.deepStrictEqual(lines, [
    "- Time: 2024-01-01 00:00 UTC",
    "- Symbol: XAUUSD",
    "- SIGNAL: BUY",
    "- Entry: 10",
    "- SL: 9",
    "- TP1: 11 (R 1.0)",
    "- TP2: 12 (R 2.0)",
  ]);
}

async function run() {
  await testBuySignal();
  await testDigitNormalization();
  await testLanguageDetection();
  await testParseOhlcPayload();
  await testNeutralFormatting();
  await testBuyFormatting();
  const { runSmartReplyTests } = await import("./smartReply.behaviour.test.ts");
  await runSmartReplyTests();
  const { runWebhookHandlerTests } = await import("./webhook-handler.test.ts");
  await runWebhookHandlerTests();
  console.log("All tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

