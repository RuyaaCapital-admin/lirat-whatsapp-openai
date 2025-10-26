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
              text: `Use the web_search tool to find up to ${safeCount} recent economic or market-moving events only (macro releases like CPI/PPI/GDP/NFP/PMI, central bank decisions/speeches, major political/financial developments). Exclude sports/entertainment/tech gadgets. Return STRICT JSON: {"items":[{"date":"YYYY-MM-DD","source":"...","title":"...","impact":"high|medium|low","url":"..."}]}. If uncertain or not applicable, use an empty array. Reply with JSON only in ${language}.`,
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
      response_format: { type: "json_object" } as any,
    });

    const text = extractText(response);
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        console.warn("[NEWS] failed to parse response", error, { text });
      }
    }

    // Fallback: try to repair into JSON structure
    if (!parsed) {
      try {
        const repair = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `Convert the provided content into up to ${safeCount} market/economic EVENTS only. Use STRICT JSON {"items":[{"date":"YYYY-MM-DD","source":"...","title":"...","impact":"high|medium|low","url":"..."}]}. If none, return {"items":[]}. Titles in ${language}. Ignore price summaries; keep macro/central bank/political events only.`,
            },
            { role: "user", content: text || "" },
          ],
        });
        const repaired = repair?.choices?.[0]?.message?.content || "";
        parsed = repaired ? JSON.parse(repaired) : null;
      } catch (e) {
        console.warn("[NEWS] repair parse failed", e);
        parsed = null;
      }
    }

    if (!parsed) return [];
    const itemsSource = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(itemsSource)) return [];

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
