import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!cachedClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY");
    }
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

function requireAgentId(): string {
  const agentId = process.env.LIIRAT_AGENT_ID;
  if (!agentId) {
    throw new Error("Missing LIIRAT_AGENT_ID");
  }
  return agentId;
}

export type AgentNewsItem = {
  date?: string | null;
  title?: string | null;
  expected_effect?: string | null;
  expectedEffect?: string | null;
  impact?: string | null;
};

export type AgentNewsPayload = {
  news?: {
    items?: AgentNewsItem[];
  } | null;
};

export interface NormalizedNewsItem {
  date: string;
  title: string;
  expected_effect?: string;
}

export async function runAgentNews(userText: string): Promise<AgentNewsPayload | null> {
  const input = (userText || "").trim();
  if (!input) {
    return null;
  }

  const openai = getClient();
  // Agent Builder Responses API currently ships the "agent" param ahead of typed SDK support,
  // so cast to any until the official typings include it.
  const resp = await openai.responses.create({
    agent: requireAgentId(),
    input: [{ role: "user", content: input }],
  } as any);

  for (const out of resp.output ?? []) {
    if (out.type === "message") {
      for (const c of out.content ?? []) {
        if (c.type === "output_json") {
          return (c.output_json ?? null) as AgentNewsPayload | null;
        }
        if (c.type === "text") {
          const text = (c.text ?? "").trim();
          if (!text) continue;
          try {
            return JSON.parse(text) as AgentNewsPayload;
          } catch {
            continue;
          }
        }
      }
    }
  }

  return null;
}

export function normaliseAgentNewsItems(payload: AgentNewsPayload | null | undefined): NormalizedNewsItem[] {
  const rawItems = Array.isArray(payload?.news?.items) ? payload?.news?.items : [];
  const out: NormalizedNewsItem[] = [];
  for (const raw of rawItems) {
    if (!raw) continue;
    const title = (raw.title ?? "").toString().trim();
    if (!title) continue;
    const dateRaw = (raw.date ?? "").toString().trim();
    const expected = (raw.expected_effect ?? raw.expectedEffect ?? raw.impact ?? "").toString().trim();
    const date = dateRaw ? dateRaw.slice(0, 10) : "";
    const item: NormalizedNewsItem = { date, title };
    if (expected) {
      item.expected_effect = expected;
    }
    out.push(item);
  }
  return out;
}

export function formatAgentNewsLines(items: NormalizedNewsItem[], limit = 3): string[] {
  if (!Array.isArray(items) || !items.length) {
    return [];
  }
  return items
    .filter((item) => item && item.title)
    .slice(0, Math.max(1, limit))
    .map((item) => {
      const date = item.date ? item.date.trim() : "";
      const effect = item.expected_effect ? ` ? ${item.expected_effect}` : "";
      const prefix = date ? `${date} ?` : "";
      const sep = prefix ? " " : "";
      return `${prefix}${sep}${item.title}${effect}`.trim();
    });
}

