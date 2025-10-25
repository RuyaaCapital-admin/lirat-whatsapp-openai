import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";
export type ConversationEntry = { role: ConversationRole; content: string };

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

export async function getOrCreateConversationByTitle(phone: string): Promise<string | null> {
  const supabase = getClient();
  if (!supabase || !phone) return null;
  try {
    const { data: existing, error: selError } = await supabase
      .from("conversations")
      .select("id")
      .eq("title", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!selError && existing?.id) return existing.id as string;
  } catch (e) {
    console.warn("[SUPABASE] select conv title failed", e);
  }
  try {
    const payload: Record<string, unknown> = {
      title: phone,
      created_at: new Date().toISOString(),
    };
    const supabase = getClient();
    if (!supabase) return null;
    const { data, error } = await supabase.from("conversations").insert(payload).select("id").single();
    if (!error && data?.id) return data.id as string;
  } catch (e) {
    console.warn("[SUPABASE] insert conv failed", e);
  }
  return null;
}

export async function fetchRecentContext(conversationId: string, limit = 10): Promise<ConversationEntry[]> {
  const supabase = getClient();
  if (!supabase || !conversationId) return [];
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return [];
    return (data || [])
      .map<ConversationEntry>((r: any) => ({
        role: (r.role === "assistant" ? "assistant" : "user") as ConversationRole,
        content: String(r.content ?? ""),
      }))
      .filter((r) => r.content.trim().length > 0);
  } catch (e) {
    console.warn("[SUPABASE] fetch context failed", e);
    return [];
  }
}

export async function insertMessage(conversationId: string, role: ConversationRole, content: string): Promise<void> {
  const supabase = getClient();
  if (!supabase || !conversationId || !content?.trim()) return;
  try {
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role,
      content,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[SUPABASE] insert message failed", e);
  }
}
