// src/tools/news.ts
import axios from "axios";

export interface NewsItem {
  date: string;
  source: string;
  title: string;
  url: string;
  impact?: string;
}

const FMP_NEWS_ENDPOINT = "https://financialmodelingprep.com/api/v3/stock_news";

function normaliseDate(value: string): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function mapRow(row: any): NewsItem | null {
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  const url = typeof row?.url === "string" ? row.url.trim() : "";
  const date = normaliseDate(String(row?.publishedDate ?? row?.date ?? ""));
  const source = typeof row?.site === "string" ? row.site.trim() : "";
  if (!title || !url || !date || !source) return null;
  const impact = typeof row?.text === "string" ? row.text.slice(0, 120).trim() : undefined;
  return { date, source, title, url, impact };
}

function scoreNews(item: NewsItem, query: string): number {
  if (!query) return 0;
  const lowerTitle = item.title.toLowerCase();
  const lowerSource = item.source.toLowerCase();
  let score = 0;
  for (const token of query.split(/\s+/g)) {
    if (!token) continue;
    if (lowerTitle.includes(token)) score += 2;
    if (lowerSource.includes(token)) score += 1;
  }
  return score;
}

export async function fetchNews(query: string, count: number): Promise<NewsItem[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn("[NEWS] missing FMP_API_KEY");
    return [];
  }

  const safeCount = Math.max(1, Math.min(count, 5));
  const limit = Math.max(safeCount * 3, 10);
  const url = `${FMP_NEWS_ENDPOINT}?limit=${limit}&apikey=${apiKey}`;

  try {
    const { data } = await axios.get(url, { timeout: 9000 });
    const rows = Array.isArray(data) ? data : [];
    const queryTokens = query.trim().toLowerCase();

    const mapped = rows
      .map(mapRow)
      .filter((item): item is NewsItem => Boolean(item));

    if (!mapped.length) {
      return [];
    }

    const scored = mapped
      .map((item) => ({ item, score: scoreNews(item, queryTokens) }))
      .sort((a, b) => b.score - a.score || (a.item.date < b.item.date ? 1 : -1));

    const deduped: NewsItem[] = [];
    const seen = new Set<string>();
    for (const { item } of scored) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      deduped.push(item);
      if (deduped.length >= safeCount) break;
    }

    return deduped.slice(0, safeCount);
  } catch (error) {
    console.warn("[NEWS] fetch failed", error);
    return [];
  }
}

export default fetchNews;
