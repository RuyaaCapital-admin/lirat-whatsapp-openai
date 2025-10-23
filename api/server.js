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
async function typing(phone, to, state = 'typing') {
  try {
    await graph.post(`/${phone}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'action',
      action: { typing: state },
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

async function pauseTyping(phone, to) {
  return typing(phone, to, 'paused');
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

function resOK(res, extra) {
  const payload = extra ? { ok: true, ...extra } : { ok: true };
  return res.status(200).json(payload);
}

const SYSTEM_PROMPT = `
You are Liirat Assistant. Be brief and decisive. For trading Q&A:
- Prefer compact answers (<=4 lines).
- Arabic or English matching user.
- No news paragraphs or links.
- If user asked "price" and symbol is recognized, defer to webhook formatter (do not restate).
`;

// --- OpenAI Agent (SDK) fallback ---
function flattenAgentContent(node) {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(flattenAgentContent);
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return [node.text];
    if (typeof node.message === 'string') return [node.message];
    if (typeof node.value === 'string') return [node.value];
    if (node.content) return flattenAgentContent(node.content);
  }
  return [];
}

function sanitizeReply(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const cleaned = [];
  let skipping = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*(sources?|references?)\s*[:：]/i.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!line.trim() || /^[-*\d]/.test(line.trim()) || /https?:\/\//i.test(line)) {
        continue;
      }
      skipping = false;
    }
    cleaned.push(line);
  }
  return cleaned
    .join('\n')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
 codex/implement-typing-helper-and-price-replies
      instructions: SYSTEM_PROMPT.trim()

      instructions: [
        'You are the official Liirat WhatsApp assistant.',
        'Reply exactly once per user message with a concise and helpful answer in the same language the user used when possible.',
        'Never mention tools, searches, or internal reasoning. Do not include any source links or citations.',
        'Keep the tone warm and professional and avoid repetitive filler.',
      ].join('\n')
 main
    });

    const runner = new Runner();
    const result = await runner.run(liiratAssistant, [
      { role: 'user', content: [{ type: 'input_text', text: userText }] }
    ]);
    const raw = flattenAgentContent(result?.finalOutput);
    const reply = sanitizeReply(raw.join('\n').trim());
    return reply || null;
  } catch (e) {
    console.error('Agent SDK error:', e.response?.data || e.message);
    return null;
  }
}

const YF_MAP = {
  'XAU/USD': 'XAUUSD=X',
  'XAG/USD': 'XAGUSD=X',
};

function mapArabicToSymbol(text) {
  const t = (text || '').toLowerCase();
  if (/(ذهب|الذهب|دهب|gold|xau)/.test(t)) return { pretty: 'XAU/USD', source: 'yahoo' };
  if (/(فضة|الفضة|silver|xag)/.test(t)) return { pretty: 'XAG/USD', source: 'yahoo' };
  if (/(بيتكوين|البيتكوين|btc)/.test(t)) return { pretty: 'BTCUSDT', source: 'binance' };
  if (/(اثيريوم|إيثيريوم|eth)/.test(t)) return { pretty: 'ETHUSDT', source: 'binance' };
  return null;
}

async function fetchYahooClose(pretty) {
  const ticker = YF_MAP[pretty];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`;
  const { data } = await axios.get(url, { timeout: 15000 });
  const r = data?.chart?.result?.[0];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const ts = r?.timestamp || [];
  let i = closes.length - 1;
  while (i >= 0 && (closes[i] == null)) i--;
  if (i < 0) throw new Error('no_close');
  const price = closes[i];
  const timeUTC = new Date(ts[i] * 1000).toISOString().slice(11, 16);
  return { price, timeUTC, note: 'latest CLOSED price' };
}

async function fetchBinanceClose(symbol) {
  const { data } = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=2`, { timeout: 12000 });
  const last = data[data.length - 1];
  const price = Number(last[4]);
  const timeUTC = new Date(last[0] + 60_000).toISOString().slice(11, 16);
  return { price, timeUTC, note: 'latest CLOSED price' };
}

function fmtPrice({ timeUTC, symbolPretty, price, note }) {
  let formatted;
  if (price >= 100) formatted = price.toFixed(2);
  else if (price >= 1) formatted = price.toFixed(4);
  else formatted = price.toFixed(6);
  return `Time (UTC): ${timeUTC}\nSymbol: ${symbolPretty}\nPrice: ${formatted}\nNote: ${note}`;
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
 codex/implement-typing-helper-and-price-replies
  let stopTyping = () => {};

  let phone = null;
  let from = null;
  let typingActive = false;

  const stopTyping = async () => {
    if (typingActive && phone && from) {
      typingActive = false;
      await pauseTyping(phone, from);
    }
  };

main
  try {
    const change  = req.body?.entry?.[0]?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return resOK(res);

    phone = change.value?.metadata?.phone_number_id;
    if (!phone) {
      console.error('Missing phone number id');
      return resOK(res);
    }
codex/implement-typing-helper-and-price-replies
    const from  = message.from;
    const bodyRaw = message?.text?.body;
    if (!bodyRaw) return resOK(res);

    const msgId = message.id;
    if (globalThis._handledIds?.has(msgId)) return resOK(res);
    (globalThis._handledIds ||= new Set()).add(msgId);
    setTimeout(() => globalThis._handledIds.delete(msgId), 60_000);

    stopTyping = startTypingLoop(phone, from);

    from  = message.from;

    await typing(phone, from);
    typingActive = true;
 main

    const body  = bodyRaw.trim();
    const lower = body.toLowerCase();

    // commands
    if (lower.startsWith('price ')) {
      const sym = body.split(/\s+/)[1]?.toUpperCase();
      if (!sym) {
        await stopTyping();
        await send([{ type:'text', value: 'Please provide a symbol, for example: price BTCUSDT' }], phone, from);
        await markRead(phone, message.id);
        return res.status(200).json({ ok: true });
      }
      const p = await getPrice(sym);
      await stopTyping();
      await send([{ type:'text', value: `${sym}: ${p}` }], phone, from);
      await markRead(phone, message.id);
      stopTyping();
      return resOK(res);
    }
    if (lower.startsWith('signal ')) {
      const sym = body.split(/\s+/)[1]?.toUpperCase();
      if (!sym) {
        await stopTyping();
        await send([{ type:'text', value: 'Please provide a symbol, for example: signal BTCUSDT' }], phone, from);
        await markRead(phone, message.id);
        return res.status(200).json({ ok: true });
      }
      const r = await getSignal(sym);
      const txt = `**Signal** ${sym}\nSMA-20: ${r.sma20}\nSMA-50: ${r.sma50}\nClose: ${r.last}\nAction: ${r.signal}`;
      await stopTyping();
      await send([{ type:'text', value: txt }], phone, from);
      await markRead(phone, message.id);
      stopTyping();
      return resOK(res);
    }

    const looksLikePriceQ = /(سعر|price)/i.test(body);
    if (looksLikePriceQ) {
      const mapped = mapArabicToSymbol(body);
      if (mapped) {
        const symbolPretty = mapped.pretty;
        let priceRes;
        if (mapped.source === 'yahoo') priceRes = await fetchYahooClose(symbolPretty);
        else if (mapped.source === 'binance') priceRes = await fetchBinanceClose(symbolPretty);
        if (priceRes) {
          const msg = fmtPrice({ timeUTC: priceRes.timeUTC, symbolPretty, price: priceRes.price, note: priceRes.note });
          await send([{ type:'text', value: msg }], phone, from);
          await markRead(phone, message.id);
          stopTyping();
          return resOK(res);
        }
      }
    }

    let reply = null;
    if (body) reply = await askAgent(body);
    if (!reply) reply = '...';

    await stopTyping();
    await send([{ type: 'text', value: reply }], phone, from);
    await markRead(phone, message.id);
    stopTyping();
    return resOK(res);
  } catch (e) {
 codex/implement-typing-helper-and-price-replies
    stopTyping();

    await stopTyping();
 main
    console.error(e.response?.data || e.message);
    return res.status(500).json({ ok: false });
  }
}

app.get(['/webhook', '/api/server/webhook'], verifyHandler);
app.post(['/webhook', '/api/server/webhook'], postHandler);

module.exports = app;
