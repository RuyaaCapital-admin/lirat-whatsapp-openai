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

const TENANT_ID = "default";

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

export async function findOrCreateConversation(phone: string, title?: string): Promise<ConversationLookupResult | null> {
  if (!phone) {
    return null;
  }
  const supabase = getClient();
  if (!supabase) {
    return null;
  }
  try {
    const { data: existing, error: lookupError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", phone)
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError && lookupError.code !== "PGRST116") {
      throw lookupError;
    }
    if (existing?.id) {
      return { id: existing.id, isNew: false };
    }
    const payload = {
      user_id: phone,
      tenant_id: TENANT_ID,
      title: title && title.trim() ? title.trim() : phone,
    };
    const { data: inserted, error: insertError } = await supabase
      .from("conversations")
      .insert(payload)
      .select("id")
      .single();
    if (insertError) {
      throw insertError;
    }
    return { id: inserted!.id, isNew: true };
  } catch (error) {
    console.warn("[SUPABASE] conversation error", error);
    return null;
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
    };
    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn("[SUPABASE] insert message failed", error);
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
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      throw error;
    }
    return (data ?? [])
      .map((row) => ({
        role: row.role === "assistant" ? "assistant" : "user",
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
