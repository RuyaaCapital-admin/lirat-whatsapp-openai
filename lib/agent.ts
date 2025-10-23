import { Agent, Runner, fileSearchTool, tool } from "@openai/agents";
import { z } from "zod";
import { fetchLatestPrice } from "../src/tools/price";
import { fetchOhlc } from "../src/tools/ohlc";
import { computeSignal, type Candle, type TF } from "../src/signal";
import { env } from "../src/env";

const getPrice = tool({
  name: "get_price",
  description: "Fetch the latest closed price for a slash pair (e.g., XAU/USD). Returns { ok, data }.",
  parameters: z.object({ symbol: z.string() }),
  execute: async ({ symbol }) => fetchLatestPrice(symbol),
});

const getOhlc = tool({
  name: "get_ohlc",
  description: "Fetch OHLC candles for a normalized symbol without slash (e.g., XAUUSD) and timeframe.",
  parameters: z.object({
    symbol: z.string(),
    interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const),
  }),
  execute: async ({ symbol, interval }) => fetchOhlc(symbol, interval as TF),
});

const computeTradingSignal = tool({
  name: "compute_trading_signal",
  description: "Compute EMA20/EMA50/RSI14/MACD/ATR signal from OHLC candles.",
  parameters: z.object({
    symbol: z.string(),
    interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const),
    candles: z.array(
      z.object({ t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number() })
    ),
  }),
  execute: async ({ symbol, interval, candles }) => {
    const signal = computeSignal(symbol, interval as TF, candles as Candle[]);
    return { symbol, interval, signal };
  },
});

const fileSearch = fileSearchTool(["vs_68f9b61c2ae48191be99dad2c614f9f2"]);

const instructions = `Liirat Trading Agent — v6
- أنت مساعد تداول مختص من Liirat. رد دائمًا بالعربية الفصحى المختصرة (≤8 أسطر) وبدون روابط.
- لا تستخدم file_search إلا إذا سأل المستخدم صراحة عن Liirat أو الوثائق.

[Price intent]
- إذا طلب المستخدم \"سعر\" أو \"price\" لرمز ما فاعتبرها PRICE INTENT.
- طبّع الرمز إلى صيغة slash pair (مثل XAU/USD).
- استدع get_price مرة واحدة فقط. لا تطلب إطارًا زمنيًا.
- إذا ok=false فاشرح الخطأ بجملة عربية قصيرة.
- إذا ok=true فأعرض كتلة PRICE بالشكل التالي بدون أي تعليق إضافي:
  Time (UTC): HH:MM\n  Symbol: SYMBOL\n  Price: VALUE\n  Note: latest CLOSED price

[Signal intent]
- أي طلب لإشارة/صفقة/تحليل أو ذكر إطار زمني => SIGNAL INTENT.
- الإطار الافتراضي 15m إن لم يحدده المستخدم. طبّع الرمز إلى صيغة بدون slash.
- استدع get_ohlc (بالرمز بدون slash) ثم compute_trading_signal بنفس الإطار.
- إذا فشل أي أداة فاشرح السبب بجملة عربية قصيرة.
- إذا نجحت جميعها فأنشئ كتلة SIGNAL بالضبط كما يلي:
  Time (UTC): HH:MM\n  Symbol: SYMBOL\n  Interval: TF\n  Last closed: YYYYMMDD_HH:MM UTC\n  Close: …\n  Prev: …\n  EMA20: …  EMA50: …  RSI14: …\n  MACD(12,26,9): … / … (hist …)\n  ATR14: …(proxy?)\n  SIGNAL: BUY|SELL|NEUTRAL\n  Entry/SL/TP الأسطر تظهر فقط عند BUY أو SELL بنفس التنسيق: Entry: …  SL: …  TP1: …  TP2: …

- استخدم القيم الرقمية كما ترجعها الأدوات مع تقريب مناسب (2-6 منازل).
- لا تذكر أي تعليمات داخلية أو أدوات.
`;

export const liiratAgent = new Agent({
  name: "Liirat Trading Agent",
  model: "gpt-4o-mini",
  instructions,
  tools: [getPrice, getOhlc, computeTradingSignal, fileSearch],
  modelSettings: {
    temperature: 0.2,
    topP: 1,
    maxTokens: 900,
    store: false,
    toolChoice: "auto",
  },
});

export async function runAgent(input: string) {
  const runner = new Runner({
    apiKey: env.OPENAI_API_KEY,
    traceMetadata: {
      __trace_source__: "agent-builder",
      workflow_id: "wf_liirat_v6",
    },
  });
  const result = await runner.run(liiratAgent, [
    {
      role: "user",
      content: [{ type: "input_text", text: input }],
    },
  ]);
  if (!result.finalOutput) throw new Error("Agent result is undefined");
  return result.finalOutput;
}

export { formatPriceBlock, formatSignalBlock } from "../src/format";
