// src/lib/memory.ts
import type { RedisConfigNodejs } from "@upstash/redis";
import { Redis } from "@upstash/redis";

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export interface ConversationMemoryAdapter {
  getHistory(userId: string): Promise<HistoryMessage[]>;
  appendHistory(userId: string, messages: HistoryMessage[]): Promise<void>;
  clearHistory?(userId: string): Promise<void>;
}

const MAX_HISTORY_MESSAGES = 12;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7; // one week

function hasArabic(text: string) {
  return /[\u0600-\u06FF]/.test(text);
}

class RedisConversationMemory implements ConversationMemoryAdapter {
  private readonly redis?: Redis;
  private readonly fallback = new Map<string, HistoryMessage[]>();

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      const config: RedisConfigNodejs = { url, token };
      this.redis = new Redis(config);
    }
  }

  private key(userId: string) {
    return `wa:history:${userId}`;
  }

  private normalise(messages: HistoryMessage[]): HistoryMessage[] {
    return messages
      .filter((msg) => msg && typeof msg.content === "string" && msg.content.trim())
      .slice(-MAX_HISTORY_MESSAGES);
  }

  async getHistory(userId: string): Promise<HistoryMessage[]> {
    if (!userId) return [];
    try {
      if (this.redis) {
        const raw = await this.redis.get<string>(this.key(userId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return this.normalise(
            parsed.map((item) => ({
              role: item.role === "assistant" ? "assistant" : "user",
              content: String(item.content ?? ""),
            }))
          );
        }
      }
    } catch (error) {
      console.warn("[MEMORY] Failed to load history", error);
    }
    const fallback = this.fallback.get(userId) || [];
    return this.normalise(fallback);
  }

  async appendHistory(userId: string, messages: HistoryMessage[]): Promise<void> {
    if (!userId || !Array.isArray(messages) || messages.length === 0) return;
    const existing = await this.getHistory(userId);
    const combined = this.normalise([...existing, ...messages]);

    if (this.redis) {
      try {
        await this.redis.set(this.key(userId), JSON.stringify(combined), {
          ex: HISTORY_TTL_SECONDS,
        });
        this.fallback.set(userId, combined);
        return;
      } catch (error) {
        console.warn("[MEMORY] Failed to persist history", error);
      }
    }

    this.fallback.set(userId, combined);
  }

  async clearHistory(userId: string): Promise<void> {
    if (!userId) return;
    this.fallback.delete(userId);
    if (this.redis) {
      try {
        await this.redis.del(this.key(userId));
      } catch (error) {
        console.warn("[MEMORY] Failed to clear history", error);
      }
    }
  }
}

export const memory: ConversationMemoryAdapter = new RedisConversationMemory();

export function fallbackUnavailableMessage(text: string) {
  return hasArabic(text) ? "البيانات غير متاحة حالياً." : "Data unavailable right now.";
}

export default memory;
