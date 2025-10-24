// src/tools/signal.ts
import { TF } from './normalize';
import { getOhlcFmp, getFmpTechnicalIndicators } from './ohlc';
import { ema, macd, atr } from './indicators';

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

// Get timeframe multiplier for risk calculation
function getTimeframeMultiplier(tf: TF): number {
  switch (tf) {
    case '1min': return 0.35;
    case '5min': return 0.50;
    case '15min': return 0.75;
    case '30min': return 0.90;
    case '1hour': return 1.00;
    case '4hour': return 1.50;
    case 'daily': return 2.00;
  }
}

export async function computeSignal(symbol: string, tf: TF): Promise<SignalBlock> {
  // Get OHLC data and technical indicators from FMP
  const [candles, indicators] = await Promise.all([
    getOhlcFmp(symbol, tf, 200),
    getFmpTechnicalIndicators(symbol, tf)
  ]);

  if (!candles.length || !indicators.length) {
    throw new Error(`No data available for ${symbol} ${tf}`);
  }

  // Find the last closed bar where date <= now_utc
  const now = new Date();
  let lastClosedIndex = candles.length - 1;
  
  // If last candle is in the future, step back one
  if (new Date(candles[lastClosedIndex].t as number) > now) {
    lastClosedIndex = Math.max(0, lastClosedIndex - 1);
  }

  const lastCandle = candles[lastClosedIndex];
  const prevCandle = candles[Math.max(0, lastClosedIndex - 1)];
  
  const lastClose = lastCandle.c;
  const prevClose = prevCandle.c;

  // Calculate indicators from OHLC data
  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const macdData = macd(closes, 12, 26, 9);
  const atr14 = atr(highs, lows, closes, 14);

  const lastEma20 = ema20[lastClosedIndex];
  const lastEma50 = ema50[lastClosedIndex];
  const lastMacd = macdData.macdLine[lastClosedIndex];
  const lastMacdSignal = macdData.signalLine[lastClosedIndex];
  const lastMacdHist = macdData.hist[lastClosedIndex];
  const lastAtr = atr14[lastClosedIndex];

  // Get RSI from FMP technical indicators
  const lastIndicator = indicators[indicators.length - 1];
  const rsi14 = lastIndicator.rsi || null;

  // SIGNAL RULE as specified
  let decision: 'BUY'|'SELL'|'NEUTRAL' = 'NEUTRAL';
  
  if (lastClose > lastEma50 && lastEma20 > lastEma50 && rsi14 >= 55 && lastMacd > lastMacdSignal) {
    decision = 'BUY';
  } else if (lastClose < lastEma50 && lastEma20 < lastEma50 && rsi14 <= 45 && lastMacd < lastMacdSignal) {
    decision = 'SELL';
  }

  // TRADE LEVELS calculation
  const k = getTimeframeMultiplier(tf);
  const risk = k * lastAtr;
  
  let entry: number|undefined, sl: number|undefined, tp1: number|undefined, tp2: number|undefined;
  
  if (decision === 'BUY') {
    entry = +lastClose.toFixed(5);
    sl = +(lastClose - risk).toFixed(5);
    tp1 = +(lastClose + risk).toFixed(5);
    tp2 = +(lastClose + 2 * risk).toFixed(5);
  } else if (decision === 'SELL') {
    entry = +lastClose.toFixed(5);
    sl = +(lastClose + risk).toFixed(5);
    tp1 = +(lastClose - risk).toFixed(5);
    tp2 = +(lastClose - 2 * risk).toFixed(5);
  }

  const nowUTC = new Date().toISOString().slice(11, 16); // HH:MM
  const lastClosedUTC = new Date(lastCandle.t as number).toISOString().slice(0, 16).replace('T', '_');

  return {
    timeUTC: nowUTC,
    symbol,
    interval: tf,
    lastClosedUTC,
    close: +lastClose.toFixed(5),
    prev: +prevClose.toFixed(5),
    ema20: lastEma20 ? +lastEma20.toFixed(5) : undefined,
    ema50: lastEma50 ? +lastEma50.toFixed(5) : undefined,
    rsi14: rsi14 ? +rsi14.toFixed(2) : undefined,
    macd: lastMacd ? +lastMacd.toFixed(5) : undefined,
    macdSignal: lastMacdSignal ? +lastMacdSignal.toFixed(5) : undefined,
    macdHist: lastMacdHist ? +lastMacdHist.toFixed(5) : undefined,
    atr14: lastAtr ? +lastAtr.toFixed(5) : undefined,
    signal: decision,
    entry, sl, tp1, tp2
  };
}
