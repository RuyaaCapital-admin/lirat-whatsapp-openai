// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { callBase44 } from "../../lib/base44";

async function sendWhatsApp(to: string, body: string) {
  const token = process.env.META_TOKEN;
  const phoneId = process.env.META_PHONE_ID;
  if (!token || !phoneId) return;

  try {
    const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    const txt = await resp.text();
    console.log("[WA SEND]", resp.status, txt.slice(0, 300));
  } catch (e: any) {
    console.error("[WA SEND] error:", e?.message || e);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") return res.status(200).json({ ok: true });
  if (req.method !== "POST") return res.status(405).end();

  const body = (req.body || {}) as any;
  const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = (msg?.from || "").toString();
  const text =
    (msg?.text?.body ||
      msg?.button?.text ||
      msg?.interactive?.button_reply?.title ||
      msg?.interactive?.list_reply?.title ||
      "").toString();

  console.log("[WEBHOOK-IN]", { from, text });

  let reply = "Service unavailable. Try again shortly.";
  if (from && text) reply = await callBase44(from, text);

  if (from && reply) await sendWhatsApp(from, reply);

  return res.status(200).json({ ok: true, reply });
}