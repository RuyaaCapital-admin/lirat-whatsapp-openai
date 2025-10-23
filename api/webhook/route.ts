import { alreadyHandled } from "../../src/idempotency";
import { env } from "../../src/env";
import { wabaText, wabaTyping } from "../../src/waba";
import { runAgent } from "../../lib/agent";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const id: string | undefined = message?.id;
    const from: string | undefined = message?.from;
    const text: string | undefined = message?.text?.body;

    if (!id || !from || !text) {
      return Response.json({ ok: true });
    }

    if (alreadyHandled(id)) {
      return Response.json({ ok: true });
    }

    await wabaTyping(from, true);
    let reply = "";
    try {
      reply = await runAgent(text.trim());
    } catch (err) {
      console.error("agent_error", err);
      reply = "تعذر معالجة الطلب الآن. حاول لاحقًا.";
    }
    if (!reply) {
      reply = "تعذر معالجة الطلب الآن. حاول لاحقًا.";
    }
    try {
      await wabaText(from, reply.slice(0, 4096));
    } finally {
      try {
        await wabaTyping(from, false);
      } catch (typingErr) {
        console.error("typing_off_error", typingErr);
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("webhook_error", err);
    return Response.json({ ok: true });
  }
}
