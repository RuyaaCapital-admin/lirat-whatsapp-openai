// src/lib/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
}

export interface ConversationHistory {
  conversationId: string | null;
  messages: ConversationMessage[];
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_ANON_KEY ||
  "";

const DEFAULT_TENANT_ID = process.env.SUPABASE_TENANT_ID || "default-tenant";
const DEFAULT_EXTERNAL_USER = process.env.SUPABASE_EXTERNAL_USER_ID || "external";

let client: SupabaseClient | null = null;
let disabledLogged = false;

function getClient(): SupabaseClient | null {
  if (client) {
    return client;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    if (!disabledLogged) {
      console.log("[SUPABASE] disabled", { reason: "missing_env" });
      disabledLogged = true;
    }
    return null;
  }

  client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

async function findConversationId(phone: string): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("tenant_id", DEFAULT_TENANT_ID)
      .eq("title", phone)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.error("[SUPABASE] error findConversation", error);
    return null;
  }
}

export async function getOrCreateConversation(
  phone: string,
  contactName?: string,
): Promise<string | null> {
  if (!phone) {
    return null;
  }

  const supabase = getClient();
  if (!supabase) {
    return null;
  }

  const existing = await findConversationId(phone);
  if (existing) {
    return existing;
  }

  try {
    const title = phone;
    const payload = {
      title,
      tenant_id: DEFAULT_TENANT_ID,
      user_id: DEFAULT_EXTERNAL_USER,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("conversations")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.error("[SUPABASE] error createConversation", error);
    return null;
  }
}

export async function loadRecentMessages(
  conversationId: string,
  limit = 10,
): Promise<ConversationMessage[]> {
  const supabase = getClient();
  if (!supabase || !conversationId) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role,content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return (data as Array<{ role?: string | null; content?: string | null }> | null)?.flatMap(
      (row) => {
        const role = row?.role === "assistant" ? "assistant" : row?.role === "user" ? "user" : null;
        const content = typeof row?.content === "string" ? row.content.trim() : "";
        return role && content ? [{ role, content }] : [];
      },
    ) ?? [];
  } catch (error) {
    console.error("[SUPABASE] error loadMessages", error);
    return [];
  }
}

export async function loadConversationHistory(
  phone: string,
  limit = 10,
): Promise<ConversationHistory> {
  if (!phone) {
    return { conversationId: null, messages: [] };
  }

  const supabase = getClient();
  if (!supabase) {
    return { conversationId: null, messages: [] };
  }

  const conversationId = await findConversationId(phone);
  if (!conversationId) {
    return { conversationId: null, messages: [] };
  }

  const messages = await loadRecentMessages(conversationId, limit);
  return { conversationId, messages };
}

export interface SaveMessageOptions {
  userId?: string | null;
}

export async function saveMessage(
  conversationId: string,
  role: ConversationRole,
  content: string,
  options: SaveMessageOptions = {},
): Promise<void> {
  const supabase = getClient();
  if (!supabase || !conversationId) {
    return;
  }

  const payload = {
    conversation_id: conversationId,
    role,
    content,
    user_id:
      options.userId ?? (role === "user" ? DEFAULT_EXTERNAL_USER : role === "assistant" ? "assistant" : null),
    created_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from("messages").insert(payload);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("[SUPABASE] error saveMessage", error);
    throw error;
  }
}

