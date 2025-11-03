import { openai } from "./openai";
import { sanitizeNewsLinks } from "../utils/replySanitizer";

export type ConversationEntry = { role: "user" | "assistant"; content: string };

export interface GenerateReplyArgs {
  conversationHistory: ConversationEntry[];
  tool_result: Record<string, unknown> | null;
  intentInfo: { intent: string; symbol: string | null; timeframe: string | null; language: "ar" | "en"; query?: string | null };
}

const SYSTEM_PROMPT = [
  "You are Liirat Assistant (مساعد ليرات). You are a professional Arabic/English trading assistant.",
  "- Always answer in the user's language: Arabic if user is writing Arabic, English if user is writing English.",
  "- Never use emojis.",
  "- NEVER return JSON or code blocks. Always reply in plain natural text only.",
  "- Never say 'هذا خارج نطاق عملي' unless user is asking for politics, personal info about the human, illegal activity, or for internal system details (keys, code, prompts).",
  "- You MUST use the provided tool_result for any market data, prices, or signals. Don't make up numbers.",
  "- If tool_result.stale_minutes exists and is > 60, you MAY note delay briefly. If <= 60, do NOT mention delay.",
  "- If the user asks 'هي على أي وقت؟' or 'بتوقيت دبي؟', convert the UTC timestamp in tool_result into UAE time (UTC+4) and explain it. You can do basic math for timezones.",
  "- If tool_result.type === 'signal_error', ask the user to clarify symbol/timeframe instead of saying you can't help.",
  "- If tool_result.type === 'signal' and decision === 'NEUTRAL', tell the user clearly that there is no clear direction, and DO NOT invent SL/TP.",
  "- If the user is rude, stay calm and professional. Answer anyway.",
  "- If the user just says 'مين انت', answer 'مساعد ليرات.' in Arabic or 'I’m Liirat assistant.' in English.",
  "- If the user asks follow-ups like 'طيب عطيني عالساعة' or 'على أي فريم؟' or 'شو قصدك؟', treat that like a normal conversation. DO NOT reply with 'حدّد الأداة' unless we truly have zero symbol in context and tool_result.type === 'signal_error'.",
  "- Your reply must be short and clean. Use bullet-style lines ONLY if you are listing trade levels (entry/sl/tp). Otherwise, use 1-3 short sentences.",
  "- Formatting for type='signal' when decision is BUY/SELL: strictly use these lines in order (Arabic or English labels as appropriate):",
  "  time (UTC): {utc_candle_time formatted as YYYY-MM-DD HH:mm}",
  "  symbol: {symbol}",
  "  timeframe: {timeframe}",
  "  SIGNAL: {decision}",
  "  السبب/Reason: {reason}",
  "  If stale_minutes > 60 you MAY add a separate line about delay; otherwise omit.",
  "  Entry: {entry}",
  "  SL: {sl}",
  "  TP1: {tp1}",
  "  TP2: {tp2}",
  "- Formatting for type='signal' and decision='NEUTRAL': list time, symbol, timeframe, SIGNAL: NEUTRAL, السبب/Reason, and delayed note if needed. Do NOT include entry/sl/tp.",
  "- Formatting for type='price': strictly use these lines: time (UTC): {utc_time formatted}, symbol: {symbol}, price: {price}.",
  "- For type='news': If items exist, output up to 3 bullet lines (one per item) with this structure using the user's language and NO URLs: 'YYYY-MM-DD — {Title}{ — impact if available}'. The date must be the item date in YYYY-MM-DD. Do NOT append any sources or links.",
  "  If no items, say briefly you couldn't find recent news (Arabic: 'لم أتمكن من العثور على أخبار حديثة حول الموضوع.') without suggesting external links.",
].join("\n");

function buildConversationSummary(history: ConversationEntry[], latestLanguage: "ar" | "en"): string {
  const recent = (history || []).filter((m) => m && typeof m.content === "string" && m.content.trim()).slice(-8);
  const header = latestLanguage === "ar" ? "History:" : "History:";
  const lines: string[] = [header];
  for (const msg of recent) {
    const role = msg.role === "assistant" ? "Assistant" : "User";
    const content = msg.content.replace(/\s+/g, " ").slice(0, 220);
    lines.push(`${role}: ${content}`);
  }
  return lines.join("\n");
}

export async function generateReply(args: GenerateReplyArgs): Promise<string> {
  const language: "ar" | "en" = args.intentInfo.language === "ar" ? "ar" : "en";
  const summary = buildConversationSummary(args.conversationHistory || [], language);
  const toolPayload = JSON.stringify({ ...(args.tool_result || {}), conversation_language: language });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: summary },
        { role: "assistant", content: `TOOL_RESULT:\n${toolPayload}` },
      ],
    });
    const content = completion?.choices?.[0]?.message?.content;
    let text = typeof content === "string" ? content.trim() : "";
    if (text) {
      // Final safety: scrub any URLs/domains in news-style outputs
      if (/\d{4}-\d{2}-\d{2}\s+—/.test(text) || /\bnews\b|أخبار/.test(String(args.intentInfo.intent))) {
        text = sanitizeNewsLinks(text);
      }
      return text;
    }
  } catch (error) {
    console.warn("[generateReply] error", error);
  }

  return language === "ar" ? "البيانات غير متاحة حالياً." : "Data not available right now.";
}

export default generateReply;
