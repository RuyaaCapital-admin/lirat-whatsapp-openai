import type { NextApiRequest, NextApiResponse } from "next";
export const config = { runtime: "nodejs" };

async function sendWhatsApp(to: string, body: string) {
  const url = `https://graph.facebook.com/v21.0/${process.env.WABA_PHONE_ID}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WABA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!r.ok) throw new Error(`waba_send_failed ${r.status}`);
}

async function callBase44(from: string, text: string) {
  const url = `${process.env.B44_BASE_URL}${process.env.B44_AGENT_FN}`;
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (process.env.B44_API_KEY) headers.Authorization = `Bearer ${process.env.B44_API_KEY}`;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ from, text }) });
  const j = await r.json().catch(() => ({}));
  return (j?.reply ?? "").toString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const { ["hub.mode"]: mode, ["hub.verify_token"]: token, ["hub.challenge"]: challenge } = req.query as any;
    if (mode === "subscribe" && token === process.env.WABA_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("forbidden");
  }
  if (req.method !== "POST") return res.status(405).end();

  try {
    const value: any = req.body?.entry?.[0]?.changes?.[0]?.value || {};
    const msg: any = value.messages?.[0];
    const from: string | undefined = msg?.from;
    const text: string | undefined = msg?.text?.body?.trim();
    if (!from || !text) return res.status(200).end();

    let reply = "";
    try { reply = (await callBase44(from, text)).trim(); }
    catch { reply = "Service unavailable. Try again shortly."; }

    await sendWhatsApp(from, reply || "…");
    return res.status(200).end();
  } catch {
    try {
      const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) await sendWhatsApp(from, "Service unavailable. Try again shortly.");
    } catch {}
    return res.status(200).end();
  }
}
