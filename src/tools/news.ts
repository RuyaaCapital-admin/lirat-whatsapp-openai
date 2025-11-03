// src/tools/news.ts
import { DateTime } from "luxon";
import { openai } from "../lib/openai";

export interface NewsItem {
  date: string;
  source: string;
  title: string;
  url: string;
  impact?: string;
}

type Scope = "TODAY" | "LAST" | "NEXT";

const NEWS_MODEL = process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini";

function detectScope(query: string): Scope {
  const q = query.toLowerCase();
  if (/\b(tomorrow|next|upcoming|بعد|غد|غدا|القادم)\b/.test(q)) return "NEXT";
  if (/\b(today|now|later\stoday|اليوم|حالياً|حاليا)\b/.test(q)) return "TODAY";
  if (/\b(yesterday|last|previous|أمس|امس|الماضي)\b/.test(q)) return "LAST";
  return "LAST";
}

function isValidDate(d: string): boolean {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
}

function withinScope(dateStr: string, scope: Scope, now: DateTime): boolean {
  const dt = DateTime.fromISO(dateStr, { zone: "Asia/Dubai" });
  if (!dt.isValid) return false;
  if (scope === "TODAY") {
    return dt >= now.minus({ hours: 12 }) && dt <= now.plus({ hours: 24 });
  }
  if (scope === "LAST") {
    return dt <= now && dt >= now.minus({ hours: 72 });
  }
  if (scope === "NEXT") {
    return dt > now;
  }
  return false;
}

function ensureText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function fetchNews(query: string, count: number, lang = "en"): Promise<NewsItem[]> {
  const safeCount = Math.max(1, Math.min(count, 5));
  const language = lang === "ar" ? "ar" : "en";
  if (!query.trim()) {
    return [];
  }

  const scope = detectScope(query);
  const now = DateTime.now().setZone("Asia/Dubai");

  try {
    const response = await openai.chat.completions.create({
      model: NEWS_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You are a market news assistant. Use the web_search tool to source up to ${safeCount} market-moving events. Respond ONLY with JSON matching the schema. Language: ${language}.`,
        },
        {
          role: "user",
          content: `Topic: ${query}\nScope: ${scope}\nReturn ${safeCount} items at most following the schema.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "news_items",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              items: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                    title: { type: "string" },
                    effect: { type: "string" },
                  },
                  required: ["date", "title", "effect"],
                },
              },
            },
            required: ["items"],
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("[NEWS] invalid JSON payload", error);
      return [];
    }

    const items = Array.isArray((parsed as any)?.items) ? ((parsed as any).items as Array<{ date: string; title: string; effect: string }>) : [];

    const filtered = items
      .filter((item) => item && typeof item.date === "string" && typeof item.title === "string" && typeof item.effect === "string")
      .filter((item) => isValidDate(item.date) && withinScope(item.date, scope, now))
      .slice(0, safeCount);

    if (!filtered.length) {
      return [];
    }

    return filtered.map((item) => {
      const dt = DateTime.fromISO(item.date, { zone: "Asia/Dubai" });
      const isoDate = dt.isValid ? dt.toISODate() ?? item.date : item.date;
      const title = ensureText(item.title);
      const effect = ensureText(item.effect);
      return {
        date: isoDate,
        source: "www.liiratnews.com",
        title: title || effect,
        url: "",
        impact: effect || undefined,
      };
    });
  } catch (error) {
    console.warn("[NEWS] structured fetch failed", error);
    return [];
  }
}

export default fetchNews;
