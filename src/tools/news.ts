import axios from "axios";

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
};

const FALLBACK_NEWS: NewsItem[] = [
  {
    title: "Market Update: Gold holds steady as traders await economic cues",
    url: "https://www.example.com/news/gold-market-update",
    source: "Liirat Desk",
  },
  {
    title: "Forex snapshot: Dollar mixed while euro consolidates",
    url: "https://www.example.com/news/forex-snapshot",
    source: "Liirat Desk",
  },
  {
    title: "Crypto brief: Bitcoin volatility remains muted",
    url: "https://www.example.com/news/crypto-brief",
    source: "Liirat Desk",
  },
];

function buildNewsUrl(query: string) {
  const base = "https://financialmodelingprep.com/api/v3";
  const key = process.env.FMP_API_KEY;
  const search = encodeURIComponent(query || "markets");
  if (key) {
    return `${base}/search-news?limit=10&query=${search}&apikey=${key}`;
  }
  return `${base}/search-news?limit=10&query=${search}`;
}

export async function searchNews(query: string): Promise<NewsItem[]> {
  try {
    const url = buildNewsUrl(query);
    const { data } = await axios.get(url, { timeout: 7000 });
    if (!Array.isArray(data)) throw new Error("NEWS_EMPTY");
    const items = data
      .filter((n: any) => n?.title && n?.url)
      .slice(0, 3)
      .map((n: any) => ({
        title: String(n.title),
        url: String(n.url),
        source: String(n.site || n.source || "FMP"),
        publishedAt: n?.publishedDate || n?.published_at || undefined,
      }));
    if (items.length >= 3) return items;
  } catch (error) {
    console.error("[NEWS] fetch error", error);
  }
  return FALLBACK_NEWS;
}
