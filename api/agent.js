'use strict';

const { tool, fileSearchTool, Agent, Runner, withTrace } = require('@openai/agents');
const { z } = require('zod');

// ---------- helpers ----------
const FCS_KEY = process.env.FCS_API_KEY || process.env.PRICE_API_KEY;

const toPretty = (sym) => {
  const s = (sym || '').toUpperCase().replace(/\s+/g, '').replace(/[-_]/g, '');
  if (s === 'XAUUSD') return 'XAU/USD';
  if (s === 'XAGUSD') return 'XAG/USD';
  if (/^[A-Z]{6}$/.test(s)) return s.slice(0, 3) + '/' + s.slice(3);
  return (sym || '').toUpperCase();
};
const isCrypto = (sym) => sym.toUpperCase().endsWith('USDT');

const fmt = (x) => (x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toFixed(6));
const hhmm = (tsSec) => new Date(tsSec * 1000).toISOString().slice(11, 16);

// ---------- indicators ----------
const ema = (arr, p) => {
  const k = 2 / (p + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
};
const rsi14 = (cl) => {
  let g = 0, l = 0;
  for (let i = cl.length - 14; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  const rs = g / (l || 1e-12);
  return 100 - 100 / (1 + rs);
};
const macd = (cl) => {
  const arr = cl.slice(-120);
  const ema12 = ema(arr, 12);
  const ema26 = ema(arr, 26);
  const line = ema12 - ema26;

  const diffs = [];
  {
    let e12 = arr[0], e26 = arr[0];
    const k12 = 2 / (12 + 1), k26 = 2 / (26 + 1);
    for (let i = 1; i < arr.length; i++) {
      e12 = arr[i] * k12 + e12 * (1 - k12);
      e26 = arr[i] * k26 + e26 * (1 - k26);
      diffs.push(e12 - e26);
    }
  }
  let sig = diffs[0];
  const k9 = 2 / (9 + 1);
  for (let i = 1; i < diffs.length; i++) sig = diffs[i] * k9 + sig * (1 - k9);
  return { line, signal: sig, hist: line - sig };
};
const atr14 = (candles) => {
  const n = candles.length;
  const start = Math.max(1, n - 15);
  const trs = [];
  for (let i = start; i < n; i++) {
    const h = candles[i].h;
    const l = candles[i].l;
    const pc = candles[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((a, b) => a + b, 0) / (trs.length || 1);
};
const rrK = (tf) => ({ '1m':0.35, '5m':0.50, '15m':0.75, '30m':0.90, '1h':1.00, '4h':1.50, '1d':2.00 })[tf] ?? 0.75;

// ---------- tools ----------
const getOhlc = tool({
  name: 'getOhlc',
  description: 'Return OHLC candles for symbol/interval. Use FCS for FX/metals, Binance for crypto.',
  parameters: z.object({
    symbol: z.string(),
    interval: z.string(),
    limit: z.number().int().default(300)
  }),
  execute: async ({ symbol, interval, limit }) => {
    const p = toPretty(symbol);

    if (isCrypto(p)) {
      const u = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(p)}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
      const r = await fetch(u);
      const data = await r.json();
      const candles = data.map((k) => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
      if (!candles.length) throw new Error('binance_no_data');
      return { symbol: p, period: interval, candles };
    }

    if (!FCS_KEY) throw new Error('FCS_API_KEY missing');
    const u = `https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(p)}&period=${interval}&access_key=${FCS_KEY}`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const resp = j?.response || j?.data || {};
    const rows = Object.values(resp);
    const parsed = rows.map((x) => ({
      t: Number(x.t) || Math.floor(new Date(x.tm || x.date).getTime() / 1000),
      o: +x.o,
      h: +x.h,
      l: +x.l,
      c: +x.c
    })).filter((v) => Number.isFinite(v.t) && Number.isFinite(v.c));
    if (!parsed.length) throw new Error('fcs_no_ohlc');
    const candles = parsed.slice(-limit);
    return { symbol: p, period: interval, candles };
  }
});

const computeTradingSignal = tool({
  name: 'computeTradingSignal',
  description: 'Compute EMA20/EMA50/RSI14/MACD(12,26,9)/ATR14 and a BUY/SELL/NEUTRAL signal. Returns formatted text.',
  parameters: z.object({
    symbol: z.string(),
    period: z.string(),
    candles: z.array(z.object({
      t: z.number(), o: z.number(), h: z.number(), l: z.number(), c: z.number()
    }))
  }),
  execute: async ({ symbol, period, candles }) => {
    const c = candles.slice(-300);
    const closes = c.map((x) => x.c);
    if (closes.length < 60) throw new Error('too_few_candles');

    const close = closes.at(-1);
    const e20 = ema(closes.slice(-60), 20);
    const e50 = ema(closes.slice(-120), 50);
    const rsi = rsi14(closes);
    const { line: mL, signal: mS, hist } = macd(closes);
    const atr = atr14(c);

    let action = 'NEUTRAL';
    if (close > e50 && e20 > e50 && Math.abs(rsi - 55) > 1 && mL > mS) action = 'BUY';
    if (close < e50 && e20 < e50 && rsi <= 45 && mL < mS) action = 'SELL';

    const risk = rrK(period) * atr;
    let entry = close, sl, tp1, tp2;
    if (action === 'BUY') { sl = entry - risk; tp1 = entry + risk; tp2 = entry + 2 * risk; }
    if (action === 'SELL') { sl = entry + risk; tp1 = entry - risk; tp2 = entry - 2 * risk; }

    const time = hhmm(c.at(-1).t);
    let text =
`Time (UTC): ${time}
Symbol: ${symbol}
Interval: ${period}
Close: ${fmt(close)}
EMA20: ${fmt(e20)}
EMA50: ${fmt(e50)}
RSI14: ${rsi.toFixed(2)}
MACD(12,26,9): ${fmt(mL)} / ${fmt(mS)} (hist ${fmt(hist)})
ATR14: ${fmt(atr)}
SIGNAL: (${action})`;
    if (action !== 'NEUTRAL') {
      text += `
Entry: ${fmt(entry)}
SL: ${fmt(sl)}
TP1: ${fmt(tp1)}
TP2: ${fmt(tp2)}`;
    }
    return { text };
  }
});

const getPrice = tool({
  name: 'getPrice',
  description: "Return a compact 4-line price for FX/metals (FCS) or crypto (Binance). Use the returned 'text' verbatim.",
  parameters: z.object({ symbol: z.string() }),
  execute: async ({ symbol }) => {
    const p = toPretty(symbol);

    if (isCrypto(p)) {
      const u = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(p)}&interval=1m&limit=2`;
      const r = await fetch(u);
      const data = await r.json();
      if (!data?.length) throw new Error('binance_no_data');
      const k = data.at(-1);
      const t = hhmm(Math.floor((k[0] + 60000) / 1000));
      const price = Number(k[4]);
      const text =
`Time (UTC): ${t}
Symbol: ${p}
Price: ${fmt(price)}
Note: latest CLOSED price`;
      return { time_utc: t, symbol: p, price, note: 'latest CLOSED price', text };
    }

    if (!FCS_KEY) throw new Error('FCS_API_KEY missing');
    const u = `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(p)}&access_key=${FCS_KEY}`;
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const row = j?.response?.[0];
    if (!row) throw new Error('fcs_no_data');
    const tIso = row.tm || (row.t ? new Date(row.t * 1000).toISOString() : new Date().toISOString());
    const t = tIso.slice(11, 16);
    const price = Number(row.c);
    const text =
`Time (UTC): ${t}
Symbol: ${p}
Price: ${fmt(price)}
Note: latest CLOSED price`;
    return { time_utc: t, symbol: p, price, note: 'latest CLOSED price', text };
  }
});

// ---------- file search ----------
const fileSearch = fileSearchTool(['vs_68f9b61c2ae48191be99dad2c614f9f2']);

const liiratAssistant = new Agent({
  name: 'Liirat Assistant',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  instructions: [
    'When a tool returns a field named text, output exactly that text as the final answer (no extra commentary).',
    'You are Liirat Assistant. Reply briefly (≤4 lines) in the user language. No links.'
  ].join('\n'),
  tools: [getPrice, getOhlc, computeTradingSignal, fileSearch],
  modelSettings: {
    temperature: 0.3,
    topP: 1,
    maxTokens: 900,
    store: false,
    toolChoice: 'required'
  }
});

const runWorkflow = async (workflow) => {
  return await withTrace('liirat1', async () => {
    const conversationHistory = [{
      role: 'user',
      content: [{ type: 'input_text', text: workflow.input_as_text }]
    }];

    const runner = new Runner({
      traceMetadata: {
        __trace_source__: 'agent-builder',
        workflow_id: 'wf_68f727c14ea08190b41d781adfea66ac0421e4aa99b1c9bb'
      }
    });

    const res = await runner.run(liiratAssistant, conversationHistory);
    if (!res.finalOutput) throw new Error('Agent result is undefined');

    return { output_text: res.finalOutput };
  });
};

module.exports = {
  liiratAssistant,
  runWorkflow,
  tools: { getPrice, getOhlc, computeTradingSignal, fileSearch },
  _test: { helpers: { toPretty, isCrypto, fmt, hhmm, ema, rsi14, macd, atr14, rrK } }
};
