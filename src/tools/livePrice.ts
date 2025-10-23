// src/tools/livePrice.ts
import axios from "axios";
import { normalise } from "../symbols";

export type LivePriceResponse = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number;
  source: string;
  timeUtc: string;
};

const UA = { "User-Agent": "Mozilla/5.0 (LiiratBot)" };

function isCrypto(base: string) {
  return base.length > 3 || ["BTC", "ETH"].includes(base.toUpperCase());
}

export function hasPriceIntent(text: string): boolean {
  const priceKeywords = ['price', 'سعر', 'gold', 'silver', 'oil', 'btc', 'eth', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud', 'nzd', 'xau', 'xag'];
  const lowerText = text.toLowerCase();
  return priceKeywords.some(keyword => lowerText.includes(keyword));
}

export async function getLivePrice(symbolInput: string): Promise<LivePriceResponse | null> {
  try {
    const FCS_API_KEY = process.env.FCS_API_KEY;
    if (!FCS_API_KEY) {
      console.error('[PRICE] FCS_API_KEY is not set');
      return null;
    }

    const { pricePair } = normalise(symbolInput);
    if (!pricePair.includes("/")) {
      console.error('[PRICE] symbol_missing_slash');
      return null;
    }
    
    const [base, quote] = pricePair.split("/");
    if (!base || !quote) {
      console.error('[PRICE] symbol_invalid');
      return null;
    }

    const endpoint = isCrypto(base)
      ? `https://fcsapi.com/api-v3/crypto/latest?symbol=${encodeURIComponent(`${base}/${quote}`)}&access_key=${FCS_API_KEY}`
      : `https://fcsapi.com/api-v3/forex/latest?symbol=${encodeURIComponent(pricePair)}&access_key=${FCS_API_KEY}`;

    const { data } = await axios.get(endpoint, { headers: UA });
    const row = data?.response?.[0] || data?.data?.[0];
    
    if (!row) {
      console.error('[PRICE] price_not_found');
      return null;
    }

    let bid: number | null = null;
    let ask: number | null = null;
    let price: number | null = null;
    let usedField = '';

    if (row.bid && Number.isFinite(Number(row.bid))) {
      bid = Number(row.bid);
      price = bid;
      usedField = 'bid';
    }
    if (row.ask && Number.isFinite(Number(row.ask))) {
      ask = Number(row.ask);
      if (price === null) {
        price = ask;
        usedField = 'ask';
      }
    }
    if (price === null && row.price && Number.isFinite(Number(row.price))) {
      price = Number(row.price);
      usedField = 'price';
    }
    if (price === null && row.c && Number.isFinite(Number(row.c))) {
      price = Number(row.c);
      usedField = 'close';
    }

    if (price === null) {
      console.error('[PRICE] price_invalid');
      return null;
    }

    const ts = row.t ? Number(row.t) : Math.floor(Date.now() / 1000);
    const utcTime = new Date(ts * 1000).toISOString().slice(11, 16);

    return {
      symbol: pricePair,
      bid,
      ask,
      price,
      source: `FCS (${usedField})`,
      timeUtc: utcTime
    };
  } catch (err: any) {
    const code = err?.response?.status;
    console.error(`[PRICE] price_fetch_failed${code ? `_${code}` : ""}`);
    return null;
  }
}