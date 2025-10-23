// Debug script to test webhook functionality
const axios = require('axios');

// Test webhook payload
const testPayload = {
  entry: [{
    id: "test-entry",
    changes: [{
      value: {
        messages: [{
          id: "test-message-123",
          from: "1234567890",
          timestamp: "1234567890",
          type: "text",
          text: {
            body: "سعر الذهب"
          }
        }]
      }
    }]
  }]
};

async function testWebhook() {
  console.log('Testing webhook with payload:', JSON.stringify(testPayload, null, 2));
  
  try {
    const response = await axios.post('http://localhost:3000/api/webhook', testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Webhook response:', response.status, response.data);
  } catch (error) {
    console.error('Webhook error:', error.response?.status, error.response?.data || error.message);
  }
}

// Check environment variables
console.log('Environment check:');
console.log('WHATSAPP_VERSION:', process.env.WHATSAPP_VERSION || 'NOT SET');
console.log('WHATSAPP_PHONE_NUMBER_ID:', process.env.WHATSAPP_PHONE_NUMBER_ID || 'NOT SET');
console.log('WHATSAPP_TOKEN:', process.env.WHATSAPP_TOKEN ? 'SET' : 'NOT SET');
console.log('VERIFY_TOKEN:', process.env.VERIFY_TOKEN || 'NOT SET');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');
console.log('');

if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN) {
  testWebhook();
} else {
  console.log('Environment variables not set. Please set them first.');
}