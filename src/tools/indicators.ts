// src/tools/indicators.ts
export function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i=0;i<values.length;i++) {
    const v = values[i];
    prev = i===0 ? v : v*k + prev*(1-k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period=14) {
  let gains=0, losses=0;
  for (let i=1;i<=period;i++){
    const ch = values[i]-values[i-1];
    if (ch>=0) gains+=ch; else losses-=ch;
  }
  let avgGain = gains/period, avgLoss = losses/period;
  const out:number[] = [NaN];
  for (let i=period+1;i<values.length;i++){
    const ch = values[i]-values[i-1];
    avgGain = (avgGain*(period-1)+Math.max(0,ch))/period;
    avgLoss = (avgLoss*(period-1)+Math.max(0,-ch))/period;
    const rs = avgLoss===0 ? 100 : avgGain/avgLoss;
    const r = 100 - 100/(1+rs);
    out.push(r);
  }
  // pad front
  while(out.length<values.length) out.unshift(NaN);
  return out;
}

export function macd(values:number[], fast=12, slow=26, signal=9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_,i)=> emaFast[i]-emaSlow[i]);
  const signalLine = ema(macdLine.slice(slow-1), signal);
  // align lengths
  const sigAligned:number[] = new Array(slow-1).fill(NaN).concat(signalLine);
  const hist = macdLine.map((m,i)=> m - (sigAligned[i] ?? NaN));
  return { macdLine, signalLine: sigAligned, hist };
}

export function atr(h:number[], l:number[], c:number[], period=14) {
  const tr:number[] = [];
  for (let i=0;i<h.length;i++){
    const prevClose = i>0 ? c[i-1] : c[i];
    const v = Math.max(
      h[i]-l[i],
      Math.abs(h[i]-prevClose),
      Math.abs(l[i]-prevClose)
    );
    tr.push(v);
  }
  const out = ema(tr, period);
  return out;
}
