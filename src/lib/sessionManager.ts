// src/lib/sessionManager.ts
import { randomUUID } from "crypto";
import { getSupabaseClient } from "./supabase";
import { openai } from "./openai";

export interface SessionLookupResult {
  conversationId: string | null;
  sessionId: string;
}

async function createWorkflowSessionSafe(): Promise<string> {
  const wf: any = (openai as any)?.workflows;
  // Try official sessions API if available
  if (wf?.sessions?.create) {
    try {
      const session = await wf.sessions.create({});
      if (session?.id && typeof session.id === "string") return session.id;
    } catch {}
  }
  // Some SDKs expose createSession
  if (wf?.sessions?.createSession) {
    try {
      const session = await wf.sessions.createSession({});
      if (session?.id && typeof session.id === "string") return session.id;
    } catch {}
  }
  // Fallback: deterministic random id
  return `sess_${randomUUID().replace(/-/g, "")}`;
}

export async function getOrCreateWorkflowSession(
  phone: string,
  workflowId: string,
): Promise<SessionLookupResult> {
  let conversationId: string | null = null;
  let sessionId: string | null = null;

  const supabase = getSupabaseClient();
  if (supabase && phone) {
    try {
      const { data } = await supabase
        .from("conversations")
        .select("id, phone, session_id")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        conversationId = data.id as string;
        sessionId = (data as any)?.session_id ?? null;
      }
    } catch {}
  }

  if (!sessionId) {
    sessionId = await createWorkflowSessionSafe();
    if (supabase) {
      try {
        if (conversationId) {
          await supabase
            .from("conversations")
            .update({ session_id: sessionId, workflow_id: workflowId, updated_at: new Date().toISOString() })
            .eq("id", conversationId);
        } else if (phone) {
          const { data } = await supabase
            .from("conversations")
            .insert({ phone, session_id: sessionId, workflow_id: workflowId, created_at: new Date().toISOString() })
            .select("id")
            .single();
          if (data?.id) conversationId = data.id as string;
        }
      } catch {
        // Ignore schema issues; session still returned for in-memory use
      }
    }
  } else if (supabase && conversationId) {
    // Best-effort ensure workflow id is recorded
    try {
      await supabase
        .from("conversations")
        .update({ workflow_id: workflowId, updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    } catch {}
  }

  return { conversationId, sessionId };
}

export async function logMessageAsync(conversationId: string | null, role: "user" | "assistant", content: string) {
  if (!conversationId || !content?.trim()) return;
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role,
      content,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Non-blocking: swallow errors
  }
}
