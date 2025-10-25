// Test script for the intent parser
const { decideUserIntent } = require('./src/lib/intentParser.ts');

function testIntentParser() {
  console.log('Testing intent parser...\n');

  const testCases = [
    {
      text: 'عطيني صفقة عالدهب',
      state: { lastSymbol: null, lastTimeframe: null },
      expected: 'signal with gold symbol'
    },
    {
      text: 'سعر الفضة',
      state: { lastSymbol: null, lastTimeframe: null },
      expected: 'price with silver symbol'
    },
    {
      text: 'عالدقيقة',
      state: { lastSymbol: 'XAUUSD', lastTimeframe: '5min' },
      expected: 'signal using previous symbol with 1min timeframe'
    },
    {
      text: 'ذهب',
      state: { lastSymbol: null, lastTimeframe: '5min' },
      expected: 'signal with gold symbol using previous timeframe'
    },
    {
      text: 'شو قلتلي قبل شوي؟',
      state: { lastSymbol: 'XAUUSD', lastTimeframe: '5min' },
      expected: 'memory_question'
    },
    {
      text: 'مين ليرات',
      state: { lastSymbol: null, lastTimeframe: null },
      expected: 'about_liirat'
    },
    {
      text: 'انت غبي',
      state: { lastSymbol: null, lastTimeframe: null },
      expected: 'chat'
    },
    {
      text: 'صفقة',
      state: { lastSymbol: null, lastTimeframe: null },
      expected: 'clarify_symbol (no symbol provided)'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n--- Testing: "${testCase.text}" ---`);
    console.log(`State: ${JSON.stringify(testCase.state)}`);
    console.log(`Expected: ${testCase.expected}`);
    
    try {
      const result = decideUserIntent(testCase.text, testCase.state);
      console.log(`Result: ${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }
}

// Run the test
testIntentParser();