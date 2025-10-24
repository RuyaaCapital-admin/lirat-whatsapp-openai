// src/tools/signal.ts
import { TF } from './normalize';
import { getOhlcFmp } from './ohlc';
import { ema, rsi, macd, atr } from './indicators';

export type SignalBlock = {
  timeUTC: string;
  symbol: string;
  interval: TF;
  lastClosedUTC: string;
  close: number;
  prev: number;
  ema20?: number;
  ema50?: number;
  rsi14?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  atr14?: number;
  signal: 'BUY'|'SELL'|'NEUTRAL';
  entry?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
};

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  const candles = await getOhlcFmp(symbol, tf, 400);

  const c = candles.map(x=>x.c);
  const h = candles.map(x=>x.h);
  const l = candles.map(x=>x.l);

  const e20 = ema(c,20);
  const e50 = ema(c,50);
  const r14 = rsi(c,14);
  const m = macd(c,12,26,9);
  const a14 = atr(h,l,c,14);

  const n = c.length-1;                // last index (last closed candle)
  const now = new Date().toISOString().slice(11,16); // HH:MM
  const lastTs = new Date(candles[n].t as number).toISOString().slice(0,16).replace('T','_');

  const lastClose = c[n];
  const prevClose = c[n-1];

  const lastE20 = e20[n];
  const lastE50 = e50[n];
  const lastRsi = r14[n];
  const lastMacd = m.macdLine[n];
  const lastSig  = m.signalLine[n];
  const lastHist = m.hist[n];
  const lastAtr  = a14[n];

  // Simple, robust rules:
  // BUY: price>EMA20>EMA50 AND MACD hist>0 AND RSI between 45–70
  // SELL: price<EMA20<EMA50 AND MACD hist<0 AND RSI between 30–55
  // else NEUTRAL
  let decision:'BUY'|'SELL'|'NEUTRAL' = 'NEUTRAL';
  if (lastClose>lastE20 && lastE20>lastE50 && lastHist>0 && lastRsi>45 && lastRsi<70) decision='BUY';
  else if (lastClose<lastE20 && lastE20<lastE50 && lastHist<0 && lastRsi<55 && lastRsi>30) decision='SELL';

  // Risk model: ATR-based
  // BUY → SL = close - 1.2*ATR ; TP1 = close + 1.2*ATR ; TP2 = close + 2.4*ATR
  // SELL → mirror
  let entry:number|undefined, sl:number|undefined, tp1:number|undefined, tp2:number|undefined;
  if (decision==='BUY') {
    entry = +lastClose.toFixed(5);
    sl    = +(lastClose - 1.2*lastAtr).toFixed(5);
    tp1   = +(lastClose + 1.2*lastAtr).toFixed(5);
    tp2   = +(lastClose + 2.4*lastAtr).toFixed(5);
  } else if (decision==='SELL') {
    entry = +lastClose.toFixed(5);
    sl    = +(lastClose + 1.2*lastAtr).toFixed(5);
    tp1   = +(lastClose - 1.2*lastAtr).toFixed(5);
    tp2   = +(lastClose - 2.4*lastAtr).toFixed(5);
  }

  return {
    timeUTC: now,
    symbol,
    interval: tf,
    lastClosedUTC: lastTs,
    close: +lastClose.toFixed(5),
    prev: +prevClose.toFixed(5),
    ema20: +lastE20.toFixed(5),
    ema50: +lastE50.toFixed(5),
    rsi14: +lastRsi.toFixed(2),
    macd: +lastMacd.toFixed(5),
    macdSignal: +lastSig.toFixed(5),
    macdHist: +lastHist.toFixed(5),
    atr14: +lastAtr.toFixed(5),
    signal: decision,
    entry, sl, tp1, tp2
  };
}
