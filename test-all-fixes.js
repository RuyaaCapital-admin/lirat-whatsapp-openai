// Comprehensive test script for all fixes
console.log('🧪 Testing All Fixes...\n');

// Test 1: Intent Parsing
console.log('1️⃣ Testing Intent Parsing...');
try {
  // Import the parseIntent function
  const { parseIntent } = require('./src/tools/symbol.ts');
  
  const testCases = [
    'عطيني صفقة عالدهب عالدقيقة',
    'صفقة عالفضة',
    'BTCUSDT 5min',
    'XAUUSD 1hour'
  ];
  
  testCases.forEach((testCase, index) => {
    console.log(`\nTest ${index + 1}: "${testCase}"`);
    try {
      const result = parseIntent(testCase);
      console.log('✅ Result:', result);
    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  });
} catch (error) {
  console.error('❌ Failed to import parseIntent:', error.message);
}

// Test 2: Symbol Mapping
console.log('\n2️⃣ Testing Symbol Mapping...');
try {
  const { toCanonical } = require('./src/tools/symbol.ts');
  
  const symbolTests = [
    'عالدهب',
    'الدهب', 
    'دهب',
    'btcusdt',
    'BTCUSDT',
    'عالفضة'
  ];
  
  symbolTests.forEach(symbol => {
    const result = toCanonical(symbol);
    console.log(`${symbol} → ${result}`);
  });
} catch (error) {
  console.error('❌ Failed to test symbol mapping:', error.message);
}

// Test 3: Timeframe Parsing
console.log('\n3️⃣ Testing Timeframe Parsing...');
try {
  const { parseIntent } = require('./src/tools/symbol.ts');
  
  const timeframeTests = [
    'عالدقيقة',
    'الدقيقة',
    'دقيقة',
    '5min',
    '1hour'
  ];
  
  timeframeTests.forEach(tf => {
    const result = parseIntent(`test ${tf}`);
    console.log(`${tf} → ${result.timeframe}`);
  });
} catch (error) {
  console.error('❌ Failed to test timeframe parsing:', error.message);
}

console.log('\n✅ Testing completed!');
