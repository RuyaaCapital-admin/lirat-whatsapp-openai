import type { NextApiRequest, NextApiResponse } from "next";

type Candle = {
  o: number;
  h: number;
  l: number;
  c: number;
  t: number;
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { symbol, period, candles } = (req.body ?? {}) as {
    symbol?: string;
    period?: string;
    candles?: Candle[];
  };

  if (!symbol || !period || !Array.isArray(candles) || candles.length < 100) {
    return res.status(400).json({ error: "Missing {symbol,period,candles>=100}" });
  }

  const n = candles.length;
  const prev = candles[n - 2];
  if (!prev || typeof prev.h !== "number" || typeof prev.l !== "number" || typeof prev.c !== "number") {
    return res.status(400).json({ error: "Invalid candle data" });
  }

  const pivot = (prev.h + prev.l + prev.c) / 3;
  const r1 = 2 * pivot - prev.l;
  const s1 = 2 * pivot - prev.h;
  const r2 = pivot + (prev.h - prev.l);
  const s2 = pivot - (prev.h - prev.l);

  const round = (value: number) => Number(value.toFixed(3));

  return res.status(200).json({
    symbol,
    interval: period,
    pivot: round(pivot),
    r1: round(r1),
    r2: round(r2),
    s1: round(s1),
    s2: round(s2),
  });
}
