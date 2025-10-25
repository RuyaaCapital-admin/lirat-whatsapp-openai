import { randomUUID } from "node:crypto";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type ConversationRole = "user" | "assistant";

export interface ConversationContextEntry {
  role: ConversationRole;
  content: string;
}

export interface ConversationLookupResult {
  conversation_id: string;
  tenant_id: string | null;
  user_id: string | null;
  isNew: boolean;
  last_symbol?: string | null;
  last_tf?: string | null;
}

const SUPABASE_TENANT_ID = process.env.SUPABASE_TENANT_ID ?? process.env.DEFAULT_TENANT_ID ?? null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

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

function indicatesMissingColumn(error: any, column: string): boolean {
  if (!error) return false;
  if (error?.code === "42703") return true;
  const message = typeof error?.message === "string" ? error.message : "";
  const details = typeof error?.details === "string" ? error.details : "";
  const hint = typeof error?.hint === "string" ? error.hint : "";
  return [message, details, hint].some((part) =>
    part?.includes(`column \"${column}`) || part?.includes(`column ${column}`),
  );
}

function normaliseSymbolValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length ? trimmed : null;
}

function normaliseTimeframeValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function mapConversationRow(
  row: any,
  fallbackUserId: string,
  isNew: boolean,
): ConversationLookupResult {
  return {
    conversation_id: row.id,
    tenant_id: row.tenant_id ?? null,
    user_id: row.user_id && isUuid(row.user_id) ? row.user_id : fallbackUserId,
    isNew,
    last_symbol: normaliseSymbolValue(row?.last_symbol),
    last_tf: normaliseTimeframeValue(row?.last_tf),
  };
}

async function ensureProfileUsingProfilesTable(
  supabase: SupabaseClient,
  phone: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      if (indicatesMissingColumn(error, "phone")) {
        return null;
      }
      throw error;
    }
    if (data?.id && isUuid(data.id)) {
      return data.id;
    }
    const payload: Record<string, unknown> = {
      id: randomUUID(),
      phone,
      created_at: new Date().toISOString(),
    };
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert(payload)
      .select("id")
      .single();
    if (insertError) {
      if (indicatesMissingColumn(insertError, "phone")) {
        return null;
      }
      throw insertError;
    }
    return inserted?.id && isUuid(inserted.id) ? inserted.id : null;
  } catch (error) {
    console.warn("[SUPABASE] ensureProfileUsingProfilesTable error", error);
    return null;
  }
}

async function ensureProfileUsingAccountsTable(
  supabase: SupabaseClient,
  phone: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, profile_id")
      .eq("external_id", phone)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      if (indicatesMissingColumn(error, "external_id")) {
        return null;
      }
      throw error;
    }
    if (data?.profile_id && isUuid(data.profile_id)) {
      return data.profile_id;
    }

    const profileId = randomUUID();
    const profilePayload: Record<string, unknown> = {
      id: profileId,
      created_at: new Date().toISOString(),
    };
    const { error: profileError } = await supabase.from("profiles").insert(profilePayload);
    if (profileError && profileError.code !== "23505") {
      console.warn("[SUPABASE] profiles insert error", profileError);
      return null;
    }

    if (data?.id && isUuid(data.id)) {
      const { error: updateError } = await supabase
        .from("accounts")
        .update({ profile_id: profileId })
        .eq("id", data.id);
      if (updateError) {
        console.warn("[SUPABASE] accounts update error", updateError);
        return null;
      }
      return profileId;
    }

    const accountPayload: Record<string, unknown> = {
      id: randomUUID(),
      profile_id: profileId,
      external_id: phone,
      created_at: new Date().toISOString(),
    };
    const { error: accountError } = await supabase.from("accounts").insert(accountPayload);
    if (accountError) {
      if (indicatesMissingColumn(accountError, "external_id")) {
        return null;
      }
      console.warn("[SUPABASE] accounts insert error", accountError);
      return null;
    }
    return profileId;
  } catch (error) {
    console.warn("[SUPABASE] ensureProfileUsingAccountsTable error", error);
    return null;
  }
}

async function ensureProfileForPhone(waId: string): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) {
    return null;
  }
  const phone = typeof waId === "string" ? waId.trim() : "";
  if (!phone) {
    return null;
  }

  const viaProfiles = await ensureProfileUsingProfilesTable(supabase, phone);
  if (viaProfiles) {
    return viaProfiles;
  }

  const viaAccounts = await ensureProfileUsingAccountsTable(supabase, phone);
  if (viaAccounts) {
    return viaAccounts;
  }

  return null;
}

export async function createOrGetConversation(waId: string): Promise<ConversationLookupResult | null> {
  if (!waId) {
    return null;
  }
  const supabase = getClient();
  if (!supabase) {
    return { conversation_id: waId, tenant_id: null, user_id: null, isNew: true };
  }

  const userId = await ensureProfileForPhone(waId);
  if (!userId) {
    return { conversation_id: waId, tenant_id: null, user_id: null, isNew: true };
  }

  const timestamp = new Date().toISOString();

attemptLoop: for (let attempt = 0; attempt < 2; attempt += 1) {
    const useMetadata = attempt === 0;
    const selectColumns = useMetadata
      ? "id, tenant_id, user_id, last_symbol, last_tf"
      : "id, tenant_id, user_id";
    const insertColumns = selectColumns;
    let fallbackToTitle = false;

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select(selectColumns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") {
        if (useMetadata && (indicatesMissingColumn(error, "last_symbol") || indicatesMissingColumn(error, "last_tf"))) {
          continue attemptLoop;
        }
        if (indicatesMissingColumn(error, "user_id")) {
          fallbackToTitle = true;
        } else {
          throw error;
        }
      }
      if (!fallbackToTitle && data?.id && isUuid(data.id)) {
        return mapConversationRow(data, userId, false);
      }
    } catch (error) {
      console.warn("[SUPABASE] select conversation error", error);
    }

    if (!fallbackToTitle) {
      const basePayload: Record<string, unknown> = {
        user_id: userId,
        title: waId,
        created_at: timestamp,
      };
      if (SUPABASE_TENANT_ID) {
        basePayload.tenant_id = SUPABASE_TENANT_ID;
      }
      if (useMetadata) {
        basePayload.last_symbol = null;
        basePayload.last_tf = null;
      }
      const payloads: Record<string, unknown>[] = [
        { ...basePayload, channel: "whatsapp" },
        { ...basePayload },
      ];
      for (const payload of payloads) {
        try {
          const { data: inserted, error: insertError } = await supabase
            .from("conversations")
            .insert(payload)
            .select(insertColumns)
            .single();
          if (insertError) {
            if (useMetadata && (indicatesMissingColumn(insertError, "last_symbol") || indicatesMissingColumn(insertError, "last_tf"))) {
              continue attemptLoop;
            }
            if (indicatesMissingColumn(insertError, "channel") || indicatesMissingColumn(insertError, "user_id")) {
              fallbackToTitle = fallbackToTitle || indicatesMissingColumn(insertError, "user_id");
              continue;
            }
            throw insertError;
          }
          if (inserted?.id && isUuid(inserted.id)) {
            return mapConversationRow(inserted, userId, true);
          }
        } catch (error) {
          console.warn("[SUPABASE] insert conversation error", error);
        }
      }
    }

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select(selectColumns)
        .eq("title", waId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== "PGRST116") {
        if (useMetadata && (indicatesMissingColumn(error, "last_symbol") || indicatesMissingColumn(error, "last_tf"))) {
          continue attemptLoop;
        }
        throw error;
      }
      if (data?.id && isUuid(data.id)) {
        return mapConversationRow(data, userId, false);
      }
      const fallbackPayload: Record<string, unknown> = {
        title: waId,
        created_at: timestamp,
      };
      if (SUPABASE_TENANT_ID) {
        fallbackPayload.tenant_id = SUPABASE_TENANT_ID;
      }
      if (useMetadata) {
        fallbackPayload.last_symbol = null;
        fallbackPayload.last_tf = null;
      }
      const { data: inserted, error: insertError } = await supabase
        .from("conversations")
        .insert(fallbackPayload)
        .select(insertColumns)
        .single();
      if (insertError) {
        if (useMetadata && (indicatesMissingColumn(insertError, "last_symbol") || indicatesMissingColumn(insertError, "last_tf"))) {
          continue attemptLoop;
        }
        throw insertError;
      }
      if (inserted?.id && isUuid(inserted.id)) {
        return mapConversationRow(inserted, userId, true);
      }
    } catch (error) {
      console.warn("[SUPABASE] fallback conversation error", error);
    }
  }

  return { conversation_id: waId, tenant_id: null, user_id: userId, isNew: false };
}

export interface ConversationMetadataUpdate {
  last_symbol?: string | null;
  last_tf?: string | null;
}

export async function updateConversationMetadata(
  conversationId: string,
  updates: ConversationMetadataUpdate,
): Promise<void> {
  if (!conversationId || !isUuid(conversationId)) {
    return;
  }
  if (!updates || typeof updates !== "object") {
    return;
  }
  const supabase = getClient();
  if (!supabase) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(updates, "last_symbol")) {
    payload.last_symbol = normaliseSymbolValue(updates.last_symbol) ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "last_tf")) {
    payload.last_tf = normaliseTimeframeValue(updates.last_tf) ?? null;
  }
  if (!Object.keys(payload).length) {
    return;
  }
  try {
    const { error } = await supabase.from("conversations").update(payload).eq("id", conversationId);
    if (error) {
      if (
        indicatesMissingColumn(error, "last_symbol") ||
        indicatesMissingColumn(error, "last_tf")
      ) {
        return;
      }
      throw error;
    }
  } catch (error) {
    console.warn("[SUPABASE] updateConversationMetadata error", error);
  }
}

export async function logMessage(
  conversationId: string,
  role: ConversationRole,
  content: string,
  userId?: string | null,
): Promise<void> {
  if (!conversationId || !role || !content) {
    return;
  }
  if (!isUuid(conversationId)) {
    return;
  }
  const supabase = getClient();
  if (!supabase) {
    return;
  }
  const effectiveUserId = isUuid(userId) ? userId : null;
  if (!effectiveUserId) {
    console.warn("[SUPABASE] skip logMessage missing user_id", { conversationId });
    return;
  }
  try {
    const payload = {
      conversation_id: conversationId,
      user_id: effectiveUserId,
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
  if (!isUuid(conversationId)) {
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
  if (!isUuid(conversationId)) {
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
  userId?: string | null;
}

export async function insertMessage(payload: MessageInsertPayload): Promise<void> {
  if (!payload?.conversationId) return;
  await logMessage(payload.conversationId, payload.role, payload.content, payload.userId);
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
