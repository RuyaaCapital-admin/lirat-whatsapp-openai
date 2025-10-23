import axios from "axios";
import { normalise } from "../symbols";

export type PriceResponse = {
  symbol: string;
  timestamp: number;
  price: number;
  note: string;
  utcTime: string;
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
    // Parse in order: bid, ask, price, c (close). Use the first numeric you find.
    let price: number | null = null;
    let usedField = '';
    
    if (row.bid && Number.isFinite(Number(row.bid))) {
      price = Number(row.bid);
      usedField = 'bid';
    } else if (row.ask && Number.isFinite(Number(row.ask))) {
      price = Number(row.ask);
      usedField = 'ask';
    } else if (row.price && Number.isFinite(Number(row.price))) {
      price = Number(row.price);
      usedField = 'price';
    } else if (row.c && Number.isFinite(Number(row.c))) {
      price = Number(row.c);
      usedField = 'close';
    }
    
    if (!price) return { ok: false, error: "price_invalid" };
    
    // Use numeric t if present; fallback to Date.now()/1000
    const ts = row.t ? Number(row.t) : Date.now() / 1000;
    const utcString = new Date(ts * 1000).toISOString().slice(11, 16);
    
    return { 
      ok: true, 
      data: { 
        symbol: pricePair, 
        timestamp: Math.floor(ts), 
        price, 
        note: `FCS (${usedField})`,
        utcTime: utcString
      } 
    };
  } catch (err: any) {
    const code = err?.response?.status;
    return { ok: false, error: `price_fetch_failed${code ? `_${code}` : ""}` };
  }
}
