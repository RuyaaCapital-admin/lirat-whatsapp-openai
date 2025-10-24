// src/lib/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { HistoryMessage } from "./memory";

export type StoredMessageRole = "user" | "assistant";

export interface StoredMessage {
  id?: string;
  wa_id?: string;
  role?: string | null;
  direction?: string | null;
  body?: string | null;
  content?: string | null;
  message?: string | null;
  text?: string | null;
  created_at?: string | null;
  timestamp?: string | null;
  lang?: string | null;
  contact_name?: string | null;
}

export interface LoadedHistory {
  messages: HistoryMessage[];
  lastRecentAt: number | null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const MESSAGES_TABLE = process.env.SUPABASE_MESSAGES_TABLE || "messages";

let client: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function coerceRole(row: StoredMessage): StoredMessageRole | null {
  const raw = (row.role || row.direction || "").toString().toLowerCase();
  if (["user", "in", "incoming", "inbound"].includes(raw)) return "user";
  if (["assistant", "out", "outgoing", "outbound", "bot"].includes(raw)) return "assistant";
  return null;
}

function extractBody(row: StoredMessage): string {
  const candidates = [row.body, row.content, row.message, row.text];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function parseTimestamp(row: StoredMessage): number | null {
  const candidates = [row.created_at, row.timestamp];
  for (const value of candidates) {
    if (typeof value === "string" && value) {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

export async function fetchHistoryFromSupabase(waId: string, limit = 15): Promise<LoadedHistory> {
  if (!client || !waId) {
    return { messages: [], lastRecentAt: null };
  }

  try {
    const response = await client
      .from(MESSAGES_TABLE)
      .select("*")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (response.error) {
      console.warn("[SUPABASE] fetch history failed", response.error);
      return { messages: [], lastRecentAt: null };
    }

    const rows = Array.isArray(response.data) ? (response.data as StoredMessage[]) : [];
    const history: HistoryMessage[] = [];
    let lastRecentAt: number | null = null;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      const role = coerceRole(row);
      const content = extractBody(row);
      if (!role || !content) continue;
      history.push({ role, content });
    }

    for (const row of rows) {
      const ts = parseTimestamp(row);
      if (ts && ts >= cutoff) {
        if (!lastRecentAt || ts > lastRecentAt) {
          lastRecentAt = ts;
        }
      }
    }

    return { messages: history.slice(-limit), lastRecentAt };
  } catch (error) {
    console.warn("[SUPABASE] fetch history exception", error);
    return { messages: [], lastRecentAt: null };
  }
}

export interface LogMessageInput {
  waId: string;
  role: StoredMessageRole;
  content: string;
  lang?: string;
  messageId?: string;
  contactName?: string;
}

export async function logSupabaseMessage(input: LogMessageInput): Promise<void> {
  if (!client) return;
  const { waId, role, content, lang, messageId, contactName } = input;
  if (!waId || !content) return;

  const payload: Record<string, unknown> = {
    wa_id: waId,
    role,
    body: content,
    lang: lang ?? null,
    message_id: messageId ?? null,
    direction: role === "user" ? "inbound" : "outbound",
    contact_name: contactName ?? null,
  };

  try {
    const { error } = await client.from(MESSAGES_TABLE).insert(payload);
    if (error) {
      console.warn("[SUPABASE] failed to log message", error);
    }
  } catch (error) {
    console.warn("[SUPABASE] insert exception", error);
  }
}

