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
    .replace(/بيتكوين|BTC/gi, "BTCUSDT")
    .replace(/إيثيريوم|ETH/gi, "ETHUSDT")
    .replace(/يورو|EUR/gi, "EURUSD")
    .replace(/ين|ين ياباني|JPY/gi, "USDJPY")
    .replace(/فرنك سويسري|CHF/gi, "USDCHF")
    .replace(/جنيه استرليني|GBP/gi, "GBPUSD")
    .replace(/دولار كندي|CAD/gi, "USDCAD")
    .replace(/دولار أسترالي|AUD/gi, "AUDUSD")
    .replace(/دولار نيوزلندي|NZD/gi, "NZDUSD");
  
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
    NZDUSD: "NZD/USD",
    BTCUSDT: "BTCUSDT",
    ETHUSDT: "ETHUSDT",
  } as const;
  if (/[A-Z]{3,4}\/[A-Z]{3}/.test(input)) pricePair = input.toUpperCase();
  else if ((map as Record<string, string>)[ohlcSymbol]) pricePair = (map as Record<string, string>)[ohlcSymbol];
  return { pricePair, ohlcSymbol };
}
