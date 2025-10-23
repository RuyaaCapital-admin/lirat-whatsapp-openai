import axios from "axios";
import { normalise } from "../symbols";

export type PriceResponse = {
  symbol: string;
  timestamp: number;
  price: number;
  note: string;
};

const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

function isCrypto(base: string) {
  return base.length > 3 || ["BTC", "ETH"].includes(base);
}

export async function fetchLatestPrice(symbol: string): Promise<{ ok: true; data: PriceResponse } | { ok: false; error: string }> {
  try {
    const { pricePair } = normalise(symbol);
    if (!pricePair.includes("/")) {
      return { ok: false, error: "symbol_missing_slash" };
    }
    const [base, quote] = pricePair.split("/");
    if (!base || !quote) return { ok: false, error: "symbol_invalid" };
    const priceKey = process.env.PRICE_API_KEY;
    if (!priceKey) return { ok: false, error: "price_key_missing" };

    const endpoint = isCrypto(base)
      ? `https://fcsapi.com/api-v3/crypto/latest?symbol=${encodeURIComponent(`${base}/${quote}`)}&access_key=${priceKey}`
      : `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(pricePair)}&access_key=${priceKey}`;

    const { data } = await axios.get(endpoint, { headers: UA });
    const row = data?.response?.[0] || data?.data?.[0];
    if (!row) return { ok: false, error: "price_not_found" };
    const price = Number(row.c ?? row.price ?? row.close);
    if (!Number.isFinite(price)) return { ok: false, error: "price_invalid" };
    const ts = row.t ? Number(row.t) * 1000 : row.tm ? Date.parse(row.tm) : row.date ? Date.parse(row.date) : Date.now();
    return { ok: true, data: { symbol: pricePair, timestamp: Math.floor(ts / 1000), price, note: "latest CLOSED price" } };
  } catch (err: any) {
    const code = err?.response?.status;
    return { ok: false, error: `price_fetch_failed${code ? `_${code}` : ""}` };
  }
}
