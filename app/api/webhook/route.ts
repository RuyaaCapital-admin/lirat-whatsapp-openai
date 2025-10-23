// app/api/webhook/route.ts  -- ESM, no external deps
const WA_VER = process.env.WHATSAPP_VERSION || 'v24.0';
const WA_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WA_URL = WA_ID ? `https://graph.facebook.com/${WA_VER}/${WA_ID}/messages` : '';

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const mode = p.get('hub.mode');
  const token = p.get('hub.verify_token');
  const challenge = p.get('hub.challenge');
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

async function wa(body: unknown) {
  if (!WA_URL || !process.env.WHATSAPP_TOKEN) return;
  await fetch(WA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).catch(() => {});
}

function firstInbound(json: any) {
  const es = Array.isArray(json?.entry) ? json.entry : [];
  for (const e of es) {
    const cs = Array.isArray(e?.changes) ? e.changes : [];
    for (const c of cs) {
      const ms = Array.isArray(c?.value?.messages) ? c.value.messages : [];
      if (ms.length) return ms[0];
    }
  }
  return null;
}

export async function POST(req: Request) {
  // ACK immediately for Meta
  const ack = Response.json({ received: true }, { status: 200 });

  // fire-and-forget
  req.json().then(async (json) => {
    const m = firstInbound(json);
    if (!m?.id || !m?.from) return;

    // mark read + (optional) typing
    await wa({ messaging_product: 'whatsapp', status: 'read', message_id: m.id });
    await wa({ messaging_product: 'whatsapp', to: m.from, type: 'typing', typing: { status: 'typing' } });

    const text = m?.text?.body || 'تم الاستلام.';
    await wa({ messaging_product: 'whatsapp', to: m.from, type: 'text', text: { body: `Echo: ${text}` } });
  }).catch(() => {});
  return ack;
}
