import { openai } from "./openai";

export type ClassifiedIntent = {
  intent: "price" | "trading_signal" | "news" | "liirat_info" | "general";
  symbol: string | null;
  timeframe: "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "day" | null;
  query: string | null;
  language: "ar" | "en";
};

export type ConversationEntry = { role: "user" | "assistant"; content: string };

function buildHistoryString(history: ConversationEntry[], latestUserMessage: string): string {
  const recent = (history || [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-8);
  const lines: string[] = [];
  for (const msg of recent) {
    const role = msg.role === "assistant" ? "Assistant" : "User";
    const content = msg.content.replace(/\s+/g, " ").slice(0, 300);
    lines.push(`${role}: ${content}`);
  }
  const latest = (latestUserMessage || "").replace(/\s+/g, " ").slice(0, 500);
  lines.push(`User: ${latest}`);
  return lines.join("\n");
}

const CLASSIFIER_SYSTEM = [
  "You are an intent classifier for a trading assistant.",
  "Always return STRICT JSON only with keys: intent, symbol, timeframe, query, language.",
  "JSON schema:",
  "{\\n  \\\"intent\\\": \\\"price\\\" | \\\"trading_signal\\\" | \\\"news\\\" | \\\"liirat_info\\\" | \\\"general\\\",\\n  \\\"symbol\\\": string|null,\\n  \\\"timeframe\\\": \\\"1min\\\"|\\\"5min\\\"|\\\"15min\\\"|\\\"30min\\\"|\\\"1hour\\\"|\\\"4hour\\\"|\\\"day\\\"|null,\\n  \\\"query\\\": string|null,\\n  \\\"language\\\": \\\"ar\\\"|\\\"en\\\"\\n}",
  "Rules:",
  "- Use the provided History to resolve follow-ups. Carry over last clear symbol/timeframe.",
  "- Example: 'عطيني صفقة عالساعة' following BTCUSDT -> intent=trading_signal, symbol=BTCUSDT, timeframe=1hour.",
  "- 'هي على أي وقت؟' after a signal -> intent=general and include the last used symbol/timeframe in fields.",
  "- 'على توقيت دبي؟' -> intent=general (language=ar).",
  "- Only use intent=general for chat/follow-up/clarifications, not for clear price/signal requests.",
  "- language is 'ar' if the latest user message contains Arabic letters, else 'en'.",
  "- If timeframe is missing for trading_signal, set it to null (the pipeline defaults to 5min).",
  "- If a news request is detected (أخبار/news/fed/etc.), set intent=news and query to the topic.",
  "- If the user asks 'why up/down' questions (e.g., 'ليش البيتكوين بصعود', 'ليش نازل', 'why is BTC up/down'), set intent=news and set query to the topic (include the symbol if present).",
  "- If the question is about Liirat company/support, set intent=liirat_info and query accordingly.",
].join("\n");

export async function classifyIntent(
  latestUserMessage: string,
  history: ConversationEntry[],
): Promise<ClassifiedIntent> {
  const historyBlock = buildHistoryString(history || [], latestUserMessage || "");
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM },
        {
          role: "user",
          content: `History:\n${historyBlock}`,
        },
      ],
    });
    const raw = completion?.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw || "{}");
    const intent: ClassifiedIntent = {
      intent: parsed.intent || "general",
      symbol: typeof parsed.symbol === "string" && parsed.symbol ? parsed.symbol : null,
      timeframe: parsed.timeframe ?? null,
      query: typeof parsed.query === "string" && parsed.query ? parsed.query : null,
      language: parsed.language === "ar" ? "ar" : "en",
    };
    return intent;
  } catch (error) {
    const isArabic = /[\u0600-\u06FF]/.test(latestUserMessage || "");
    return {
      intent: "general",
      symbol: null,
      timeframe: null,
      query: null,
      language: isArabic ? "ar" : "en",
    };
  }
}

export default classifyIntent;
