// src/pages/api/test-signal.js
import { get_ohlc as loadOhlc, compute_trading_signal } from "../../tools/agentTools";
import { hardMapSymbol, toTimeframe } from "../../tools/normalize";

export default async function handler(req, res) {
  try {
    const symbolRaw = String(req.query.symbol || "XAUUSD");
    const tfRaw = String(req.query.timeframe || "5min");
    const limitRaw = Number(req.query.limit || 150);

    const symbol = hardMapSymbol(symbolRaw) || symbolRaw.toUpperCase();
    const timeframe = toTimeframe(tfRaw);
    const limit = Math.max(30, Math.min(limitRaw, 300));

    const ohlc = await loadOhlc(symbol, timeframe, limit);
    if (!ohlc.ok) {
      res.status(200).json({ ok: false, reason: "NO_DATA", symbol, timeframe });
      return;
    }

    const signal = await compute_trading_signal({ ...ohlc, lang: /[\u0600-\u06FF]/.test(symbolRaw) ? "ar" : "en" });

    res.status(200).json({
      ok: true,
      env: {
        FCS_API_KEY: Boolean(process.env.FCS_API_KEY),
        FMP_API_KEY: Boolean(process.env.FMP_API_KEY),
      },
      request: { symbol, timeframe, limit },
      provider: ohlc.provider,
      rawSymbol: ohlc.rawSymbol,
      candles: ohlc.candles.length,
      lastISO: ohlc.lastISO,
      ageMinutes: ohlc.ageMinutes,
      stale: ohlc.stale,
      signal,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
