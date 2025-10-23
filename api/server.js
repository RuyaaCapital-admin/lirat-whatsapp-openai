'use strict';
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios').default;

const app = express().use(bodyParser.json());

// ENV
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN;

// Graph API client
const graph = axios.create({
  baseURL: `https://graph.facebook.com/${WHATSAPP_VERSION}`,
  timeout: 15000,
});
const gh = () => ({
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
});

// --- helpers: typing / read / send ---
async function typing(phone, to) {
  try {
    await graph.post(`/${phone}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'action',
      action: { typing: 'typing' },
    }, { headers: gh() });
  } catch (_) {}
}

async function markRead(phone, id) {
  try {
    await graph.post(`/${phone}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: id,
    }, { headers: gh() });
  } catch (_) {}
}

async function send(messages, phone, to) {
  for (const m of messages) {
    const data = (m.type === 'text')
      ? { messaging_product:'whatsapp', to, type:'text', text:{ preview_url:true, body:m.value } }
      : (m.type === 'image')
      ? { messaging_product:'whatsapp', to, type:'image', image:{ link:m.value } }
      : null;
    if (!data) continue;
    await graph.post(`/${phone}/messages`, data, { headers: gh() });
  }
}

// --- OpenAI Agent (SDK) fallback ---
async function askAgent(userText) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { Agent, Runner, webSearchTool, hostedMcpTool } = await import('@openai/agents');

    const webSearchPreview = webSearchTool({
      searchContextSize: 'low',
      userLocation: { timezone: 'Asia/Dubai', type: 'approximate' }
    });

    const mcp = hostedMcpTool({
      serverLabel: 'current_time',
      allowedTools: ['get_utc_time', 'convert_time', 'list_timezones'],
      requireApproval: 'never',
      serverDescription: 'Current time',
      serverUrl: 'https://a.currenttimeutc.com/mcp'
    });

    const liiratAssistant = new Agent({
      name: 'Liirat Assistant',
      model: 'gpt-4o-mini',
      tools: [webSearchPreview, mcp],
      modelSettings: { temperature: 1.05, topP: 1, maxTokens: 6593, store: true },
      instructions: `<<PASTE YOUR EXISTING INSTRUCTIONS BLOCK HERE>>`
    });

    const runner = new Runner();
    const result = await runner.run(liiratAssistant, [
      { role: 'user', content: [{ type: 'input_text', text: userText }] }
    ]);
    return result.finalOutput || null;
  } catch (e) {
    console.error('Agent SDK error:', e.response?.data || e.message);
    return null;
  }
}

// --- price / signal (Binance public API) ---
async function getPrice(sym) {
  const r = await axios.get(
    `https://api.binance.com/api/v3/ticker/price?symbol=${sym}`
  );
  if (!r.data?.price) throw new Error('Invalid symbol');
  return r.data.price;
}

async function getSignal(sym) {
  const { data } = await axios.get(
    `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=200`
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

// --- health ---
app.get(['/favicon.ico', '/favicon.png'], (_, res) => res.status(204).end());
app.get('/', (_, res) => res.status(200).send('ok'));

// --- webhook verification ---
function verifyHandler(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).send('Forbidden');
}

// --- webhook messages ---
async function postHandler(req, res) {
  try {
    const change  = req.body?.entry?.[0]?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return res.status(200).json({ ok: true });

    const phone = change.value?.metadata?.phone_number_id;
    if (!phone) {
      console.error('Missing phone number id');
      return res.status(200).json({ ok: true });
    }
    const from  = message.from;

    await typing(phone, from);

    const body  = message.text?.body?.trim() || '';
    const lower = body.toLowerCase();

    // commands
    if (lower.startsWith('price ')) {
      const sym = body.split(/\s+/)[1].toUpperCase();
      const p = await getPrice(sym);
      await send([{ type:'text', value: `${sym}: ${p}` }], phone, from);
      await markRead(phone, message.id);
      return res.status(200).json({ ok: true });
    }
    if (lower.startsWith('signal ')) {
      const sym = body.split(/\s+/)[1].toUpperCase();
      const r = await getSignal(sym);
      const txt = `**Signal** ${sym}\nSMA-20: ${r.sma20}\nSMA-50: ${r.sma50}\nClose: ${r.last}\nAction: ${r.signal}`;
      await send([{ type:'text', value: txt }], phone, from);
      await markRead(phone, message.id);
      return res.status(200).json({ ok: true });
    }

    let reply = null;
    if (body) reply = await askAgent(body);
    if (!reply) reply = '...';

    await send([{ type: 'text', value: reply }], phone, from);
    await markRead(phone, message.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e.response?.data || e.message);
    return res.status(500).json({ ok: false });
  }
}

app.get(['/webhook', '/api/server/webhook'], verifyHandler);
app.post(['/webhook', '/api/server/webhook'], postHandler);

module.exports = app;
