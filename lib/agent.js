import { tool, Agent, Runner } from "@openai/agents";
import { z } from "zod";

// ---- ENV
const FCS_KEY = process.env.FCS_API_KEY || process.env.PRICE_API_KEY;

// ---- Helpers
const clean = s => (s || "").toUpperCase().replace(/\s+/g,"").replace(/[-_]/g,"");
const toPretty = s => {
  const x = clean(s);
  if (x === "XAUUSD") return "XAU/USD";
  if (x === "XAGUSD") return "XAG/USD";
  if (/^[A-Z]{6}$/.test(x)) return x.slice(0,3)+"/"+x.slice(3); // EURUSD -> EUR/USD
  return s.toUpperCase();
};
const isCrypto = p => p.endsWith("USDT");
const fmt = n => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6));
const hhmm = ms => new Date(ms).toISOString().slice(11,16);

// ---- Indicators
const ema = (a,p)=>{const k=2/(p+1);let e=a[0];for(let i=1;i<a.length;i++)e=a[i]*k+e*(1-k);return e;};
const rsi14 = cl => {let g=0,l=0;for(let i=cl.length-14;i<cl.length;i++){const d=cl[i]-cl[i-1];if(d>0)g+=d;else l-=d;}const rs=g/(l||1e-12);return 100-100/(1+rs);};
const macd = cl => {
  const arr=cl.slice(-120);
  let x12=arr[0],x26=arr[0],k12=2/(12+1),k26=2/(26+1), diff=[];
  for(let i=1;i<arr.length;i++){ x12=arr[i]*k12+x12*(1-k12); x26=arr[i]*k26+x26*(1-k26); diff.push(x12-x26); }
  let sig=diff[0],k9=2/(9+1); for(let i=1;i<diff.length;i++) sig=diff[i]*k9+sig*(1-k9);
  const line = ema(arr,12)-ema(arr,26);
  return { line, signal:sig, hist: line - sig };
};
const atr14 = c => {
  const n=c.length,start=Math.max(1,n-15),trs=[];
  for(let i=start;i<n;i++){const h=c[i].h,l=c[i].l,pc=c[i-1].c;trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc))); }
  return trs.reduce((a,b)=>a+b,0)/(trs.length||1);
};
const rrK = tf => ({'1m':0.35,'5m':0.50,'15m':0.75,'30m':0.90,'1h':1.00,'4h':1.50,'1d':2.00}[tf] ?? 0.75);

// ---- TOOLS
const getOhlc = tool({
  name: "getOhlc",
  description: "Return candles for symbol/interval. FCS for FX/metals; Binance for crypto.",
  parameters: z.object({ symbol: z.string(), interval: z.string(), limit: z.number().int().default(300) }),
  execute: async ({ symbol, interval, limit }) => {
    const p = toPretty(symbol);
    if (isCrypto(p)) {
      const u=`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(p)}&interval=${interval}&limit=${Math.min(limit,1000)}`;
      const r=await fetch(u); const arr=await r.json();
      const candles = arr.map(k=>({t:Math.floor(k[0]/1000),o:+k[1],h:+k[2],l:+k[3],c:+k[4]})).filter(v=>Number.isFinite(v.c));
      return { symbol:p, period:interval, candles };
    }
    if(!FCS_KEY) throw new Error("FCS_API_KEY missing");
    const u=`https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(p)}&period=${interval}&access_key=${FCS_KEY}`;
    const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0'}}); const j=await r.json();
    const rows=Object.values(j?.response||j?.data||{});
    const candles=rows.map(x=>({t:Number(x.t)||Math.floor(new Date(x.tm||x.date).getTime()/1000),o:+x.o,h:+x.h,l:+x.l,c:+x.c}))
                      .filter(v=>Number.isFinite(v.c)).slice(-limit);
    return { symbol:p, period:interval, candles };
  }
});

const computeTradingSignal = tool({
  name: "computeTradingSignal",
  description: "Compute EMA20/50, RSI14, MACD(12,26,9), ATR14 + BUY/SELL/NEUTRAL, SL/TP. Returns {text}.",
  parameters: z.object({
    symbol: z.string(),
    period: z.string(),
    candles: z.array(z.object({t:z.number(),o:z.number(),h:z.number(),l:z.number(),c:z.number()}))
  }),
  execute: async ({ symbol, period, candles }) => {
    const c=candles.slice(-300); const closes=c.map(x=>x.c);
    if (closes.length<60) return { text: "Data unavailable right now. Try another timeframe." };
    const close=closes.at(-1), e20=ema(closes.slice(-60),20), e50=ema(closes.slice(-120),50);
    const rsi=rsi14(closes); const {line:mL,signal:mS,hist}=macd(closes); const atr=atr14(c);
    let action="NEUTRAL"; if (close>e50&&e20>e50&&Math.abs(rsi-55)>1&&mL>mS) action="BUY";
    if (close<e50&&e20<e50&&rsi<=45&&mL<mS) action="SELL";
    const risk=rrK(period)*atr; const entry=close;
    const sl  = action==="BUY"?entry-risk:action==="SELL"?entry+risk:undefined;
    const tp1 = action==="BUY"?entry+risk:action==="SELL"?entry-risk:undefined;
    const tp2 = action==="BUY"?entry+2*risk:action==="SELL"?entry-2*risk:undefined;
    const t = hhmm((c.at(-1).t||Math.floor(Date.now()/1000))*1000);
    let text =
`Time (UTC): ${t}
Symbol: ${symbol}
Interval: ${period}
Close: ${fmt(close)}
EMA20: ${fmt(e20)}
EMA50: ${fmt(e50)}
RSI14: ${rsi.toFixed(2)}
MACD(12,26,9): ${fmt(mL)} / ${fmt(mS)} (hist ${fmt(hist)})
ATR14: ${fmt(atr)}
SIGNAL: (${action})`;
    if (action!=="NEUTRAL") {
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
  name: "getPrice",
  description: "4-line latest CLOSED price. FX/metals via FCS; crypto via Binance. Returns {text}.",
  parameters: z.object({ symbol: z.string() }),
  execute: async ({ symbol }) => {
    const p = toPretty(symbol);
    if (isCrypto(p)) {
      const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(p)}&interval=1m&limit=2`);
      const data=await r.json(); const k=data.at(-1);
      const t=hhmm(k[0]+60000); const price=+k[4];
      return { text:
`Time (UTC): ${t}
Symbol: ${p}
Price: ${fmt(price)}
Note: latest CLOSED price` };
    }
    if (!FCS_KEY) return { text: "Data unavailable right now. Try: price BTCUSDT" };
    const r=await fetch(`https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(p)}&access_key=${FCS_KEY}`,{headers:{'User-Agent':'Mozilla/5.0'}});
    const j=await r.json(); const row=j?.response?.[0];
    if (!row) return { text: "Data unavailable right now. Try another symbol." };
    let price=Number(row.c); const tIso=row.tm||(row.t?new Date(row.t*1000).toISOString():new Date().toISOString());
    const t=(tIso||"").slice(11,16);
    return { text:
`Time (UTC): ${t}
Symbol: ${p}
Price: ${fmt(price)}
Note: latest CLOSED price` };
  }
});

// ---- Agent
const liiratAssistant = new Agent({
  name: "Liirat Assistant",
  instructions:
`If a tool returns {text}, output EXACTLY that text and nothing else.
Be brief. Do not mention tools or internals.
For price → call getPrice. For signal → getOhlc then computeTradingSignal.`,
  model: "gpt-4o-mini",
  tools: [ getOhlc, computeTradingSignal, getPrice ],
  modelSettings: { temperature: 0.3, topP: 1, parallelToolCalls: false, maxTokens: 900, store: false }
});

export async function runWorkflow({ input_as_text }) {
  const runner = new Runner({ traceMetadata: { __trace_source__: "agent-builder", workflow_id: "wf_68f727c14ea08190b41d781adfea66ac0421e4aa99b1c9bb" } });
  const res = await runner.run(liiratAssistant, [{ role:"user", content:[{ type:"input_text", text: input_as_text }]}]);
  if (!res.finalOutput) throw new Error("Agent result is undefined");
  return { output_text: res.finalOutput };
}
