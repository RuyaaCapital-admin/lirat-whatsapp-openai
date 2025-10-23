// pages/api/tools/price.js
import axios from "axios";

const FCS_KEY = process.env.FCS_API_KEY || process.env.PRICE_API_KEY;
const FMP_KEY = process.env.FMP_API_KEY;

const nowHHMM = (d = new Date()) => new Date(d).toISOString().slice(11, 16);
const fmt = (n) => (n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6));

function normalizeSymbol(raw) {
  let s = (raw || "").trim().toUpperCase();
  // Arabic → canonical
  s = s
    .replace(/ذ?ه?ب|GOLD/gi, "XAUUSD")
    .replace(/فِ?ض[هة]?|SILVER/gi, "XAGUSD")
    .replace(/نَ?فط|خام|WTI/gi, "XTIUSD")
    .replace(/برنت/gi, "XBRUSD")
    .replace(/بيتكوين|BTC/gi, "BTCUSDT")
    .replace(/إ?ي?ثيريوم|ETH/gi, "ETHUSDT");

  // slash price pair (always show slashes in output)
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
    BTCUSDT: "BTC/USDT",
    ETHUSDT: "ETH/USDT",
  };

  // if already contains slash, keep it
  let pricePair = /[A-Z]{3,4}\/[A-Z]{3,4}/.test(s)
    ? s
    : slashMap[s] || s;

  return {
    // output
    pretty: pricePair,
    // provider needs slash for FCS (FX/metals)
    forFcs: pricePair,
    // provider needs noslash for FMP/Binance
    noslash: pricePair.replace("/", ""),
  };
}

async function fcsLatest(pairSlash) {
  if (!FCS_KEY) return null;
  // FCS expects slash pairs for FX/metals e.g. XAU/USD
  const url = `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(
    pairSlash
  )}&access_key=${FCS_KEY}`;
  const r = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const row = r.data?.response?.[0];
  if (!row) return null;
  const price = Number(row.c);
  const tIso = row.tm || (row.t ? new Date(row.t * 1000).toISOString() : new Date().toISOString());
  const hhmm = nowHHMM(tIso);
  return { price, hhmm };
}

async function fmpQuote(noslash) {
  if (!FMP_KEY) return null;
  // FMP supports /v3/quote/{symbol} for many assets, including crypto & some forex
  const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(
    noslash
  )}?apikey=${FMP_KEY}`;
  const r = await axios.get(url);
  const row = r.data?.[0];
  if (!row) return null;
  const price = Number(row.price ?? row.c ?? row.previousClose);
  const hhmm = nowHHMM();
  return { price, hhmm };
}

async function binanceLastClosed(noslash) {
  // crypto fallback: Binance klines 1m, take previous candle close as "latest CLOSED"
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
    noslash
  )}&interval=1m&limit=2`;
  const r = await axios.get(url);
  const k = r.data?.[0] && r.data[r.data.length - 1]; // last candle (closed)
  if (!k) return null;
  const price = Number(k[4]);
  const hhmm = nowHHMM(k[0] + 60000);
  return { price, hhmm };
}

async function yahooFallback(prettySlash) {
  // metals sanity fallback when FCS looks off
  const map = {
    "XAU/USD": ["XAUUSD=X", "XAU=X", "GC=F"],
    "XAG/USD": ["XAGUSD=X", "SI=F"],
  };
  const list = map[prettySlash];
  if (!list) return null;
  for (const tkr of list) {
    try {
      const y = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${tkr}?range=1d&interval=1m`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      const r0 = y.data?.chart?.result?.[0];
      const closes = r0?.indicators?.quote?.[0]?.close ?? [];
      const ts = r0?.timestamp ?? [];
      let i = closes.length - 1;
      while (i >= 0 && (closes[i] == null || isNaN(closes[i]))) i--;
      if (i >= 0) return { price: Number(closes[i]), hhmm: nowHHMM(ts[i] * 1000) };
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const { symbol } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });

    const norm = normalizeSymbol(symbol);
    let out = null;

    // try FCS for FX/metals first (slash pair)
    if (/(XAU|XAG|XTI|XBR|EUR|GBP|USD|CHF|AUD|CAD)/.test(norm.noslash)) {
      out = await fcsLatest(norm.forFcs);
      // sanity guard for metals
      if (out && norm.pretty === "XAU/USD" && (out.price < 1000 || out.price > 3500)) out = null;
      if (out && norm.pretty === "XAG/USD" && (out.price < 10 || out.price > 60)) out = null;
      if (!out && (norm.pretty === "XAU/USD" || norm.pretty === "XAG/USD")) {
        out = await yahooFallback(norm.pretty);
      }
    }

    // FMP quote fallback (covers crypto and some fx)
    if (!out) out = await fmpQuote(norm.noslash);

    // Binance last-closed fallback (crypto)
    if (!out && /USDT$/.test(norm.noslash)) out = await binanceLastClosed(norm.noslash);

    if (!out || !isFinite(out.price)) {
      return res.status(200).json({ ok: false, error: "Data unavailable" });
    }

    const text =
`Time (UTC): ${out.hhmm}
Symbol: ${norm.pretty}
Price: ${fmt(out.price)}
Note: latest CLOSED price`;

    return res.status(200).json({ ok: true, text });
  } catch (e) {
    console.error("[price]", e?.response?.data || e);
    return res.status(200).json({ ok: false, error: "price_error" });
  }
}
