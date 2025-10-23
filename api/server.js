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

// === Graph API client ===
const graph = axios.create({
  baseURL: `https://graph.facebook.com/${WHATSAPP_VERSION}`,
  timeout: 15000
});
const gh = () => ({
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json'
});

// === Read / Send ===
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
function mapArabicToSymbol(text) {
  const t = (text || '').toLowerCase();
  if (/(ذهب|الذهب|دهب|gold|xau)/.test(t)) return { pretty: 'XAU/USD', source: 'yahoo' };
  if (/(فضة|الفضة|silver|xag)/.test(t))     return { pretty: 'XAG/USD', source: 'yahoo' };
  if (/(بيتكوين|البيتكوين|btc)/.test(t))    return { pretty: 'BTCUSDT', source: 'binance' };
  if (/(اثيريوم|إيثيريوم|eth)/.test(t))     return { pretty: 'ETHUSDT', source: 'binance' };
  return null;
}
async function yahooCloseFor(ticker, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=${interval}`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error('no_result');
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const ts = r?.timestamp || [];
  let i = closes.length - 1; while (i >= 0 && (closes[i] == null)) i--;
  if (i < 0) throw new Error('no_close');
  return {
    price: Number(closes[i]),
    timeUTC: new Date(ts[i] * 1000).toISOString().slice(11,16)
  };
}

async function fetchYahooClose(pretty) {
  const candidates =
    pretty === 'XAU/USD'
      ? ['XAUUSD=X', 'XAU=X', 'GC=F']
      : ['XAGUSD=X', 'SI=F'];

  const intervals = ['1m', '5m', '15m'];

  for (const t of candidates) {
    for (const iv of intervals) {
      try {
        const r = await yahooCloseFor(t, iv);
        return { ...r, note: 'latest CLOSED price' };
      } catch (_) {}
    }
  }
  throw new Error('yahoo_unavailable');
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
function formatCompactPrice(timeUTC, symbolPretty, price, note='latest CLOSED price') {
  const p = price >= 100 ? price.toFixed(2)
          : price >= 1   ? price.toFixed(4)
          :                price.toFixed(6);
  return `Time (UTC): ${timeUTC}\nSymbol: ${symbolPretty}\nPrice: ${p}\nNote: ${note}`;
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
// ---- OPENAI AGENT (no MCP/tools; brief) ----
async function askAgent(userText) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { Agent, Runner } = await import('@openai/agents');
    const agent = new Agent({
      name: 'Liirat Assistant',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      instructions: 'You are Liirat Assistant. Reply briefly (≤4 lines) in the user language. No links.',
      modelSettings: { temperature: 0.3, topP: 1, maxTokens: 900, store: false }
    });
    const runner = new Runner();
    const result = await runner.run(agent, [
      { role: 'user', content: [{ type: 'input_text', text: userText }] }
    ]);
    return result.finalOutput || null;
  } catch (e) {
    console.error('Agent error:', e.response?.data || e.message);
    return null;  // never hang webhook
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
  let phone, from;
  try {
    const change  = req.body?.entry?.[0]?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message?.text?.body) return res.status(200).json({ ok: true });

    phone = change.value.metadata.phone_number_id;
    from  = message.from;
    const body  = message.text.body.trim();
    const lower = body.toLowerCase();

    // duplicate guard
    const msgId = message.id;
    if (globalThis._handledIds?.has(msgId)) return res.status(200).json({ ok: true });
    (globalThis._handledIds ||= new Set()).add(msgId);
    setTimeout(() => globalThis._handledIds.delete(msgId), 60000);

    await markRead(phone, message.id);

    // Natural "price" question → compact formatter
    const mapped = mapArabicToSymbol(body);
    if (/(سعر|price)/i.test(body) && mapped) {
      let r;
      if (mapped.source === 'yahoo') r = await fetchYahooClose(mapped.pretty);
      else r = await fetchBinanceClose(mapped.pretty);

      const msg = formatCompactPrice(r.timeUTC, mapped.pretty, r.price, r.note);
      await send([{ type:'text', value: msg }], phone, from);
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
      const msg = formatCompactPrice(resData.timeUTC, pretty, resData.price, resData.note);
      await send([{ type:'text', value: msg }], phone, from);
      return res.status(200).json({ ok: true });
    }

    // Command: signal SYMBOL (crypto)
    if (lower.startsWith('signal ')) {
      const sym = body.split(/\s+/)[1].toUpperCase();
      const r = await getSignal(sym);
      const txt = `**Signal** ${sym}\nSMA-20: ${r.sma20.toFixed(2)}\nSMA-50: ${r.sma50.toFixed(2)}\nClose: ${r.last.toFixed(2)}\nAction: ${r.signal}`;
      await send([{ type:'text', value: txt }], phone, from);
      return res.status(200).json({ ok: true });
    }

    // Agent fallback (brief)
    let reply = await askAgent(body);
    if (!reply) reply = 'تم';
    await send([{ type:'text', value: reply }], phone, from);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error(e.response?.data || e.message);
    try {
      if (phone && from) {
        const fallback = 'Data unavailable right now. Try: price BTCUSDT';
        await send([{ type:'text', value: fallback }], phone, from);
      }
    } catch (_) {}
    return res.status(200).json({ ok: false });
  }
});

module.exports = app;
module.exports.formatCompactPrice = formatCompactPrice;
module.exports.fetchYahooClose = fetchYahooClose;
