// pages/api/tools/ohlc.js
import axios from "axios";

const FCS_KEY = process.env.FCS_API_KEY || process.env.OHLC_API_KEY;
const FMP_KEY = process.env.FMP_API_KEY;

const fcsPeriod = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};
const fmpPeriod = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour",
  "4h": "4hour", // FMP supports this
  "1d": "1day",
};

function normalizeSymbol(raw) {
  let s = (raw || "").trim().toUpperCase();
  s = s
    .replace(/ذ?ه?ب|GOLD/gi, "XAUUSD")
    .replace(/فِ?ض[هة]?|SILVER/gi, "XAGUSD")
    .replace(/نَ?فط|خام|WTI/gi, "XTIUSD")
    .replace(/برنت/gi, "XBRUSD")
    .replace(/بيتكوين|BTC/gi, "BTCUSDT")
    .replace(/إ?ي?ثيريوم|ETH/gi, "ETHUSDT");
  // remove slashes for ohlc
  return s.replace("/", "");
}

function asCandles(rows, isFcs = false) {
  // Normalise to {t,o,h,l,c}
  return rows
    .map((x) => {
      if (isFcs) {
        const t = Number(x.t) || Math.floor(new Date(x.tm || x.date).getTime() / 1000);
        return { t, o: +x.o, h: +x.h, l: +x.l, c: +x.c };
      }
      // FMP historical-chart: { date, open, high, low, close }
      const t = Math.floor(new Date(x.date).getTime() / 1000);
      return { t, o: +x.open, h: +x.high, l: +x.low, c: +x.close };
    })
    .filter((v) => Number.isFinite(v.c));
}

async function fcsHistory(pairSlash, period) {
  if (!FCS_KEY) return null;
  const url = `https://fcsapi.com/api-v3/forex/history?symbol=${encodeURIComponent(
    pairSlash
  )}&period=${period}&access_key=${FCS_KEY}`;
  const r = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const rows = Object.values(r.data?.response || r.data?.data || {});
  const candles = asCandles(rows, true);
  return candles;
}

async function fmpHistory(noslash, period) {
  if (!FMP_KEY) return null;
  // Forex & crypto supported by FMP historical-chart
  const url = `https://financialmodelingprep.com/api/v3/historical-chart/${period}/${encodeURIComponent(
    noslash
  )}?apikey=${FMP_KEY}`;
  const r = await axios.get(url);
  const rows = r.data || [];
  // FMP returns newest-first; we’ll reverse to oldest->newest
  const candles = asCandles(rows.reverse(), false);
  return candles;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    let { symbol, interval = "15m", limit = 300 } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });

    const noslash = normalizeSymbol(symbol);
    const slashMap = {
      XAUUSD: "XAU/USD",
      XAGUSD: "XAG/USD",
      XTIUSD: "XTI/USD",
      XBRUSD: "XBR/USD",
      EURUSD: "EUR/USD",
      GBPUSD: "GBP/USD",
      USDJPY: "USD/JPY",
      USDCHF: "USD/CHF",
      AUDUSD: "AUD/USD",
      USDCAD: "USD/CAD",
    };
    const withSlash = slashMap[noslash] || noslash; // FCS wants slash for FX/metals

    // 1) Try FCS for FX/metals
    let candles = null;
    if (slashMap[noslash]) {
      const p = fcsPeriod[interval] || "15min";
      candles = await fcsHistory(withSlash, p);
    }

    // 2) FMP fallback (works for forex & crypto)
    if (!candles || candles.length === 0) {
      const p = fmpPeriod[interval] || "15min";
      candles = await fmpHistory(noslash, p);
    }

    // 3) Final shape + limit + last CLOSED
    if (!candles || candles.length === 0) {
      return res.status(200).json({ ok: false, error: "No data found" });
    }
    candles = candles.filter(Boolean).slice(-limit);

    return res.status(200).json({
      ok: true,
      symbol: noslash,
      period: interval,
      candles, // [{t,o,h,l,c}...], oldest → newest, last one is CLOSED
    });
  } catch (e) {
    console.error("[ohlc]", e?.response?.data || e);
    return res.status(200).json({ ok: false, error: "ohlc_error" });
  }
}
