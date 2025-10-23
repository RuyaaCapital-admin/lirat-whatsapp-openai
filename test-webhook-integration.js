// Test script for webhook integration
const { runWorkflow } = require('./lib/agent.ts');

async function testWebhookIntegration() {
  console.log('Testing webhook integration...');
  
  try {
    // Test 1: Price request
    console.log('\n--- Test 1: Price request ---');
    const priceResult = await runWorkflow({ input_as_text: 'سعر الذهب' });
    console.log('Price result:', priceResult);
    
    // Test 2: Signal request
    console.log('\n--- Test 2: Signal request ---');
    const signalResult = await runWorkflow({ input_as_text: 'إشارة الذهب' });
    console.log('Signal result:', signalResult);
    
    // Test 3: English price request
    console.log('\n--- Test 3: English price request ---');
    const englishResult = await runWorkflow({ input_as_text: 'price XAU/USD' });
    console.log('English result:', englishResult);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testWebhookIntegration();
}

module.exports = { testWebhookIntegration };