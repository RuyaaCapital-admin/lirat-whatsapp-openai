// src/tools/news.ts
import { openai } from "../lib/openai";

export interface NewsItem {
  date: string;
  source: string;
  title: string;
  url: string;
  impact?: string;
}

function extractText(response: any): string {
  if (!response) return "";
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (Array.isArray(output)) {
    const chunks = output
      .flatMap((item: any) => (Array.isArray(item.content) ? item.content : item.content ? [item.content] : []))
      .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
      .filter(Boolean);
    if (chunks.length) {
      return chunks.join("\n").trim();
    }
  }
  return "";
}

function normaliseDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const trimmed = value.trim();
  const isoCandidate = /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed : new Date(trimmed).toISOString();
  if (!isoCandidate) return "";
  const parsed = Date.parse(isoCandidate);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function mapItem(raw: any): NewsItem | null {
  const date = normaliseDate(raw?.date ?? raw?.published_at ?? raw?.publishedDate);
  const source = typeof raw?.source === "string" ? raw.source.trim() : typeof raw?.site === "string" ? raw.site.trim() : "";
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const url = typeof raw?.url === "string" ? raw.url.trim() : "";
  const impact = typeof raw?.impact === "string" ? raw.impact.trim() : undefined;
  if (!date || !source || !title || !url) return null;
  return { date, source, title, url, impact };
}

export async function fetchNews(query: string, count: number, lang = "en"): Promise<NewsItem[]> {
  const safeCount = Math.max(1, Math.min(count, 5));
  const language = lang === "ar" ? "ar" : "en";
  if (!query.trim()) {
    return [];
  }

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_NEWS_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Use the web_search tool to find up to ${safeCount} recent market or economic headlines relevant to the user's query. Respond ONLY with valid JSON matching {"items":[{"date":"YYYY-MM-DD","source":"...","title":"...","impact":"...","url":"..."}]}. Write title and impact in ${language} when possible. If impact is unknown, omit it or use null.`,
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: query }],
        },
      ],
      tools: [{ type: "web_search" as any }],
      tool_choice: "auto",
      max_output_tokens: 800,
    });

    const text = extractText(response);
    if (!text) {
      return [];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.warn("[NEWS] failed to parse response", error, { text });
      return [];
    }

    const itemsSource = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(itemsSource)) {
      return [];
    }

    const mapped = itemsSource
      .map(mapItem)
      .filter((item): item is NewsItem => Boolean(item))
      .slice(0, safeCount);

    return mapped;
  } catch (error) {
    console.warn("[NEWS] search failed", error);
    return [];
  }
}

export default fetchNews;
