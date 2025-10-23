// Test script for your Vercel webhook
const https = require('https');

const WEBHOOK_URL = 'https://lirat-whatsapp-openai.vercel.app/api/webhook';

// Sample WhatsApp message payload
const testPayload = {
  entry: [{
    id: "test-entry-id",
    changes: [{
      value: {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "1234567890",
          phone_number_id: "test_phone_id"
        },
        contacts: [{
          profile: {
            name: "Test User"
          },
          wa_id: "1234567890"
        }],
        messages: [{
          id: "test-message-123",
          from: "1234567890",
          timestamp: "1640995200",
          type: "text",
          text: {
            body: "سعر الذهب"
          }
        }]
      }
    }]
  }]
};

function testWebhook() {
  console.log('Testing webhook with sample WhatsApp payload...');
  console.log('URL:', WEBHOOK_URL);
  console.log('Payload:', JSON.stringify(testPayload, null, 2));
  
  const postData = JSON.stringify(testPayload);
  
  const options = {
    hostname: 'lirat-whatsapp-openai.vercel.app',
    port: 443,
    path: '/api/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const req = https.request(options, (res) => {
    let data = '';
    
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Response Body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Webhook test SUCCESSFUL!');
        console.log('Your webhook is receiving and processing messages correctly.');
      } else {
        console.log('❌ Webhook test FAILED!');
        console.log('Status:', res.statusCode);
      }
    });
  });
  
  req.on('error', (err) => {
    console.error('❌ Request failed:', err.message);
  });
  
  req.write(postData);
  req.end();
}

// Run the test
testWebhook();
