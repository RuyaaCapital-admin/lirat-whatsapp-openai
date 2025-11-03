import type { VercelRequest, VercelResponse } from '@vercel/node';

type Candle = { t:number; o:number; h:number; l:number; c:number };

const MAP: Record<string,"1min"|"5min"|"15min"|"30min"|"1hour"|"4hour"|"daily"> =
  { "1m":"1min","5m":"5min","15m":"15min","30m":"30min","1h":"1hour","4h":"4hour","1d":"daily" };

function prec(symbol:string){
  const s=symbol.toUpperCase();
  if (s==="XAUUSD") return 2;
  if (s==="XAGUSD") return 3;
  if (s.endsWith("USD")) return 5;
  if (s==="BTCUSDT"||s==="ETHUSDT") return 2;
  return 4;
}

export default function handler(req:VercelRequest,res:VercelResponse){
  if (req.method!=="POST"){ res.setHeader("Allow","POST"); return res.status(405).json({error:"Method Not Allowed"}); }
  const {symbol,period,candles} = req.body as {symbol?:string; period?:"1m"|"5m"|"15m"|"30m"|"1h"|"4h"|"1d"; candles?:Candle[]};
  if (!symbol || !period || !Array.isArray(candles) || candles.length<2)
    return res.status(400).json({error:"Missing {symbol,period,candles>=2}"});

  const prev = candles[candles.length-2];
  const H=prev.h, L=prev.l, C=prev.c;
  const P=(H+L+C)/3, R1=2*P-L, S1=2*P-H, R2=P+(H-L), S2=P-(H-L);

  const r=(x:number)=>Number(x.toFixed(prec(symbol)));
  return res.status(200).json({
    symbol, interval: MAP[period], pivot: r(P), s1: r(S1), s2: r(S2), r1: r(R1), r2: r(R2)
  });
}
