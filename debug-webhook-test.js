// Debug script to test webhook endpoint
const fetch = require('node-fetch');

async function testWebhookEndpoint() {
  const webhookUrl = 'http://localhost:3000/api/webhook';
  
  // Test webhook verification
  console.log('Testing webhook verification...');
  const verifyUrl = `${webhookUrl}?hub.mode=subscribe&hub.verify_token=test_token&hub.challenge=test_challenge`;
  
  try {
    const response = await fetch(verifyUrl);
    const text = await response.text();
    console.log('Verification response:', response.status, text);
  } catch (error) {
    console.error('Verification test failed:', error);
  }
  
  // Test webhook POST
  console.log('\nTesting webhook POST...');
  const webhookPayload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            id: 'test_message_id',
            from: '1234567890',
            text: { body: 'سعر الذهب' },
            timestamp: Math.floor(Date.now() / 1000)
          }],
          contacts: [{
            wa_id: '1234567890'
          }]
        }
      }]
    }]
  };
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookPayload)
    });
    
    const text = await response.text();
    console.log('POST response:', response.status, text);
  } catch (error) {
    console.error('POST test failed:', error);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  testWebhookEndpoint();
}

module.exports = { testWebhookEndpoint };