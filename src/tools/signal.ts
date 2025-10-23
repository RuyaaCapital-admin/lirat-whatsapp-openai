// src/tools/signal.ts
import { ema, rsi14, macd, atr14 } from "./indicators";

export function computeSignal(args: {
  ema20?: number, 
  ema50?: number, 
  rsi?: number, 
  macd?: number, 
  signal?: number
}): 'BUY' | 'SELL' | 'NEUTRAL' {
  const { ema20, ema50, rsi, macd, signal } = args;
  
  // Check if we have enough data
  if (ema20 === undefined || ema50 === undefined || rsi === undefined || 
      macd === undefined || signal === undefined) {
    return 'NEUTRAL';
  }
  
  // BUY conditions
  if (ema20 > ema50 && macd > signal && rsi < 70) {
    return 'BUY';
  }
  
  // SELL conditions  
  if (ema20 < ema50 && macd < signal && rsi > 30) {
    return 'SELL';
  }
  
  return 'NEUTRAL';
}

export function calculateEntrySlTp(
  signal: 'BUY' | 'SELL' | 'NEUTRAL',
  close: number,
  atr: number
): { entry: number, sl: number, tp1: number, tp2: number } | null {
  if (signal === 'NEUTRAL') {
    return null;
  }
  
  const risk = atr * 1.5; // 1.5x ATR for stop loss
  
  if (signal === 'BUY') {
    return {
      entry: close,
      sl: close - risk,
      tp1: close + risk, // R1.0
      tp2: close + (risk * 2) // R2.0
    };
  } else { // SELL
    return {
      entry: close,
      sl: close + risk,
      tp1: close - risk, // R1.0
      tp2: close - (risk * 2) // R2.0
    };
  }
}
