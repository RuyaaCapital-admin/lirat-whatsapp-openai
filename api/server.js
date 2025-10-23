import { runWorkflow } from "../lib/agent.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) return res.status(200).send(challenge);
      return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const body = req.body || {};
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    const from = msg?.from;
    const text = msg?.text?.body?.trim();

    if (!from || !text) return res.status(200).json({ ok: true });

    // mark as read first
    await markRead(msg.id);

    // normalize intent
    const { isPrice, isSignal, symbol, interval } = extract(text);

    let out;
    if (isPrice && symbol) {
      out = await run("price " + symbol);
    } else if (isSignal && symbol) {
      const tf = interval || "15m";
      out = await run(`signal ${symbol} ${tf}`);
    } else {
      // pass through for chit-chat if needed; here we keep it simple
      out = await run(text);
    }

    await sendText(from, out);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ ok: true });
  }
}

// ---- helpers
function normalizeArabicDigits(s){ return s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }

function extract(t0) {
  const t = normalizeArabicDigits(String(t0||"")).toLowerCase();

  const map = [
    [/(\b(ذهب|الذهب|دهب|gold)\b)/i, "XAUUSD"],
    [/(\b(فضة|الفضة|silver)\b)/i, "XAGUSD"],
    [/(\b(برنت)\b)/i, "XBRUSD"],
    [/(\b(نفط|خام|wti)\b)/i, "XTIUSD"],
    [/(\b(بيتكوين|btc)\b)/i, "BTCUSDT"],
    [/(\b(اثيريوم|إيثيريوم|eth)\b)/i, "ETHUSDT"],
    [/(\b(يورو)\b)/i, "EURUSD"],
    [/(\b(ين|ين ياباني)\b)/i, "USDJPY"],
    [/(\b(فرنك سويسري)\b)/i, "USDCHF"],
    [/(\b(جنيه استرليني)\b)/i, "GBPUSD"],
    [/(\b(دولار كندي)\b)/i, "USDCAD"],
    [/(\b(دولار استرالي|أسترالي)\b)/i, "AUDUSD"],
    [/(\b(دولار نيوزلندي)\b)/i, "NZDUSD"],
  ];
  let symbol=null; for (const [re,s] of map) if (re.test(t)) { symbol=s; break; }
  const m1 = t.match(/\b([a-z]{3}\/[a-z]{3}|[a-z]{6}|[a-z]+usdt)\b/i); if (m1) symbol = m1[1].toUpperCase();

  const isPrice = /(سعر|price|آخر سعر)/i.test(t);
  const tfMap = { "1m":["1m","دقيقة","عالدفعة"], "5m":["5m","5","خمس","5 دقائق"], "15m":["15m","ربع","عالربع","15 دقيقة"], "30m":["30m","30 دقيقة"], "1h":["1h","ساعة","عالساعة"], "4h":["4h","4 ساعات","عال4"], "1d":["1d","يوم","يومي"] };
  let interval=null; for (const [k,arr] of Object.entries(tfMap)) if (arr.some(w=>t.includes(w))) { interval=k; break; }
  const isSignal = /(إشارة|signal|تحليل|صفقة|وين رايح|شو وضع)/i.test(t) || interval!=null;

  if (isSignal && !interval) interval="15m";
  return { isPrice, isSignal, symbol, interval };
}

async function run(input_as_text){ const r = await runWorkflow({ input_as_text }); return r.output_text; }

const GRAPH = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}`;

async function sendText(to, text){
  await fetch(`${GRAPH}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify({ messaging_product:"whatsapp", to, type:"text", text:{ body: String(text).slice(0, 4096) } })
  });
}

async function markRead(id){
  await fetch(`${GRAPH}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type":"application/json" },
    body: JSON.stringify({ messaging_product:"whatsapp", status:"read", message_id:id })
  });
}
