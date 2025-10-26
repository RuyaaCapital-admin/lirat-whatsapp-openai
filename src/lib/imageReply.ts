// src/lib/imageReply.ts
import { openai } from "./openai";

function detectLanguage(text?: string): "ar" | "en" {
  if (text && /[\u0600-\u06FF]/.test(text)) return "ar";
  return "en";
}

const SYSTEM = [
  "You are Liirat Assistant (مساعد ليرات). You are a professional Arabic/English trading assistant.",
  "- Always answer in the user's language: Arabic if user is writing Arabic, English if user is writing English.",
  "- Never use emojis.",
  "- NEVER return JSON or code blocks. Always reply in plain natural text only.",
  "- Your reply must be short and clean (1-3 short sentences).",
  "- You are given an IMAGE and an optional caption/question. Describe what's in the image and answer the user's question if any.",
].join("\n");

export async function generateImageReply(args: { base64: string; mimeType: string; caption?: string }): Promise<string> {
  const { base64, mimeType } = args;
  const caption = (args.caption || "").trim();
  const lang = detectLanguage(caption);
  const prompt = caption || (lang === "ar" ? "صف الصورة بإيجاز." : "Briefly describe the image.");
  const url = `data:${mimeType};base64,${base64}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url } },
          ] as any,
        },
      ],
    });
    const content = completion?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (text) return text;
  } catch (error) {
    console.warn("[imageReply] error", error);
  }
  return lang === "ar" ? "تعذر قراءة الصورة حالياً." : "Couldn't read the image right now.";
}

export default generateImageReply;
