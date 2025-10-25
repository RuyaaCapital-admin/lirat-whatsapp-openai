import { openai } from "./openai";

export type ConversationEntry = { role: "user" | "assistant"; content: string };

export interface GenerateReplyInput {
  language: "ar" | "en";
  lastUserMessage: string;
  conversationContext: ConversationEntry[]; // up to ~10
  toolResult: Record<string, unknown> | null;
  toolMeta?: Record<string, unknown> | null;
}

function buildSystemPrompt(lang: "ar" | "en"): string {
  const common = [
    "You are Liirat Assistant (\u0645\u0633\u0627\u0639\u062F \u0644\u064A\u0631\u0627\u062A), a concise professional trading assistant.",
    "Rules:",
    "- Always reply in the SAME language as the user's last message (Arabic or English).",
    "- Be short, direct, and factual. No greetings unless explicitly asked.",
    "- Use conversation context to answer follow-ups. Don't ask for symbol/timeframe again if it was clear earlier.",
    "- Never re-introduce yourself unless the user literally asks who/what you are.",
    "- If the user asks 'who are you' or 'min anta' / '\u0645\u064A\u0646 \u0627\u0646\u062A', answer EXACTLY:",
    "  Arabic: \"\u0645\u0633\u0627\u0639\u062F \u0644\u064A\u0631\u0627\u062A\".",
    "  English: \"I'm Liirat assistant.\"",
    "- If the user is rude, respond calmly: Arabic: \"\u062E\u0644\u0651\u064A\u0646\u0627 \u0646\u0631\u0643\u0651\u0632 \u0639\u0644\u0649 \u0627\u0644\u0635\u0641\u0642\u0629\"; English: \"Let's focus on the trade.\"",
    "- If outside finance/Liirat scope: Arabic: \"\u0647\u0630\u0627 \u062E\u0627\u0631\u062C \u0646\u0637\u0627\u0642 \u0639\u0645\u0644\u064A.\" / English: \"That's outside my scope.\"",
    "- Do not invent numbers. Only use provided tool_result values.",
    "- Outputs MUST be plain text only (no JSON, no markdown).",
    "- For clarifications: if symbol missing, Arabic: \"\u062D\u062F\u0651\u062F \u0627\u0644\u0623\u062F\u0627\u0629 (\u0630\u0647\u0628، \u0641\u0636\u0651\u0629، \u064A\u0648\u0631\u0648، \u0628\u064A\u062A\u0643\u0648\u064A\u0646...)\" / English: \"Which asset?\". If timeframe missing, Arabic: \"\u062D\u062F\u0651\u062F \u0627\u0644\u0625\u0637\u0627\u0631 \u0627\u0644\u0632\u0645\u0646\u064A (5min، 1hour، daily)\" / English: \"Which timeframe (5min, 1hour, daily)?\"",
    "- When asked 'which time is that?' use provided tool_meta.time/timeframe if available; otherwise infer from last context and state explicitly.",
    "- If tool_result indicates stale data, clearly state Arabic: \"\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0645\u062A\u0623\u062E\u0651\u0631\u0629 \u062D\u0648\u0627\u0644\u064A X \u062F\u0642\u064A\u0642\u0629\" / English: \"Data is delayed about X minutes\".",
  ].join("\n");

  const signalArabic = [
    "لما يكون tool_result.type = 'signal':",
    "- لو decided = 'STALE': \"البيانات متأخرة حوالي {stale_minutes} دقيقة، ما فيني أعطي صفقة مباشرة على {symbol} حالياً. آخر تحديث {last_candle_time_utc} UTC على فريم {timeframe}.\"",
    "- لو decided = 'NEUTRAL': \"مافي اتجاه واضح على {symbol} حالياً (فريم {timeframe}). آخر تحديث {last_candle_time_utc} UTC.\"",
    "- لو decided = 'BUY' أو 'SELL':",
    "  \"صفقة {decided} على {symbol} (فريم {timeframe}) — آخر تحديث {last_candle_time_utc} UTC:\nدخول: {entry}\nوقف: {sl}\nهدف1: {tp1}\nهدف2: {tp2}\nالسبب المختصر: {reason_short}\"",
    "  وإذا stale_minutes > 10: أضف جملة: \"البيانات متأخرة حوالي {stale_minutes} دقيقة\".",
  ].join("\n");

  const signalEnglish = [
    "For tool_result.type = 'signal':",
    "- If decided = 'STALE': \"Data is delayed about {stale_minutes} minutes, I can't provide a direct trade on {symbol} now. Last update {last_candle_time_utc} UTC on {timeframe}.\"",
    "- If decided = 'NEUTRAL': \"No clear bias on {symbol} right now (timeframe {timeframe}). Last update {last_candle_time_utc} UTC.\"",
    "- If decided = 'BUY' or 'SELL':",
    "  \"{decided} on {symbol} (timeframe {timeframe}) — Last update {last_candle_time_utc} UTC:\nEntry: {entry}\nSL: {sl}\nTP1: {tp1}\nTP2: {tp2}\nReason: {reason_short}\"",
    "  And if stale_minutes > 10: add \"Data is delayed about {stale_minutes} minutes\".",
  ].join("\n");

  const priceArabic = "لو tool_result.type = 'price': جاوب بسطرين: الرمز والسعر مع وقت UTC مختصر.";
  const priceEnglish = "If tool_result.type = 'price': reply in 1-2 lines: symbol, price, and UTC time.";

  const otherArabic = "لو السؤال خارج نطاق المال/ليـرات: \"هذا خارج نطاق عملي.\"";
  const otherEnglish = "If question is outside finance/Liirat: \"That's outside my scope.\"";

  return [
    common,
    lang === "ar" ? signalArabic : signalEnglish,
    lang === "ar" ? priceArabic : priceEnglish,
    lang === "ar" ? otherArabic : otherEnglish,
  ].join("\n\n");
}

export async function generateReply(input: GenerateReplyInput): Promise<string> {
  const language = input.language === "ar" ? "ar" : "en";
  const system = buildSystemPrompt(language);

  const historyMessages = (input.conversationContext || [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content } as const));

  const toolInfo = JSON.stringify({
    tool_result: input.toolResult ?? null,
    tool_meta: input.toolMeta ?? null,
    language,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: system },
        { role: "system", content: `TOOL_CONTEXT: ${toolInfo}` },
        ...historyMessages,
        { role: "user", content: input.lastUserMessage || "" },
      ],
    });
    const content = completion?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (text) return text;
  } catch (error) {
    console.warn("[GENERATE_REPLY] error", error);
  }

  // Minimal safe fallback in correct language
  return language === "ar" ? "البيانات غير متاحة حالياً." : "Data not available right now.";
}

export default generateReply;
