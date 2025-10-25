import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";

export interface ConversationContextEntry {
  role: ConversationRole;
  content: string;
}

export interface ConversationLookupResult {
  conversation_id: string;
  tenant_id: string | null;
  isNew: boolean;
}

const SUPABASE_TENANT_ID = process.env.SUPABASE_TENANT_ID ?? null;

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

export async function createOrGetConversation(waId: string): Promise<ConversationLookupResult | null> {
  if (!waId) {
    return null;
  }
  const supabase = getClient();
  if (!supabase) {
    return { conversation_id: waId, tenant_id: null, isNew: true };
  }
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, tenant_id")
      .eq("title", waId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      throw error;
    }
    if (data?.id) {
      return { conversation_id: data.id, tenant_id: data.tenant_id ?? null, isNew: false };
    }
    const payload: Record<string, unknown> = {
      title: waId,
      created_at: new Date().toISOString(),
    };
    if (SUPABASE_TENANT_ID) {
      payload.tenant_id = SUPABASE_TENANT_ID;
    }
    const { data: inserted, error: insertError } = await supabase
      .from("conversations")
      .insert(payload)
      .select("id, tenant_id")
      .single();
    if (insertError) {
      throw insertError;
    }
    if (inserted?.id) {
      return { conversation_id: inserted.id, tenant_id: inserted.tenant_id ?? null, isNew: true };
    }
  } catch (error) {
    console.warn("[SUPABASE] error createOrGetConversation", error);
  }
  return { conversation_id: waId, tenant_id: null, isNew: false };
}

export async function logMessage(
  conversationId: string,
  role: ConversationRole,
  content: string,
): Promise<void> {
  if (!conversationId || !role) {
    return;
  }
  const supabase = getClient();
  if (!supabase) {
    return;
  }
  try {
    const payload = {
      conversation_id: conversationId,
      user_id: null,
      role,
      content,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[SUPABASE] error logMessage", error);
  }
}

export async function getRecentContext(
  conversationId: string,
  limit = 10,
): Promise<ConversationContextEntry[]> {
  if (!conversationId) {
    return [];
  }
  const supabase = getClient();
  if (!supabase) {
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      throw error;
    }
    return (data ?? [])
      .map((row) => ({
        role: (row.role === "assistant" ? "assistant" : "user") as ConversationRole,
        content: typeof row.content === "string" ? row.content : "",
      }))
      .filter((row) => row.content.trim().length > 0);
  } catch (error) {
    console.warn("[SUPABASE] error getRecentContext", error);
    return [];
  }
}

export async function getConversationMessageCount(conversationId: string): Promise<number | null> {
  if (!conversationId) {
    return 0;
  }
  const supabase = getClient();
  if (!supabase) {
    return 0;
  }
  try {
    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (error) {
      throw error;
    }
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.warn("[SUPABASE] error getConversationMessageCount", error);
    return null;
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  return getClient();
}

export async function findOrCreateConversation(
  phone: string,
  title?: string,
): Promise<{ id: string; isNew: boolean } | null> {
  void title;
  const result = await createOrGetConversation(phone);
  if (!result) {
    return null;
  }
  return { id: result.conversation_id, isNew: result.isNew };
}

export async function getOrCreateConversation(phone: string, title?: string): Promise<string | null> {
  const result = await findOrCreateConversation(phone, title);
  return result?.id ?? null;
}

export interface MessageInsertPayload {
  conversationId: string;
  phone?: string;
  role: ConversationRole;
  content: string;
}

export async function insertMessage(payload: MessageInsertPayload): Promise<void> {
  if (!payload?.conversationId) return;
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
