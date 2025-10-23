// app/api/webhook/route.ts
const WA_VER = process.env.WHATSAPP_VERSION || 'v24.0';
const WA_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN  = process.env.WHATSAPP_TOKEN || '';
const GRAPH_URL = WA_ID ? `https://graph.facebook.com/${WA_VER}/${WA_ID}/messages` : '';

async function wa(body: unknown) {
  if (!GRAPH_URL || !TOKEN) return;
  await fetch(GRAPH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).catch(() => {});
}
function firstMsg(j: any) {
  const es = Array.isArray(j?.entry) ? j.entry : [];
  for (const e of es) {
    const cs = Array.isArray(e?.changes) ? e.changes : [];
    for (const c of cs) {
      const ms = Array.isArray(c?.value?.messages) ? c.value.messages : [];
      if (ms.length) return ms[0];
    }
  }
  return null;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  const ack = Response.json({ received: true }, { status: 200 });
  req.json().then(async (json) => {
    const m = firstMsg(json);
    if (!m?.id || !m?.from) return;
    await wa({ messaging_product: 'whatsapp', status: 'read', message_id: m.id });
    await wa({ messaging_product: 'whatsapp', to: m.from, type: 'typing', typing: { status: 'typing' } });
    const txt = (m?.text?.body || 'تم الاستلام.').toString();
    await wa({ messaging_product: 'whatsapp', to: m.from, type: 'text', text: { body: `Echo: ${txt}` } });
  }).catch(() => {});
  return ack;
}
