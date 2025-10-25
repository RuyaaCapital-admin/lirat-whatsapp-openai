import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";

export interface ConversationContextEntry {
  role: ConversationRole;
  content: string;
}

export interface ConversationLookupResult {
  conversation_id: string;
  phone: string | null;
  user_id: string | null;
  isNew: boolean;
  last_symbol: string | null;
  last_tf: string | null;
  last_signal: any;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return null;
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

function normaliseSymbolValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

function normaliseTimeframeValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function safeJsonParse(value: unknown): any {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn("[SUPABASE] failed to parse JSON", error);
    }
  }
  return null;
}

async function selectConversation(
  supabase: SupabaseClient,
  phone: string,
): Promise<ConversationLookupResult | null> {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, phone, user_id, last_symbol, last_tf, last_signal")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[SUPABASE] select conversation error", error);
      return null;
    }
    if (!data?.id || !isUuid(data.id)) {
      return null;
    }
    return {
      conversation_id: data.id,
      phone: typeof data.phone === "string" ? data.phone : phone,
      user_id: isUuid(data.user_id) ? data.user_id : null,
      isNew: false,
      last_symbol: normaliseSymbolValue(data.last_symbol),
      last_tf: normaliseTimeframeValue(data.last_tf),
      last_signal: safeJsonParse(data.last_signal),
    };
  } catch (error) {
    console.warn("[SUPABASE] select conversation exception", error);
    return null;
  }
}

async function insertConversation(
  supabase: SupabaseClient,
  phone: string,
): Promise<ConversationLookupResult | null> {
  try {
    const payload: Record<string, unknown> = {
      phone,
      user_id: null,
      last_symbol: null,
      last_tf: null,
      last_signal: null,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("conversations")
      .insert(payload)
      .select("id, phone, user_id, last_symbol, last_tf, last_signal")
      .single();
    if (error) {
      console.warn("[SUPABASE] insert conversation error", error);
      return null;
    }
    if (!data?.id || !isUuid(data.id)) {
      return null;
    }
    return {
      conversation_id: data.id,
      phone: typeof data.phone === "string" ? data.phone : phone,
      user_id: isUuid(data.user_id) ? data.user_id : null,
      isNew: true,
      last_symbol: normaliseSymbolValue(data.last_symbol),
      last_tf: normaliseTimeframeValue(data.last_tf),
      last_signal: safeJsonParse(data.last_signal),
    };
  } catch (error) {
    console.warn("[SUPABASE] insert conversation exception", error);
    return null;
  }
}

export async function createOrGetConversation(phone: string): Promise<ConversationLookupResult | null> {
  if (!phone) {
    return null;
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      conversation_id: phone,
      phone,
      user_id: null,
      isNew: true,
      last_symbol: null,
      last_tf: null,
      last_signal: null,
    };
  }
  const existing = await selectConversation(supabase, phone);
  if (existing) {
    return existing;
  }
  return insertConversation(supabase, phone);
}

export async function updateConversationMetadata(
  conversationId: string,
  updates: { last_symbol?: string | null; last_tf?: string | null; last_signal?: any },
): Promise<void> {
  if (!isUuid(conversationId)) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const payload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(updates, "last_symbol")) {
    payload.last_symbol = normaliseSymbolValue(updates.last_symbol) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "last_tf")) {
    payload.last_tf = normaliseTimeframeValue(updates.last_tf) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "last_signal")) {
    payload.last_signal = updates.last_signal ?? null;
  }
  if (!Object.keys(payload).length) return;
  try {
    const { error } = await supabase
      .from("conversations")
      .update(payload)
      .eq("id", conversationId);
    if (error) {
      console.warn("[SUPABASE] update metadata error", error);
    }
  } catch (error) {
    console.warn("[SUPABASE] update metadata exception", error);
  }
}

export async function logMessage(
  conversationId: string,
  role: ConversationRole,
  content: string,
): Promise<void> {
  if (!isUuid(conversationId)) return;
  if (!content || !content.trim()) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const payload = {
      conversation_id: conversationId,
      role,
      content,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      console.warn("[SUPABASE] log message error", error);
    }
  } catch (error) {
    console.warn("[SUPABASE] log message exception", error);
  }
}

export async function getRecentContext(
  conversationId: string,
  limit = 10,
): Promise<ConversationContextEntry[]> {
  if (!isUuid(conversationId)) return [];
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      console.warn("[SUPABASE] recent context error", error);
      return [];
    }
    return (data ?? [])
      .map((row) => ({
        role: row.role === "assistant" ? "assistant" : "user",
        content: typeof row.content === "string" ? row.content : "",
      }))
      .filter((row) => row.content.trim().length > 0);
  } catch (error) {
    console.warn("[SUPABASE] recent context exception", error);
    return [];
  }
}

export async function getConversationMessageCount(conversationId: string): Promise<number> {
  if (!isUuid(conversationId)) return 0;
  const supabase = getSupabaseClient();
  if (!supabase) return 0;
  try {
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (error) {
      console.warn("[SUPABASE] message count error", error);
      return 0;
    }
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.warn("[SUPABASE] message count exception", error);
    return 0;
  }
}

export async function findOrCreateConversation(
  phone: string,
): Promise<{ id: string; isNew: boolean } | null> {
  const result = await createOrGetConversation(phone);
  if (!result) return null;
  return { id: result.conversation_id, isNew: result.isNew };
}

export async function getOrCreateConversation(phone: string): Promise<string | null> {
  const result = await findOrCreateConversation(phone);
  return result?.id ?? null;
}

export interface MessageInsertPayload {
  conversationId: string;
  role: ConversationRole;
  content: string;
}

export async function insertMessage(payload: MessageInsertPayload): Promise<void> {
  await logMessage(payload.conversationId, payload.role, payload.content);
}

export async function fetchConversationMessages(
  conversationId: string,
  limit = 10,
): Promise<Array<{ role: ConversationRole; content: string }>> {
  return getRecentContext(conversationId, limit);
}

export interface ConversationHistory {
  conversationId: string | null;
  messages: Array<{ role: ConversationRole; content: string }>;
}

export async function loadConversationHistory(
  phone: string,
  limit = 10,
): Promise<ConversationHistory> {
  const result = await createOrGetConversation(phone);
  if (!result?.conversation_id) {
    return { conversationId: null, messages: [] };
  }
  const messages = await getRecentContext(result.conversation_id, limit);
  return { conversationId: result.conversation_id, messages };
}
