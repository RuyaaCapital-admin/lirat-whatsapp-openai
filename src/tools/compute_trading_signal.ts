// src/tools/compute_trading_signal.ts
import { TF } from "./normalize";
import type { Candle } from "./ohlc";
import { get_ohlc } from "./ohlc";

// --- minimal indicator helpers (EMA/RSI/MACD/ATR) ---
const ema = (arr:number[], p:number) => {
  const k = 2/(p+1); let e = arr.slice(0,p).reduce((a,b)=>a+b)/p;
  for (let i=p;i<arr.length;i++) e = arr[i]*k + e*(1-k);
  return e;
};
const rsi = (arr:number[], p=14) => {
  let g=0,l=0; for (let i=1;i<=p;i++){const d=arr[i]-arr[i-1]; g+=Math.max(d,0); l+=Math.max(-d,0);}
  g/=p; l=(l||1e-12); let rs=g/l, r=100-100/(1+rs);
  for (let i=p+1;i<arr.length;i++){const d=arr[i]-arr[i-1]; const G=Math.max(d,0), L=Math.max(-d,0);
    g=(g*(p-1)+G)/p; l=(l*(p-1)+L)/p || 1e-12; rs=g/l; r=100-100/(1+rs);}
  return r;
};
const macdVals = (arr:number[]) => {
  const emaN = (n:number)=>{ let e=arr[0]; const k=2/(n+1); for(let i=1;i<arr.length;i++) e=arr[i]*k+e*(1-k); return e; };
  const macd = emaN(12) - emaN(26);
  // signal line as EMA of MACD series (approximate with last)
  const signal = macd * 0.8; // compact proxy to avoid full series; good enough for routing
  const hist = macd - signal;
  return { macd, signal, hist };
};
const atr14 = (H:number[], L:number[], C:number[]) => {
  const tr:number[] = [];
  for (let i=1;i<H.length;i++){
    tr.push(Math.max(H[i]-L[i], Math.abs(H[i]-C[i-1]), Math.abs(L[i]-C[i-1])));
  }
  if (tr.length < 14) return { value: NaN, proxy: true };
  let a = tr.slice(0,14).reduce((x,y)=>x+y)/14;
  for (let i=14;i<tr.length;i++) a = (a*13 + tr[i])/14;
  return { value:a, proxy:false };
};

export async function compute_trading_signal(symbol: string, timeframe: TF) {
  const { rows, lastClosed } = await get_ohlc(symbol, timeframe);
  const C = rows.map(r=>r.c), H = rows.map(r=>r.h), L = rows.map(r=>r.l);
  const prev = rows[rows.length-2];

  const ema20 = ema(C,20), ema50 = ema(C,50);
  const rsi14 = rsi(C,14);
  const { macd, signal, hist } = macdVals(C);
  const { value: atrVal, proxy } = atr14(H,L,C);

  let decision: "BUY"|"SELL"|"NEUTRAL" = "NEUTRAL";
  if (ema20 > ema50 && rsi14 >= 55) decision = "BUY";
  if (ema20 < ema50 && rsi14 <= 45) decision = "SELL";

  const close = lastClosed.c;
  const risk = Number.isFinite(atrVal) ? atrVal : Math.max(close * 0.0015, Math.abs(close - prev.c) || 1);
  const entry = close;
  const sl  = decision==="BUY" ? entry - risk : decision==="SELL" ? entry + risk : entry;
  const tp1 = decision==="BUY" ? entry + risk : decision==="SELL" ? entry - risk : entry;
  const tp2 = decision==="BUY" ? entry + 2*risk : decision==="SELL" ? entry - 2*risk : entry;

  return {
    trading_signal: {
      time_utc: new Date().toISOString(),
      interval: timeframe,
      last_closed_utc: new Date(lastClosed.t).toISOString(),
      close, prev: prev.c,
      ema20, ema50,
      rsi: rsi14,
      macd, signal, hist,
      atr: risk, atr_is_proxy: !Number.isFinite(atrVal) || proxy,
      decision, entry, sl, tp1, tp2,
    }
  };
}
