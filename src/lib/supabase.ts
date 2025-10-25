import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  user_id: string | null;
  role: ConversationRole;
  content: string;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  title: string;
  created_at: string;
}

export interface ConversationLookupResult {
  id: string;
  isNew: boolean;
}

export interface ConversationHistory {
  conversationId: string | null;
  messages: Array<{ role: ConversationRole; content: string }>;
}

const TENANT_ID = process.env.TENANT_ID ?? null;

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) {
    return client;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) {
    console.warn("[SUPABASE] missing env, disabling");
    return null;
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function findOrCreateConversation(
  phone: string,
  title?: string,
): Promise<ConversationLookupResult | null> {
  if (!phone) {
    return null;
  }
  const conversationId = phone;
  const supabase = getClient();
  if (!supabase) {
    return { id: conversationId, isNew: true };
  }
  const createdAt = new Date().toISOString();
  const safeTitle = title && title.trim() ? title.trim() : "WhatsApp chat";
  try {
    const { data: existing, error: lookupError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (lookupError && lookupError.code !== "PGRST116") {
      throw lookupError;
    }
    if (existing?.id) {
      return { id: existing.id, isNew: false };
    }
    const payload = {
      id: conversationId,
      user_id: phone,
      tenant_id: TENANT_ID,
      title: safeTitle,
      created_at: createdAt,
    };
    const { error: insertError } = await supabase.from("conversations").insert(payload);
    if (insertError) {
      throw insertError;
    }
    return { id: conversationId, isNew: true };
  } catch (error) {
    console.warn("[SUPABASE] failed to log conversation", error);
    return { id: conversationId, isNew: false };
  }
}

export async function getOrCreateConversation(phone: string, title?: string): Promise<string | null> {
  const result = await findOrCreateConversation(phone, title);
  return result?.id ?? null;
}

export async function loadConversationHistory(phone: string, limit = 10): Promise<ConversationHistory> {
  if (!phone) {
    return { conversationId: null, messages: [] };
  }
  const supabase = getClient();
  if (!supabase) {
    return { conversationId: null, messages: [] };
  }
  try {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", phone)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      throw error;
    }
    if (!conversation?.id) {
      return { conversationId: null, messages: [] };
    }
    const messages = await fetchConversationMessages(conversation.id, limit);
    return { conversationId: conversation.id, messages };
  } catch (err) {
    console.warn("[SUPABASE] load history failed", err);
    return { conversationId: null, messages: [] };
  }
}

export interface MessageInsertPayload {
  conversationId: string;
  phone: string;
  role: ConversationRole;
  content: string;
}

export async function insertMessage({ conversationId, phone, role, content }: MessageInsertPayload): Promise<void> {
  const supabase = getClient();
  if (!supabase || !conversationId) {
    return;
  }
  try {
    const payload = {
      conversation_id: conversationId,
      user_id: phone,
      role,
      content,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[SUPABASE] failed to log conversation", error);
  }
}

export async function fetchConversationMessages(
  conversationId: string,
  limit = 10,
): Promise<Array<{ role: ConversationRole; content: string }>> {
  const supabase = getClient();
  if (!supabase || !conversationId) {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw error;
    }
    return (data ?? [])
      .reverse()
      .map((row) => ({
        role: (row.role === "assistant" ? "assistant" : "user") as ConversationRole,
        content: typeof row.content === "string" ? row.content : "",
      }))
      .filter((row) => row.content.trim().length > 0);
  } catch (error) {
    console.warn("[SUPABASE] fetch messages failed", error);
    return [];
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  return getClient();
}
