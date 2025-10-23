'use strict';
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios').default;

const app = express().use(bodyParser.json());

// === ENV ===
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN;
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;          // optional
const OPENAI_MODEL     = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// === Graph API client ===
const graph = axios.create({
  baseURL: `https://graph.facebook.com/${WHATSAPP_VERSION}`,
  timeout: 15000
});
const gh = () => ({
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json'
});

// === Typing / Read / Send ===
async function typing(phone, to) {
  try {
    await graph.post(`/${phone}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'action',
      action: { typing: 'typing' }
    }, { headers: gh() });
  } catch (e) {
    console.warn('typing failed:', e.response?.data || e.message);
  }
}
function startTypingLoop(phone, to) {
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    try { await typing(phone, to); } catch (_) {}
    if (alive) setTimeout(tick, 8000);
  };
  tick();
  return () => { alive = false; };
}
async function markRead(phone, id) {
  try {
    await graph.post(`/${phone}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: id
    }, { headers: gh() });
  } catch (_) {}
}
async function send(messages, phone, to) {
  for (const m of messages) {
    const data = (m.type === 'text')
      ? { messaging_product:'whatsapp', to, type:'text', text:{ preview_url:false, body:m.value } }
      : (m.type === 'image')
      ? { messaging_product:'whatsapp', to, type:'image', image:{ link:m.value } }
      : null;
    if (!data) continue;
    await graph.post(`/${phone}/messages`, data, { headers: gh() });
  }
}

// === Compact Price Formatter ===
// XAU/XAG via Yahoo Finance (closed price). Crypto via Binance (closed price).
const YF_MAP = {
  'XAU/USD': 'XAUUSD=X',
  'XAG/USD': 'XAGUSD=X',
};
function mapArabicToSymbol(text) {
  const t = (text || '').toLowerCase();
  if (/(ذهب|الذهب|دهب|gold|xau)/.test(t)) return { pretty: 'XAU/USD', source: 'yahoo' };
  if (/(فضة|الفضة|silver|xag)/.test(t))     return { pretty: 'XAG/USD', source: 'yahoo' };
  if (/(بيتكوين|البيتكوين|btc)/.test(t))    return { pretty: 'BTCUSDT', source: 'binance' };
  if (/(اثيريوم|إيثيريوم|eth)/.test(t))     return { pretty: 'ETHUSDT', source: 'binance' };
  return null;
}
async function fetchYahooClose(pretty) {
  const ticker = YF_MAP[pretty];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`;
  const { data } = await axios.get(url, { timeout: 15000 });
  const r = data?.chart?.result?.[0];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const ts = r?.timestamp || [];
  let i = closes.length - 1; while (i >= 0 && (closes[i] == null)) i--;
  if (i < 0) throw new Error('no_close');
  const price = Number(closes[i]);
  const timeUTC = new Date(ts[i] * 1000).toISOString().slice(11,16); // HH:MM
  return { price, timeUTC, note: 'latest CLOSED price' };
}
async function fetchBinanceClose(symbol) {
  const { data } = await axios.get(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=2`,
    { timeout: 12000 }
  );
  const last = data[data.length - 1];
  const price = Number(last[4]);                 // close
  const timeUTC = new Date(last[0] + 60_000).toISOString().slice(11,16);
  return { price, timeUTC, note: 'latest CLOSED price' };
}
function fmtPrice({ timeUTC, symbolPretty, price, note }) {
  let s;
  if (price >= 100) s = price.toFixed(2);
  else if (price >= 1) s = price.toFixed(4);
  else s = price.toFixed(6);
  return `Time (UTC): ${timeUTC}\nSymbol: ${symbolPretty}\nPrice: ${s}\nNote: ${note}`;
}

// === Simple Signal (SMA20/50 on 1h) for crypto symbols ===
async function getSignal(sym) {
  const { data } = await axios.get(
    `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=200`,
    { timeout: 15000 }
  );
  const c = data.map(k => Number(k[4]));
  if (c.length < 50) throw new Error('Too few candles');
  const sma = n => c.slice(-n).reduce((a,b)=>a+b,0)/n;
  const sma20 = sma(20), sma50 = sma(50), last = c.at(-1);
  const signal = (sma20 > sma50 && last > sma50) ? 'buy'
               : (sma20 < sma50 && last < sma50) ? 'sell'
               : 'hold';
  return { signal, sma20, sma50, last };
}

// === OpenAI Agent fallback (optional) ===
async function askAgent(userText) {
  if (!OPENAI_API_KEY) return null;
  try {
    const { Agent, Runner, webSearchTool, hostedMcpTool } = await import('@openai/agents');
    const webSearchPreview = webSearchTool({
      searchContextSize: 'low',
      userLocation: { timezone: 'Asia/Dubai', type: 'approximate' }
    });
    const mcp = hostedMcpTool({
      serverLabel: 'current_time',
      allowedTools: ['get_utc_time','convert_time','list_timezones'],
      requireApproval: 'never',
      serverDescription: 'Current time',
      serverUrl: 'https://a.currenttimeutc.com/mcp'
    });
    const SYSTEM_PROMPT = `You are Liirat Assistant. Be brief and decisive; answer in the user's language; max 4 lines.`;
    const agent = new Agent({
      name: 'Liirat Assistant',
      model: OPENAI_MODEL,
      tools: [webSearchPreview, mcp],
      modelSettings: { temperature: 0.3, topP: 1, maxTokens: 900, store: false },
      instructions: SYSTEM_PROMPT
    });
    const runner = new Runner();
    const result = await runner.run(agent, [
      { role: 'user', content: [{ type: 'input_text', text: userText }] }
    ]);
    return result.finalOutput || null;
  } catch (e) {
    console.error('Agent error:', e.response?.data || e.message);
    return null;
  }
}

// === Noise filters / health ===
app.get(['/favicon.ico','/favicon.png'], (_, res) => res.status(204).end());
app.get('/', (_, res) => res.status(200).send('ok'));

// === Webhook verify ===
function verifyHandler(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).send('Forbidden');
}
app.get(['/webhook','/api/server/webhook'], verifyHandler);

// === Webhook message ===
app.post(['/webhook','/api/server/webhook'], async (req, res) => {
  try {
    const change  = req.body?.entry?.[0]?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message?.text?.body) return res.status(200).json({ ok: true });

    const phone = change.value.metadata.phone_number_id;
    const from  = message.from;
    const body  = message.text.body.trim();
    const lower = body.toLowerCase();

    // duplicate guard
    const msgId = message.id;
    if (globalThis._handledIds?.has(msgId)) return res.status(200).json({ ok: true });
    (globalThis._handledIds ||= new Set()).add(msgId);
    setTimeout(() => globalThis._handledIds.delete(msgId), 60000);

    const stopTyping = startTypingLoop(phone, from);

    // Natural "price" question → compact formatter
    const mapped = mapArabicToSymbol(body);
    if (/(سعر|price)/i.test(body) && mapped) {
      let resData;
      if (mapped.source === 'yahoo') resData = await fetchYahooClose(mapped.pretty);
      else resData = await fetchBinanceClose(mapped.pretty);
      const msg = fmtPrice({ timeUTC: resData.timeUTC, symbolPretty: mapped.pretty, price: resData.price, note: resData.note });
      await send([{ type:'text', value: msg }], phone, from);
      await markRead(phone, message.id);
      stopTyping();
      return res.status(200).json({ ok: true });
    }

    // Command: explicit price SYMBOL
    if (lower.startsWith('price ')) {
      const sym = body.split(/\s+/)[1].toUpperCase();
      let resData;
      if (/USDT$/.test(sym)) resData = await fetchBinanceClose(sym);
      else if (sym === 'XAUUSD') resData = await fetchYahooClose('XAU/USD');
      else if (sym === 'XAGUSD') resData = await fetchYahooClose('XAG/USD');
      else resData = await fetchBinanceClose(sym);
      const pretty = (sym === 'XAUUSD') ? 'XAU/USD' : (sym === 'XAGUSD') ? 'XAG/USD' : sym;
      const msg = fmtPrice({ timeUTC: resData.timeUTC, symbolPretty: pretty, price: resData.price, note: resData.note });
      await send([{ type:'text', value: msg }], phone, from);
      await markRead(phone, message.id);
      stopTyping();
      return res.status(200).json({ ok: true });
    }

    // Command: signal SYMBOL (crypto)
    if (lower.startsWith('signal ')) {
      const sym = body.split(/\s+/)[1].toUpperCase();
      const r = await getSignal(sym);
      const txt = `**Signal** ${sym}\nSMA-20: ${r.sma20.toFixed(2)}\nSMA-50: ${r.sma50.toFixed(2)}\nClose: ${r.last.toFixed(2)}\nAction: ${r.signal}`;
      await send([{ type:'text', value: txt }], phone, from);
      await markRead(phone, message.id);
      stopTyping();
      return res.status(200).json({ ok: true });
    }

    // Agent fallback (brief)
    let reply = await askAgent(body);
    if (!reply) reply = body || '...';
    await send([{ type:'text', value: reply }], phone, from);
    await markRead(phone, message.id);
    stopTyping();
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error(e.response?.data || e.message);
    return res.status(500).json({ ok: false });
  }
});

module.exports = app;
