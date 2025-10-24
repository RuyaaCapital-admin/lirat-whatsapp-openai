// Manual test of intent parsing logic
console.log('🧪 Manual Test of Intent Parsing Logic\n');

// Test case: "عطيني صفقة عالدهب عالدقيقة"
const testText = 'عطيني صفقة عالدهب عالدقيقة';
console.log('📝 Test text:', testText);

// Step 1: Normalize text
const normalized = testText.toLowerCase().replace(/\s+/g,' ').trim();
console.log('📝 Normalized:', normalized);

// Step 2: Split into tokens
const tokens = normalized.split(' ');
console.log('📝 Tokens:', tokens);

// Step 3: Test symbol mapping
const MAP = {
  'ذهب':'XAUUSD','الذهب':'XAUUSD','دهب':'XAUUSD','الدهب':'XAUUSD','عالدهب':'XAUUSD','على الدهب':'XAUUSD','gold':'XAUUSD',
  'فضة':'XAGUSD','الفضة':'XAGUSD','على الفضة':'XAGUSD',
  'بتكوين':'BTCUSD','بيتكوين':'BTCUSD','btc':'BTCUSD','btcusdt':'BTCUSD'
};

const ALIASES = {
  'xau':'XAUUSD','xauusd':'XAUUSD','xau/usd':'XAUUSD',
  'xag':'XAGUSD','xagusd':'XAGUSD','xag/usd':'XAGUSD',
  'eurusd':'EURUSD','eur/usd':'EURUSD',
  'gbpusd':'GBPUSD','gbp/usd':'GBPUSD',
  'btcusdt':'BTCUSD','btc/usdt':'BTCUSD','btcusd':'BTCUSD'
};

function toCanonical(s) {
  const t = s.trim().toLowerCase();
  return ALIASES[t] ?? MAP[t];
}

console.log('\n🔍 Testing symbol detection:');
let symbol = undefined;
for (let i = 0; i < tokens.length; i++) {
  const uni = tokens[i];
  const bi = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : '';
  
  console.log(`  Checking "${uni}" → ${toCanonical(uni)}`);
  console.log(`  Checking "${bi}" → ${toCanonical(bi)}`);
  
  symbol = toCanonical(bi) || toCanonical(uni) || symbol;
  if (symbol) break;
}
console.log(`✅ Final symbol: ${symbol}`);

// Step 4: Test timeframe detection
console.log('\n🔍 Testing timeframe detection:');
const timeframeRegex = /\b(1 ?min|1m|دقيقة|الدقيقة|دقيقه|الدقيقى|الدقيقة|عالدقيقة|على الدقيقة)\b/;
const hasTimeframe = timeframeRegex.test(normalized);
console.log(`✅ Timeframe found: ${hasTimeframe ? '1min' : 'none'}`);

// Step 5: Test price intent
const hasPriceWord = /\b(سعر|كم|price|quote|شراء|بيع|صفقة|تداول|trade)\b/.test(normalized);
const hasSymbolInText = Boolean(symbol);
const wantsPrice = hasSymbolInText && (hasPriceWord || /xau|xag|eurusd|gbpusd|btc|ذهب|فضة|دهب/u.test(normalized));

console.log(`✅ hasPriceWord: ${hasPriceWord}`);
console.log(`✅ hasSymbolInText: ${hasSymbolInText}`);
console.log(`✅ wantsPrice: ${wantsPrice}`);

console.log('\n📊 Final Result:');
console.log(`Symbol: ${symbol}`);
console.log(`Timeframe: ${hasTimeframe ? '1min' : 'undefined'}`);
console.log(`wantsPrice: ${wantsPrice}`);
