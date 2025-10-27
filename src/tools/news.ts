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

// Try to extract a JSON block from free-form text (handles code fences and inline prose)
function extractJsonCandidate(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim().replace(/^\uFEFF/, ""); // strip BOM if present
  // Prefer fenced code blocks first
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1] && fence[1].trim()) {
    return fence[1].trim();
  }
  // If it already looks like JSON, return as-is
  if (/^[\[{]/.test(text)) {
    return text;
  }
  // Fallback: find the first JSON-looking block
  const block = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (block && block[0]) {
    return block[0];
  }
  return null;
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function inferImpactFromTitle(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/(cpi|ppi|gdp|nfp|payrolls|fomc|rate|inflation|employment|jobless|unemployment|fed|فيدرال|التضخم|البطالة)/i.test(t)) return "high";
  if (/(pmi|ism|confidence|housing|claims)/i.test(t)) return "medium";
  return undefined;
}

function salvageItemsFromText(text: string, count: number): NewsItem[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-•\d+\.\)]/.test(l) || /^[\*\-]/.test(l));
  const take = (bullets.length ? bullets : lines).slice(0, Math.max(1, Math.min(count, 5)));
  const date = todayISO();
  return take.map((t) => {
    const title = t.replace(/^[-•\d+\.\)]\s*/, "").replace(/^\*\s*/, "").trim();
    const sourceMatch = t.match(/\b([a-zA-Z]+\.(com|net|org|ae|uk|sa|kw))\b/i);
    const source = sourceMatch ? sourceMatch[1] : "Market";
    return { date, source, title, url: "", impact: inferImpactFromTitle(title) };
  });
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
              text: `Use the web_search tool to find up to ${safeCount} recent US economic or market-moving EVENTS ONLY for today (±48h): macro releases (CPI, PPI, GDP, NFP, PMI), FOMC/central bank decisions/speeches, major political/financial developments affecting markets. EXCLUDE non-US unless the query specifies otherwise, and exclude sports/entertainment/tech gadgets. Return STRICT JSON: {"items":[{"date":"YYYY-MM-DD","source":"...","title":"...","impact":"high|medium|low","url":"..."}]}. If uncertain or none, return {"items":[]}.
              Focus sources like Reuters, Bloomberg, CNBC, WSJ, investing.com, forexfactory, financialtimes. Reply with JSON only in ${language}.`,
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
    let parsed: any = null;
    if (text) {
      // First try a direct parse; if it fails, try to extract a JSON block
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        const candidate = extractJsonCandidate(text);
        if (candidate) {
          try {
            parsed = JSON.parse(candidate);
          } catch (e2) {
            console.warn("[NEWS] failed to parse response", e2, { text });
          }
        } else {
          console.warn("[NEWS] failed to parse response", error, { text });
        }
      }
    }

    // Fallback: try to repair into JSON structure
    if (!parsed) {
      try {
        const repair = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
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
        // Attempt to extract JSON block from the response (handles fences and inline)
        const candidate = extractJsonCandidate(repaired) ?? repaired;
        parsed = candidate ? JSON.parse(candidate) : null;
      } catch (e) {
        console.warn("[NEWS] repair parse failed", e);
        parsed = null;
      }
    }

    if (!parsed) {
      // Last-resort salvage from plain text into heuristic items
      const salvaged = salvageItemsFromText(text || "", safeCount);
      return salvaged;
    }
    const itemsSource = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(itemsSource)) return [];

    const mapped = itemsSource
      .map(mapItem)
      .filter((item): item is NewsItem => Boolean(item))
      .slice(0, safeCount);

    // Post-filter by recency (<= 3 days) and limit to safeCount
    const now = Date.now();
    const recent = mapped.filter((it) => {
      const ms = Date.parse(it.date);
      if (!Number.isFinite(ms)) return false;
      const days = (now - ms) / (1000 * 60 * 60 * 24);
      return days <= 3.1; // allow slight skew
    }).slice(0, safeCount);

    return recent;
  } catch (error) {
    console.warn("[NEWS] search failed", error);
    return [];
  }
}

export default fetchNews;
