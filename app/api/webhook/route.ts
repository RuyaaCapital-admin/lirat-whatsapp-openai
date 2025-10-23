// app/api/webhook/route.ts
const WA_VER  = process.env.WHATSAPP_VERSION || 'v24.0';
const PHONEID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN   = process.env.WHATSAPP_TOKEN || '';
const GRAPH_URL = PHONEID ? `https://graph.facebook.com/${WA_VER}/${PHONEID}/messages` : '';

const FCS_KEY = process.env.FCS_API_KEY || '';
const FCS_URL = 'https://fcsapi.com/api-v3/forex/latest';

async function wa(body: unknown) {
  if (!GRAPH_URL || !TOKEN) return { ok:false, status:0, text:'' };
  const r = await fetch(GRAPH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { ok: r.ok, status: r.status, text: await r.text().catch(()=> '') };
}

function firstInbound(json: any) {
  const es = Array.isArray(json?.entry) ? json.entry : [];
  for (const e of es) {
    const cs = Array.isArray(e?.changes) ? e.changes : [];
    for (const c of cs) {
      const v = c?.value;
      const ms = Array.isArray(v?.messages) ? v.messages : [];
      if (ms.length) return { msg: ms[0], from: v?.contacts?.[0]?.wa_id || ms[0]?.from };
    }
  }
  return null;
}

function n(x:any){ return Number(String(x ?? '').replace(',', '.')); }
function pickPrice(item:any){
  for (const k of ['bid','ask','price','c']) {
    const v = n(item?.[k]); if (!Number.isNaN(v)) return { price:v, field:k, ts:Number(item?.t)||Math.floor(Date.now()/1000) };
  }
  return null;
}
async function fcs(symbol:string){
  if(!FCS_KEY) return { err:'FCS_API_KEY missing' };
  const u = new URL(FCS_URL); u.searchParams.set('symbol',symbol); u.searchParams.set('access_key',FCS_KEY);
  const r = await fetch(u, { cache:'no-store' }); if(!r.ok) return { err:`FCS ${r.status}` };
  const j = await r.json().catch(()=> ({}));
  const it = Array.isArray(j?.response) ? j.response[0] : undefined;
  if(!it) return { err:'FCS empty' };
  const p = pickPrice(it); if(!p) return { err:'FCS schema change' };
  return p; // {price, field, ts}
}

async function sendText(to:string, body:string){ await wa({ messaging_product:'whatsapp', to, type:'text', text:{ body } }); }
async function markRead(id:string){ await wa({ messaging_product:'whatsapp', status:'read', message_id:id }); }
async function typing(to:string){ const r = await wa({ messaging_product:'whatsapp', to, type:'typing', typing:{ status:'typing' } }); if(!r.ok && r.status===400) {/* ignore */} }

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get('hub.mode')==='subscribe' && p.get('hub.verify_token')===process.env.VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  console.log('WABA webhook hit', new Date().toISOString());
  const ack = Response.json({ received:true }, { status:200 });

  req.clone().json().then(async (json)=>{
    const hit = firstInbound(json);
    if(!hit?.msg?.id || !hit.from) return; // ignore statuses etc.
    const { msg, from } = hit;

    await markRead(msg.id);
    await typing(from);

    const text = (msg?.text?.body || '').trim();

    // Price intent (minimal)
    if (/xau|gold|ذهب/i.test(text)) {
      const g = await fcs('XAU/USD');
      if ('err' in (g as any)) return void sendText(from, `تعذر جلب السعر: ${(g as any).err}`);
      const { price, field, ts } = g as any;
      const t = new Date(ts*1000).toUTCString();
      return void sendText(from, `Time (UTC): ${t}\nSymbol: XAU/USD\nPrice: ${price}\nSource: FCS ${field}`);
    }

    // Agent Builder integration
    try {
      const { runWorkflow } = await import('../../../lib/agent');
      const result = await runWorkflow({ input_as_text: text });
      return void sendText(from, result.output_text);
    } catch (error) {
      console.error('Agent processing error:', error);
      return void sendText(from, 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
    }
  }).catch(()=>{});

  return ack;
}