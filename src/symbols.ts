export function normalise(input: string): {
  pricePair: string;
  ohlcSymbol: string;
} {
  let s = (input || "").trim().toUpperCase();
  s = s
    .replace(/ذ?ه?ب|GOLD/gi, "XAUUSD")
    .replace(/فِ?ض[ةه]?|SILVER/gi, "XAGUSD")
    .replace(/نَ?فط|WTI/gi, "XTIUSD")
    .replace(/برنت/gi, "XBRUSD")
    .replace(/بيتكوين|BTC/gi, "BTCUSD")
    .replace(/إيثيريوم|ETH/gi, "ETHUSD");
  const ohlcSymbol = s.replace(/[\s/]/g, "");
  let pricePair = ohlcSymbol;
  const map = {
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
    BTCUSD: "BTC/USD",
    ETHUSD: "ETH/USD",
  } as const;
  if (/[A-Z]{3,4}\/[A-Z]{3}/.test(input)) pricePair = input.toUpperCase();
  else if ((map as Record<string, string>)[ohlcSymbol]) pricePair = (map as Record<string, string>)[ohlcSymbol];
  return { pricePair, ohlcSymbol };
}
