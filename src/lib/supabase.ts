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
  lastInboundAt: number | null;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const MESSAGES_TABLE = process.env.SUPABASE_MESSAGES_TABLE || "messages";
const PROCESSED_TABLE = process.env.SUPABASE_PROCESSED_TABLE || "processed_messages";

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
  const candidates = [row.created_at, row.timestamp, (row as any).inserted_at, (row as any).updated_at, (row as any).createdAt];
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
    return { messages: [], lastInboundAt: null };
  }

  try {
    const response = await client
      .from(MESSAGES_TABLE)
      .select("*")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("timestamp", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (response.error) {
      console.warn("[SUPABASE] fetch history failed", response.error);
      return { messages: [], lastInboundAt: null };
    }

    const rows = Array.isArray(response.data) ? (response.data as StoredMessage[]) : [];
    rows.sort((a, b) => (parseTimestamp(a) ?? 0) - (parseTimestamp(b) ?? 0));

    const history: HistoryMessage[] = [];
    let lastInboundAt: number | null = null;

    for (const row of rows) {
      const role = coerceRole(row);
      const content = extractBody(row);
      if (!role || !content) continue;
      history.push({ role, content });
      if (role === "user") {
        const ts = parseTimestamp(row);
        if (typeof ts === "number") {
          lastInboundAt = lastInboundAt ? Math.max(lastInboundAt, ts) : ts;
        }
      }
    }

    return { messages: history.slice(-limit), lastInboundAt };
  } catch (error) {
    console.warn("[SUPABASE] fetch history exception", error);
    return { messages: [], lastInboundAt: null };
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

export async function shouldGreet(waId: string, lastInboundTimestamp?: number | null): Promise<boolean> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  if (typeof lastInboundTimestamp === "number") {
    return lastInboundTimestamp < cutoff;
  }
  if (!client || !waId) return false;
  try {
    const { data, error } = await client
      .from(MESSAGES_TABLE)
      .select("created_at,timestamp,inserted_at,updated_at")
      .eq("wa_id", waId)
      .eq("role", "user")
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("timestamp", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) {
      console.warn("[SUPABASE] shouldGreet query failed", error);
      return false;
    }
    if (!data || !data.length) {
      return true;
    }
    const ts = parseTimestamp(data[0] as StoredMessage);
    if (!ts) return true;
    return ts < cutoff;
  } catch (error) {
    console.warn("[SUPABASE] shouldGreet exception", error);
    return false;
  }
}

export async function reserveMessageProcessing(messageId: string): Promise<boolean> {
  if (!client || !messageId) {
    return true;
  }
  try {
    const payload = { id: messageId, created_at: new Date().toISOString() };
    const { error } = await client.from(PROCESSED_TABLE).insert(payload);
    if (!error) {
      return true;
    }
    if ((error as any)?.code === "23505" || /duplicate/i.test(String((error as any)?.message ?? ""))) {
      console.info("[SUPABASE] message already processed", { messageId });
      return false;
    }
    console.warn("[SUPABASE] reserve message failed", error);
    return true;
  } catch (error) {
    console.warn("[SUPABASE] reserve message exception", error);
    return true;
  }
}

