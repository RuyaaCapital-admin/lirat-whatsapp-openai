// Test script for the new WhatsApp trading assistant system
const { smartReply } = require('./src/lib/smartReplyNew.ts');

async function testSystem() {
  console.log('Testing new WhatsApp trading assistant system...\n');

  const testCases = [
    {
      name: 'Signal request in Arabic',
      input: { phone: '+1234567890', text: 'عطيني صفقة عالدهب' },
      expected: 'Should return a trading signal for gold'
    },
    {
      name: 'Price request in English', 
      input: { phone: '+1234567890', text: 'price of silver' },
      expected: 'Should return current silver price'
    },
    {
      name: 'Memory question in Arabic',
      input: { phone: '+1234567890', text: 'شو قلتلي قبل شوي؟' },
      expected: 'Should return conversation history'
    },
    {
      name: 'About Liirat question',
      input: { phone: '+1234567890', text: 'مين ليرات' },
      expected: 'Should return company information'
    },
    {
      name: 'Insult handling',
      input: { phone: '+1234567890', text: 'انت غبي' },
      expected: 'Should return polite redirect message'
    },
    {
      name: 'Follow-up timeframe',
      input: { phone: '+1234567890', text: 'عالدقيقة' },
      expected: 'Should use previous symbol with new timeframe'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n--- ${testCase.name} ---`);
    console.log(`Input: "${testCase.input.text}"`);
    console.log(`Expected: ${testCase.expected}`);
    
    try {
      const result = await smartReply(testCase.input);
      console.log(`Output: "${result.replyText}"`);
      console.log(`Language: ${result.language}`);
      console.log(`Conversation ID: ${result.conversationId}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }
}

// Run the test
testSystem().catch(console.error);